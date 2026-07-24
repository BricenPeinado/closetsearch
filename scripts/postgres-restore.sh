#!/bin/sh
set -eu

umask 077

fail() {
  printf 'restore_failed: %s\n' "$1" >&2
  exit 1
}

checksum_verify() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$1"
  else
    fail "sha256sum or shasum is required"
  fi
}

backup_path=${1:-}
database_url=${RESTORE_DATABASE_URL:-}
target_database=${RESTORE_TARGET_DATABASE:-}
confirmation=${RESTORE_CONFIRMATION:-}
age_identity=${RESTORE_AGE_IDENTITY:-}

[ -n "$backup_path" ] || fail "pass one explicit backup file path"
[ -f "$backup_path" ] || fail "backup file does not exist"
[ -n "$database_url" ] || fail "RESTORE_DATABASE_URL is required"

case "$target_database" in
  ''|*[!A-Za-z0-9_-]*) fail "RESTORE_TARGET_DATABASE must be a simple database name" ;;
  postgres|template0|template1) fail "refusing to restore into a PostgreSQL system database" ;;
esac

[ "$confirmation" = "restore:${target_database}" ] ||
  fail "set RESTORE_CONFIRMATION=restore:${target_database}"

backup_directory=$(dirname "$backup_path")
backup_filename=$(basename "$backup_path")
checksum_path="${backup_path}.sha256"

if [ -f "$checksum_path" ]; then
  (
    cd "$backup_directory"
    checksum_verify "$(basename "$checksum_path")"
  )
else
  fail "matching checksum file is required: ${checksum_path}"
fi

restore_input=$backup_path
temporary_dump=

case "$backup_filename" in
  *.age)
    [ -n "$age_identity" ] || fail "RESTORE_AGE_IDENTITY is required for encrypted backups"
    command -v age >/dev/null 2>&1 || fail "age is required to decrypt this backup"
    temporary_dump=$(mktemp "${TMPDIR:-/tmp}/closetsearch-restore.XXXXXX")
    age --decrypt --identity "$age_identity" --output "$temporary_dump" "$backup_path"
    restore_input=$temporary_dump
    ;;
esac

cleanup() {
  if [ -n "$temporary_dump" ]; then
    rm -f "$temporary_dump"
  fi
}
trap cleanup EXIT HUP INT TERM

pg_restore --list "$restore_input" >/dev/null
pg_restore \
  --dbname="$database_url" \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --single-transaction \
  "$restore_input"

schema_version=$(psql "$database_url" --no-psqlrc --tuples-only --no-align \
  --command="SELECT COALESCE(MAX(version), 0) FROM postgres_schema_migrations")

printf '{"event":"postgres_restore_complete","database":"%s","schemaVersion":"%s"}\n' \
  "$target_database" \
  "$schema_version"
