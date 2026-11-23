"""Offline Storage API simulation: no live GI data or credentials used."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gi_backup_storage as backup

PHOTO = b"\x89PNG\r\n\x1a\n" + b"test-photo"
DOC = b"%PDF-1.7\n" + b"test-report"

class FakeStorage(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _send(self, data, content_type="application/json", status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _auth(self):
        return self.headers.get("Authorization") == "Bearer test-service-key"

    def do_GET(self):
        if not self._auth():
            return self._send(b"{}", status=401)
        if self.path == "/storage/v1/bucket":
            return self._send(json.dumps([
                {"id":"photos","public":False},{"id":"reports","public":False}
            ]).encode())
        if self.path == "/storage/v1/object/photos/2026/wood.png":
            return self._send(PHOTO, "image/png")
        if self.path == "/storage/v1/object/reports/report.pdf":
            return self._send(DOC, "application/pdf")
        return self._send(b"{}", status=404)

    def do_POST(self):
        if not self._auth():
            return self._send(b"{}", status=401)
        n = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(n))
        prefix = body.get("prefix", "")
        if self.path == "/storage/v1/object/list/photos":
            data = [{"name":"2026","id":None}] if prefix == "" else [
                {"name":"wood.png","id":"uuid-1"}]
        elif self.path == "/storage/v1/object/list/reports":
            data = [{"name":"report.pdf","id":"uuid-2"}] if prefix == "" else []
        else:
            return self._send(b"{}", status=404)
        self._send(json.dumps(data).encode())

class BackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeStorage)
        cls.thread = threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_round_trip_and_sha256(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "snapshot"
            args = SimpleNamespace(directory=path,url=self.url,
                                   key="test-service-key",max_bytes=100000)
            backup.snapshot(args)
            manifest = json.loads((path/"storage-manifest.json").read_text())
            self.assertEqual(manifest["object_count"], 2)
            self.assertEqual(manifest["total_bytes"],len(PHOTO)+len(DOC))
            self.assertEqual(manifest["objects"][0]["sha256"],
                             hashlib.sha256(PHOTO).hexdigest())
            self.assertEqual((path/"storage/photos/2026/wood.png").read_bytes(),PHOTO)
            backup.verify(path)
            with self.assertRaises(RuntimeError):
                backup.snapshot(args)
            (path/"storage/photos/2026/wood.png").write_bytes(b"tampered")
            with self.assertRaises(RuntimeError):
                backup.verify(path)

    def test_no_leaked_names_or_traversal(self):
        for name in ("../passwords","/etc/passwd","a//b","a/./b","..\\x"):
            with self.assertRaises(ValueError):
                backup.safe_key(name)
        with self.assertRaises(ValueError):
            backup.safe_bucket("../../secret")
        with self.assertRaises(ValueError):
            backup.Storage("http://example.com", "key")

    def test_denied_api_and_source_restore_protection(self):
        with self.assertRaises(RuntimeError):
            backup.Storage(self.url,"wrong-key").buckets()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"snapshot"
            backup.snapshot(SimpleNamespace(directory=path,url=self.url,
                              key="test-service-key",max_bytes=100000))
            with patch.dict(os.environ,{"GI_RESTORE_TO_ISOLATED_TARGET":"YES"}):
                with self.assertRaises(RuntimeError):
                    backup.restore(SimpleNamespace(directory=path,url=self.url,
                                    key="test-service-key"))

if __name__ == "__main__":
    unittest.main()
