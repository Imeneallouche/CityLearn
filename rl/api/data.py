"""Data loading utilities for episode data, schemas, and raw datasets."""

import csv
import json
from pathlib import Path

from .config import DATASETS_DIR, OUTPUTS_DIR, get_dataset_schema


def _read_csv(path: Path) -> list[dict]:
    """Read a CSV file into a list of dicts with numeric conversion."""
    rows = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            parsed = {}
            for k, v in row.items():
                if k is None:
                    continue
                k = k.strip()
                try:
                    parsed[k] = float(v)
                except (ValueError, TypeError):
                    parsed[k] = v
            rows.append(parsed)
    return rows


def load_episode_data(model_info: dict, episode: str) -> dict | None:
    """Load all data for a single evaluation episode.

    Merges ui_export CSVs with raw dataset CSVs to produce a complete
    per-timestep view suitable for the frontend.
    """
    ui_dir = Path(model_info["ui_exports_dir"]) / episode
    if not ui_dir.exists():
        return None

    dataset_name = model_info["dataset_name"]
    dataset_dir = DATASETS_DIR / dataset_name
    schema = get_dataset_schema(dataset_name)
    building_names = [
        name for name, cfg in schema["buildings"].items()
        if cfg.get("include", True)
    ]

    # --- Community data ---
    community_file = ui_dir / "exported_data_community_ep0.csv"
    community_rows = _read_csv(community_file) if community_file.exists() else []

    timestamps = [r.get("timestamp", "") for r in community_rows]
    n_steps = len(timestamps)

    community = {
        "timestamps": timestamps,
        "net_consumption": [r.get("Net Electricity Consumption-kWh", 0) for r in community_rows],
        "self_consumption": [r.get("Self Consumption-kWh", 0) for r in community_rows],
        "stored_energy": [r.get("Stored energy by community- kWh", 0) for r in community_rows],
        "solar_generation": [r.get("Total Solar Generation-kWh", 0) for r in community_rows],
        "co2": [r.get("CO2-kg_co2", 0) for r in community_rows],
        "price_cost": [r.get("Price-$", 0) for r in community_rows],
    }

    # --- Pricing data ---
    pricing_file = ui_dir / "exported_data_pricing_ep0.csv"
    pricing_rows = _read_csv(pricing_file) if pricing_file.exists() else []
    pricing = {
        "electricity_price": [r.get("electricity_pricing-$/kWh", 0) for r in pricing_rows],
        "price_predicted_1": [r.get("electricity_pricing_predicted_1-$/kWh", 0) for r in pricing_rows],
        "price_predicted_2": [r.get("electricity_pricing_predicted_2-$/kWh", 0) for r in pricing_rows],
        "price_predicted_3": [r.get("electricity_pricing_predicted_3-$/kWh", 0) for r in pricing_rows],
    }

    # --- Weather data (from raw dataset) ---
    weather_file = dataset_dir / "weather.csv"
    weather_rows = _read_csv(weather_file) if weather_file.exists() else []
    sim_start = schema.get("simulation_start_time_step", 0)
    weather_slice = weather_rows[sim_start : sim_start + n_steps]

    weather = {
        "outdoor_temperature": [r.get("outdoor_dry_bulb_temperature", 0) for r in weather_slice],
        "outdoor_humidity": [r.get("outdoor_relative_humidity", 0) for r in weather_slice],
        "diffuse_irradiance": [r.get("diffuse_solar_irradiance", 0) for r in weather_slice],
        "direct_irradiance": [r.get("direct_solar_irradiance", 0) for r in weather_slice],
    }

    # --- Per-building data ---
    buildings_data = {}
    for bname in building_names:
        bkey = bname.replace(" ", "_")

        # UI export - building energy
        bfile = ui_dir / f"exported_data_{bkey.lower()}_ep0.csv"
        brows = _read_csv(bfile) if bfile.exists() else []

        # UI export - battery
        bat_file = ui_dir / f"exported_data_{bkey.lower()}_battery_ep0.csv"
        bat_rows = _read_csv(bat_file) if bat_file.exists() else []

        # Raw dataset - building CSV (for indoor temp, demands, etc.)
        raw_file = dataset_dir / f"{bname}.csv"
        raw_rows = _read_csv(raw_file) if raw_file.exists() else []
        raw_slice = raw_rows[sim_start : sim_start + n_steps]

        buildings_data[bname] = {
            "net_consumption": [r.get("Net Electricity Consumption-kWh", 0) for r in brows],
            "non_shiftable_load": [r.get("Non-shiftable Load-kWh", 0) for r in brows],
            "pv_generation": [r.get("Energy Production from PV-kWh", 0) for r in brows],
            "battery_soc": [r.get("Battery Soc-%", 0) for r in bat_rows],
            "battery_charge": [r.get("Battery (Dis)Charge-kWh", 0) for r in bat_rows],
            "indoor_temperature": [r.get("indoor_dry_bulb_temperature", 0) for r in raw_slice],
            "cooling_demand": [r.get("cooling_demand", 0) for r in raw_slice],
            "dhw_demand": [r.get("dhw_demand", 0) for r in raw_slice],
            "solar_generation": [r.get("solar_generation", 0) for r in raw_slice],
            "non_shiftable_load_raw": [r.get("non_shiftable_load", 0) for r in raw_slice],
            "cooling_setpoint": [r.get("indoor_dry_bulb_temperature_cooling_set_point", 0) for r in raw_slice],
            "occupant_count": [r.get("occupant_count", 0) for r in raw_slice],
        }

    # --- KPIs ---
    kpi_file = ui_dir / "exported_kpis.csv"
    kpis = {}
    if kpi_file.exists():
        kpi_rows = _read_csv(kpi_file)
        for row in kpi_rows:
            metric = row.get("KPI", "")
            if not metric:
                continue
            for col_name, val in row.items():
                if col_name == "KPI":
                    continue
                if col_name not in kpis:
                    kpis[col_name] = {}
                kpis[col_name][metric] = val

    # --- Building equipment from schema ---
    building_specs = {}
    for bname in building_names:
        cfg = schema["buildings"][bname]
        building_specs[bname] = {
            "cooling_nominal_power": cfg["cooling_device"]["attributes"]["nominal_power"],
            "cooling_efficiency": cfg["cooling_device"]["attributes"]["efficiency"],
            "dhw_nominal_power": cfg["dhw_device"]["attributes"]["nominal_power"],
            "dhw_efficiency": cfg["dhw_device"]["attributes"]["efficiency"],
            "dhw_storage_capacity": cfg["dhw_storage"]["attributes"]["capacity"],
            "battery_capacity": cfg["electrical_storage"]["attributes"]["capacity"],
            "battery_nominal_power": cfg["electrical_storage"]["attributes"]["nominal_power"],
            "battery_efficiency": cfg["electrical_storage"]["attributes"]["efficiency"],
            "pv_nominal_power": cfg["pv"]["attributes"]["nominal_power"],
        }

    return {
        "model_id": model_info["model_id"],
        "episode": episode,
        "algorithm": model_info["algorithm"],
        "reward_variant": model_info["reward_variant"],
        "dataset_name": dataset_name,
        "dataset_size": model_info["dataset_size"],
        "timesteps": n_steps,
        "buildings": building_names,
        "community": community,
        "buildings_data": buildings_data,
        "weather": weather,
        "pricing": pricing,
        "kpis": kpis,
        "building_specs": building_specs,
    }


def load_carbon_intensity(dataset_name: str, n_steps: int | None = None) -> list[float]:
    """Load carbon intensity time series from the dataset."""
    schema = get_dataset_schema(dataset_name)
    sim_start = schema.get("simulation_start_time_step", 0) if schema else 0

    ci_file = DATASETS_DIR / dataset_name / "carbon_intensity.csv"
    if not ci_file.exists():
        return []

    rows = _read_csv(ci_file)
    sliced = rows[sim_start:]
    if n_steps is not None:
        sliced = sliced[:n_steps]
    return [r.get("carbon_intensity", 0) for r in sliced]
