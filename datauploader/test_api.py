import sys
import unittest
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
