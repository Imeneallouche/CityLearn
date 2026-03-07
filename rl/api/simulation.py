"""Optional live simulation engine using Ray RLlib and CityLearn.

This module is only used when Ray and CityLearn are available.
The API works fine without it (serving pre-computed episode data).
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_RAY_AVAILABLE = False
try:
    import ray
    import numpy as np
    from ray.rllib.algorithms.algorithm import Algorithm
    from citylearn.wrappers import (
        ClippedObservationWrapper,
        NormalizedObservationWrapper,
        RLlibMultiAgentEnv,
    )
    from gymnasium import spaces
    _RAY_AVAILABLE = True
except ImportError:
    pass


def is_available() -> bool:
    return _RAY_AVAILABLE


class MARLISAEnv(RLlibMultiAgentEnv):
    """MARLISA wrapper: extends observations with coordination variables."""

    def __init__(self, env_config):
        super().__init__(env_config)
        base = self.env
        while hasattr(base, "env"):
            base = base.env
        self._base_env = base

        coeffs = []
        for b in self._base_env.buildings:
            es = b.electrical_storage
            coef = max(es.capacity * es.nominal_power, 0.1)
            coeffs.append(coef)
        total = sum(coeffs)
        self._energy_coef = [c / total for c in coeffs]

        extended = {}
        for agent_id in self._agent_ids:
            orig = self.observation_space[agent_id]
            low = np.concatenate([orig.low, np.array([-5.0, 0.0], dtype=np.float32)])
            high = np.concatenate([orig.high, np.array([5.0, 1.0], dtype=np.float32)])
            extended[agent_id] = spaces.Box(low=low, high=high, dtype=np.float32)
        self.observation_space = spaces.Dict(extended)
        self._coord_vars = {a: np.zeros(2, dtype=np.float32) for a in self._agent_ids}
        self._rng = np.random.default_rng(42)
        self.possible_agents = list(self._agent_ids)

    def _augment(self, observations):
        return {
            aid: np.concatenate([obs, self._coord_vars[aid]])
            for aid, obs in observations.items()
        }

    def _update_coordination(self):
        demands = [b.net_electricity_consumption[-1] for b in self._base_env.buildings]
        total_demand = sum(demands)
        total_coef = sum(self._energy_coef)
        order = list(range(len(self._agent_ids)))
        self._rng.shuffle(order)

        for idx, agent_id in enumerate(self._agent_ids):
            other_demand = total_demand - demands[idx]
            c0 = np.clip(other_demand / max(total_coef, 1e-8), -5.0, 5.0)
            pos = order.index(idx)
            c1 = sum(self._energy_coef[order[j]] for j in range(pos))
            self._coord_vars[agent_id] = np.array([c0, c1], dtype=np.float32)

    def reset(self, *, seed=None, options=None):
        observations, info = super().reset(seed=seed, options=options)
        self._coord_vars = {a: np.zeros(2, dtype=np.float32) for a in self._agent_ids}
        return self._augment(observations), info

    def step(self, action_dict):
        observations, rewards, terminated, truncated, info = super().step(action_dict)
        self._update_coordination()
        return self._augment(observations), rewards, terminated, truncated, info


class SimulationEngine:
    """Manages a live simulation with a loaded model checkpoint."""

    def __init__(self, model_info: dict, schema_path: str):
        if not _RAY_AVAILABLE:
            raise RuntimeError("Ray/RLlib not available. Install ray[rllib] and citylearn.")

        if not ray.is_initialized():
            ray.init(ignore_reinit_error=True, num_gpus=0)

        self.model_info = model_info
        self.schema_path = schema_path
        self.algo = None
        self.env = None
        self.obs = None
        self.step_count = 0

    def load_model(self, checkpoint_path: str):
        """Load an RLlib algorithm from a checkpoint."""
        self.algo = Algorithm.from_checkpoint(checkpoint_path)
        logger.info("Loaded checkpoint: %s", checkpoint_path)

    def reset(self):
        """Create environment and reset for a new episode."""
        env_config = {
            "env_kwargs": {
                "schema": self.schema_path,
                "render_mode": "none",
            },
            "wrappers": [NormalizedObservationWrapper, ClippedObservationWrapper],
        }

        if self.model_info["uses_marlisa_wrapper"]:
            self.env = MARLISAEnv(env_config)
        else:
            self.env = RLlibMultiAgentEnv(env_config)

        self.obs, _ = self.env.reset()
        self.step_count = 0
        return self._get_state()

    def step(self):
        """Run one simulation step with the loaded agent."""
        if self.algo is None or self.env is None:
            raise RuntimeError("Call load_model() and reset() first.")

        if self.env.terminated:
            return self._get_state()

        policy_type = self.model_info["policy_type"]
        actions = {}
        for agent_id, agent_obs in self.obs.items():
            if policy_type == "shared":
                pid = "shared_policy"
            else:
                pid = agent_id
            actions[agent_id] = self.algo.compute_single_action(
                agent_obs, policy_id=pid, explore=False
            )

        self.obs, rewards, _, _, _ = self.env.step(actions)
        self.step_count += 1

        state = self._get_state()
        state["rewards"] = {k: float(v) for k, v in rewards.items()}
        state["actions"] = {k: v.tolist() if hasattr(v, "tolist") else list(v) for k, v in actions.items()}
        return state

    def _get_state(self):
        """Extract current environment state."""
        base = self.env
        while hasattr(base, "env"):
            base = base.env

        buildings_state = {}
        for b in base.buildings:
            buildings_state[b.name] = {
                "net_consumption": b.net_electricity_consumption[-1] if b.net_electricity_consumption else 0,
                "battery_soc": b.electrical_storage.soc[-1] if b.electrical_storage.soc else 0,
                "indoor_temperature": b.indoor_dry_bulb_temperature[-1] if b.indoor_dry_bulb_temperature else 0,
                "cooling_demand": b.cooling_demand[-1] if b.cooling_demand else 0,
                "solar_generation": b.solar_generation[-1] if b.solar_generation else 0,
            }

        return {
            "step": self.step_count,
            "terminated": bool(self.env.terminated),
            "buildings": buildings_state,
        }

    def close(self):
        if self.env:
            self.env.close()
        if self.algo:
            self.algo.stop()
