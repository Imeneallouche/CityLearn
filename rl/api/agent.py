"""Digital assistant powered by Agno + Gemini 2.5 Flash.

Provides tools that expose the full CityLearn RL platform: trained models,
episode data, KPI analysis, algorithm explanations, dataset info, and more.
"""

import json
import logging
import os
from typing import Optional

from agno.agent import Agent
from agno.models.google import Gemini
from agno.tools import tool

from .config import (
    discover_models,
    get_dataset_schema,
    get_building_names,
    DATASET_MAP,
    DATASETS_DIR,
    OUTPUTS_DIR,
)
from .data import load_episode_data

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────
#  Tools
# ──────────────────────────────────────────────────

@tool
def list_trained_models() -> str:
    """List all available trained RL models in the platform.

    Returns a catalog of every discovered model with its algorithm name,
    reward variant, dataset size (number of buildings), available evaluation
    episodes, number of checkpoints, and policy type (shared vs independent).
    Use this when the user asks what models are available or wants an overview.
    """
    models = discover_models()
    result = []
    for m in models:
        result.append({
            "model_id": m["model_id"],
            "algorithm": m["algorithm"],
            "reward_variant": m["reward_variant"],
            "dataset_size": m["dataset_size"],
            "num_buildings": m["dataset_size"],
            "policy_type": m["policy_type"],
            "uses_marlisa_wrapper": m["uses_marlisa_wrapper"],
            "num_episodes": len(m["episodes"]),
            "episodes": m["episodes"],
            "num_checkpoints": len(m["checkpoints"]),
        })
    return json.dumps(result, indent=2)


@tool
def get_model_details(model_id: str) -> str:
    """Get detailed information about a specific trained model.

    Args:
        model_id: The model identifier in format 'algorithm/reward_variant/dataset_size'
                   (e.g. 'marlisa/marl/3', 'sac/indep-sac/3').

    Returns complete metadata: algorithm, reward variant, dataset info,
    checkpoint details, policy IDs, episode list, and schema override info.
    """
    models = discover_models()
    models_by_id = {m["model_id"]: m for m in models}
    model = models_by_id.get(model_id)
    if not model:
        available = list(models_by_id.keys())
        return json.dumps({"error": f"Model '{model_id}' not found. Available: {available}"})

    info = {
        "model_id": model["model_id"],
        "algorithm": model["algorithm"],
        "reward_variant": model["reward_variant"],
        "dataset_size": model["dataset_size"],
        "dataset_name": model["dataset_name"],
        "policy_type": model["policy_type"],
        "uses_marlisa_wrapper": model["uses_marlisa_wrapper"],
        "episodes": model["episodes"],
        "checkpoints": [
            {"name": c["name"], "policy_ids": c["policy_ids"]}
            for c in model["checkpoints"]
        ],
        "has_schema_override": model["schema_override"] is not None,
    }

    # Add training config based on algorithm
    if model["algorithm"] in ("sac", "indep-sac"):
        info["training_config"] = {
            "algorithm": "SAC (Soft Actor-Critic)",
            "framework": "PyTorch",
            "replay_buffer": "MultiAgentPrioritizedReplayBuffer",
            "replay_capacity": 1_000_000,
            "prioritized_replay_alpha": 0.6,
            "prioritized_replay_beta": 0.4,
            "policy_type": "shared_policy" if model["policy_type"] == "shared" else "independent per-agent",
            "gpu": True,
            "wrappers": ["NormalizedObservationWrapper", "ClippedObservationWrapper"],
        }
    elif model["algorithm"] == "marlisa":
        info["training_config"] = {
            "algorithm": "MAPPO (Multi-Agent PPO)" if model["reward_variant"] == "marl" else "MAPPO with solar penalty",
            "framework": "PyTorch",
            "learning_rate": 3e-4,
            "gamma": 0.99,
            "lambda": 0.95,
            "clip_param": 0.2,
            "vf_loss_coeff": 0.5,
            "entropy_coeff": 0.01,
            "train_batch_size": 256,
            "minibatch_size": 64,
            "num_epochs": 10,
            "network": {"hidden_layers": [256, 256], "activation": "relu"},
            "vf_share_layers": False,
            "uses_marlisa_wrapper": True,
            "coordination_variables": ["c0 (other agents demand)", "c1 (cumulative energy coefficient)"],
            "wrappers": ["NormalizedObservationWrapper", "ClippedObservationWrapper"],
        }

    return json.dumps(info, indent=2)


@tool
def get_episode_kpis(model_id: str, episode: Optional[str] = None) -> str:
    """Retrieve and analyze KPI metrics for a specific model episode.

    Args:
        model_id: Model identifier (e.g. 'marlisa/marl/3').
        episode: Episode name (e.g. 'marlisa_eval_ep_0200'). If omitted, uses the latest.

    Returns normalized KPIs including cost, carbon emissions, electricity
    consumption, peak demand, daily peak, load factor, and ramping metrics.
    Values < 1.0 mean the RL agent outperforms the baseline.
    """
    models = discover_models()
    models_by_id = {m["model_id"]: m for m in models}
    model = models_by_id.get(model_id)
    if not model:
        return json.dumps({"error": f"Model '{model_id}' not found"})

    if not model["episodes"]:
        return json.dumps({"error": f"No episodes found for {model_id}"})

    ep = episode or model["episodes"][-1]
    if ep not in model["episodes"]:
        return json.dumps({"error": f"Episode '{ep}' not found. Available: {model['episodes']}"})

    data = load_episode_data(model, ep)
    if not data:
        return json.dumps({"error": "Failed to load episode data"})

    result = {
        "model_id": model_id,
        "episode": ep,
        "algorithm": model["algorithm"],
        "dataset_size": model["dataset_size"],
        "timesteps": data["timesteps"],
        "kpis": data.get("kpis", {}),
        "interpretation": {
            "note": "KPI values are normalized against a no-op baseline. Values < 1.0 mean the RL agent performs better than the baseline for that metric.",
            "key_metrics": [
                "cost: Total electricity cost",
                "carbon_emissions: Total CO2 emissions",
                "electricity_consumption: Net electricity consumed",
                "peak: Peak district demand",
                "daily_peak: Average daily peak demand",
                "1-load_factor: Inverse load factor (lower is better, means more uniform load)",
                "ramping: Rate of change in consumption (lower means smoother)",
            ],
        },
    }
    return json.dumps(result, indent=2)


@tool
def get_episode_summary(model_id: str, episode: Optional[str] = None) -> str:
    """Get a summary of episode timeseries data including community energy stats.

    Args:
        model_id: Model identifier (e.g. 'marlisa/marl/3').
        episode: Episode name. If omitted, uses the latest.

    Returns summary statistics of the episode: total/avg/peak community
    consumption, solar generation, CO2, cost, and per-building battery usage.
    """
    models = discover_models()
    models_by_id = {m["model_id"]: m for m in models}
    model = models_by_id.get(model_id)
    if not model:
        return json.dumps({"error": f"Model '{model_id}' not found"})

    if not model["episodes"]:
        return json.dumps({"error": f"No episodes found for {model_id}"})

    ep = episode or model["episodes"][-1]
    data = load_episode_data(model, ep)
    if not data:
        return json.dumps({"error": "Failed to load episode data"})

    com = data["community"]
    net = com["net_consumption"]
    solar = com["solar_generation"]
    co2 = com["co2"]
    cost = com["price_cost"]

    summary = {
        "model_id": model_id,
        "episode": ep,
        "timesteps": data["timesteps"],
        "buildings": data["buildings"],
        "community_stats": {
            "net_consumption": {
                "total_kWh": round(sum(net), 2),
                "avg_kWh": round(sum(net) / len(net), 2) if net else 0,
                "peak_kW": round(max(net), 2) if net else 0,
                "min_kW": round(min(net), 2) if net else 0,
            },
            "solar_generation": {
                "total_kWh": round(sum(solar), 2),
                "avg_kWh": round(sum(solar) / len(solar), 2) if solar else 0,
                "peak_kW": round(max(solar), 2) if solar else 0,
            },
            "co2_kg": round(sum(co2), 2),
            "cost_usd": round(sum(cost), 2),
        },
        "building_battery_summary": {},
    }

    for bname, bdata in data["buildings_data"].items():
        soc = bdata.get("battery_soc", [])
        charge = bdata.get("battery_charge", [])
        net_b = bdata.get("net_consumption", [])
        summary["building_battery_summary"][bname] = {
            "avg_soc_pct": round(sum(soc) / len(soc) * 100, 1) if soc else 0,
            "total_charged_kWh": round(sum(c for c in charge if c > 0), 2) if charge else 0,
            "total_discharged_kWh": round(abs(sum(c for c in charge if c < 0)), 2) if charge else 0,
            "net_consumption_total_kWh": round(sum(net_b), 2) if net_b else 0,
        }

    return json.dumps(summary, indent=2)


@tool
def compare_models(dataset_size: str) -> str:
    """Compare KPIs across all trained models on the same dataset.

    Args:
        dataset_size: Number of buildings ('3' or '6').

    Returns KPIs from the latest episode of each model trained on the
    specified dataset, enabling cross-algorithm performance comparison.
    """
    models = discover_models()
    results = []
    for m in models:
        if str(m["dataset_size"]) != dataset_size:
            continue
        if not m["episodes"]:
            continue
        latest_ep = m["episodes"][-1]
        ep_data = load_episode_data(m, latest_ep)
        if ep_data and ep_data.get("kpis"):
            results.append({
                "model_id": m["model_id"],
                "algorithm": m["algorithm"],
                "reward_variant": m["reward_variant"],
                "episode": latest_ep,
                "kpis": ep_data["kpis"],
            })

    if not results:
        return json.dumps({"error": f"No models found for dataset_size={dataset_size}"})

    return json.dumps({"dataset_size": dataset_size, "models": results}, indent=2)


@tool
def get_building_info(model_id: str) -> str:
    """Get detailed building equipment specifications for a model's dataset.

    Args:
        model_id: Model identifier (e.g. 'marlisa/marl/3').

    Returns per-building specs: PV nominal power, battery capacity/power/efficiency,
    cooling device power/efficiency, DHW device power/efficiency/storage.
    """
    models = discover_models()
    models_by_id = {m["model_id"]: m for m in models}
    model = models_by_id.get(model_id)
    if not model:
        return json.dumps({"error": f"Model '{model_id}' not found"})

    if not model["episodes"]:
        return json.dumps({"error": "No episodes available"})

    data = load_episode_data(model, model["episodes"][-1])
    if not data:
        return json.dumps({"error": "Failed to load data"})

    return json.dumps({
        "model_id": model_id,
        "buildings": data["buildings"],
        "building_specs": data["building_specs"],
    }, indent=2)


@tool
def get_dataset_info(dataset_size: str) -> str:
    """Get metadata about a CityLearn dataset.

    Args:
        dataset_size: Number of buildings ('3' or '6').

    Returns dataset name, building list, simulation time range, observation
    space features, action space, and equipment configuration from the schema.
    """
    dataset_name = DATASET_MAP.get(dataset_size)
    if not dataset_name:
        return json.dumps({"error": f"No dataset for size '{dataset_size}'. Available: {list(DATASET_MAP.keys())}"})

    schema = get_dataset_schema(dataset_name)
    if not schema:
        return json.dumps({"error": f"Schema not found for {dataset_name}"})

    buildings_info = {}
    for bname, cfg in schema.get("buildings", {}).items():
        if not cfg.get("include", True):
            continue
        buildings_info[bname] = {
            "pv_nominal_power": cfg["pv"]["attributes"]["nominal_power"],
            "battery_capacity": cfg["electrical_storage"]["attributes"]["capacity"],
            "battery_power": cfg["electrical_storage"]["attributes"]["nominal_power"],
            "cooling_power": cfg["cooling_device"]["attributes"]["nominal_power"],
            "dhw_power": cfg["dhw_device"]["attributes"]["nominal_power"],
            "active_observations": [
                obs for obs, active in cfg.get("inactive_observations", {}).items()
                if not active
            ] if "inactive_observations" in cfg else "all",
            "active_actions": [
                act for act, active in cfg.get("inactive_actions", {}).items()
                if not active
            ] if "inactive_actions" in cfg else "all",
        }

    info = {
        "dataset_name": dataset_name,
        "dataset_size": dataset_size,
        "num_buildings": len(buildings_info),
        "simulation_start_time_step": schema.get("simulation_start_time_step", 0),
        "simulation_end_time_step": schema.get("simulation_end_time_step"),
        "seconds_per_time_step": schema.get("seconds_per_time_step", 3600),
        "buildings": buildings_info,
        "reward_function": schema.get("reward_function", {}).get("type", "unknown"),
    }

    return json.dumps(info, indent=2)


@tool
def explain_citylearn() -> str:
    """Explain the CityLearn environment, how it works, and its role in this project.

    Returns a comprehensive explanation of the CityLearn simulation platform,
    the observation space, action space, reward function, and how RL agents
    interact with it for smart building energy management.
    """
    explanation = {
        "overview": (
            "CityLearn is an OpenAI Gymnasium-compatible environment for benchmarking "
            "multi-agent reinforcement learning for building energy coordination. "
            "It simulates a district of residential/commercial buildings, each equipped "
            "with solar PV panels, battery storage, cooling systems, and domestic hot water (DHW) devices."
        ),
        "objective": (
            "The goal is to train RL agents that control battery charging/discharging "
            "to minimize district-level electricity cost, carbon emissions, and peak demand, "
            "while maintaining occupant comfort (indoor temperature within setpoints)."
        ),
        "observation_space": {
            "description": "Each building agent observes local state variables",
            "key_features": [
                "month, hour, day_type (temporal context)",
                "indoor_dry_bulb_temperature (comfort metric)",
                "non_shiftable_load (base electrical demand in kWh)",
                "solar_generation (PV output in kWh)",
                "cooling_demand, dhw_demand (thermal loads)",
                "electrical_storage_soc (battery state-of-charge)",
                "electricity_pricing (current and predicted 1-3h ahead)",
                "carbon_intensity (grid carbon factor)",
                "outdoor_temperature, humidity, irradiance (weather)",
            ],
        },
        "action_space": {
            "description": "Each agent outputs a continuous action in [-1, 1]",
            "meaning": (
                "The action controls battery charging: positive values charge the battery "
                "(store energy), negative values discharge (release energy to offset grid import). "
                "The magnitude is proportional to the battery's nominal power."
            ),
        },
        "reward_function": (
            "The default CityLearn reward penalizes high net electricity consumption. "
            "Variants include solar penalty rewards that also penalize wasted solar generation. "
            "The reward is designed to encourage peak shaving, load shifting, and solar self-consumption."
        ),
        "evaluation_kpis": {
            "description": "Performance is measured via normalized KPIs (< 1.0 = better than baseline)",
            "metrics": [
                "cost: Total electricity cost",
                "carbon_emissions: Total CO2",
                "electricity_consumption: Net consumption",
                "peak: Peak district demand",
                "daily_peak: Average daily peak",
                "1-load_factor: Load uniformity (lower = flatter profile)",
                "ramping: Consumption smoothness (lower = less volatile)",
            ],
        },
        "wrappers_used": [
            "NormalizedObservationWrapper: Min-max normalization + cyclical cosine encoding for temporal features",
            "ClippedObservationWrapper: Clips observations to valid range (required for RLlib)",
            "RLlibMultiAgentEnv: Adapts CityLearn to RLlib's multi-agent interface",
        ],
        "datasets_in_this_project": {
            "3-building": "CityLearn Challenge 2023 Phase 2 (local evaluation) — 3 buildings, ~2209 timesteps (~92 days)",
            "6-building": "CityLearn Challenge 2023 Phase 3.3 — 6 buildings, ~2209 timesteps",
        },
    }
    return json.dumps(explanation, indent=2)


@tool
def explain_algorithm(algorithm_name: str) -> str:
    """Explain a specific RL algorithm used in this project.

    Args:
        algorithm_name: One of 'sac', 'mappo', 'marlisa', or 'rbc'.

    Returns a detailed explanation of the algorithm, its key characteristics,
    hyperparameters used, and how it's applied in the CityLearn context.
    """
    algorithms = {
        "sac": {
            "full_name": "Soft Actor-Critic (SAC)",
            "type": "Off-policy, model-free, actor-critic",
            "key_idea": (
                "SAC maximizes both expected reward AND entropy (randomness) of the policy. "
                "This encourages exploration and prevents premature convergence to suboptimal "
                "deterministic strategies. It uses twin Q-networks to reduce overestimation bias."
            ),
            "in_this_project": {
                "configuration": "Single shared policy for all building agents",
                "replay_buffer": "MultiAgentPrioritizedReplayBuffer (1M capacity)",
                "prioritized_replay": "alpha=0.6, beta=0.4 (prioritizes surprising transitions)",
                "framework": "PyTorch on GPU",
                "wrappers": ["NormalizedObservation", "ClippedObservation"],
            },
            "strengths": [
                "Sample-efficient (reuses past experience via replay buffer)",
                "Stable training via entropy regularization",
                "Works well with continuous action spaces (battery control)",
            ],
            "weaknesses": [
                "No explicit multi-agent coordination mechanism",
                "Shared policy treats each building identically",
            ],
        },
        "mappo": {
            "full_name": "Multi-Agent Proximal Policy Optimization (MAPPO)",
            "type": "On-policy, model-free, actor-critic with CTDE",
            "key_idea": (
                "MAPPO extends PPO to multi-agent settings using Centralized Training with "
                "Decentralized Execution (CTDE). During training, the shared critic sees data "
                "from all agents. During execution, each agent acts based only on its local observation."
            ),
            "in_this_project": {
                "parameter_sharing": "All agents share ONE policy network",
                "separate_value_network": "vf_share_layers=False — critic has its own parameters",
                "hyperparameters": {
                    "learning_rate": 3e-4,
                    "gamma": 0.99,
                    "lambda_gae": 0.95,
                    "clip_param": 0.2,
                    "vf_loss_coeff": 0.5,
                    "entropy_coeff": 0.01,
                    "train_batch_size": 256,
                    "minibatch_size": 64,
                    "sgd_epochs": 10,
                },
                "network": "2-layer MLP [256, 256] with ReLU activation",
            },
            "strengths": [
                "CTDE enables coordination during training while keeping decentralized execution",
                "Parameter sharing dramatically reduces model size for many agents",
                "PPO clipping prevents destructive policy updates",
            ],
            "weaknesses": [
                "On-policy: cannot reuse old experience (less sample-efficient than SAC)",
                "Shared policy assumes homogeneous agents",
            ],
        },
        "marlisa": {
            "full_name": "Multi-Agent RL with Iterative Sequential Action (MARLISA)",
            "type": "Coordination wrapper extending base MARL algorithms",
            "key_idea": (
                "MARLISA augments each agent's observation with 2D coordination variables: "
                "c0 = normalized electricity demand of other agents, and "
                "c1 = cumulative energy coefficient based on agent processing order. "
                "This gives each agent implicit awareness of the district state without "
                "requiring explicit communication channels."
            ),
            "in_this_project": {
                "wrapper": "MARLISAEnv extends RLlibMultiAgentEnv",
                "coordination_variables": {
                    "c0": "Other agents' average electricity demand (normalized)",
                    "c1": "Cumulative energy coefficient — encodes ordering information based on electrical storage capacity",
                },
                "energy_weighting": "Agents are weighted by their electrical storage capacity relative to total district capacity",
                "base_algorithm": "Combined with MAPPO for training",
            },
            "strengths": [
                "Enables emergent coordination without explicit communication",
                "Simple observation augmentation — no architecture changes needed",
                "Energy-weighted coefficients capture building heterogeneity",
            ],
            "weaknesses": [
                "Sequential agent ordering introduces asymmetry",
                "Coordination quality depends on the informativeness of c0, c1",
            ],
        },
        "rbc": {
            "full_name": "Rule-Based Controller (BasicRBC)",
            "type": "Heuristic baseline (no learning)",
            "key_idea": (
                "A simple hour-based controller that follows fixed rules: "
                "charge batteries during low-price/high-solar hours, "
                "discharge during peak demand hours. No learning involved."
            ),
            "in_this_project": {
                "role": "Baseline agent for comparison",
                "implementation": "CityLearn's built-in BasicRBC class",
            },
            "strengths": [
                "No training required — works immediately",
                "Interpretable and predictable behavior",
            ],
            "weaknesses": [
                "Cannot adapt to changing conditions",
                "Does not optimize for district-level coordination",
                "Fixed heuristics may not suit all building configurations",
            ],
        },
    }

    name = algorithm_name.lower().strip()
    if name in algorithms:
        return json.dumps(algorithms[name], indent=2)

    return json.dumps({
        "error": f"Unknown algorithm: '{algorithm_name}'",
        "available": list(algorithms.keys()),
        "hint": "Try 'sac', 'mappo', 'marlisa', or 'rbc'",
    })


@tool
def get_baseline_comparison(model_id: str, baseline_type: str = "baseline") -> str:
    """Compare an RL model's performance against a baseline agent.

    Args:
        model_id: Model identifier (e.g. 'marlisa/marl/3').
        baseline_type: Either 'baseline' (no-op) or 'rbc' (rule-based controller).

    Returns side-by-side KPI comparison and summary statistics showing
    how much the RL agent improves (or doesn't) over the baseline.
    """
    models = discover_models()
    models_by_id = {m["model_id"]: m for m in models}
    model = models_by_id.get(model_id)
    if not model:
        return json.dumps({"error": f"Model '{model_id}' not found"})

    if not model["episodes"]:
        return json.dumps({"error": "No episodes available"})

    # Load RL agent data
    latest_ep = model["episodes"][-1]
    agent_data = load_episode_data(model, latest_ep)
    if not agent_data:
        return json.dumps({"error": "Failed to load agent data"})

    # Load baseline data
    try:
        from .baselines import get_baseline_data
        baseline_data = get_baseline_data(model["dataset_name"], baseline_type)
    except Exception as e:
        return json.dumps({"error": f"Baseline generation failed: {str(e)}"})

    # Compare KPIs
    agent_kpis = agent_data.get("kpis", {})
    baseline_kpis = baseline_data.get("kpis", {})

    comparison = {
        "model_id": model_id,
        "episode": latest_ep,
        "baseline_type": baseline_type,
        "agent_kpis": agent_kpis,
        "baseline_kpis": baseline_kpis,
    }

    # Compute community-level summary
    agent_com = agent_data["community"]
    baseline_com = baseline_data["community"]
    comparison["community_comparison"] = {
        "agent": {
            "total_consumption_kWh": round(sum(agent_com["net_consumption"]), 2),
            "total_co2_kg": round(sum(agent_com["co2"]), 2),
            "total_cost_usd": round(sum(agent_com["price_cost"]), 2),
            "peak_demand_kW": round(max(agent_com["net_consumption"]), 2),
        },
        "baseline": {
            "total_consumption_kWh": round(sum(baseline_com["net_consumption"]), 2),
            "total_co2_kg": round(sum(baseline_com["co2"]), 2),
            "total_cost_usd": round(sum(baseline_com["price_cost"]), 2),
            "peak_demand_kW": round(max(baseline_com["net_consumption"]), 2),
        },
    }

    return json.dumps(comparison, indent=2)


# ──────────────────────────────────────────────────
#  Agent Factory
# ──────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert digital assistant for a CityLearn Reinforcement Learning platform.

This platform trains multi-agent RL algorithms (SAC, MAPPO, MARLISA) to manage battery
storage across a district of smart buildings, optimizing for electricity cost, carbon
emissions, and peak demand reduction.

You have access to tools that let you:
- List and inspect trained models
- Analyze episode data and KPIs
- Compare models against baselines and each other
- Explain the CityLearn environment, algorithms, and datasets
- Get building equipment specifications

Guidelines:
- Be precise and data-driven. When the user asks about performance, use tools to fetch actual numbers.
- Interpret KPI values: < 1.0 means the RL agent outperforms the baseline for that metric.
- Use markdown formatting for readability: tables, lists, bold for emphasis.
- When comparing models, highlight which algorithm performs best and why.
- If the user asks a general question you can answer from your knowledge, do so directly.
- If data is needed, call the appropriate tool first, then summarize findings clearly.
- Be conversational but concise. Avoid unnecessary verbosity.
"""

ALL_TOOLS = [
    list_trained_models,
    get_model_details,
    get_episode_kpis,
    get_episode_summary,
    compare_models,
    get_building_info,
    get_dataset_info,
    explain_citylearn,
    explain_algorithm,
    get_baseline_comparison,
]


def create_agent() -> Agent:
    """Create a fresh Agno agent instance with Gemini 2.5 Flash."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    return Agent(
        model=Gemini(id="gemini-2.5-flash", api_key=api_key),
        tools=ALL_TOOLS,
        instructions=[SYSTEM_PROMPT],
        markdown=True,
        show_tool_calls=False,
    )


def _extract_tool_calls(response) -> list[dict]:
    """Extract tool call info from an Agno RunResponse."""
    if not response.messages:
        return []

    # Collect assistant tool_calls (name + args) and tool results separately
    calls = []   # {"name", "args"}
    results = []  # {"tool_call_id"|index, "result"}

    for msg in response.messages:
        role = getattr(msg, "role", None)

        # Assistant messages may contain tool_calls
        if role == "assistant" or role == "model":
            tc_list = getattr(msg, "tool_calls", None)
            if tc_list:
                for tc in tc_list:
                    fn = getattr(tc, "function", tc)
                    name = getattr(fn, "name", None) or str(fn)
                    raw_args = getattr(fn, "arguments", None) or {}
                    if isinstance(raw_args, str):
                        try:
                            raw_args = json.loads(raw_args)
                        except (json.JSONDecodeError, TypeError):
                            raw_args = {"raw": raw_args}
                    calls.append({"name": name, "args": raw_args})

        # Tool messages carry results
        if role == "tool":
            content = getattr(msg, "content", "") or ""
            if not isinstance(content, str):
                content = json.dumps(content)
            results.append(content)

    # Pair calls with results
    final = []
    for i, call in enumerate(calls):
        result_str = results[i] if i < len(results) else ""
        if len(result_str) > 2000:
            result_str = result_str[:2000] + "\n... (truncated)"
        final.append({
            "name": call["name"],
            "args": call["args"],
            "result": result_str,
        })

    # If there are results without matching calls (some providers skip the assistant tool_call message)
    if not calls and results:
        for r in results:
            if len(r) > 2000:
                r = r[:2000] + "\n... (truncated)"
            final.append({"name": "tool", "args": {}, "result": r})

    return final


def _clean_content(content: str) -> str:
    """Strip raw tool-call JSON blobs that Gemini sometimes injects into the response text."""
    if not content:
        return ""

    result = content
    # Repeatedly find and remove top-level JSON objects that look like tool calls
    while True:
        # Find the start of a potential tool-call blob
        idx = result.find('"type": "function"')
        if idx == -1:
            idx = result.find("'type': 'function'")
        if idx == -1:
            break

        # Walk backwards to find the opening brace
        start = idx
        while start > 0 and result[start] != '{':
            start -= 1
        if result[start] != '{':
            break

        # Walk forward to find the matching closing brace
        depth = 0
        end = start
        while end < len(result):
            if result[end] == '{':
                depth += 1
            elif result[end] == '}':
                depth -= 1
                if depth == 0:
                    end += 1
                    break
            end += 1

        # Remove this blob
        result = result[:start] + result[end:]

    return result.strip()


def chat(messages: list[dict], session_id: str | None = None) -> dict:
    """Process a chat request and return the response with tool call details.

    Args:
        messages: List of {"role": "user"|"assistant", "content": "..."} dicts.
        session_id: Optional session identifier for conversation continuity.

    Returns:
        {"content": str, "tool_calls": [{"name": str, "args": dict, "result": str}, ...]}
    """
    agent = create_agent()
    user_message = messages[-1]["content"] if messages else ""
    response = agent.run(user_message)

    content = response.content or ""
    content = _clean_content(content)

    return {
        "content": content,
        "tool_calls": _extract_tool_calls(response),
    }
