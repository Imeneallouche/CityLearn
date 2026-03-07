"""Generate baseline agent episode data for comparison.

Uses CityLearn's built-in agents:
  - BaselineAgent (from citylearn.agents.base) — empty actions, true no-op baseline
  - BasicRBC (from citylearn.agents.rbc) — hour-based rule-based controller

Cached on disk after first run to avoid re-simulation.
"""

import json
import logging
from pathlib import Path

import numpy as np

from .config import DATASETS_DIR, OUTPUTS_DIR, DATASET_MAP, get_dataset_schema

logger = logging.getLogger(__name__)

BASELINES_DIR = OUTPUTS_DIR.parent / "baselines_cache"

AGENT_TYPES = {
    "baseline": "BaselineAgent",
    "rbc": "BasicRBC",
}


def _cache_path(dataset_name: str, agent_type: str) -> Path:
    return BASELINES_DIR / f"{agent_type}_{dataset_name}.json"


def _make_agent(env, agent_type: str):
    """Instantiate the appropriate CityLearn agent."""
    if agent_type == "baseline":
        from citylearn.agents.base import BaselineAgent
        return BaselineAgent(env)
    elif agent_type == "rbc":
        from citylearn.agents.rbc import BasicRBC
        return BasicRBC(env)
    else:
        raise ValueError(f"Unknown agent type: {agent_type}. Choose from: {list(AGENT_TYPES)}")


def _run_baseline(dataset_name: str, agent_type: str) -> dict:
    """Run a CityLearn simulation with the given agent and return results
    in the standard episode data format."""
    from citylearn.citylearn import CityLearnEnv

    schema_path = DATASETS_DIR / dataset_name / "schema.json"
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema not found: {schema_path}")

    env = CityLearnEnv(str(schema_path))
    agent = _make_agent(env, agent_type)

    # Run one deterministic episode
    agent.learn(episodes=1, deterministic=True, logging_level=logging.WARNING)

    # --- Extract data from env post-episode ---
    building_names = [b.name for b in env.buildings]
    n_buildings = len(building_names)
    n_steps = len(env.buildings[0].net_electricity_consumption)

    # Community timeseries
    ts_community_net = []
    ts_community_solar = []
    ts_community_co2 = []
    ts_community_cost = []

    for i in range(n_steps):
        net = float(sum(b.net_electricity_consumption[i] for b in env.buildings))
        solar = float(sum(abs(b.solar_generation[i]) for b in env.buildings))
        ts_community_net.append(net)
        ts_community_solar.append(solar)

        ci = float(env.buildings[0].carbon_intensity.carbon_intensity[i]) if hasattr(env.buildings[0], 'carbon_intensity') else 0.0
        price = float(env.buildings[0].pricing.electricity_pricing[i]) if hasattr(env.buildings[0], 'pricing') else 0.0
        ts_community_co2.append(net * ci if net > 0 else 0.0)
        ts_community_cost.append(net * price if net > 0 else 0.0)

    # Per-building timeseries
    ts_building = {}
    for b in env.buildings:
        cap = max(b.electrical_storage.capacity, 0.01)
        ts_building[b.name] = {
            "net_consumption": [float(v) for v in b.net_electricity_consumption],
            "non_shiftable_load": [float(v) for v in b.non_shiftable_load],
            "pv_generation": [float(abs(v)) for v in b.solar_generation],
            "battery_soc": [float(v / cap) for v in b.electrical_storage.soc],
            "battery_charge": [float(v) for v in b.electrical_storage.energy_balance],
            "indoor_temperature": [float(v) for v in b.indoor_dry_bulb_temperature],
            "cooling_demand": [float(v) for v in b.cooling_demand],
            "dhw_demand": [float(v) for v in b.dhw_demand],
        }

    # KPIs via CityLearn's built-in evaluation
    kpis = {}
    try:
        kpi_df = env.evaluate()
        for _, row in kpi_df.iterrows():
            name = row.get("name", "")
            cost_fn = row.get("cost_function", "")
            value = row.get("value", 0.0)
            if not name or not cost_fn:
                continue
            if name not in kpis:
                kpis[name] = {}
            kpis[name][cost_fn] = float(value) if not np.isnan(value) else 0.0
    except Exception:
        logger.exception("KPI evaluation failed")

    # Building specs from schema
    schema = get_dataset_schema(dataset_name)
    building_specs = {}
    for bname in building_names:
        cfg = schema["buildings"][bname]
        building_specs[bname] = {
            "pv_nominal_power": cfg["pv"]["attributes"]["nominal_power"],
            "battery_capacity": cfg["electrical_storage"]["attributes"]["capacity"],
            "battery_nominal_power": cfg["electrical_storage"]["attributes"]["nominal_power"],
        }

    return {
        "model_id": f"baseline/{agent_type}/{n_buildings}",
        "episode": "baseline",
        "algorithm": agent_type,
        "reward_variant": "baseline",
        "dataset_name": dataset_name,
        "dataset_size": n_buildings,
        "timesteps": n_steps,
        "buildings": building_names,
        "community": {
            "timestamps": list(range(n_steps)),
            "net_consumption": ts_community_net,
            "solar_generation": ts_community_solar,
            "co2": ts_community_co2,
            "price_cost": ts_community_cost,
            "self_consumption": [0.0] * n_steps,
            "stored_energy": [0.0] * n_steps,
        },
        "buildings_data": ts_building,
        "weather": {},
        "pricing": {},
        "kpis": kpis,
        "building_specs": building_specs,
    }


def get_baseline_data(dataset_name: str, agent_type: str) -> dict:
    """Return baseline episode data, from cache if available."""
    if agent_type not in AGENT_TYPES:
        raise ValueError(f"Unknown baseline: {agent_type}. Choose from: {list(AGENT_TYPES)}")

    cache = _cache_path(dataset_name, agent_type)
    if cache.exists():
        logger.info("Loading cached baseline: %s/%s", agent_type, dataset_name)
        with cache.open() as f:
            return json.load(f)

    logger.info("Running baseline simulation: %s/%s (this may take a moment)", agent_type, dataset_name)
    data = _run_baseline(dataset_name, agent_type)

    # Cache to disk
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)
    with cache.open("w") as f:
        json.dump(data, f)
    logger.info("Cached baseline to %s", cache)

    return data


def list_baselines(dataset_name: str) -> list[dict]:
    """Return available baseline types for a dataset."""
    return [
        {"type": "baseline", "label": "Baseline (No-Op)"},
        {"type": "rbc", "label": "Rule-Based Controller (BasicRBC)"},
    ]
