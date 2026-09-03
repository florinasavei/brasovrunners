#!/usr/bin/env node
/**
 * Brasov Runners local development setup.
 *
 * Configures this clone's git: the tracked hooks in .githooks so `yarn check` runs before
 * every commit exactly as CI runs it, and a `git gone` alias for tidying merged branches.
 * Both are repository-local, so nothing here touches the machine's global git config.
 *
 * Tracked hooks need no dependency: git supports core.hooksPath natively, so husky and
 * lint-staged are not installed.
 *
 * Safe to re-run. Usage: yarn setup
 * Exit code 0 = configured, 1 = failure.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const HOOKS_PATH = ".githooks";
const ROOT = process.cwd();

/**
 * `git gone` — delete local branches whose remote branch has been deleted.
 *
 * After a pull request merges, GitHub deletes the head branch; the local copy stays behind
 * with an upstream that no longer exists, which git reports as `[gone]`. This removes exactly
 * those.
 *
 * `-D` rather than `-d` is required, not careless: this repository squash-merges into `qa`
 * (AGENTS.md §6.3), so the squashed commit differs from the branch's own commits and `-d`
 * refuses every time. The safety comes from the `[gone]` filter instead — a branch only
 * reaches that state after its remote was deleted, which happens on merge. A branch never
 * pushed has no upstream, is not `[gone]`, and is never touched.
 *
 * Written as one shell line because git runs `!`-aliases through its bundled shell, which
 * exists on Windows too, so this works from PowerShell as well as from a bash prompt.
 */
const GONE_ALIAS =
  '!git fetch --prune && ' +
  'git for-each-ref --format "%(refname:short) %(upstream:track)" refs/heads ' +
  '| awk \'$2 == "[gone]" { print $1 }\' ' +
  "| xargs -r git branch -D";

function git(...args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function fail(message) {
  console.error(`setup: ${message}`);
  process.exit(1);
}

const repository = git("rev-parse", "--git-dir");
if (repository.status !== 0) {
  fail("not a git repository. Run this from the repository root after cloning.");
}

if (!existsSync(path.join(ROOT, HOOKS_PATH, "pre-commit"))) {
  fail(`${HOOKS_PATH}/pre-commit is missing. Run this from the repository root.`);
}

const hooks = git("config", "core.hooksPath", HOOKS_PATH);
if (hooks.status !== 0) {
  fail(`git config core.hooksPath failed.\n${hooks.stderr.trim()}`);
}

const alias = git("config", "alias.gone", GONE_ALIAS);
if (alias.status !== 0) {
  fail(`git config alias.gone failed.\n${alias.stderr.trim()}`);
}

console.log(`setup: core.hooksPath = ${HOOKS_PATH}`);
console.log("setup: 'yarn check' now runs before every commit.");
console.log("setup: 'git gone' deletes local branches whose remote branch was deleted.");
