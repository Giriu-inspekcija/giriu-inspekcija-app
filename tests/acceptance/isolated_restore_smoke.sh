#!/usr/bin/env bash
# End-to-end backup / encrypted archive / restore on TWO disposable local
# Supabase projects only. Never reads hosted production URLs or sends data offsite.
set -Eeuo pipefail
umask 077
if [[ $# -ne 3 ]]; then
  echo "Usage: isolated_restore_smoke.sh SOURCE_LOOPBACK_DB SOURCE_LOOPBACK_API LOCAL_SERVICE_ROLE_KEY" >&2
  exit 2
fi
source_db="$1"; source_api="$2"; source_key="$3"
case "$source_db" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSED non-local source DB" >&2; exit 2;; esac
case "$source_api" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "REFUSED non-local source Storage" >&2; exit 2;; esac
repo="$(pwd)"
tmp="$(mktemp -d)"
cleanup() {
  (cd "$tmp/restore" && supabase stop --no-backup >/dev/null 2>&1) || true
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/snapshot/storage-export" "$tmp/restore"
for needed in supabase age psql python3 sha256sum; do command -v "$needed" >/dev/null || { echo "Missing $needed" >&2; exit 2; }; done
# Export precisely the five database components used by the live backup.
supabase db dump --db-url "$source_db" --role-only -f "$tmp/snapshot/roles.sql"
supabase db dump --db-url "$source_db" -f "$tmp/snapshot/schema.sql"
supabase db dump --db-url "$source_db" --use-copy --data-only \
  -x storage.buckets_vectors -x storage.vector_indexes -f "$tmp/snapshot/data.sql"
supabase db dump --db-url "$source_db" --schema supabase_migrations -f "$tmp/snapshot/migration-schema.sql"
supabase db dump --db-url "$source_db" --schema supabase_migrations --use-copy --data-only \
  -f "$tmp/snapshot/migration-data.sql"
GI_SUPABASE_URL="$source_api" GI_SUPABASE_SERVICE_ROLE_KEY="$source_key" \
  python3 "$repo/scripts/gi_backup_storage.py" backup --directory "$tmp/snapshot/storage-export"
(cd "$tmp/snapshot" && sha256sum roles.sql schema.sql data.sql migration-schema.sql \
  migration-data.sql storage-export/storage-manifest.json > CHECKSUMS.sha256)
printf 'GI disposable restore acceptance test. All data synthetic.\n' > "$tmp/snapshot/README.txt"
tar -C "$tmp" -czf "$tmp/test-backup.tar.gz" snapshot
age-keygen -o "$tmp/ephemeral-identity.txt" >/dev/null 2>&1
recipient="$(age-keygen -y "$tmp/ephemeral-identity.txt")"
age -r "$recipient" -o "$tmp/test-backup.tar.gz.age" "$tmp/test-backup.tar.gz"

# Start second local Supabase project on DIFFERENT loopback ports. No secrets leave runner.
(cd "$tmp/restore" && supabase init --yes >/dev/null)
python3 - "$tmp/restore/supabase/config.toml" <<'PY'
from pathlib import Path
import re,sys
path=Path(sys.argv[1])
config=path.read_text()
# Default local API/db/mail ports are 5432x. Move all of them away from the source.
config=re.sub(r'(?<![0-9])543([0-9]{2})(?![0-9])', lambda m: '544'+m.group(1), config)
path.write_text(config)
PY
(cd "$tmp/restore" && supabase start -x studio,vector,logflare,imgproxy,realtime,edge-runtime >/dev/null)
(cd "$tmp/restore" && supabase status -o env > "$tmp/target.env")
# Local test credentials only (do not print env vars).
set -a
source "$tmp/target.env"
set +a
target_db="$DB_URL"; target_api="$API_URL"; target_key="$SERVICE_ROLE_KEY"
case "$target_db" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSED remote target DB" >&2; exit 2;; esac
case "$target_api" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "REFUSED remote target Storage" >&2; exit 2;; esac
[[ "$target_db" != "$source_db" && "$target_api" != "$source_api" ]] || { echo "REFUSED same source and target" >&2; exit 2; }

# Run the real restore entrypoint, not a hand-simulated set of SQL operations.
GI_AGE_IDENTITY="$tmp/ephemeral-identity.txt" \
GI_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_GI_TEST GI_RESTORE_ALLOW_LOOPBACK=YES \
GI_RESTORE_DB_URL="$target_db" GI_RESTORE_SUPABASE_URL="$target_api" \
GI_RESTORE_SERVICE_ROLE_KEY="$target_key" \
  bash "$repo/scripts/gi_restore.sh" "$tmp/test-backup.tar.gz.age" --restore-isolated

# Compare actual database rows, RLS state and RESTORed object bytes.
for table in gi_tasks gi_real_cases gi_real_case_access; do
  source_count="$(psql "$source_db" -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.$table")"
  target_count="$(psql "$target_db" -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.$table")"
  [[ "$source_count" == "$target_count" ]] || { echo "Restore row mismatch: $table" >&2; exit 1; }
done
test "$(psql "$target_db" -XAtq -c "SELECT relrowsecurity FROM pg_class WHERE oid='public.gi_real_cases'::regclass")" = "t"
GI_SUPABASE_URL="$target_api" GI_SUPABASE_SERVICE_ROLE_KEY="$target_key" \
 python3 - "$tmp/snapshot/storage-export/storage-manifest.json" <<'PY'
import hashlib,json,os,sys
from urllib.parse import quote
import requests
manifest=json.load(open(sys.argv[1],encoding='utf-8'))
api=os.environ['GI_SUPABASE_URL']
key=os.environ['GI_SUPABASE_SERVICE_ROLE_KEY']
session=requests.Session()
session.trust_env=False
headers={'apikey':key}
if not key.startswith('sb_secret_'): headers['Authorization']='Bearer '+key
for item in manifest['objects']:
    target=api+'/storage/v1/object/'+quote(item['bucket'],safe='')+'/'+quote(item['key'],safe='/')
    resp=session.get(target,headers=headers,timeout=(10,40))
    resp.raise_for_status()
    assert len(resp.content)==item['size']
    assert hashlib.sha256(resp.content).hexdigest()==item['sha256']
assert len(manifest['objects'])>0, 'Acceptance fixture must contain a real private Storage object'
print('PASS isolated FULL SQL/roles/migration/Storage restore: rows, RLS, object bytes and hashes',flush=True)
PY
