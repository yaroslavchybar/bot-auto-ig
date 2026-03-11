import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraping_tasks import (  # noqa: E402
    build_manifest_payload,
    extract_chunk_storage_ids,
    extract_users_from_payload,
    has_user_collection,
    normalize_task_row,
)


class ScrapingTaskHelpersTest(unittest.TestCase):
    def test_normalize_task_row_prefers_export_and_estimates_rows(self) -> None:
        task = {
            "_id": "task_1",
            "name": "Followers import",
            "targets": ["alpha", "beta"],
            "manifestStorageId": "manifest_1",
            "exportStorageId": "export_1",
            "stats": {"scraped": 12, "deduped": 9},
        }

        normalized = normalize_task_row(task)

        self.assertEqual(normalized["storageId"], "export_1")
        self.assertEqual(normalized["rowCount"], 9)
        self.assertEqual(normalized["targetUsername"], "alpha\nbeta")

    def test_extract_chunk_storage_ids_uses_manifest_and_task_fallback(self) -> None:
        manifest_payload = {
            "chunks": [
                {"storageId": "chunk_1"},
                {"storage_id": "chunk_2"},
                "chunk_3",
            ]
        }
        task = {
            "chunkRefs": [
                {"storageId": "chunk_2"},
                {"storageId": "chunk_4"},
            ]
        }

        storage_ids = extract_chunk_storage_ids(manifest_payload, task)

        self.assertEqual(storage_ids, ["chunk_1", "chunk_2", "chunk_3", "chunk_4"])

    def test_extract_users_from_payload_supports_chunk_and_raw_users_shapes(self) -> None:
        payload = {
            "chunks": [
                {"rawUsers": [{"username": "alpha"}]},
                {"users": ["beta"]},
            ]
        }

        users = extract_users_from_payload(payload)

        self.assertEqual(users, [{"username": "alpha"}, "beta"])
        self.assertFalse(has_user_collection(payload))

    def test_build_manifest_payload_flattens_chunk_payloads(self) -> None:
        task = {"_id": "task_2"}
        manifest_payload = {"summary": {"kind": "followers"}}
        chunk_payloads = [
            {"users": [{"username": "alpha"}]},
            {"rawUsers": [{"userName": "beta"}]},
        ]

        combined = build_manifest_payload(task, manifest_payload, chunk_payloads)

        self.assertEqual(combined["chunkCount"], 2)
        self.assertEqual(
            combined["users"],
            [{"username": "alpha"}, {"userName": "beta"}],
        )
        self.assertEqual(combined["storageKind"], "manifest")
        self.assertEqual(combined["taskId"], "task_2")

    def test_has_user_collection_accepts_empty_user_list(self) -> None:
        self.assertTrue(has_user_collection({"users": []}))
        self.assertTrue(has_user_collection({"rawUsers": []}))
        self.assertFalse(has_user_collection({"summary": {}}))


if __name__ == "__main__":
    unittest.main()
