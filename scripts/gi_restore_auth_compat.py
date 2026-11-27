"""Opt-in local compatibility for one known, empty hosted Auth COPY block."""
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

HEADER = re.compile(rb'^\s*COPY\s+(?:"auth"|auth)\s*\.\s*(?:"custom_oauth_providers"|custom_oauth_providers)\s*\(([^)]*)\)\s+FROM\s+stdin\s*;\s*$', re.I)
ANY_COPY = re.compile(rb'^\s*COPY\s+.+\s+FROM\s+stdin\s*;\s*$', re.I)
ALLOWED = {"client_auth_method", "client_assertion_audience"}


def adapt(data, actual_columns, target_empty):
    lines = data.splitlines(keepends=True)
    matches = []
    active = False
    for i, line in enumerate(lines):
        if active:
            if line.rstrip(b'\r\n') == b'\\.':
                active = False
            continue
        m = HEADER.fullmatch(line)
        if m:
            matches.append((i, m.group(1)))
            active = True
        elif ANY_COPY.fullmatch(line):
            active = True
    if active or len(matches) > 1:
        raise ValueError("Unexpected COPY format")
    if not matches:
        return data
    i, raw_names = matches[0]
    columns = {x.strip().strip(b'"').decode("ascii") for x in raw_names.split(b',')}
    missing = columns - actual_columns
    if not missing:
        return data
    if (not actual_columns or not missing <= ALLOWED or not target_empty
            or i + 1 >= len(lines) or lines[i+1].rstrip(b'\r\n') != b'\\.'):
        raise ValueError("OAuth compatibility unsafe: unexpected columns or nonempty table")
    return b''.join(lines[:i] + lines[i+2:])


def main():
    db_url = os.environ["GI_RESTORE_DB_URL"]
    db = urlparse(db_url)
    api = urlparse(os.environ["GI_RESTORE_SUPABASE_URL"])
    if (os.environ.get("GI_RESTORE_ALLOW_LOOPBACK") != "YES"
            or db.scheme not in ("postgres", "postgresql")
            or db.hostname != "127.0.0.1" or api.hostname != "127.0.0.1"
            or api.scheme != "http" or not db.port or not api.port
            or db.query or db.fragment):
        raise SystemExit("Empty OAuth compatibility is local-loopback only")
    def query(sql):
        return subprocess.run(
            ["psql", db_url, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, text=True, check=True
        ).stdout.strip()
    path = Path(sys.argv[1])
    original = path.read_bytes()
    actual = set(query("SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name='custom_oauth_providers' ORDER BY column_name;").splitlines())
    empty = bool(actual) and query("SELECT count(*) FROM auth.custom_oauth_providers;") == "0"
    updated = adapt(original, actual, empty)
    if updated != original:
        path.write_bytes(updated)
        print("PASS: only verified empty auth.custom_oauth_providers COPY block omitted")


if __name__ == "__main__":
    main()
