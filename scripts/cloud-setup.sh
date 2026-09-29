#!/usr/bin/env bash
# Prepare a Claude Code cloud session (Claude Code on the web) to work on this repository (§501).
# Run by the SessionStart hook in .claude/settings.json: dependencies, a local PostgreSQL migrated
# and seeded, a .env.local. Local values only — the credentials docker-compose.yml already
# publishes; the database steps refuse a DATABASE_URL not on localhost (§31). Idempotent; an
# existing .env.local is never touched. Outside a cloud session (CLAUDE_CODE_REMOTE != "true") it
# does nothing unless given --force.
#
# Usage: bash scripts/cloud-setup.sh [--force]
# Exit code 0 = ready (or nothing to do), 1 = a step failed; the log's last lines are printed.

# No `-e`: the probes below fail quietly and are compared; a step that must succeed ends in
# `|| fail "…"`.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# The local database, as docker-compose.yml defines it; not a secret.
DB_NAME="brasov_runners"
DB_USER="brasov_runners"
DB_PASSWORD="local_only_not_a_secret"
DB_PORT="5432"
# Spelled out rather than assembled, so `yarn secrets:check` sees the one password it allows.
LOCAL_DATABASE_URL="postgresql://brasov_runners:local_only_not_a_secret@localhost:5432/brasov_runners"
LOCAL_BASE_URL="http://localhost:47821"

LOG="${TMPDIR:-/tmp}/brasovrunners-cloud-setup.log"
: >"$LOG"

# Corepack would otherwise stop and ask before downloading Yarn, and a hook has nobody to answer.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The cloud network policy refuses repo.yarnpkg.com; the npm registry has the same release (#222).
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-https://registry.npmjs.org}"
# CLAUDE_ENV_FILE carries these into the session's later commands. Playwright's browser download
# is refused too, so the image's Chromium is named for playwright.config.ts.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
    echo "export COREPACK_NPM_REGISTRY=${COREPACK_NPM_REGISTRY}"
    if [ -x /opt/pw-browsers/chromium ]; then echo "export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium"; fi
  } >>"$CLAUDE_ENV_FILE"
fi

DONE=()
say() { printf 'cloud-setup: %s\n' "$*"; }
did() { DONE+=("$1"); say "$1"; }
fail() {
  say "FAILED: $1"
  say "last lines of $LOG:"
  tail -n 30 "$LOG" | sed 's/^/  | /'
  exit 1
}
# Run a command with its output in the log rather than in the session's context.
quiet() { "$@" >>"$LOG" 2>&1; }

# ---------------------------------------------------------------------------------------------
# 1. Yarn and the dependencies
# ---------------------------------------------------------------------------------------------

WANT_YARN="$(node -p "(require('./package.json').packageManager || '').replace(/^yarn@/, '').split('+')[0]" 2>/dev/null)"
YARN=(yarn)
if [ "$(yarn --version 2>/dev/null)" != "$WANT_YARN" ]; then
  quiet corepack enable || fail "corepack enable"
  hash -r
  if [ "$(yarn --version 2>/dev/null)" = "$WANT_YARN" ]; then
    did "corepack enabled: yarn $WANT_YARN"
  elif [ "$(corepack yarn --version 2>/dev/null)" = "$WANT_YARN" ]; then
    # A global Yarn earlier on PATH than Corepack's shim; go through Corepack explicitly.
    YARN=(corepack yarn)
    did "the yarn on PATH is not $WANT_YARN even after corepack enable: use 'corepack yarn …' in this session"
  else
    fail "cannot get yarn $WANT_YARN through corepack"
  fi
fi

# .yarn-state.yml is written by every successful install: newer than both means nothing changed.
if [ -f node_modules/.yarn-state.yml ] &&
  [ node_modules/.yarn-state.yml -nt yarn.lock ] &&
  [ node_modules/.yarn-state.yml -nt package.json ]; then
  :
else
  say "installing dependencies (yarn install --immutable)…"
  quiet "${YARN[@]}" install --immutable || fail "yarn install --immutable"
  did "dependencies installed"
fi

# The tracked git hooks.
if [ "$(git config --get core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  quiet "${YARN[@]}" setup || fail "yarn setup"
  did "git hooks installed (yarn setup)"
fi

# ---------------------------------------------------------------------------------------------
# 2. A local PostgreSQL, its role and its database
# ---------------------------------------------------------------------------------------------

listening() { (exec 3<>"/dev/tcp/127.0.0.1/${DB_PORT}") 2>/dev/null; }

# First value of the first row of query $2 on connection $1; nothing on any error.
db_value() {
  DATABASE_URL="$1" node -e '
    const { Client } = require("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    client.connect()
      .then(() => client.query(process.argv[1]))
      .then((result) => { const row = result.rows[0]; if (row) console.log(String(Object.values(row)[0])); })
      .catch(() => {})
      .finally(() => client.end().catch(() => {}));
  ' "$2" 2>/dev/null
}

# SQL from stdin, as the server's superuser. In a cloud session the agent is root, so `su`.
as_superuser() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/sh -c "cd / && psql -X -qAt -v ON_ERROR_STOP=1 -d postgres"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    (cd / && sudo -n -u postgres psql -X -qAt -v ON_ERROR_STOP=1 -d postgres)
  else
    psql -X -qAt -v ON_ERROR_STOP=1 -d postgres
  fi
}

if ! listening; then
  if command -v service >/dev/null 2>&1 && [ -e /etc/init.d/postgresql ]; then
    if [ "$(id -u)" = "0" ]; then
      quiet service postgresql start || fail "service postgresql start"
    else
      quiet sudo -n service postgresql start || fail "sudo service postgresql start"
    fi
    how="PostgreSQL started (service postgresql start)"
  elif command -v docker >/dev/null 2>&1; then
    # docker-compose.yml's container creates the same role and database by itself.
    quiet docker compose up -d --wait db || fail "docker compose up -d --wait db"
    how="PostgreSQL started (docker compose up -d db)"
  else
    fail "no PostgreSQL on port ${DB_PORT}, and neither the postgresql service nor docker to start one"
  fi
  for _ in $(seq 1 30); do
    listening && break
    sleep 1
  done
  listening || fail "PostgreSQL did not start listening on port ${DB_PORT}"
  did "$how"
fi

if [ "$(db_value "$LOCAL_DATABASE_URL" "select 1")" != "1" ]; then
  if [ "$(printf "select 1 from pg_roles where rolname = '%s';\n" "$DB_USER" | as_superuser 2>>"$LOG")" != "1" ]; then
    printf "create role %s login password '%s';\n" "$DB_USER" "$DB_PASSWORD" | quiet as_superuser ||
      fail "create role ${DB_USER}"
    did "role ${DB_USER} created"
  fi
  if [ "$(printf "select 1 from pg_database where datname = '%s';\n" "$DB_NAME" | as_superuser 2>>"$LOG")" != "1" ]; then
    # C collation and UTF-8, as docker-compose.yml: ordering must not depend on the host's locale.
    printf "create database %s owner %s template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C';\n" \
      "$DB_NAME" "$DB_USER" | quiet as_superuser || fail "create database ${DB_NAME}"
    did "database ${DB_NAME} created"
  fi
  [ "$(db_value "$LOCAL_DATABASE_URL" "select 1")" = "1" ] ||
    fail "cannot connect as ${DB_USER} to ${DB_NAME} on localhost:${DB_PORT}"
fi

# ---------------------------------------------------------------------------------------------
# 3. .env.local — only when there is none, and only local values
# ---------------------------------------------------------------------------------------------

if [ ! -f .env.local ]; then
  # Empty variables are commented out: the configuration schema refuses an empty string.
  sed \
    -e 's/\r$//' \
    -e "s|^APP_ENV=.*|APP_ENV=local|" \
    -e "s|^APP_BASE_URL=.*|APP_BASE_URL=${LOCAL_BASE_URL}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=${LOCAL_DATABASE_URL}|" \
    -e 's|^\([A-Z][A-Z0-9_]*\)=$|# \1=|' \
    .env.example >.env.local.tmp || fail "write .env.local"
  mv .env.local.tmp .env.local || fail "write .env.local"
  chmod 600 .env.local 2>/dev/null
  did ".env.local created from .env.example (APP_ENV=local, APP_BASE_URL=${LOCAL_BASE_URL}, the local DATABASE_URL)"
fi

# ---------------------------------------------------------------------------------------------
# 4. Migrate and seed — the local database only
# ---------------------------------------------------------------------------------------------

# As the yarn scripts see it: the environment wins over .env.local.
from_env_file() { sed -n "s/^$1=//p" .env.local | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
EFFECTIVE_URL="${DATABASE_URL:-$(from_env_file DATABASE_URL)}"
EFFECTIVE_APP_ENV="${APP_ENV:-$(from_env_file APP_ENV)}"

case "$EFFECTIVE_APP_ENV" in
  "" | local | test) ;;
  *) fail "APP_ENV is '${EFFECTIVE_APP_ENV}'; this script migrates and seeds a local database only" ;;
esac
if ! [[ "$EFFECTIVE_URL" =~ ^postgres(ql)?://[^@/]*@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/ ]]; then
  fail "DATABASE_URL does not point at localhost; this script migrates and seeds a local database only"
fi

count_applied() { db_value "$EFFECTIVE_URL" "select case when to_regclass('drizzle.__drizzle_migrations') is null then 0 else (select count(*) from drizzle.__drizzle_migrations) end"; }
before="$(count_applied)"
server_version="$(db_value "$EFFECTIVE_URL" "show server_version_num")"
if [ "${server_version:-0}" -ge 170000 ]; then
  quiet "${YARN[@]}" db:migrate || fail "yarn db:migrate"
else
  # drizzle-kit applies all pending migrations in ONE transaction; PostgreSQL 16 refuses using an
  # enum value added in the same transaction ("unsafe use of new value"). One transaction per
  # migration records the same rows, as every deployed database received them.
  DATABASE_URL="$EFFECTIVE_URL" quiet node --input-type=module -e '
    import { drizzle } from "drizzle-orm/node-postgres";
    import { readMigrationFiles } from "drizzle-orm/migrator";
    const config = { migrationsFolder: "src/db/migrations" };
    const db = drizzle(process.env.DATABASE_URL);
    try {
      for (const migration of readMigrationFiles(config)) {
        await db.dialect.migrate([migration], db.session, config);
      }
    } finally {
      await db.$client.end();
    }
  ' || fail "migrate, one transaction per migration (PostgreSQL ${server_version:-unknown})"
fi
after="$(count_applied)"
if [ "${before:-0}" != "${after:-0}" ]; then
  did "migrations applied: $(( ${after:-0} - ${before:-0} )) (now ${after})"
fi

# yarn db:seed deletes the events first, so it runs only on an empty table. To start over, drop
# the database and rerun this script; `yarn db:reset:local` needs PostgreSQL 17, as above.
events="$(db_value "$EFFECTIVE_URL" "select count(*) from events")"
if [ "$events" = "0" ]; then
  quiet "${YARN[@]}" db:seed || fail "yarn db:seed"
  events="$(db_value "$EFFECTIVE_URL" "select count(*) from events")"
  did "sample data seeded (yarn db:seed): ${events} events"
elif [ -z "$events" ]; then
  fail "cannot count the events after migrating"
fi

# ---------------------------------------------------------------------------------------------

if [ "${#DONE[@]}" -eq 0 ]; then
  say "nothing to do: dependencies installed, PostgreSQL running, ${DB_NAME} migrated (${after}) and holding ${events} events."
else
  say "ready: ${DB_NAME} migrated (${after}) and holding ${events} events; yarn dev serves ${LOCAL_BASE_URL}."
fi
say "local values only: email capture, the dev staff switcher, this machine's database. Never add a QA or production credential here."
exit 0
