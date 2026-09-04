#!/usr/bin/env node
/**
 * Copy the country flags into `public/flags/`.
 *
 * The site shows two flags today — the language switcher — and will show many when a
 * participant can state their country. Two can be drawn by hand; two hundred cannot, and
 * drawing them badly is worse than not showing them: Romania is 2:3 and the United Kingdom
 * 1:2, so a set that is not normalised renders at two different widths in the same row.
 *
 * `flag-icons` (MIT) is the source. Only its SVG files are used, never its stylesheet: that
 * CSS references every flag in the set as a background image, which is exactly the kind of
 * "one file, 250 things" cost AGENTS.md §1.5 rejects. Copied as static files instead, so a
 * page fetches the one flag it shows and the browser caches it.
 *
 * The output is generated, so it is git-ignored and rebuilt: `yarn install` runs this through
 * `postinstall`, and `yarn build` runs it explicitly, which covers CI and the deployment.
 *
 * Usage: node scripts/sync-flags.mjs
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
// 4x3 rather than 1x1: every flag on the same box, which is the whole reason for using a set.
const SOURCE = path.join(ROOT, "node_modules", "flag-icons", "flags", "4x3");
const TARGET = path.join(ROOT, "public", "flags");

async function main() {
  if (!existsSync(SOURCE)) {
    // Not fatal: `yarn install --immutable` in a job that only lints has no node_modules yet,
    // and failing there would block a check that has nothing to do with flags.
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
