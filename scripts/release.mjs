#!/usr/bin/env node
/**
 * Build a versioned release of the documentation baseline.
 *
 *   npm run release
 *
 * Produces, under dist/:
 *   brasovrunners-<baseline>/          the repository tree, ready to unzip into a clone
 *   brasovrunners-<baseline>.zip       the same tree as one archive
 *   share/<NAME>-<baseline>.md         each document as a standalone, versioned file,
 *                                      for sending to people who do not use git
 *
 * Filenames inside the repository stay stable on purpose: links, CODEOWNERS, GitHub's
 * README rendering, and docs-check all key on them. The version lives in the folder
 * name, the archive name, the share copies, and the visible header of every document.
 *
 * Refuses to run when docs-check fails, so a release is always internally consistent.
 */

import { readFile, mkdir, rm, cp, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const NAME = "brasovrunners";

const EXCLUDE = new Set([".git", "node_modules", "dist", ".next", "coverage", "playwright-report", "test-results"]);

const SHARE = [
  "README.md",
  "BUSINESS.md",
  "SPECS.md",
  "AGENTS.md",
  "SETUP.md",
  "DECISIONS.md",
  "CHANGELOG.md",
  "MANIFEST.txt",
  "docs/PRACTICES.md",
  "docs/RUNBOOKS.md",
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return r.status === 0;
}

async function baseline() {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const m = readme.match(/PROJECT_BASELINE:\s*(BR-V[\d.]+-\d{4}-\d{2}-\d{2})/);
  if (!m) throw new Error("No PROJECT_BASELINE marker in README.md");
  return m[1];
}

async function main() {
  if (!run(process.execPath, [path.join(ROOT, "scripts", "docs-check.mjs")])) {
    console.error("release aborted: docs-check failed");
    process.exit(1);
  }

  const version = await baseline();
  const folderName = `${NAME}-${version}`;
  const folder = path.join(DIST, folderName);
  const share = path.join(DIST, "share");

  await rm(DIST, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await mkdir(share, { recursive: true });

  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    await cp(path.join(ROOT, entry.name), path.join(folder, entry.name), { recursive: true });
  }

  for (const rel of SHARE) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) continue;
    const ext = path.extname(rel);
    const stem = path.basename(rel, ext);
    await cp(src, path.join(share, `${stem}-${version}${ext}`));
  }

  const zipPath = path.join(DIST, `${folderName}.zip`);
  const zipped =
    run("zip", ["-qr", zipPath, folderName], { cwd: DIST }) ||
    run("tar", ["-a", "-cf", zipPath, folderName], { cwd: DIST });
  if (!zipped) {
    console.warn("no zip or tar available; folder and share copies were produced without an archive");
  }

  const manifest = [
    `release ${version}`,
    `folder  dist/${folderName}/`,
    zipped ? `archive dist/${folderName}.zip` : "archive (not produced)",
    `share   dist/share/*-${version}.*`,
    "",
  ].join("\n");
  await writeFile(path.join(DIST, "RELEASE.txt"), manifest);
  console.log(manifest);
}

main().catch((e) => {
  console.error("release failed:", e);
  process.exit(1);
});
