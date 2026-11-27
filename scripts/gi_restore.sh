#!/usr/bin/env bash
# Decrypt and verify any GI snapshot; restore only into a separately approved project.
set -Eeuo pipefail
umask 077

usage(){
  echo "Usage: GI_AGE_IDENTITY=/safe/offline/key.txt $0 backup.tar.gz.age [--verify-only|--restore-isolated]" >&2
  exit 2
}
[[ $# -ge 1 ]] || usage
archive="$1"
mode="--verify-only"
[[ $# -lt 2 ]] || mode="$2"
[[ "$mode" == "--verify-only" || "$mode" == "--restore-isolated" ]] || usage
[[ -f "$archive" ]] || { echo "Backup archive not found" >&2; exit 2; }
: "${GI_AGE_IDENTITY:?Set path to offline private age identity}"
[[ -f "$GI_AGE_IDENTITY" ]] || { echo "Private recovery identity missing" >&2; exit 2; }
command -v age >/dev/null
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
age -d -i "$GI_AGE_IDENTITY" -o "$tmp/snapshot.tar.gz" "$archive"
# An attacker who knows the PUBLIC recipient can encrypt arbitrary data;
# reject links, special files and traversal before extracting any archive.
python3 - "$tmp/snapshot.tar.gz" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for item in archive:
        path = PurePosixPath(item.name)
        if path.is_absolute() or not path.parts or path.parts[0] != "snapshot" or ".." in path.parts:
            raise SystemExit("Unsafe archive path")
        if not (item.isfile() or item.isdir()):
            raise SystemExit("Archive contains a link or special file")
        if item.size > 30 * 1024**3:
            raise SystemExit("Suspiciously large archive entry")
PY
tar -C "$tmp" --no-same-owner --no-same-permissions -xzf "$tmp/snapshot.tar.gz"
cd "$tmp/snapshot"
sha256sum --quiet --check CHECKSUMS.sha256
python3 "$SCRIPT_DIR/gi_backup_storage.py" verify --directory storage-export
for file in roles.sql schema.sql data.sql migration-schema.sql migration-data.sql; do
  test -s "$file"
done
echo "PASS: decrypted archive, SQL component checksums and every Storage object verified."

if [[ "$mode" == "--verify-only" ]]; then
  echo "Verification only. NO database or files were changed."
  exit 0
fi
if [[ "${GI_RESTORE_CONFIRM:-}" != "RESTORE_TO_ISOLATED_GI_TEST" ]]; then
  echo "Explicit isolated restore confirmation missing" >&2; exit 2
fi
if [[ -z "${GI_RESTORE_DB_URL:-}" || -z "${GI_RESTORE_SUPABASE_URL:-}" || -z "${GI_RESTORE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Isolated DB and Storage restore credentials required" >&2; exit 2
fi
command -v psql >/dev/null
if [[ "$GI_RESTORE_DB_URL" == *"mkhxokzuietqgjdpkcqq"* ]] ||
   [[ "$GI_RESTORE_SUPABASE_URL" == "https://mkhxokzuietqgjdpkcqq.supabase.co" ]]; then
  echo "REFUSED: source and restore target must be different projects" >&2; exit 2
fi
python3 - <<'PY'
import os
from urllib.parse import urlparse
url = urlparse(os.environ["GI_RESTORE_DB_URL"])
api = urlparse(os.environ["GI_RESTORE_SUPABASE_URL"])
if url.scheme not in ("postgresql", "postgres") or not url.hostname:
    raise SystemExit("Invalid restore database URI")
# Opt-in local recovery avoids buying a second hosted project. Both endpoints
# must be loopback, with an explicit fresh disposable local target.
local = (os.environ.get("GI_RESTORE_ALLOW_LOOPBACK") == "YES"
         and api.scheme == "http" and api.hostname == "127.0.0.1"
         and url.hostname == "127.0.0.1" and api.port and url.port)
remote = (api.scheme == "https" and api.hostname
          and api.hostname.endswith(".supabase.co"))
if not (local or remote):
    raise SystemExit("Restore target must be verified Supabase or explicitly local loopback")
if remote:
    ref = api.hostname.split(".")[0]
    if ref not in ((url.hostname or "") + " " + (url.username or "")):
        raise SystemExit("Storage target and database target are not the same project")
import json
from pathlib import Path
source = urlparse(json.loads(Path("storage-export/storage-manifest.json").read_text())["source_url"])
if source.hostname == api.hostname and source.port == api.port:
    raise SystemExit("Restore target must not be the source Storage")

PY
# Real hosted snapshots can include newer Auth platform columns than the local
# platform image. Adapt only a verified, empty COPY block, only by explicit
# opt-in, only on loopback. The original encrypted archive is never changed.
if [[ "${GI_RESTORE_ALLOW_EMPTY_OAUTH_COMPAT:-}" == "YES" ]]; then
  python3 - <<'GI_LOCAL_AUTH_COMPAT'
import os, re, subprocess
from pathlib import Path
from urllib.parse import urlparse

db = urlparse(os.environ["GI_RESTORE_DB_URL"])
api = urlparse(os.environ["GI_RESTORE_SUPABASE_URL"])
if (os.environ.get("GI_RESTORE_ALLOW_LOOPBACK") != "YES"
        or db.hostname != "127.0.0.1" or api.hostname != "127.0.0.1"
        or api.scheme != "http" or not db.port or not api.port):
    raise SystemExit("Empty OAuth compatibility is local-loopback only")

def query(sql):
    result = subprocess.run(
        ["psql", os.environ["GI_RESTORE_DB_URL"], "-XAtq",
         "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, check=True)
    return result.stdout.strip()

p = Path("data.sql")
lines = p.read_bytes().splitlines(keepends=True)
header = re.compile(rb'^\s*COPY\s+(?:"auth"|auth)\s*\.\s*(?:"custom_oauth_providers"|custom_oauth_providers)\s*\(([^)]*)\)\s+FROM\s+stdin\s*;\s*
# Fail atomically on SQL errors. Auth/Storage objects need the platform schema.
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql \
  --dbname "$GI_RESTORE_DB_URL"
psql --single-transaction --variable ON_ERROR_STOP=1 --file migration-schema.sql \
  --file migration-data.sql --dbname "$GI_RESTORE_DB_URL"

GI_RESTORE_TO_ISOLATED_TARGET=YES GI_SUPABASE_SERVICE_ROLE_KEY="$GI_RESTORE_SERVICE_ROLE_KEY" \
python3 "$SCRIPT_DIR/gi_backup_storage.py" restore \
  --directory "$tmp/snapshot/storage-export" --url "$GI_RESTORE_SUPABASE_URL"
echo "Isolated restore completed. Now audit RLS and sign-in before declaring GO."
, re.I)
any_copy = re.compile(rb'^\s*COPY\s+.+\s+FROM\s+stdin\s*;\s*
# Fail atomically on SQL errors. Auth/Storage objects need the platform schema.
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql \
  --dbname "$GI_RESTORE_DB_URL"
psql --single-transaction --variable ON_ERROR_STOP=1 --file migration-schema.sql \
  --file migration-data.sql --dbname "$GI_RESTORE_DB_URL"

GI_RESTORE_TO_ISOLATED_TARGET=YES GI_SUPABASE_SERVICE_ROLE_KEY="$GI_RESTORE_SERVICE_ROLE_KEY" \
python3 "$SCRIPT_DIR/gi_backup_storage.py" restore \
  --directory "$tmp/snapshot/storage-export" --url "$GI_RESTORE_SUPABASE_URL"
echo "Isolated restore completed. Now audit RLS and sign-in before declaring GO."
, re.I)
matches = []
active = False
for i, line in enumerate(lines):
    if active:
        if line.rstrip(b'\r\n') == b'\\.':
            active = False
        continue
    m = header.fullmatch(line)
    if m:
        matches.append((i, m.group(1)))
        active = True
    elif any_copy.fullmatch(line):
        active = True
if active or len(matches) > 1:
    raise SystemExit("Unexpected COPY format; refusing compatibility adaptation")
if matches:
    i, raw_names = matches[0]
    columns = {x.strip().strip(b'"').decode("ascii") for x in raw_names.split(b',')}
    actual = set(query("SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name='custom_oauth_providers' ORDER BY column_name;").splitlines())
    missing = columns - actual
    if missing:
        allowed = {"client_auth_method", "client_assertion_audience"}
        if (not actual or not missing <= allowed
                or i+1 >= len(lines) or lines[i+1].rstrip(b'\r\n') != b'\\.'
                or query("SELECT count(*) FROM auth.custom_oauth_providers;") != "0"):
            raise SystemExit("OAuth compatibility not safe: unexpected missing columns or nonempty table")
        p.write_bytes(b''.join(lines[:i] + lines[i+2:]))
        print("PASS: only the verified empty auth.custom_oauth_providers COPY block omitted.")
GI_LOCAL_AUTH_COMPAT
fi

# A fresh Supabase project must be prepared first (extensions, webhooks).
# Fail atomically on SQL errors. Auth/Storage objects need the platform schema.
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql \
  --dbname "$GI_RESTORE_DB_URL"
psql --single-transaction --variable ON_ERROR_STOP=1 --file migration-schema.sql \
  --file migration-data.sql --dbname "$GI_RESTORE_DB_URL"

GI_RESTORE_TO_ISOLATED_TARGET=YES GI_SUPABASE_SERVICE_ROLE_KEY="$GI_RESTORE_SERVICE_ROLE_KEY" \
python3 "$SCRIPT_DIR/gi_backup_storage.py" restore \
  --directory "$tmp/snapshot/storage-export" --url "$GI_RESTORE_SUPABASE_URL"
echo "Isolated restore completed. Now audit RLS and sign-in before declaring GO."
