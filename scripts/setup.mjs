#!/usr/bin/env node
/**
 * Brasov Runners local development setup.
 *
 * Points git at the tracked hooks in .githooks so `npm run check` runs before every
 * commit, exactly as CI runs it. Tracked hooks need no dependency: git supports
 * core.hooksPath natively, so husky and lint-staged are not installed.
 *
 * Safe to re-run. Usage: npm run setup
 * Exit code 0 = configured, 1 = failure.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const HOOKS_PATH = ".githooks";
const ROOT = process.cwd();

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

const configured = git("config", "core.hooksPath", HOOKS_PATH);
if (configured.status !== 0) {
  fail(`git config core.hooksPath failed.\n${configured.stderr.trim()}`);
}

console.log(`setup: core.hooksPath = ${HOOKS_PATH}`);
console.log("setup: 'npm run check' now runs before every commit.");
