"""Copy one encrypted GI archive to a fixed Shared Drive without overwriting."""
import hashlib
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
import requests

DRIVE = "0ADCW__IFKRzXUk9PVA"
FOLDER = "1UuGP7gdRifvnzY_k0DYn8qbvtiCqCj_G"
API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
FIELDS = "id,name,parents,driveId,trashed,size,sha256Checksum"
NAME = re.compile(r"gi-supabase-\d{8}T\d{6}Z\.tar\.gz\.age")


def local_archive(directory):
    files = list(directory.glob("*.age"))
    if len(files) != 1:
        raise ValueError("Expected exactly one encrypted archive")
    path = files[0]
    if path.is_symlink() or not path.is_file() or not NAME.fullmatch(path.name):
        raise ValueError("Unexpected archive")
    with path.open("rb") as stream:
        if not stream.read(32).startswith(b"age-encryption.org/v1"):
            raise ValueError("Not an age archive")
    return path


def request(session, method, url, **kwargs):
    response = session.request(method, url, timeout=(20, 300),
                               allow_redirects=False, **kwargs)
    if not 200 <= response.status_code < 300:
        response.close()
        raise RuntimeError(f"Drive {method} failed: HTTP {response.status_code}")
    return response


def verify(metadata, name, size, digest):
    if (metadata.get("name") != name or metadata.get("parents") != [FOLDER]
            or metadata.get("driveId") != DRIVE or metadata.get("trashed") is not False
            or str(metadata.get("size")) != str(size)
            or metadata.get("sha256Checksum") != digest):
        raise ValueError("Drive file identity, location, size or SHA256 mismatch")


def mirror(session, path):
    size = path.stat().st_size
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    folder = request(session, "GET", API + "/" + FOLDER,
                     params={"supportsAllDrives": "true",
                             "fields": "id,driveId,mimeType,trashed,capabilities(canAddChildren)"}).json()
    if (folder.get("id") != FOLDER or folder.get("driveId") != DRIVE
            or folder.get("mimeType") != "application/vnd.google-apps.folder"
            or folder.get("trashed") is not False
            or not folder.get("capabilities", {}).get("canAddChildren")):
        raise ValueError("Wrong or inaccessible destination")
    listing = request(session, "GET", API, params={
        "corpora": "drive", "driveId": DRIVE, "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true", "pageSize": 100,
        "q": f"'{FOLDER}' in parents and name = '{path.name}' and trashed = false",
        "fields": f"nextPageToken,incompleteSearch,files({FIELDS})"}).json()
    if listing.get("nextPageToken") or listing.get("incompleteSearch"):
        raise ValueError("Incomplete Drive inventory")
    existing = listing["files"]
    if len(existing) > 1:
        raise ValueError("Duplicate archive name")
    if existing:
        verify(existing[0], path.name, size, digest)
        return existing[0]["id"]
    start = request(session, "POST", UPLOAD, params={
        "uploadType": "resumable", "supportsAllDrives": "true", "fields": FIELDS},
        json={"name": path.name, "parents": [FOLDER],
              "mimeType": "application/octet-stream"},
        headers={"X-Upload-Content-Type": "application/octet-stream",
                 "X-Upload-Content-Length": str(size)})
    location = start.headers.get("Location", "")
    url = urlsplit(location)
    if url.scheme != "https" or url.netloc != "www.googleapis.com" or not url.path.startswith("/upload/drive/"):
        raise ValueError("Unexpected Drive upload endpoint")
    with path.open("rb") as stream:
        uploaded = request(session, "PUT", location, data=stream,
                           headers={"Content-Type": "application/octet-stream",
                                    "Content-Length": str(size)}).json()
    file_id = uploaded["id"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", file_id):
        raise ValueError("Invalid Drive file ID")
    fresh = request(session, "GET", API + "/" + file_id, params={
        "supportsAllDrives": "true", "fields": FIELDS}).json()
    verify(fresh, path.name, size, digest)
    return file_id


def main():
    try:
        path = local_archive(Path(os.environ["GI_BACKUP_OUTPUT_DIR"]))
        token = os.environ["GI_DRIVE_ACCESS_TOKEN"]
        if not token:
            raise ValueError("Missing short-lived Drive token")
        with requests.Session() as session:
            session.headers["Authorization"] = "Bearer " + token
            file_id = mirror(session, path)
        print("PASS: encrypted Drive mirror, exact folder, byte size and SHA256 verified.")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(f"Encrypted Drive copy verified: https://drive.google.com/file/d/{file_id}/view\n")
    except (ValueError, RuntimeError, OSError, KeyError, requests.RequestException) as error:
        # Do not print API response bodies, token, upload URL or exception details.
        print("::error::Drive mirror failed: " + type(error).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
