#!/usr/bin/env bash
# GI encrypted daily backup. No plaintext backup is uploaded to GitHub/Drive.
set -Eeuo pipefail
umask 077

if [[ -z "$GI_BACKUP_DB_URL" || -z "$GI_BACKUP_SERVICE_ROLE_KEY" || -z "$GI_BACKUP_AGE_RECIPIENT" || -z "$GI_BACKUP_OUTPUT_DIR" ]]; then
  echo "::error::Backup requires DB URL, service role key, age recipient and output directory" >&2; exit 2
fi
export GI_SUPABASE_URL="https://mkhxokzuietqgjdpkcqq.supabase.co"
export GI_SUPABASE_SERVICE_ROLE_KEY="$GI_BACKUP_SERVICE_ROLE_KEY"

if [[ ! "$GI_BACKUP_AGE_RECIPIENT" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{40,}$ ]]; then
  echo "::error::Invalid age recipient; backup disabled" >&2; exit 2
fi
# The source is explicitly pinned to GI pilot, to avoid exporting another project.
python3 - <<'PY'
import os
from urllib.parse import urlparse
uri = urlparse(os.environ["GI_BACKUP_DB_URL"])
if uri.scheme not in ("postgresql", "postgres") or not uri.hostname:
    raise SystemExit("Invalid backup DB URL")
if "mkhxokzuietqgjdpkcqq" not in ((uri.hostname or "")+" "+(uri.username or "")):
    raise SystemExit("Backup DB URL does not belong to the GI pilot project")
PY

if ! command -v supabase >/dev/null || ! command -v age >/dev/null; then
  echo "::error::Install supabase CLI and age before running backup" >&2; exit 2
fi

tmp="$(mktemp -d)"
cleanup(){ rm -rf "$tmp"; }
trap cleanup EXIT
mkdir -p "$tmp/snapshot" "$GI_BACKUP_OUTPUT_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$GI_BACKUP_OUTPUT_DIR/gi-supabase-$stamp.tar.gz.age"

# Supabase-supported logical recovery format: roles, schema, data, migrations.
# The SQL includes auth users/Storage metadata; object bytes are exported separately.
supabase db dump --db-url "$GI_BACKUP_DB_URL" --role-only -f "$tmp/snapshot/roles.sql"
supabase db dump --db-url "$GI_BACKUP_DB_URL" -f "$tmp/snapshot/schema.sql"
supabase db dump --db-url "$GI_BACKUP_DB_URL" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes" -f "$tmp/snapshot/data.sql"
supabase db dump --db-url "$GI_BACKUP_DB_URL" --schema supabase_migrations \
  -f "$tmp/snapshot/migration-schema.sql"
supabase db dump --db-url "$GI_BACKUP_DB_URL" --schema supabase_migrations \
  --use-copy --data-only -f "$tmp/snapshot/migration-data.sql"

for item in roles.sql schema.sql data.sql migration-schema.sql migration-data.sql; do
  if [[ ! -s "$tmp/snapshot/$item" ]]; then
    echo "::error::Empty or missing backup component" >&2; exit 1
  fi
done
python3 scripts/gi_backup_storage.py backup --directory "$tmp/snapshot/storage-export"

(
  cd "$tmp/snapshot"
  sha256sum roles.sql schema.sql data.sql migration-schema.sql migration-data.sql \
    storage-export/storage-manifest.json > CHECKSUMS.sha256
)
cat > "$tmp/snapshot/README.txt" <<'EOF'
GI encrypted Supabase database and Storage snapshot.
Logical database: roles.sql, schema.sql, data.sql, migration-*.sql.
Storage objects: storage-export/ (with SHA256 metadata).
Restore only into an isolated approved target; never overwrite live GI.
EOF
tar -C "$tmp" -czf "$tmp/snapshot.tar.gz" snapshot
# Add an ephemeral second recipient to prove decryption works on the real snapshot.
# The test identity never leaves this runner and is deleted with the temp files.
age-keygen -o "$tmp/test-identity.txt" >/dev/null 2>&1
test_recipient="$(age-keygen -y "$tmp/test-identity.txt")"
age -r "$GI_BACKUP_AGE_RECIPIENT" -r "$test_recipient" -o "$out" "$tmp/snapshot.tar.gz"
age -d -i "$tmp/test-identity.txt" -o "$tmp/roundtrip.tar.gz" "$out"
cmp -s "$tmp/snapshot.tar.gz" "$tmp/roundtrip.tar.gz"
test -s "$out"
head -c 32 "$out" | grep -aq 'age-encryption.org'
echo "Encrypted snapshot ready: $(basename "$out") ($(stat -c%s "$out") bytes)"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "snapshot_file=$(basename "$out")" >> "$GITHUB_OUTPUT"
fi
