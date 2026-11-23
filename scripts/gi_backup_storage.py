#!/usr/bin/env python3
"""GI Supabase Storage snapshot/verification and isolated-target restore.

The snapshot contains object bytes AND metadata. The outer backup job encrypts
this directory before uploading it. Never publish unencrypted output.
"""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

MAX_OBJECTS = 100000
DEFAULT_MAX_TOTAL = 20 * 1024**3
CHUNK = 1024 * 1024


def safe_part(part):
    if not part or part in (".", "..") or "\\" in part or "\x00" in part:
        raise ValueError("Unsafe storage object path")
    return part


def safe_key(key):
    path = PurePosixPath(key)
    if path.is_absolute() or not key or "//" in key:
        raise ValueError("Unsafe storage object path")
    parts = key.split("/")
    for part in parts:
        safe_part(part)
    return parts


def safe_bucket(bucket):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", bucket):
        raise ValueError("Invalid bucket ID")
    return bucket


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        while block := stream.read(CHUNK):
            h.update(block)
    return h.hexdigest()


class Storage:
    def __init__(self, url, key):
        if not url.startswith("https://") and not url.startswith("http://127.0.0.1:"):
            raise ValueError("Supabase Storage requires HTTPS")
        if not key:
            raise ValueError("Missing service role key")
        self.url = url.rstrip("/")
        self.http = requests.Session()
        # Supabase's newer sb_secret_* keys authenticate through apikey.
        # Legacy service_role JWTs also require the Authorization bearer header.
        self.http.headers["apikey"] = key
        if not key.startswith("sb_secret_"):
            self.http.headers["Authorization"] = "Bearer " + key
        adapter = HTTPAdapter(max_retries=Retry(
            total=3, backoff_factor=0.8, status_forcelist=[429, 502, 503, 504],
            allowed_methods=frozenset(["GET", "POST"])
        ))
        self.http.mount("https://", adapter)
        self.http.mount("http://", adapter)

    def request(self, method, endpoint, **kwargs):
        r = self.http.request(method, self.url + "/storage/v1/" + endpoint,
                              timeout=(10, 90), allow_redirects=False, **kwargs)
        if not 200 <= r.status_code < 300:
            # Never echo API errors: they may contain confidential object keys.
            # A bounded machine-readable error code is safe for CI diagnosis;
            # never print provider messages, which may contain private object names.
            try:
                payload = r.json()
                code = payload.get("code") or payload.get("errorCode") or payload.get("error") or ""
            except (ValueError, AttributeError):
                code = ""
            code = re.sub(r"[^A-Za-z0-9_-]", "", str(code))[:40]
            raise RuntimeError("Storage API " + method + " returned " + str(r.status_code)
                               + ((" [" + code + "]") if code else ""))
        return r

    def buckets(self):
        data = self.request("GET", "bucket").json()
        if not isinstance(data, list):
            raise RuntimeError("Malformed bucket list")
        return data

    def list(self, bucket, prefix=""):
        offset = 0
        while True:
            result = self.request("POST", "object/list/" + quote(bucket, safe=""),
                        json={"prefix": prefix, "limit": 100,
                              "offset": offset, "sortBy": {"column": "name", "order": "asc"}}).json()
            if not isinstance(result, list):
                raise RuntimeError("Malformed object listing")
            for entry in result:
                name = entry.get("name")
                if not isinstance(name, str):
                    raise RuntimeError("Malformed object name")
                safe_part(name)
                full = prefix + name
                if entry.get("id") is None:
                    # Supabase lists virtual folders separately from actual objects.
                    yield from self.list(bucket, full + "/")
                else:
                    yield full
            if len(result) < 100:
                break
            offset += len(result)

    def download(self, bucket, key, destination, max_bytes):
        endpoint = "object/" + quote(bucket, safe="") + "/" + quote(key, safe="/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        part = destination.with_name(destination.name + ".partial")
        try:
            with self.request("GET", endpoint, stream=True) as result:
                h = hashlib.sha256()
                size = 0
                # Content-Type is returned by authenticated Storage download.
                # Preserve it; inferring from names breaks allowed_mime_types.
                content_type = result.headers.get("Content-Type", "application/octet-stream")
                content_type = content_type.split(";", 1)[0].strip().lower()
                with part.open("xb") as stream:
                    for block in result.iter_content(CHUNK):
                        if block:
                            size += len(block)
                            if size > max_bytes:
                                raise RuntimeError("Storage size limit exceeded")
                            stream.write(block)
                            h.update(block)
            os.replace(part, destination)
            return size, h.hexdigest(), content_type
        finally:
            part.unlink(missing_ok=True)

    def upload(self, bucket, key, path, isolated_restore=False, content_type=None):
        endpoint = "object/" + quote(bucket, safe="") + "/" + quote(key, safe="/")
        content_type = content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        with path.open("rb") as stream:
            self.request("POST", endpoint, data=stream, headers={
                "Content-Type": content_type, "x-upsert": "true" if isolated_restore else "false"
            })

    def ensure_private_bucket(self, metadata):
        bucket = safe_bucket(metadata["id"])
        try:
            existing = self.request("GET", "bucket/" + quote(bucket, safe="")).json()
            if existing.get("public") is not False:
                raise RuntimeError("Refusing to restore evidence into a public bucket")
        except RuntimeError as error:
            if "404" not in str(error):
                raise
            self.request("POST", "bucket", json={
                "id": bucket, "name": bucket, "public": False
            })


def snapshot(args):
    root = args.directory.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise RuntimeError("Backup directory must be empty")
    api = Storage(args.url, args.key)
    metadata = []
    objects = []
    seen = set()
    total = 0
    for bucket in api.buckets():
        bid = safe_bucket(bucket["id"])
        metadata.append({"id": bid, "public_at_snapshot": bool(bucket.get("public"))})
        for object_key in api.list(bid):
            parts = safe_key(object_key)
            if (bid, object_key) in seen:
                raise RuntimeError("Duplicate storage object in listing")
            seen.add((bid, object_key))
            if len(seen) > MAX_OBJECTS:
                raise RuntimeError("Too many objects; use segmented backup")
            filename = root.joinpath("storage", bid, *parts)
            remaining = args.max_bytes - total
            if remaining < 0:
                raise RuntimeError("Maximum backup size reached")
            size, digest, content_type = api.download(bid, object_key, filename, remaining)
            total += size
            objects.append({"bucket": bid, "key": object_key,
                            "size": size, "sha256": digest, "content_type": content_type})
    manifest = {"format_version": 1, "source_url": api.url,
                "buckets": metadata, "objects": objects,
                "object_count": len(objects), "total_bytes": total}
    (root / "storage-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8")
    verify(root)
    print(f"Storage snapshot verified: {len(objects)} objects, {total} bytes")


def verify(root):
    root = root.resolve()
    manifest = json.loads((root / "storage-manifest.json").read_text("utf-8"))
    if manifest.get("format_version") != 1:
        raise RuntimeError("Unsupported manifest version")
    seen = set()
    total = 0
    for item in manifest["objects"]:
        bucket = safe_bucket(item["bucket"])
        parts = safe_key(item["key"])
        signature = (bucket, item["key"])
        if signature in seen:
            raise RuntimeError("Manifest contains duplicates")
        seen.add(signature)
        target = root.joinpath("storage", bucket, *parts)
        if not target.is_file() or target.is_symlink():
            raise RuntimeError("Object missing or unsafe")
        if target.stat().st_size != item["size"] or sha256(target) != item["sha256"]:
            raise RuntimeError("Object integrity check failed")
        total += item["size"]
    disk = {p.relative_to(root / "storage").as_posix()
            for p in (root / "storage").rglob("*") if p.is_file()} if (root / "storage").is_dir() else set()
    expected = {x["bucket"] + "/" + x["key"] for x in manifest["objects"]}
    if disk != expected:
        raise RuntimeError("Unexpected or missing objects")
    if total != manifest["total_bytes"] or len(seen) != manifest["object_count"]:
        raise RuntimeError("Manifest count mismatch")
    print(f"Storage integrity PASS: {len(seen)} files")


def restore(args):
    root = args.directory.resolve()
    verify(root)
    meta = json.loads((root / "storage-manifest.json").read_text("utf-8"))
    if args.url.rstrip("/") == meta["source_url"].rstrip("/"):
        raise RuntimeError("Refusing to restore to the original project")
    if os.environ.get("GI_RESTORE_TO_ISOLATED_TARGET") != "YES":
        raise RuntimeError("Set GI_RESTORE_TO_ISOLATED_TARGET=YES for deliberate isolated restore")
    api = Storage(args.url, args.key)
    for bucket in meta["buckets"]:
        api.ensure_private_bucket(bucket)
    for item in meta["objects"]:
        path = root.joinpath("storage", item["bucket"], *safe_key(item["key"]))
        # The SQL restore already re-created storage.objects metadata. Isolated
        # target restore must put the missing object BYTES back, not reject the
        # existing metadata row with a 409. The original project is forbidden.
        api.upload(item["bucket"], item["key"], path, isolated_restore=True,
                   content_type=item.get("content_type"))
    print(f"Isolated target Storage restored: {len(meta['objects'])} objects")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["backup", "verify", "restore"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--url", default=os.getenv("GI_SUPABASE_URL", ""))
    parser.add_argument("--key", default=os.getenv("GI_SUPABASE_SERVICE_ROLE_KEY", ""))
    parser.add_argument("--max-bytes", type=int,
                        default=int(os.getenv("GI_BACKUP_MAX_BYTES", DEFAULT_MAX_TOTAL)))
    args = parser.parse_args()
    if args.command == "backup":
        snapshot(args)
    elif args.command == "verify":
        verify(args.directory)
    else:
        restore(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, requests.RequestException, OSError) as err:
        print("Backup Storage FAILED: " + str(err), file=sys.stderr)
        sys.exit(1)
