#!/usr/bin/env node
/**
 * Configures this clone's git (repository-local only): core.hooksPath → .githooks, so `yarn check`
 * runs before every commit, and a `git gone` alias.
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
 * `git gone` — delete local branches whose upstream is `[gone]`. `-D` because squash merges
 * (AGENTS.md §6.3) make `-d` refuse; the `[gone]` filter is the safety. One shell line, so it
 * runs through git's bundled shell on Windows too.
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
