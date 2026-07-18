from __future__ import annotations

import json
import math
import mimetypes
import os
import gzip
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from flask import Flask, jsonify, request, send_file, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "projects.json"
STORAGE_LOCK = RLock()
RUNTIME_FILES = (
    BASE_DIR / "main.py",
    BASE_DIR / "landing_page.html",
    BASE_DIR / "project_view.html",
    BASE_DIR / "offline-service-worker.js",
    BASE_DIR / "static" / "app-shell.css",
    BASE_DIR / "static" / "landing-page.css",
    BASE_DIR / "static" / "project-view.css",
    BASE_DIR / "static" / "app-shell.js",
    BASE_DIR / "static" / "app-core.js",
    BASE_DIR / "static" / "task-tree.js",
    BASE_DIR / "static" / "materials.js",
    BASE_DIR / "static" / "api-client.js",
    BASE_DIR / "static" / "icons.js",
    BASE_DIR / "static" / "offline-data.js",
)
RUNTIME_ASSETS = {
    "/static/app-shell.css",
    "/static/landing-page.css",
    "/static/project-view.css",
    "/static/app-shell.js",
    "/static/app-core.js",
    "/static/task-tree.js",
    "/static/materials.js",
    "/static/api-client.js",
    "/static/icons.js",
    "/static/offline-data.js",
    "/static/iconify-catalog.js",
}

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
MAX_STEP_DEPTH = 2  # Root task, child, and grandchild: three visible levels.


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def app_version() -> str:
    """A small deployment fingerprint for clients that have stayed open."""
    try:
        stats = [path.stat() for path in RUNTIME_FILES]
        return f"{max(stat.st_mtime_ns for stat in stats):x}-{sum(stat.st_size for stat in stats):x}"
    except OSError:
        return "unknown"


def ensure_storage() -> None:
    with STORAGE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / "uploads").mkdir(exist_ok=True)
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
    with STORAGE_LOCK:
        if not DATA_FILE.exists():
            write_data(sample_data)


def read_data() -> dict[str, Any]:
    ensure_storage()
    with STORAGE_LOCK, DATA_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("projects"), list):
        raise ValueError("Project data has an invalid structure")
    if not isinstance(data.get("deleted_items"), list):
        data["deleted_items"] = []
    if not isinstance(data.get("offline_change_log"), list):
        data["offline_change_log"] = []
    return data


def write_data(data: dict[str, Any]) -> None:
    with STORAGE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temporary_file = DATA_FILE.with_suffix(".json.tmp")
        with temporary_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary_file, DATA_FILE)


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


def count_steps(steps: list[dict[str, Any]]) -> tuple[int, int]:
    total = 0
    done = 0
    for step in steps:
        total += 1
        done += int(bool(step.get("done")))
        child_total, child_done = count_steps(step.get("children") or [])
        total += child_total
        done += child_done
    return total, done


def summarize_project(project: dict[str, Any]) -> dict[str, Any]:
    task_total, task_done = count_steps(project.get("steps") or [])
    return {
        "id": project["id"],
        "name": project.get("name", "Untitled Project"),
        "deadline": project.get("deadline"),
        "description": project.get("description", ""),
        "finished": bool(project.get("finished")),
        "icon": project.get("icon", "📌"),
        "seconds_left": seconds_left(project.get("deadline")),
        "task_total": task_total,
        "task_done": task_done,
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


def find_project(data: dict[str, Any], project_id: str) -> dict[str, Any] | None:
    return next((p for p in data["projects"] if p["id"] == project_id), None)


def walk_steps(steps: list[dict[str, Any]], parent_id: str | None = None):
    for index, step in enumerate(steps):
        yield step, parent_id, index
        yield from walk_steps(step.get("children") or [], step.get("id"))


def find_step(steps: list[dict[str, Any]], step_id: str) -> dict[str, Any] | None:
    for step, _, _ in walk_steps(steps):
        if step.get("id") == step_id:
            return step
    return None


def add_deleted_item(data: dict[str, Any], item_type: str, item: dict[str, Any], **context: Any) -> None:
    deleted_items = data.setdefault("deleted_items", [])
    deleted_items.append({
        "id": uuid4().hex,
        "type": item_type,
        "item": deepcopy(item),
        "deleted_at": utc_now_iso(),
        **context,
    })
    data["deleted_items"] = deleted_items[-50:]


def archive_removed_items(data: dict[str, Any], current: dict[str, Any], updated: dict[str, Any]) -> None:
    updated_link_ids = {link.get("id") for link in updated.get("links", [])}
    for index, link in enumerate(current.get("links", [])):
        if link.get("id") not in updated_link_ids:
            add_deleted_item(data, "link", link, project_id=current["id"], project_name=current.get("name", "Project"), index=index)

    updated_step_ids = {step.get("id") for step, _, _ in walk_steps(updated.get("steps", []))}
    for step, parent_id, index in walk_steps(current.get("steps", [])):
        if step.get("id") in updated_step_ids or parent_id not in updated_step_ids and parent_id is not None:
            continue
        add_deleted_item(
            data,
            "task",
            step,
            project_id=current["id"],
            project_name=current.get("name", "Project"),
            parent_id=parent_id,
            index=index,
        )


def deleted_item_summary(record: dict[str, Any]) -> dict[str, Any]:
    item = record.get("item") or {}
    item_type = record.get("type")
    if item_type == "project":
        title = item.get("name", "Untitled Project")
        icon = item.get("icon", "📌")
    elif item_type == "link":
        title = item.get("title", "Untitled Link")
        icon = item.get("icon", "🔗")
    else:
        title = item.get("title", "Untitled Task")
        icon = "✓"
    return {
        "id": record.get("id"),
        "type": item_type,
        "title": title,
        "icon": icon,
        "project_name": record.get("project_name"),
        "deleted_at": record.get("deleted_at"),
    }


def sanitize_link(link: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": link.get("id") or uuid4().hex,
        "title": str(link.get("title", "")).strip(),
        "url": str(link.get("url", "")).strip(),
        "icon": str(link.get("icon", "🔗")).strip() or "🔗",
    }


def validate_step_tree(steps: Any, depth: int = 0) -> None:
    """Keep API writes within the same task hierarchy the UI can render."""
    if not isinstance(steps, list):
        raise ValueError("steps must be a list")
    if depth > MAX_STEP_DEPTH:
        raise ValueError("Tasks can be nested at most three levels deep")
    for step in steps:
        if not isinstance(step, dict):
            raise ValueError("Each task must be an object")
        children = step.get("children") or []
        if not isinstance(children, list):
            raise ValueError("Task children must be a list")
        validate_step_tree(children, depth + 1)


def validate_project_payload(payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Project payload must be an object")
    validate_step_tree(payload.get("steps", []))


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


def sanitize_file(file: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(file.get("id") or uuid4().hex),
        "name": Path(str(file.get("name") or "Document")).name or "Document",
        "content_type": str(file.get("content_type") or "application/octet-stream"),
        "size": max(0, int(file.get("size") or 0)),
        "uploaded_at": str(file.get("uploaded_at") or utc_now_iso()),
    }


def sanitize_file_link(link: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(link.get("id") or uuid4().hex),
        "source_project_id": str(link.get("source_project_id") or ""),
        "source_file_id": str(link.get("source_file_id") or ""),
        "source_project_name": str(link.get("source_project_name") or ""),
        "name": Path(str(link.get("name") or "Document")).name or "Document",
        "content_type": str(link.get("content_type") or "application/octet-stream"),
        "size": max(0, int(link.get("size") or 0)),
    }


def upload_path(project_id: str, file_id: str) -> Path:
    return DATA_DIR / "uploads" / project_id / file_id


def sanitize_project(payload: dict[str, Any], current: dict[str, Any] | None = None, updated_at: str | None = None) -> dict[str, Any]:
    now = updated_at or utc_now_iso()
    created_at = current.get("created_at") if current else now

    return {
        "id": current.get("id") if current else uuid4().hex,
        "name": str(payload.get("name", "")).strip() or "Untitled Project",
        "deadline": payload.get("deadline") or None,
        "description": str(payload.get("description", "")).strip(),
        "finished": bool(payload.get("finished", False)),
        "icon": str(payload.get("icon", "📌")).strip() or "📌",
        "links": [sanitize_link(link) for link in payload.get("links", [])],
        "files": [sanitize_file(file) for file in payload.get("files", current.get("files", []) if current else [])],
        "file_links": [sanitize_file_link(link) for link in payload.get("file_links", current.get("file_links", []) if current else [])],
        "steps": [sanitize_step(step) for step in payload.get("steps", [])],
        "created_at": created_at,
        "updated_at": now,
    }


@app.after_request
def set_response_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    if request.path == "/api/health":
        response.headers["X-PM-App-Version"] = app_version()
    if request.path in RUNTIME_ASSETS:
        response.headers["Cache-Control"] = "no-cache"
    elif request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    elif request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"

    # The two app screens contain their UI shell inline. Compressing text
    # responses avoids sending that repeated markup over a slow connection;
    # browsers transparently decode it before parsing.
    accepts_gzip = "gzip" in request.headers.get("Accept-Encoding", "").lower()
    content_type = response.mimetype or ""
    compressible = content_type.startswith("text/") or content_type in {"application/javascript", "application/json", "image/svg+xml"}
    if (
        accepts_gzip
        and compressible
        and "Content-Encoding" not in response.headers
    ):
        response.direct_passthrough = False
        payload = response.get_data()
        compressed = gzip.compress(payload, compresslevel=5)
        if len(compressed) < len(payload):
            response.set_data(compressed)
            response.headers["Content-Encoding"] = "gzip"
            response.headers["Vary"] = "Accept-Encoding"
    return response


@app.get("/")
def landing_page():
    return send_from_directory(BASE_DIR, "landing_page.html")


@app.get("/project")
def project_view():
    return send_from_directory(BASE_DIR, "project_view.html")


@app.get("/api/projects")
def get_projects():
    data = read_data()
    project_builder = summarize_project if request.args.get("summary") == "1" else enrich_project
    projects = sorted((project_builder(p) for p in data["projects"]), key=sort_key)
    return jsonify(projects)


@app.get("/api/health")
def api_health():
    return "", 204


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
    try:
        validate_project_payload(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    data = read_data()
    project = sanitize_project(payload)
    data["projects"].append(project)
    write_data(data)
    return jsonify(enrich_project(project)), 201


@app.put("/api/projects/<project_id>")
def update_project(project_id: str):
    payload = request.get_json(silent=True) or {}
    try:
        validate_project_payload(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    updated = sanitize_project(payload, current=project)
    archive_removed_items(data, project, updated)
    index = data["projects"].index(project)
    data["projects"][index] = updated
    write_data(data)
    return jsonify(enrich_project(updated))


@app.post("/api/offline-changes")
def apply_offline_changes():
    """Apply independently queued local snapshots, newest timestamp wins."""
    payload = request.get_json(silent=True) or {}
    changes = payload.get("changes")
    if not isinstance(changes, list):
        return jsonify({"error": "changes must be a list"}), 400
    data = read_data()
    accepted: list[str] = []
    for change in changes[-100:]:
        if not isinstance(change, dict):
            continue
        change_id, project_id = str(change.get("id", "")), str(change.get("project_id", ""))
        changed_at = str(change.get("changed_at", ""))
        if not change_id or not project_id or not parse_deadline(changed_at):
            continue
        data["offline_change_log"].append({
            "id": change_id,
            "project_id": project_id,
            "op": str(change.get("op", "")),
            "changed_at": changed_at,
        })
        current = find_project(data, project_id)
        current_time = parse_deadline(str(current.get("updated_at", ""))) if current else None
        change_time = parse_deadline(changed_at)
        if current_time and change_time and change_time < current_time:
            accepted.append(change_id)
            continue
        if change.get("op") == "delete":
            if current:
                add_deleted_item(data, "project", current, index=data["projects"].index(current))
                data["projects"] = [project for project in data["projects"] if project.get("id") != project_id]
            accepted.append(change_id)
            continue
        project_payload = change.get("project")
        if change.get("op") != "upsert" or not isinstance(project_payload, dict):
            continue
        try:
            validate_project_payload(project_payload)
        except ValueError:
            continue
        if current:
            updated = sanitize_project(project_payload, current=current, updated_at=changed_at)
            archive_removed_items(data, current, updated)
            data["projects"][data["projects"].index(current)] = updated
        else:
            updated = sanitize_project(project_payload, updated_at=changed_at)
            updated["id"] = project_id
            data["projects"].append(updated)
        accepted.append(change_id)
    data["offline_change_log"] = data["offline_change_log"][-500:]
    write_data(data)
    return jsonify({"accepted": accepted})


@app.post("/api/projects/<project_id>/files")
def upload_project_file(project_id: str):
    data = read_data()
    project = find_project(data, project_id)
    uploaded = request.files.get("file")
    if not project:
        return jsonify({"error": "Project not found"}), 404
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Choose a file to upload"}), 400

    file_id = uuid4().hex
    name = Path(uploaded.filename).name or "Document"
    destination = upload_path(project_id, file_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    uploaded.save(destination)
    metadata = {
        "id": file_id,
        "name": name,
        "content_type": uploaded.mimetype or mimetypes.guess_type(name)[0] or "application/octet-stream",
        "size": destination.stat().st_size,
        "uploaded_at": utc_now_iso(),
    }
    project.setdefault("files", []).append(metadata)
    project["updated_at"] = utc_now_iso()
    write_data(data)
    return jsonify(metadata), 201


@app.get("/api/projects/<project_id>/files/<file_id>")
def open_project_file(project_id: str, file_id: str):
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    metadata = next((file for file in project.get("files", []) if file.get("id") == file_id), None)
    path = upload_path(project_id, file_id)
    if not metadata or not path.is_file():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, mimetype=metadata.get("content_type"), as_attachment=False, download_name=metadata.get("name"))


@app.delete("/api/projects/<project_id>/files/<file_id>")
def delete_project_file(project_id: str, file_id: str):
    data = read_data()
    project = find_project(data, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    files = project.get("files", [])
    if not any(file.get("id") == file_id for file in files):
        return jsonify({"error": "File not found"}), 404
    project["files"] = [file for file in files if file.get("id") != file_id]
    path = upload_path(project_id, file_id)
    if path.exists():
        path.unlink()
    project["updated_at"] = utc_now_iso()
    write_data(data)
    return jsonify({"ok": True})


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

    add_deleted_item(data, "project", project, index=data["projects"].index(project))
    data["projects"] = [p for p in data["projects"] if p["id"] != project_id]
    write_data(data)
    return jsonify({"ok": True})


@app.get("/api/deleted-items")
def get_deleted_items():
    data = read_data()
    items = sorted(data["deleted_items"], key=lambda record: record.get("deleted_at", ""), reverse=True)
    return jsonify([deleted_item_summary(item) for item in items])


@app.post("/api/deleted-items/<deleted_id>/restore")
def restore_deleted_item(deleted_id: str):
    data = read_data()
    record = next((item for item in data["deleted_items"] if item.get("id") == deleted_id), None)
    if not record:
        return jsonify({"error": "Deleted item not found"}), 404

    item = deepcopy(record.get("item") or {})
    item_type = record.get("type")
    destination: list[dict[str, Any]] | None = None

    if item_type == "project":
        if find_project(data, item.get("id", "")):
            return jsonify({"error": "A project with this identity already exists"}), 409
        destination = data["projects"]
    else:
        project = find_project(data, record.get("project_id", ""))
        if not project:
            return jsonify({"error": "The original project no longer exists"}), 409
        if item_type == "link":
            if any(link.get("id") == item.get("id") for link in project.get("links", [])):
                return jsonify({"error": "This link already exists"}), 409
            destination = project.setdefault("links", [])
        elif item_type == "task":
            if find_step(project.get("steps", []), item.get("id", "")):
                return jsonify({"error": "This task already exists"}), 409
            parent_id = record.get("parent_id")
            if parent_id:
                parent = find_step(project.get("steps", []), parent_id)
                if not parent:
                    return jsonify({"error": "The original parent task no longer exists"}), 409
                destination = parent.setdefault("children", [])
            else:
                destination = project.setdefault("steps", [])
        else:
            return jsonify({"error": "Unsupported deleted item"}), 400

        project["updated_at"] = utc_now_iso()

    insert_at = max(0, min(int(record.get("index", len(destination))), len(destination)))
    destination.insert(insert_at, item)
    data["deleted_items"] = [entry for entry in data["deleted_items"] if entry.get("id") != deleted_id]
    write_data(data)
    return jsonify({"ok": True})


@app.delete("/api/deleted-items/<deleted_id>")
def permanently_delete_item(deleted_id: str):
    data = read_data()
    if not any(item.get("id") == deleted_id for item in data["deleted_items"]):
        return jsonify({"error": "Deleted item not found"}), 404
    data["deleted_items"] = [item for item in data["deleted_items"] if item.get("id") != deleted_id]
    write_data(data)
    return jsonify({"ok": True})


if __name__ == "__main__":
    ensure_storage()
    app.run(debug=False, host="0.0.0.0", port=5000)
