#!/bin/bash
# Claude Code on the web: make a fresh cloud container ready to work in (docs/DEVELOPMENT.md
# § Coding from the phone). Does nothing on a developer's own machine.
#
# Local values only: the trivial docker-compose database, email capture, the development
# switcher. No QA or production credential belongs here or in the cloud environment — the
# repository is public (CLAUDE.md, DECISIONS.md §98). Idempotent: every step skips what is done.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

DB_USER=brasov_runners
DB_NAME=brasov_runners
DB_PASSWORD=local_only_not_a_secret

echo "[session-start] dependencies"
# The cloud network policy refuses repo.yarnpkg.com, Corepack's default source for Yarn; the
# same release is published on the npm registry, which the policy allows. The env file carries
# the setting into the session, so every later `yarn` resolves the same way.
export COREPACK_NPM_REGISTRY=https://registry.npmjs.org
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export COREPACK_NPM_REGISTRY=$COREPACK_NPM_REGISTRY" >> "$CLAUDE_ENV_FILE"
  echo "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0" >> "$CLAUDE_ENV_FILE"
fi
# The image's Chromium, for Playwright (playwright.config.ts): its own download is refused too.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo "export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium" >> "$CLAUDE_ENV_FILE"
fi
corepack enable
yarn install

echo "[session-start] tracked git hooks and aliases"
yarn setup

echo "[session-start] local PostgreSQL 17"
# The repository's database is PostgreSQL 17 (docker-compose.yml, CI); Neon runs 18. The image
# ships 16, which refuses a migration run from nothing: 17 lets a transaction use an enum value
# added to a type created in the same transaction, 16 does not. There is no Docker daemon here and
# the policy refuses apt.postgresql.org, so the binaries come from the npm registry's
# @embedded-postgres build of the same release, unpacked once outside the clone.
PG_VERSION=17.6.0-beta.15
PG_HOME=/opt/pg17
PG_DATA=/var/lib/pg17
PG_LOG=/var/log/pg17.log
if [ ! -x "$PG_HOME/native/bin/postgres" ]; then
  tmp=$(mktemp -d)
  (cd "$tmp" && npm pack --silent "@embedded-postgres/linux-x64@$PG_VERSION" >/dev/null && tar xzf ./*.tgz)
  rm -rf "$PG_HOME" && mv "$tmp/package" "$PG_HOME" && rm -rf "$tmp"
  (cd "$PG_HOME" && node scripts/hydrate-symlinks.js)
fi
service postgresql stop >/dev/null 2>&1 || true
pg() { runuser -u postgres -- env LD_LIBRARY_PATH="$PG_HOME/native/lib" "$PG_HOME/native/bin/$@"; }
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  mkdir -p "$PG_DATA" && chown postgres:postgres "$PG_DATA"
  pwfile=$(mktemp) && echo "$DB_PASSWORD" > "$pwfile" && chown postgres "$pwfile"
  # The same superuser, database, locale and encoding as docker-compose.yml.
  pg initdb -D "$PG_DATA" -U "$DB_USER" --pwfile="$pwfile" --auth=scram-sha-256 \
    --locale=C --encoding=UTF8 >/dev/null
  rm -f "$pwfile"
fi
touch "$PG_LOG" && chown postgres "$PG_LOG"
if ! pg pg_ctl -D "$PG_DATA" status >/dev/null 2>&1; then
  pg pg_ctl -D "$PG_DATA" -l "$PG_LOG" -w -o "-p 5432 -k /tmp" start >/dev/null
fi
export PGPASSWORD="$DB_PASSWORD"
psql_local() { psql -h localhost -U "$DB_USER" "$@"; }
if ! psql_local -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  psql_local -d postgres -qc "CREATE DATABASE $DB_NAME"
fi

if [ ! -f .env.local ]; then
  # Only what differs from the defaults: .env.example's empty `KEY=` lines count as set and fail
  # validation (src/shared/config/env.ts). Email stays in capture and staff sign-in on the
  # development switcher, as locally.
  echo "[session-start] .env.local with local values"
  cat > .env.local <<ENV
APP_ENV=local
APP_BASE_URL=http://localhost:47821
DATABASE_URL=postgres://$DB_USER:local_only_not_a_secret@localhost:5432/$DB_NAME
EMAIL_DELIVERY_MODE=capture
ENV
fi

echo "[session-start] migrations"
yarn db:migrate
if [ "$(psql_local -d "$DB_NAME" -tAc 'SELECT count(*) FROM events' 2>/dev/null || echo 0)" = "0" ]; then
  echo "[session-start] sample events"
  yarn db:seed
fi

echo "[session-start] ready"
