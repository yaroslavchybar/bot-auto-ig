import sys
import tempfile
import unittest
from json import dumps
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if "pandas" not in sys.modules:
    pandas_stub = ModuleType("pandas")
    pandas_stub.DataFrame = type("DataFrame", (), {})
    pandas_stub.read_csv = lambda *args, **kwargs: None
    sys.modules["pandas"] = pandas_stub

if "fasttext" not in sys.modules:
    fasttext_stub = ModuleType("fasttext")
    fasttext_stub.FastText = SimpleNamespace(eprint=lambda *args, **kwargs: None)
    fasttext_stub.load_model = lambda *args, **kwargs: SimpleNamespace(
        predict=lambda text, k=1: (["__label__en"], [1.0]),
    )
    sys.modules["fasttext"] = fasttext_stub

if "multipart" not in sys.modules:
    multipart_stub = ModuleType("multipart")
    multipart_stub.__version__ = "0.0-test"
    sys.modules["multipart"] = multipart_stub

if "multipart.multipart" not in sys.modules:
    multipart_multipart_stub = ModuleType("multipart.multipart")
    multipart_multipart_stub.parse_options_header = lambda value: ("", {})
    sys.modules["multipart.multipart"] = multipart_multipart_stub

import api  # noqa: E402
from api import app  # noqa: E402


class DirectScrapeProcessingApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    @patch("api._upload_to_convex_envs")
    @patch("api._filter_and_collect_accounts")
    @patch("api.load_all_keyword_sets")
    def test_process_workflow_scrape_filters_and_uploads(self, mock_keywords, mock_filter, mock_upload) -> None:
        mock_keywords.return_value = {"us_male_names": {"john"}}
        mock_filter.return_value = (
            [{"userName": "john_alpha", "fullName": "John Smith", "matchedName": "John"}],
            [],
            2,
            1,
        )
        mock_upload.return_value = ({"dev": 1}, {"dev": 0})

        response = self.client.post(
            "/workflow-runs/process-scrape",
            json={
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "nodeLabel": "Scrape Relationships",
                "kind": "followers",
                "targets": ["alpha"],
                "sourceProfileName": "session_profile",
                "users": [
                    {"username": "john_alpha", "full_name": "John Smith"},
                    {"username": "jane_beta", "full_name": "Jane Stone"},
                ],
                "stats": {"scraped": 2, "deduped": 2},
                "metadata": {"activityId": "scrape_relationships"},
                "env": "dev",
                "environments": ["dev"],
                "accountStatus": "available",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["stats"]["totalProcessed"], 2)
        self.assertEqual(body["stats"]["removed"], 1)
        self.assertEqual(body["stats"]["remaining"], 1)
        self.assertEqual(body["uploaded"], {"dev": 1})
        self.assertEqual(body["duplicates"], {"dev": 0})
        mock_keywords.assert_called_once_with(env="dev")
        mock_upload.assert_called_once()

    @patch("api._load_local_artifact_payload")
    @patch("api.convex_query")
    def test_get_scraping_task_fields_supports_local_artifacts(self, mock_query, mock_load_local) -> None:
        mock_query.return_value = {
            "_id": "task_local",
            "workflowId": "wf_1",
            "workflowName": "Workflow",
            "nodeId": "node_1",
            "kind": "followers",
            "status": "completed",
            "localArtifactPath": "scrapes/task_local.json",
            "stats": {"scraped": 1, "deduped": 1, "chunksCompleted": 1, "targetsCompleted": 1},
        }
        mock_load_local.return_value = {
            "users": [{"username": "john_alpha", "full_name": "John Smith"}],
        }

        response = self.client.get("/scraping-tasks/task_local/fields?env=dev")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["taskId"], "task_local")
        self.assertEqual(body["rowCount"], 1)
        self.assertIn("username", body["fields"])
        self.assertIn("full_name", body["fields"])
        self.assertEqual(body["sampleRow"]["username"], "john_alpha")

    @patch("api._finalize_local_artifact_import")
    @patch("api._upload_to_convex_envs")
    @patch("api._archive_scraping_accounts")
    @patch("api._filter_and_collect_accounts")
    @patch("api.load_all_keyword_sets")
    @patch("api._get_task_and_payload")
    def test_process_scraping_task_archives_and_finalizes_local_artifact(
        self,
        mock_get_task,
        mock_keywords,
        mock_filter,
        mock_archive,
        mock_upload,
        mock_finalize,
    ) -> None:
        mock_get_task.return_value = (
            {
                "_id": "task_local",
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "kind": "followers",
                "sourceProfileName": "session_profile",
                "localArtifactPath": "scrapes/task_local.json",
            },
            {
                "users": [
                    {"username": "john_alpha", "full_name": "John Smith"},
                    {"username": "jane_beta", "full_name": "Jane Stone"},
                ]
            },
        )
        mock_keywords.return_value = {"us_male_names": {"john"}}
        mock_filter.return_value = (
            [{"userName": "john_alpha", "fullName": "John Smith", "matchedName": "John"}],
            [
                {
                    "artifactId": "task_local",
                    "workflowId": "wf_1",
                    "workflowName": "Workflow",
                    "nodeId": "node_1",
                    "kind": "followers",
                    "sourceProfileName": "session_profile",
                    "userName": "john_alpha",
                    "fullName": "John Smith",
                    "matchedName": "John",
                    "filterDecision": "accepted",
                    "rawUser": {"username": "john_alpha", "full_name": "John Smith"},
                    "createdAt": 1,
                }
            ],
            2,
            1,
        )
        mock_archive.return_value = {"inserted": 1, "skipped": 0}
        mock_upload.return_value = ({"dev": 1}, {"dev": 0})

        response = self.client.post(
            "/scraping-tasks/task_local/process",
            json={
                "env": "dev",
                "keepFields": ["username", "full_name"],
                "uploadToConvex": True,
                "environments": ["dev"],
                "accountStatus": "available",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["usernamesExtracted"], 1)
        self.assertEqual(body["stats"], {"totalProcessed": 2, "removed": 1, "remaining": 1})
        self.assertEqual(body["uploaded"], {"dev": 1})
        self.assertEqual(body["duplicates"], {"dev": 0})
        self.assertEqual(body["scrapingInserted"], {"dev": 1})
        self.assertEqual(body["scrapingDuplicates"], {"dev": 0})
        mock_archive.assert_called_once()
        mock_upload.assert_called_once()
        mock_finalize.assert_called_once_with("task_local", "dev", "scrapes/task_local.json")

    @patch("api._finalize_local_artifact_import")
    @patch("api._upload_to_convex_envs")
    @patch("api.insert_scraping_accounts_batch")
    @patch("api._filter_and_collect_accounts")
    @patch("api.load_all_keyword_sets")
    @patch("api._get_task_and_payload")
    def test_process_scraping_task_archives_large_batches_in_chunks(
        self,
        mock_get_task,
        mock_keywords,
        mock_filter,
        mock_insert_batch,
        mock_upload,
        mock_finalize,
    ) -> None:
        mock_get_task.return_value = (
            {
                "_id": "task_chunked",
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "kind": "followers",
                "localArtifactPath": "scrapes/task_chunked.json",
            },
            {"users": [{"username": "placeholder"}]},
        )
        mock_keywords.return_value = {"us_male_names": {"john"}}
        archived_accounts = [
            {"userName": f"user_{index}", "status": "need_scraping", "createdAt": index}
            for index in range(1201)
        ]
        mock_filter.return_value = (
            [{"userName": "kept_user", "fullName": "Kept User", "matchedName": "Kept"}],
            archived_accounts,
            1201,
            1200,
        )
        mock_insert_batch.side_effect = [
            {"status": "success", "inserted": 500, "skipped": 0},
            {"status": "success", "inserted": 450, "skipped": 50},
            {"status": "success", "inserted": 150, "skipped": 51},
        ]
        mock_upload.return_value = ({"dev": 1}, {"dev": 0})

        response = self.client.post(
            "/scraping-tasks/task_chunked/process",
            json={
                "env": "dev",
                "keepFields": ["username", "full_name"],
                "uploadToConvex": True,
                "environments": ["dev"],
                "accountStatus": "available",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["scrapingInserted"], {"dev": 1100})
        self.assertEqual(body["scrapingDuplicates"], {"dev": 101})
        self.assertEqual(mock_insert_batch.call_count, 3)
        self.assertEqual(len(mock_insert_batch.call_args_list[0].args[0]), 500)
        self.assertEqual(len(mock_insert_batch.call_args_list[1].args[0]), 500)
        self.assertEqual(len(mock_insert_batch.call_args_list[2].args[0]), 201)
        mock_finalize.assert_called_once_with("task_chunked", "dev", "scrapes/task_chunked.json")

    @patch("api._finalize_local_artifact_import")
    @patch("api._upload_to_convex_envs")
    @patch("api.insert_scraping_accounts_batch")
    @patch("api._filter_and_collect_accounts")
    @patch("api.load_all_keyword_sets")
    @patch("api._get_task_and_payload")
    def test_process_scraping_task_does_not_finalize_when_archive_chunk_fails(
        self,
        mock_get_task,
        mock_keywords,
        mock_filter,
        mock_insert_batch,
        mock_upload,
        mock_finalize,
    ) -> None:
        mock_get_task.return_value = (
            {
                "_id": "task_chunk_fail",
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "kind": "followers",
                "localArtifactPath": "scrapes/task_chunk_fail.json",
            },
            {"users": [{"username": "placeholder"}]},
        )
        mock_keywords.return_value = {"us_male_names": {"john"}}
        archived_accounts = [
            {"userName": f"user_{index}", "status": "need_scraping", "createdAt": index}
            for index in range(501)
        ]
        mock_filter.return_value = (
            [{"userName": "kept_user", "fullName": "Kept User", "matchedName": "Kept"}],
            archived_accounts,
            501,
            500,
        )
        mock_insert_batch.side_effect = [
            {"status": "success", "inserted": 500, "skipped": 0},
            {"status": "error", "errorMessage": "chunk failed"},
        ]

        response = self.client.post(
            "/scraping-tasks/task_chunk_fail/process",
            json={
                "env": "dev",
                "keepFields": ["username", "full_name"],
                "uploadToConvex": True,
                "environments": ["dev"],
                "accountStatus": "available",
            },
        )

        self.assertEqual(response.status_code, 500)
        self.assertIn("chunk failed", response.json()["detail"])
        self.assertIn("partial progress inserted=500, skipped=0", response.json()["detail"])
        self.assertEqual(mock_insert_batch.call_count, 2)
        mock_upload.assert_not_called()
        mock_finalize.assert_not_called()

    @patch("api.convex_mutation")
    @patch("api.upload_usernames_to_convex")
    @patch("api._get_task_and_payload")
    def test_import_scraping_task_skips_private_accounts(
        self,
        mock_get_task,
        mock_upload_usernames,
        mock_mutation,
    ) -> None:
        mock_get_task.return_value = (
            {
                "_id": "task_local",
                "workflowId": "wf_1",
            },
            {
                "users": [
                    {"username": "public_alpha"},
                    {"username": "private_beta", "is_private": True},
                    {"username": "PUBLIC_ALPHA"},
                    {"username": "public_gamma"},
                ]
            },
        )
        mock_upload_usernames.return_value = {"inserted": 2, "skipped": 0}

        response = self.client.post(
            "/scraping-tasks/task_local/import",
            json={
                "env": "dev",
                "accountStatus": "available",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["taskId"], "task_local")
        self.assertEqual(body["env"], "dev")
        self.assertEqual(body["usernamesExtracted"], 2)
        self.assertEqual(body["inserted"], 2)
        self.assertEqual(body["skipped"], 0)
        mock_upload_usernames.assert_called_once_with(
            ["public_alpha", "public_gamma"],
            env="dev",
            status="available",
        )
        mock_mutation.assert_called_once_with(
            "workflowArtifacts:setImported",
            {"id": "task_local", "imported": True},
            env="dev",
        )

    @patch("api.convex_mutation")
    def test_finalize_local_artifact_import_restores_file_on_failure(self, mock_mutation) -> None:
        artifact_path = Path("/app/uploads/scrapes/test_restore.json")
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(dumps({"users": [{"username": "alpha"}]}), encoding="utf-8")

        def fail_finalize(path, body, env="dev"):
            if path == "workflowArtifacts:finalizeLocalImport":
                raise RuntimeError("convex unavailable")
            return {}

        mock_mutation.side_effect = fail_finalize

        with self.assertRaises(RuntimeError):
            api._finalize_local_artifact_import("task_local", "dev", "scrapes/test_restore.json")

        self.assertTrue(artifact_path.exists())
        self.assertIn("alpha", artifact_path.read_text(encoding="utf-8"))

    def test_load_local_artifact_payload_rejects_traversal_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(api, "UPLOAD_DIR", Path(tmpdir)):
                with self.assertRaises(api.HTTPException) as exc:
                    api._load_local_artifact_payload("../outside.json")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid local artifact path")

    @patch("api.convex_mutation")
    def test_finalize_local_artifact_import_rejects_traversal_path_before_delete(self, mock_mutation) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            outside_path = Path(tmpdir).parent / "outside.json"
            outside_path.write_text(dumps({"users": [{"username": "alpha"}]}), encoding="utf-8")

            with patch.object(api, "UPLOAD_DIR", Path(tmpdir)):
                with self.assertRaises(api.HTTPException) as exc:
                    api._finalize_local_artifact_import("task_local", "dev", "../outside.json")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid local artifact path")
        self.assertTrue(outside_path.exists())
        mock_mutation.assert_not_called()

    def test_load_local_artifact_payload_reads_valid_in_root_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_dir = Path(tmpdir)
            artifact_path = upload_dir / "scrapes" / "task.json"
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            artifact_path.write_text(dumps({"users": [{"username": "alpha"}]}), encoding="utf-8")

            with patch.object(api, "UPLOAD_DIR", upload_dir):
                payload = api._load_local_artifact_payload("scrapes/task.json")

        self.assertEqual(payload, {"users": [{"username": "alpha"}]})

    def test_process_workflow_scrape_rejects_invalid_users_payload(self) -> None:
        response = self.client.post(
            "/workflow-runs/process-scrape",
            json={
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "kind": "followers",
                "users": {"username": "alpha"},
                "env": "dev",
                "environments": ["dev"],
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_process_workflow_scrape_requires_destination_environments(self) -> None:
        response = self.client.post(
            "/workflow-runs/process-scrape",
            json={
                "workflowId": "wf_1",
                "workflowName": "Workflow",
                "nodeId": "node_1",
                "kind": "followers",
                "users": [],
                "env": "dev",
                "environments": [],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "environments is required")


if __name__ == "__main__":
    unittest.main()
