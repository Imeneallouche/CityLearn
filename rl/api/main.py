"""FastAPI application: serves episode data, model catalog, and the simulation UI."""

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import discover_models, get_dataset_schema, get_building_names, get_static_dir, DATASET_MAP
from .data import load_episode_data, load_carbon_intensity
from .baselines import get_baseline_data, list_baselines

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
#  Baseline / Comparison Routes
# ──────────────────────────────────────────────

@app.get("/api/baselines/{dataset_size}")
def get_baselines(dataset_size: str):
    """List available baseline agent types for a dataset size."""
    dataset_name = DATASET_MAP.get(dataset_size)
    if not dataset_name:
        raise HTTPException(404, f"No dataset for size: {dataset_size}")
    return {"baselines": list_baselines(dataset_name)}


@app.get("/api/baselines/{dataset_size}/{agent_type}")
def get_baseline(dataset_size: str, agent_type: str):
    """Run or return cached baseline agent episode for comparison."""
    dataset_name = DATASET_MAP.get(dataset_size)
    if not dataset_name:
        raise HTTPException(404, f"No dataset for size: {dataset_size}")
    try:
        data = get_baseline_data(dataset_name, agent_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Baseline generation failed")
        raise HTTPException(500, f"Baseline generation failed: {e}")
    return data


@app.get("/api/compare/{dataset_size}")
def compare_models(dataset_size: str):
    """Return KPIs for all models on the same dataset for cross-model comparison."""
    results = []
    for m in _models_cache:
        if str(m["dataset_size"]) != dataset_size:
            continue
        # Use the latest episode for KPI comparison
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
    return {"dataset_size": dataset_size, "models": results}


# ──────────────────────────────────────────────
#  Chat / Digital Assistant
# ──────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    session_id: str | None = None

@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    """Send a message to the digital assistant and get a response with tool calls."""
    try:
        from .agent import chat
        messages = [{"role": m.role, "content": m.content} for m in req.messages]
        result = chat(messages, session_id=req.session_id)
        return result
    except Exception as e:
        logger.exception("Chat failed")
        raise HTTPException(500, f"Chat error: {e}")


# ──────────────────────────────────────────────
#  Static files (React SPA)
# ──────────────────────────────────────────────

_ui_dir = get_static_dir()
if _ui_dir:

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        if full_path:
            file_path = (_ui_dir / full_path).resolve()
            # Prevent path traversal outside the UI directory
            if file_path.is_relative_to(_ui_dir.resolve()) and file_path.is_file():
                return FileResponse(str(file_path))
        # SPA fallback: always return index.html
        index_path = _ui_dir / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        raise HTTPException(404, "UI not found")
