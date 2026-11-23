#!/usr/bin/env bash
# Validate exact live-backup SQL export commands on the disposable CI Supabase.
# Never accepts or uses a hosted GI project URL.
set -Eeuo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: backup_cli_smoke.sh LOCAL_DATABASE_URL"; exit 2; fi
db="$1"
if [[ "$db" != *"127.0.0.1"* && "$db" != *"localhost"* ]]; then
  echo "Refusing to test against a non-local database" >&2
  exit 2
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
supabase db dump --db-url "$db" --role-only -f "$tmp/roles.sql"
supabase db dump --db-url "$db" -f "$tmp/schema.sql"
supabase db dump --db-url "$db" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes" -f "$tmp/data.sql"
supabase db dump --db-url "$db" --schema supabase_migrations \
  -f "$tmp/migration-schema.sql"
supabase db dump --db-url "$db" --schema supabase_migrations \
  --use-copy --data-only -f "$tmp/migration-data.sql"
for file in roles.sql schema.sql data.sql migration-schema.sql migration-data.sql; do
  test -s "$tmp/$file"
done
grep -q "gi_tasks" "$tmp/schema.sql"
grep -q "gi_tasks" "$tmp/data.sql"
echo "PASS: Supabase CLI roles/schema/data/migration dumps are nonempty and include synthetic GI tables"
