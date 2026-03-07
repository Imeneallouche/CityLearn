"""
state_server.py — CityLearn building-count state bridge
Runs inside the `state-server` Docker container on port 9100.

Endpoints:
  GET  /buildings        → {"buildings": N}
  POST /buildings        → body: {"buildings": N}  or plain integer text
  GET  /health           → {"status": "ok"}

The UI backend (or a manual curl) writes the current building count here.
The scaling script polls GET /buildings to detect changes.
"""

import os
from pathlib import Path
from flask import Flask, jsonify, request, abort

app = Flask(__name__)

STATE_FILE = Path(os.environ.get("STATE_FILE", "/state/buildings.txt"))
STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

# Initialise state file if missing
if not STATE_FILE.exists():
    STATE_FILE.write_text("0")


def _read() -> int:
    try:
        return int(STATE_FILE.read_text().strip())
    except (ValueError, FileNotFoundError):
        return 0


def _write(n: int) -> None:
    STATE_FILE.write_text(str(max(0, min(20, n))))


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/buildings")
def get_buildings():
    return jsonify({"buildings": _read()})


@app.post("/buildings")
def set_buildings():
    data = request.get_json(silent=True)
    if data and "buildings" in data:
        n = int(data["buildings"])
    else:
        try:
            n = int(request.data.decode().strip())
        except ValueError:
            abort(400, "Expected JSON {\"buildings\": N} or plain integer body")
    _write(n)
    return jsonify({"buildings": _read(), "status": "updated"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9100)