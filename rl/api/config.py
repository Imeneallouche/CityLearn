"""Auto-discovery of trained models, datasets, and evaluation episodes."""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASETS_DIR = PROJECT_ROOT / "datasets"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
SIM_DIR = PROJECT_ROOT / "sim"

DATASET_MAP = {
    "3": "citylearn_challenge_2023_phase_2_local_evaluation",
    "6": "citylearn_challenge_2023_phase_3_3",
}


def discover_models() -> list[dict]:
    """Walk outputs/ to find all trained model variants with their metadata."""
    models = []
    if not OUTPUTS_DIR.exists():
        return models

    for algo_dir in sorted(OUTPUTS_DIR.iterdir()):
        if not algo_dir.is_dir():
            continue
        algorithm = algo_dir.name  # e.g. "marlisa", "sac"

        for reward_dir in sorted(algo_dir.iterdir()):
            if not reward_dir.is_dir():
                continue
            reward_variant = reward_dir.name  # e.g. "marl", "indep-sac", "solar-penalty"

            for size_dir in sorted(reward_dir.iterdir()):
                if not size_dir.is_dir():
                    continue
                dataset_size = size_dir.name  # e.g. "3", "6"
                dataset_name = DATASET_MAP.get(dataset_size)
                if dataset_name is None:
                    continue

                model_id = f"{algorithm}/{reward_variant}/{dataset_size}"

                # Find best checkpoint (latest by name)
                ckpt_dir = size_dir / "checkpoints"
                checkpoints = []
                if ckpt_dir.exists():
                    for cp in sorted(ckpt_dir.iterdir()):
                        meta_file = cp / "rllib_checkpoint.json"
                        if meta_file.exists():
                            with meta_file.open() as f:
                                meta = json.load(f)
                            checkpoints.append({
                                "path": str(cp),
                                "name": cp.name,
                                "policy_ids": meta.get("policy_ids", []),
                            })

                # Find schema override
                schema_dir = size_dir / "schemas"
                schema_override = None
                if schema_dir.exists():
                    for s in schema_dir.glob("*.json"):
                        schema_override = str(s)
                        break

                # Find evaluation episodes
                episodes = []
                ui_dir = size_dir / "ui_exports"
                if ui_dir.exists():
                    for ep_dir in sorted(ui_dir.iterdir()):
                        if ep_dir.is_dir() and (ep_dir / "exported_kpis.csv").exists():
                            episodes.append(ep_dir.name)

                # Determine policy mapping type
                policy_type = "shared"
                if checkpoints:
                    pids = checkpoints[-1]["policy_ids"]
                    if any(pid.startswith("agent_") for pid in pids):
                        policy_type = "independent"

                # Determine if MARLISA wrapper needed
                uses_marlisa_wrapper = algorithm == "marlisa"

                models.append({
                    "model_id": model_id,
                    "algorithm": algorithm,
                    "reward_variant": reward_variant,
                    "dataset_size": int(dataset_size),
                    "dataset_name": dataset_name,
                    "policy_type": policy_type,
                    "uses_marlisa_wrapper": uses_marlisa_wrapper,
                    "checkpoints": checkpoints,
                    "best_checkpoint": checkpoints[-1] if checkpoints else None,
                    "schema_override": schema_override,
                    "episodes": episodes,
                    "ui_exports_dir": str(ui_dir) if ui_dir.exists() else None,
                })

    return models


def get_dataset_schema(dataset_name: str) -> dict | None:
    """Load and return the raw dataset schema.json."""
    schema_path = DATASETS_DIR / dataset_name / "schema.json"
    if schema_path.exists():
        with schema_path.open() as f:
            return json.load(f)
    return None


def get_building_names(dataset_name: str) -> list[str]:
    """Extract building names from the dataset schema."""
    schema = get_dataset_schema(dataset_name)
    if schema and "buildings" in schema:
        return [name for name, cfg in schema["buildings"].items() if cfg.get("include", True)]
    return []
