import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from gi_backup_incremental import LocalStore, snapshot, restore, version_id

@unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age required")
class IncrementalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.identity = self.root / "identity"
        subprocess.run(["age-keygen", "-o", str(self.identity)], capture_output=True, check=True)
        self.recipient = subprocess.check_output(["age-keygen", "-y", str(self.identity)], text=True).strip()
        self.store = LocalStore(self.root / "objects")
        self.secret = b"k" * 32
        self.payloads = {"a.jpg": b"aaa", "b.jpg": b"bbb"}
        self.calls = []

    def entry(self, key, version="1"):
        return {"bucket": "evidence", "key": key, "id": key, "updated_at": version,
                "etag": version, "size": len(self.payloads[key])}

    def download(self, entry):
        self.calls.append(entry["key"])
        return self.payloads[entry["key"]]

    def snap(self, entries, previous=None):
        return snapshot("synthetic", entries, self.download, self.store,
                        self.secret, self.recipient, previous)

    def test_two_days_unchanged_changed_deleted(self):
        first, i1, stats = self.snap([self.entry("a.jpg"), self.entry("b.jpg")])
        self.assertEqual(stats["downloads"], 2)
        self.calls.clear()
        second, i2, stats = self.snap([self.entry("a.jpg"), self.entry("b.jpg")], i1)
        self.assertEqual(self.calls, [])
        self.assertEqual(stats["bytes"], 0)
        self.payloads["a.jpg"] = b"changed"
        third, i3, stats = self.snap([self.entry("a.jpg", "2")], i2)
        self.assertEqual(self.calls, ["a.jpg"])
        self.assertEqual(stats["bytes"], 7)
        self.assertEqual(restore(first, self.store, self.identity, self.root/"old"), 2)
        self.assertEqual((self.root/"old/evidence/a.jpg").read_bytes(), b"aaa")
        self.assertEqual((self.root/"old/evidence/b.jpg").read_bytes(), b"bbb")
        self.assertEqual(restore(third, self.store, self.identity, self.root/"new"), 1)
        self.assertEqual((self.root/"new/evidence/a.jpg").read_bytes(), b"changed")
        self.assertFalse((self.root/"new/evidence/b.jpg").exists())

    def test_missing_metadata_forces_copy(self):
        e = self.entry("a.jpg")
        del e["etag"]
        _, i1, _ = self.snap([e])
        _, _, stats = self.snap([e], i1)
        self.assertEqual(stats["downloads"], 1)

    def test_corrupted_object_rejected_and_not_overwritten(self):
        first, index, _ = self.snap([self.entry("a.jpg")])
        obj = next(iter(index))
        p = self.store.path(obj)
        p.write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            restore(first, self.store, self.identity, self.root/"bad")
        self.assertEqual(list((self.root/"bad").iterdir()), [])
        new, _, stats = self.snap([self.entry("a.jpg")], index)
        self.assertEqual(stats["downloads"], 1)
        self.assertEqual(p.read_bytes(), b"tampered")
        self.assertEqual(restore(new, self.store, self.identity, self.root/"good"), 1)

    def test_no_trusted_index_forces_copy_and_paths_safe(self):
        e = self.entry("a.jpg")
        _, _, _ = self.snap([e])
        _, _, stats = self.snap([e])
        self.assertEqual(stats["downloads"], 1)
        with self.assertRaises(ValueError):
            version_id(self.secret, "synthetic", dict(e, key="../escape"))
        with self.assertRaises(ValueError):
            version_id(b"short", "synthetic", e)

if __name__ == "__main__":
    unittest.main()
