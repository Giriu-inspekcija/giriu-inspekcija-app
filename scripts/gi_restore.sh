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
if api.scheme != "https" or not api.hostname or not api.hostname.endswith(".supabase.co"):
    raise SystemExit("Invalid isolated Supabase Storage URI")
ref = api.hostname.split(".")[0]
if ref not in ((url.hostname or "") + " " + (url.username or "")):
    raise SystemExit("Storage target and database target are not the same project")
PY
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
