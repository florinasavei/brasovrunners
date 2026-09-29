#!/usr/bin/env node
/**
 * Copy the country flags into `public/flags/`.
 *
 * From `flag-icons` (MIT), SVG files only — never its stylesheet, which references every flag
 * (AGENTS.md §1.5) — so a page fetches only the flag it shows. Git-ignored; `postinstall` and
 * `yarn build` regenerate it.
 *
 * Usage: node scripts/sync-flags.mjs
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
// 4x3: every flag on the same box, whatever its real ratio.
const SOURCE = path.join(ROOT, "node_modules", "flag-icons", "flags", "4x3");
const TARGET = path.join(ROOT, "public", "flags");

async function main() {
  if (!existsSync(SOURCE)) {
    // Not fatal: a job may run before node_modules exists.
    console.warn("sync-flags: flag-icons is not installed; nothing copied.");
    return;
  }

  // Replaced rather than merged, so a flag removed upstream does not linger in a deployment.
  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  await cp(SOURCE, TARGET, { recursive: true });

  const copied = (await readdir(TARGET)).filter((name) => name.endsWith(".svg"));
  console.log(`sync-flags: ${copied.length} flags copied to public/flags/`);
}

main().catch((error) => {
  console.error("sync-flags failed:", error);
  process.exit(1);
});
