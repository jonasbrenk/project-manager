from __future__ import annotations

import tempfile
import unittest
import gzip
from io import BytesIO
from pathlib import Path

import app.main as project_app


class ProjectApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_data_dir = project_app.DATA_DIR
        self.original_data_file = project_app.DATA_FILE
        project_app.DATA_DIR = Path(self.temporary_directory.name)
        project_app.DATA_FILE = project_app.DATA_DIR / "projects.json"
        self.client = project_app.app.test_client()

    def tearDown(self) -> None:
        project_app.DATA_DIR = self.original_data_dir
        project_app.DATA_FILE = self.original_data_file
        self.temporary_directory.cleanup()

    def test_summary_endpoint_omits_nested_payload(self) -> None:
        response = self.client.get("/api/projects?summary=1")

        self.assertEqual(response.status_code, 200)
        project = response.get_json()[0]
        self.assertNotIn("steps", project)
        self.assertNotIn("links", project)
        self.assertIn("task_total", project)
        self.assertIn("task_done", project)

    def test_project_crud_uses_atomic_storage(self) -> None:
        created = self.client.post(
            "/api/projects",
            json={"name": "Release plan", "links": [], "steps": []},
        )
        self.assertEqual(created.status_code, 201)
        project_id = created.get_json()["id"]

        updated_payload = created.get_json()
        updated_payload["description"] = "Prepare the production release."
        updated = self.client.put(f"/api/projects/{project_id}", json=updated_payload)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["description"], "Prepare the production release.")

        deleted = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(project_app.DATA_FILE.exists())
        self.assertFalse(project_app.DATA_FILE.with_suffix(".json.tmp").exists())

    def test_cache_and_security_headers(self) -> None:
        api_response = self.client.get("/api/projects?summary=1")
        css_response = self.client.get("/static/app-shell.css")

        self.assertEqual(api_response.headers["Cache-Control"], "no-store")
        self.assertEqual(css_response.headers["Cache-Control"], "no-cache")
        self.assertEqual(api_response.headers["X-Content-Type-Options"], "nosniff")
        api_response.close()
        css_response.close()

    def test_project_page_is_gzipped_when_supported(self) -> None:
        response = self.client.get("/project?id=test", headers={"Accept-Encoding": "gzip"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Encoding"], "gzip")
        self.assertIn(b"Project View", gzip.decompress(response.data))
        response.close()

    def test_offline_service_worker_is_available(self) -> None:
        response = self.client.get("/offline-service-worker.js")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"SHELL_CACHE", response.data)
        response.close()

    def test_health_endpoint_is_no_content(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.data, b"")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_project_file_upload_open_and_delete(self) -> None:
        created = self.client.post("/api/projects", json={"name": "Files", "links": [], "steps": []})
        project_id = created.get_json()["id"]
        uploaded = self.client.post(
            f"/api/projects/{project_id}/files",
            data={"file": (BytesIO(b"# Notes"), "notes.md")},
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        file = uploaded.get_json()
        self.assertEqual(file["name"], "notes.md")

        opened = self.client.get(f"/api/projects/{project_id}/files/{file['id']}")
        self.assertEqual(opened.status_code, 200)
        self.assertEqual(opened.data, b"# Notes")
        opened.close()

        deleted = self.client.delete(f"/api/projects/{project_id}/files/{file['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{project_id}/files/{file['id']}").status_code, 404)


    def sync(self, changes=None, revision=None):
        response = self.client.post("/api/sync", json={"changes": changes or [], "revision": revision})
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_sync_creates_offline_project_with_client_id(self) -> None:
        project = {"id": "local-1", "name": "Offline", "links": [], "steps": [], "created_at": "2026-01-01T00:00:00+00:00"}
        result = self.sync([{"op": "upsert", "project_id": "local-1", "project": project, "base": None}])

        self.assertEqual(result["applied"], ["local-1"])
        created = next(p for p in result["projects"] if p["id"] == "local-1")
        self.assertEqual(created["name"], "Offline")
        self.assertEqual(created["created_at"], "2026-01-01T00:00:00+00:00")

    def test_sync_skips_payload_when_revision_is_unchanged(self) -> None:
        revision = self.sync()["revision"]
        self.assertNotIn("projects", self.sync(revision=revision))

    def test_sync_merges_offline_edit_with_concurrent_server_edit(self) -> None:
        base = self.client.post("/api/projects", json={
            "name": "Plan",
            "steps": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}],
            "links": [],
        }).get_json()
        project_id = base["id"]

        server_version = {**base, "description": "Edited online",
                          "steps": base["steps"] + [{"id": "c", "title": "C", "children": []}]}
        self.client.put(f"/api/projects/{project_id}", json=server_version)

        local = {**base, "name": "Renamed offline", "steps": [
            {**base["steps"][0], "done": True},
            {"id": "d", "title": "D", "children": []},
        ]}
        result = self.sync([{"op": "upsert", "project_id": project_id, "project": local, "base": base}])
        merged = next(p for p in result["projects"] if p["id"] == project_id)

        self.assertEqual(merged["name"], "Renamed offline")
        self.assertEqual(merged["description"], "Edited online")
        self.assertEqual([step["id"] for step in merged["steps"]], ["a", "c", "d"])
        self.assertTrue(merged["steps"][0]["done"])
        self.assertEqual(result["deleted_items"][0]["title"], "B")

    def test_sync_is_idempotent_when_a_response_is_lost(self) -> None:
        base = self.client.post("/api/projects", json={"name": "Plan", "steps": [{"id": "a", "title": "A"}]}).get_json()
        local = {**base, "steps": [{"id": "b", "title": "B", "children": []}]}
        change = {"op": "upsert", "project_id": base["id"], "project": local, "base": base}
        first = self.sync([change])
        second = self.sync([change])

        first_project = next(p for p in first["projects"] if p["id"] == base["id"])
        second_project = next(p for p in second["projects"] if p["id"] == base["id"])
        self.assertEqual([s["id"] for s in second_project["steps"]], ["b"])
        self.assertEqual(first_project["updated_at"], second_project["updated_at"])

    def test_sync_moves_task_between_parents(self) -> None:
        base = self.client.post("/api/projects", json={"name": "Plan", "steps": [
            {"id": "a", "title": "A", "children": [{"id": "x", "title": "X"}]},
            {"id": "b", "title": "B"},
        ]}).get_json()
        local = {**base, "steps": [
            {**base["steps"][0], "children": []},
            {**base["steps"][1], "children": [base["steps"][0]["children"][0]]},
        ]}
        result = self.sync([{"op": "upsert", "project_id": base["id"], "project": local, "base": base}])
        merged = next(p for p in result["projects"] if p["id"] == base["id"])

        self.assertEqual(merged["steps"][0]["children"], [])
        self.assertEqual([c["id"] for c in merged["steps"][1]["children"]], ["x"])

    def test_sync_delete_moves_project_to_trash(self) -> None:
        base = self.client.post("/api/projects", json={"name": "Old"}).get_json()
        result = self.sync([{"op": "delete", "project_id": base["id"]}])

        self.assertFalse(any(p["id"] == base["id"] for p in result["projects"]))
        self.assertEqual(result["deleted_items"][0]["title"], "Old")

    def test_sync_removes_uploaded_file_deleted_offline(self) -> None:
        base = self.client.post("/api/projects", json={"name": "Files"}).get_json()
        file = self.client.post(
            f"/api/projects/{base['id']}/files",
            data={"file": (BytesIO(b"data"), "a.txt")},
            content_type="multipart/form-data",
        ).get_json()
        base = self.client.get(f"/api/projects/{base['id']}").get_json()
        self.sync([{"op": "upsert", "project_id": base["id"], "project": {**base, "files": []}, "base": base}])

        self.assertEqual(self.client.get(f"/api/projects/{base['id']}/files/{file['id']}").status_code, 404)
        self.assertFalse(project_app.upload_path(base["id"], file["id"]).exists())


if __name__ == "__main__":
    unittest.main()
