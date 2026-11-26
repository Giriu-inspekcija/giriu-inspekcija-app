"""GI incremental Storage prototype: no live schedule, credentials, or deletion.

A private HMAC index maps reliable source version metadata to opaque identifiers.
Age encryption remains public-recipient-only; the offline identity is never
required by backup. Every manifest describes a complete point in time.
"""
import hashlib
import hmac
import json
import re
import secrets
import subprocess
import tempfile
from pathlib import Path
from gi_backup_storage import safe_bucket, safe_key

HEX = re.compile(r"[0-9a-f]{64}")
MD5 = re.compile(r"[0-9a-f]{32}")

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def version_id(secret, source, entry):
    if len(secret) < 32:
        raise ValueError("Index key must be at least 32 bytes")
    safe_bucket(entry["bucket"])
    safe_key(entry["key"])
    # Missing or ambiguous version metadata -> download again, never assume unchanged.
    fields = [entry.get(k) for k in ("id", "updated_at", "etag", "size")]
    if (not all(isinstance(x, str) and x for x in fields[:3])
            or type(fields[3]) is not int or fields[3] < 0):
        fields = [secrets.token_hex(32)]
    return hmac.new(secret, canonical([source, entry["bucket"], entry["key"], fields]), hashlib.sha256).hexdigest()

def encrypt(recipient, data):
    return subprocess.run(["age", "-r", recipient], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True).stdout

def decrypt(identity, data):
    return subprocess.run(["age", "-d", "-i", str(identity)], input=data,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout

class LocalStore:
    """Immutable test store. Production Drive adapter is deliberately not enabled."""
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, identifier):
        if not HEX.fullmatch(identifier):
            raise ValueError("Invalid opaque identifier")
        return self.root / (identifier + ".age")

    def get(self, identifier):
        return self.path(identifier).read_bytes()

    def checksum(self, identifier):
        p = self.path(identifier)
        return digest(p.read_bytes()) if p.is_file() else None

    def put(self, identifier, ciphertext):
        p = self.path(identifier)
        with p.open("xb") as f:
            f.write(ciphertext)
        actual = self.checksum(identifier)
        if actual != digest(ciphertext):
            raise ValueError("Ciphertext failed post-write verification")
        return actual

def snapshot(source, entries, download, store, secret, recipient, previous=None):
    """Return encrypted full manifest bytes; previous is a trusted index mapping
    opaque ID to previously verified ciphertext hash (NOT a public manifest).
    Without a trusted index no reuse is allowed. No filename is stored in the index.
    The prototype caller holds it locally; durable protected index is a deployment gate.
    """
    previous = previous or {}
    manifest = {"format": 1, "source": source, "objects": []}
    index = {}
    seen = set()
    downloads = 0
    downloaded_bytes = 0
    for entry in entries:
        identifier = version_id(secret, source, entry)
        key = (entry["bucket"], entry["key"])
        if key in seen:
            raise ValueError("Duplicate source path")
        seen.add(key)
        expected = previous.get(identifier)
        actual = store.checksum(identifier)
        if expected and HEX.fullmatch(expected) and actual == expected:
            checksum = expected
        else:
            # Never overwrite a suspect/missing-index object. A new unique version
            # is allocated if the canonical name already exists.
            canonical_id = identifier
            if actual is not None:
                identifier = hmac.new(secret, canonical([canonical_id, secrets.token_hex(32)]), hashlib.sha256).hexdigest()
            payload = download(entry)
            if not isinstance(payload, bytes):
                raise TypeError("Downloader must return bytes")
            size = entry.get("size")
            if type(size) is int and size >= 0 and len(payload) != size:
                raise ValueError("Source changed during snapshot")
            header = canonical({"id": identifier, "source": source, "bucket": key[0],
                                "key": key[1], "sha256": digest(payload)})
            checksum = store.put(identifier, encrypt(recipient, header + b"\n" + payload))
            downloads += 1
            downloaded_bytes += len(payload)
        manifest["objects"].append({"id": identifier, "bucket": key[0], "key": key[1], "cipher_sha256": checksum})
        index[identifier] = checksum
    return encrypt(recipient, canonical(manifest)), index, {"downloads": downloads, "bytes": downloaded_bytes}

def restore(manifest_cipher, store, identity, output):
    """Offline local reconstruction only, refuses nonempty target. No live DB writes."""
    manifest = json.loads(decrypt(identity, manifest_cipher))
    if manifest.get("format") != 1 or not isinstance(manifest.get("objects"), list):
        raise ValueError("Invalid manifest")
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise ValueError("Restore target must be empty")
    seen = set()
    # Stage every verified object before publishing into the requested output.
    with tempfile.TemporaryDirectory(dir=root) as tmp:
        stage = Path(tmp)
        for item in manifest["objects"]:
            bucket = safe_bucket(item["bucket"])
            parts = safe_key(item["key"])
            signature = (bucket, item["key"])
            if signature in seen:
                raise ValueError("Duplicate manifest path")
            seen.add(signature)
            ciphertext = store.get(item["id"])
            if digest(ciphertext) != item["cipher_sha256"]:
                raise ValueError("Ciphertext hash mismatch")
            raw = decrypt(identity, ciphertext)
            header_bytes, payload = raw.split(b"\n", 1)
            header = json.loads(header_bytes)
            if header != {"id": item["id"], "source": manifest["source"], "bucket": bucket,
                          "key": item["key"], "sha256": digest(payload)}:
                raise ValueError("Object identity or payload mismatch")
            dest = stage.joinpath(bucket, *parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as f:
                f.write(payload)
        for child in stage.iterdir():
            child.rename(root / child.name)
    return len(seen)
