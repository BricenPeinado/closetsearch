#!/bin/sh
set -eu

umask 077

fail() {
  printf 'backup_failed: %s\n' "$1" >&2
  exit 1
}

checksum_create() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    fail "sha256sum or shasum is required"
  fi
}

database_url=${DATABASE_URL:-}
backup_dir=${BACKUP_DIR:-/backups}
retention_days=${BACKUP_RETENTION_DAYS:-14}
require_encryption=${BACKUP_REQUIRE_ENCRYPTION:-true}
age_recipient=${BACKUP_AGE_RECIPIENT:-}

[ -n "$database_url" ] || fail "DATABASE_URL is required"

case "$backup_dir" in
  /*) ;;
  *) fail "BACKUP_DIR must be an absolute path" ;;
esac

case "$backup_dir" in
  /|/bin|/etc|/home|/root|/tmp|/usr|/var)
    fail "BACKUP_DIR is too broad"
    ;;
esac

case "$retention_days" in
  ''|*[!0-9]*) fail "BACKUP_RETENTION_DAYS must be an integer" ;;
esac

[ "$retention_days" -ge 1 ] || fail "BACKUP_RETENTION_DAYS must be at least one"

if [ "$require_encryption" = "true" ] && [ -z "$age_recipient" ]; then
  fail "BACKUP_AGE_RECIPIENT is required when encryption is mandatory"
fi

mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary_dump=$(mktemp "${backup_dir}/.closetsearch-${timestamp}.XXXXXX")
final_dump="${backup_dir}/closetsearch-${timestamp}.dump"

cleanup() {
  rm -f "$temporary_dump"
}
trap cleanup EXIT HUP INT TERM

pg_dump \
  --dbname="$database_url" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$temporary_dump"

pg_restore --list "$temporary_dump" >/dev/null

if [ -n "$age_recipient" ]; then
  command -v age >/dev/null 2>&1 || fail "age is required to encrypt this backup"
  final_dump="${final_dump}.age"
  age --recipient "$age_recipient" --output "$final_dump" "$temporary_dump"
else
  mv "$temporary_dump" "$final_dump"
fi

(
  cd "$backup_dir"
  checksum_create "$(basename "$final_dump")" >"$(basename "$final_dump").sha256"
)

find "$backup_dir" -type f \
  \( -name 'closetsearch-*.dump' -o -name 'closetsearch-*.dump.age' -o -name 'closetsearch-*.dump.sha256' -o -name 'closetsearch-*.dump.age.sha256' \) \
  -mtime "+${retention_days}" -exec rm -f {} \;

rm -f "$temporary_dump"
trap - EXIT HUP INT TERM
printf '{"event":"postgres_backup_complete","path":"%s","encrypted":%s}\n' \
  "$final_dump" \
  "$([ -n "$age_recipient" ] && printf true || printf false)"
