from __future__ import annotations

import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "projects.json"

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATA_FILE.exists():
        return

    sample_data = {
        "projects": [
            {
                "id": uuid4().hex,
                "name": "Bachelor Thesis",
                "deadline": "2026-04-20T18:00:00",
                "description": "Finish the thesis structure, interviews, quantitative evaluation, and final editing.",
                "finished": False,
                "icon": "🎓",
                "links": [
                    {
                        "id": uuid4().hex,
                        "title": "Project Notes",
                        "url": "https://example.com/notes",
                        "icon": "📝",
                    },
                    {
                        "id": uuid4().hex,
                        "title": "Drive Folder",
                        "url": "https://example.com/drive",
                        "icon": "📁",
                    },
                ],
                "steps": [
                    {
                        "id": uuid4().hex,
                        "title": "Finalize chapter flow",
                        "description": "Clean up argument order and chapter logic.",
                        "done": False,
                        "until_deadline": True,
                        "deadline": "2026-04-10T17:00:00",
                        "children": [
                            {
                                "id": uuid4().hex,
                                "title": "Check chapter transitions",
                                "description": "Ensure theory leads into method and method into evaluation.",
                                "done": False,
                                "until_deadline": False,
                                "deadline": "2026-04-05T16:00:00",
                                "children": [],
                            }
                        ],
                    },
                    {
                        "id": uuid4().hex,
                        "title": "Interview synthesis",
                        "description": "Extract implementation barriers, governance lessons, and best practices.",
                        "done": False,
                        "until_deadline": True,
                        "deadline": None,
                        "children": [],
                    },
                ],
                "created_at": utc_now_iso(),
                "updated_at": utc_now_iso(),
            }
        ]
    }
    write_data(sample_data)


def read_data() -> dict[str, Any]:
    ensure_storage()
    with DATA_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_data(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def parse_deadline(deadline: str | None) -> datetime | None:
    if not deadline:
        return None
    try:
        return datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    except ValueError:
        return None


def seconds_left(deadline: str | None) -> int | None:
    dt = parse_deadline(deadline)
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = dt - datetime.now(timezone.utc)
    return math.floor(delta.total_seconds())


def sort_key(project: dict[str, Any]) -> tuple[int, float]:
    secs = seconds_left(project.get("deadline"))
    finished = 1 if project.get("finished") else 0
    if secs is None:
        return (finished, float("inf"))
    return (finished, secs)


def enrich_step(step: dict[str, Any]) -> dict[str, Any]:
    enriched = deepcopy(step)
    enriched["seconds_left"] = seconds_left(step.get("deadline"))
    enriched["children"] = [enrich_step(child) for child in step.get("children", [])]
    return enriched


def enrich_project(project: dict[str, Any]) -> dict[str, Any]:
    enriched = deepcopy(project)
    enriched["seconds_left"] = seconds_left(project.get("deadline"))
    enriched["steps"] = [enrich_step(step) for step in project.get("steps", [])]
    return enriched


def find_project(data: dict[str, Any], project_id: str) -> dict[str, Any] | None:
    return next((p for p in data["projects"] if p["id"] == project_id), None)


def sanitize_link(link: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": link.get("id") or uuid4().hex,
        "title": str(link.get("title", "")).strip(),
        "url": str(link.get("url", "")).strip(),
        "icon": str(link.get("icon", "🔗")).strip() or "🔗",
    }


def sanitize_step(step: dict[str, Any]) -> dict[str, Any]:
    children = step.get("children") or []
    deadline = step.get("deadline") or None
    return {
        "id": step.get("id") or uuid4().hex,
        "title": str(step.get("title", "")).strip(),
        "description": str(step.get("description", "")).strip(),
        "done": bool(step.get("done", False)),
        "until_deadline": bool(step.get("until_deadline", False)),
        "deadline": deadline,
        "children": [sanitize_step(child) for child in children],
    }


def sanitize_project(payload: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    now = utc_now_iso()
    created_at = current.get("created_at") if current else now

    return {
        "id": current.get("id") if current else uuid4().hex,
        "name": str(payload.get("name", "")).strip() or "Untitled Project",
        "deadline": payload.get("deadline") or None,
        "description": str(payload.get("description", "")).strip(),
        "finished": bool(payload.get("finished", False)),
        "icon": str(payload.get("icon", "📌")).strip() or "📌",
        "links": [sanitize_link(link) for link in payload.get("links", [])],
        "steps": [sanitize_step(step) for step in payload.get("steps", [])],
        "created_at": created_at,
        "updated_at": now,
    }


@app.get("/")
def landing_page():
    return send_from_directory(BASE_DIR, "landing_page.html")


@app.get("/project")
def project_view():
    return send_from_directory(BASE_DIR, "project_view.html")


@app.get("/api/projects")
def get_projects():
    data = read_data()
    projects = sorted((enrich_project(p) for p in data["projects"]), key=sort_key)
    return jsonify(projects)


@app.get("/api/projects/<project_id>")
def get_project(project_id: str):
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(enrich_project(project))


@app.post("/api/projects")
def create_project():
    payload = request.get_json(silent=True) or {}
    data = read_data()
    project = sanitize_project(payload)
    data["projects"].append(project)
    write_data(data)
    return jsonify(enrich_project(project)), 201


@app.put("/api/projects/<project_id>")
def update_project(project_id: str):
    payload = request.get_json(silent=True) or {}
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    updated = sanitize_project(payload, current=project)
    index = data["projects"].index(project)
    data["projects"][index] = updated
    write_data(data)
    return jsonify(enrich_project(updated))


@app.patch("/api/projects/<project_id>/finish")
def toggle_finished(project_id: str):
    payload = request.get_json(silent=True) or {}
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    project["finished"] = bool(payload.get("finished", not project.get("finished", False)))
    project["updated_at"] = utc_now_iso()
    write_data(data)
    return jsonify(enrich_project(project))


@app.delete("/api/projects/<project_id>")
def delete_project(project_id: str):
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    data["projects"] = [p for p in data["projects"] if p["id"] != project_id]
    write_data(data)
    return jsonify({"ok": True})


if __name__ == "__main__":
    ensure_storage()
    app.run(debug=False, host="0.0.0.0", port=5000)
