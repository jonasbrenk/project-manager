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
        self.assertIn("max-age=604800", css_response.headers["Cache-Control"])
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
        self.assertIn(b"OFFLINE_API_CACHE", response.data)
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


if __name__ == "__main__":
    unittest.main()
