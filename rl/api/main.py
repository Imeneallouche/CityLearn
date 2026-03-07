"""FastAPI application: serves episode data, model catalog, and the simulation UI."""

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import SIM_DIR, discover_models, get_dataset_schema, get_building_names
from .data import load_episode_data, load_carbon_intensity

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CityLearn RL Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Model catalog (built once at startup) ---
_models_cache: list[dict] = []
_models_by_id: dict[str, dict] = {}


@app.on_event("startup")
def startup():
    global _models_cache, _models_by_id
    _models_cache = discover_models()
    _models_by_id = {m["model_id"]: m for m in _models_cache}
    logger.info("Discovered %d models: %s", len(_models_cache), [m["model_id"] for m in _models_cache])


# ──────────────────────────────────────────────
#  API Routes
# ──────────────────────────────────────────────

@app.get("/api/catalog")
def get_catalog():
    """Return all available models with their episodes and datasets."""
    catalog = []
    for m in _models_cache:
        catalog.append({
            "model_id": m["model_id"],
            "algorithm": m["algorithm"],
            "reward_variant": m["reward_variant"],
            "dataset_size": m["dataset_size"],
            "dataset_name": m["dataset_name"],
            "policy_type": m["policy_type"],
            "uses_marlisa_wrapper": m["uses_marlisa_wrapper"],
            "episodes": m["episodes"],
            "num_checkpoints": len(m["checkpoints"]),
            "has_schema_override": m["schema_override"] is not None,
        })
    return {"models": catalog}


@app.get("/api/models/{algo}/{reward}/{size}/episodes")
def get_episodes(algo: str, reward: str, size: str):
    """List evaluation episodes for a model."""
    model_id = f"{algo}/{reward}/{size}"
    model = _models_by_id.get(model_id)
    if not model:
        raise HTTPException(404, f"Model not found: {model_id}")
    return {"model_id": model_id, "episodes": model["episodes"]}


@app.get("/api/models/{algo}/{reward}/{size}/episodes/{episode}")
def get_episode_data(algo: str, reward: str, size: str, episode: str):
    """Load full episode data (community + buildings + weather + KPIs)."""
    model_id = f"{algo}/{reward}/{size}"
    model = _models_by_id.get(model_id)
    if not model:
        raise HTTPException(404, f"Model not found: {model_id}")
    if episode not in model["episodes"]:
        raise HTTPException(404, f"Episode not found: {episode}")

    data = load_episode_data(model, episode)
    if data is None:
        raise HTTPException(500, "Failed to load episode data")

    # Add carbon intensity
    ci = load_carbon_intensity(model["dataset_name"], data["timesteps"])
    data["carbon_intensity"] = ci

    return data


@app.get("/api/datasets/{dataset_name}/schema")
def get_schema(dataset_name: str):
    """Return the raw CityLearn schema for a dataset."""
    schema = get_dataset_schema(dataset_name)
    if schema is None:
        raise HTTPException(404, f"Dataset not found: {dataset_name}")
    return schema


@app.get("/api/health")
def health():
    from . import simulation
    return {
        "status": "ok",
        "models_loaded": len(_models_cache),
        "live_simulation_available": simulation.is_available(),
    }


# ──────────────────────────────────────────────
#  Static files (Simulation UI)
# ──────────────────────────────────────────────

if SIM_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(SIM_DIR)), name="static")

    @app.get("/")
    def serve_index():
        index_path = SIM_DIR / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        raise HTTPException(404, "UI not found")
