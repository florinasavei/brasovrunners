#!/usr/bin/env node
/**
 * Brasov Runners documentation synchronization check.
 *
 * Verifies that the six root documents stay in sync and that the requirement
 * layer and the business-rule layer reference each other correctly.
 *
 * Usage: node scripts/docs-check.mjs
 * Exit code 0 = pass, 1 = failure.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const ROOT_DOCUMENTS = [
  "README.md",
  "BUSINESS.md",
  "SPECS.md",
  "AGENTS.md",
  "SETUP.md",
  "DECISIONS.md",
];

const BASELINE_PATTERN = /PROJECT_BASELINE:\s*(BR-[A-Za-z0-9.\-]+)/g;
const BUS_ID = /BR-BUS-\d+/g;
const REQ_ID = /BR-REQ-\d+-\d+/g;
const MARKDOWN_LINK = /\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;

const SCAN_IGNORE = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "docs/history",
]);

// The club's own hostname, in any subdomain and any TLD. Case-insensitive because DNS is:
// a camel-cased spelling resolves to the same host, and prose camel-cases a domain readily.
// A dotted suffix is required, so a bare repository path and the GoDaddy application names
// do not match. Clone URLs ending in ".git" are excluded below: that suffix is git's, not a
// TLD. Keep this file free of the literal hostname — the check scans itself.
const OWN_HOST =
  /(?<![A-Za-z0-9.-])(?:[A-Za-z0-9-]+\.)*(?:brasovrunners|brasov-runners)(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])/gi;

const BINARY_FILE = /\.(png|jpe?g|webp|gif|ico|pdf|woff2?|ttf|eot|zip|gz|mp4|mp3)$/i;

// docs/history is excluded from requirement scanning (it is non-authoritative) but must
// still be indexed by the README, so it is listed there explicitly.

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function readOptional(names) {
  const out = [];
  for (const name of names) {
    const full = path.join(ROOT, name);
    if (existsSync(full)) out.push([name, await readFile(full, "utf8")]);
  }
  return out;
}

async function readDoc(name) {
  return readFile(path.join(ROOT, name), "utf8");
}

function matchAll(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
}

// Repository paths are compared against Markdown links and against SCAN_IGNORE, both of
// which use "/". path.relative yields "\" on Windows, so every comparison must go through
// this first or the check passes on CI and fails on a Windows machine.
function repoPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join("/");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/** 1. Required files exist. */
async function checkRequiredFiles() {
  for (const name of ROOT_DOCUMENTS) {
    if (!existsSync(path.join(ROOT, name))) {
      fail(`Required root document is missing: ${name}`);
    }
  }
  if (!existsSync(path.join(ROOT, "MANIFEST.txt"))) {
    warn("MANIFEST.txt is missing.");
  }
}

/** 2. One identical baseline marker in every root document. */
async function checkBaseline(docs) {
  const seen = new Map();

  for (const [name, text] of docs) {
    const markers = matchAll(text, BASELINE_PATTERN).map((m) => m[1]);
    if (markers.length === 0) {
      fail(`${name} has no PROJECT_BASELINE marker.`);
      continue;
    }
    if (markers.length > 1) {
      fail(`${name} has ${markers.length} PROJECT_BASELINE markers; expected exactly one.`);
    }
    seen.set(name, markers[0]);
  }

  const distinct = uniqueSorted([...seen.values()]);
  if (distinct.length > 1) {
    fail(
      `PROJECT_BASELINE markers disagree: ${[...seen.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join(", ")}`,
    );
  }

  // Visible version: the baseline must appear in rendered text, not only inside the
  // HTML comment marker, in every root document and the two consolidated docs.
  if (distinct.length === 1) {
    const current = distinct[0];
    const visibleTargets = [...docs, ...(await readOptional(["docs/PRACTICES.md", "docs/RUNBOOKS.md", "docs/DEVELOPMENT.md", "CLAUDE.md", "WEEKEND.md"]))];
    for (const [name, text] of visibleTargets) {
      const withoutMarker = text.replace(/<!--\s*PROJECT_BASELINE:[^>]*-->/g, "");
      if (!withoutMarker.includes(current)) {
        fail(`${name} does not show the baseline ${current} in visible text.`);
      }
      const literal = /BR-V\d+\.\d+-\d{4}-\d{2}-\d{2}/g;
      if (name === "DECISIONS.md" || name === "CHANGELOG.md") continue;
      for (const match of matchAll(withoutMarker, literal)) {
        if (match[0] !== current) {
          fail(`${name}: stale baseline literal ${match[0]} (current is ${current}).`);
        }
      }
    }
  }

  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  if (distinct.length === 1) {
    if (!existsSync(changelogPath)) {
      fail("CHANGELOG.md is missing.");
    } else {
      const changelog = await readFile(changelogPath, "utf8");
      const top = changelog.match(/^## (.+)$/m)?.[1]?.trim();
      if (top !== distinct[0]) {
        fail(`CHANGELOG.md top entry is "${top}" but the current baseline is ${distinct[0]}.`);
      }
    }
  }

  const manifestPath = path.join(ROOT, "MANIFEST.txt");
  if (existsSync(manifestPath) && distinct.length === 1) {
    const manifest = await readFile(manifestPath, "utf8");
    if (!manifest.includes(distinct[0])) {
      fail(`MANIFEST.txt does not carry the current baseline ${distinct[0]}.`);
    }
  }
}

/** 3. Relative markdown links resolve. */
async function checkLinks(docs) {
  for (const [name, text] of docs) {
    for (const match of matchAll(text, MARKDOWN_LINK)) {
      const target = match[1].split("#")[0];
      if (target === "") continue;
      const resolved = path.resolve(path.dirname(path.join(ROOT, name)), target);
      if (!existsSync(resolved)) {
        fail(`${name}: broken relative link -> ${match[1]}`);
      }
    }
  }
}

/** 4. Every BR-BUS id referenced in SPECS.md is defined in BUSINESS.md. */
function checkBusinessReferences(business, specs) {
  const defined = new Set(
    matchAll(business, /^### (BR-BUS-\d+)/gm).map((m) => m[1]),
  );
  if (defined.size === 0) {
    fail("BUSINESS.md defines no BR-BUS headings.");
    return defined;
  }

  const referenced = uniqueSorted(matchAll(specs, BUS_ID).map((m) => m[0]));
  for (const id of referenced) {
    if (!defined.has(id)) {
      fail(`SPECS.md references ${id}, which does not exist in BUSINESS.md.`);
    }
  }
  return defined;
}

/** 5. Every business rule is covered by at least one requirement. */
function checkCoverage(definedBusinessIds, specs) {
  const referenced = new Set(matchAll(specs, BUS_ID).map((m) => m[0]));
  for (const id of [...definedBusinessIds].sort()) {
    if (!referenced.has(id)) {
      fail(`${id} is defined in BUSINESS.md but no requirement in SPECS.md covers it.`);
    }
  }
}

/** 6. Every BR-REQ id used anywhere in the repository is defined in SPECS.md. */
async function checkRequirementReferences(specs) {
  const defined = new Set(
    matchAll(specs, /^#### (BR-REQ-\d+-\d+)/gm).map((m) => m[1]),
  );
  if (defined.size === 0) {
    fail("SPECS.md defines no BR-REQ headings.");
    return;
  }

  const files = await collectFiles(ROOT);
  for (const file of files) {
    const relative = repoPath(file);
    if (relative === "SPECS.md") continue;
    const text = await readFile(file, "utf8").catch(() => "");
    for (const id of uniqueSorted(matchAll(text, REQ_ID).map((m) => m[0]))) {
      if (!defined.has(id)) {
        fail(`${relative} references ${id}, which does not exist in SPECS.md.`);
      }
    }
  }
}

async function collectFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = repoPath(full);
    if (SCAN_IGNORE.has(entry.name) || SCAN_IGNORE.has(relative)) continue;
    if (entry.isDirectory()) {
      await collectFiles(full, acc);
    } else if (/\.(md|txt|ts|tsx|js|mjs|json|ya?ml)$/.test(entry.name)) {
      const info = await stat(full);
      if (info.size < 2_000_000) acc.push(full);
    }
  }
  return acc;
}

/** 7. Hostname literals must not leak into application source. */
async function checkHostnameLiterals() {
  const srcDir = path.join(ROOT, "src");
  if (!existsSync(srcDir)) return;
  const files = await collectFiles(srcDir);
  const hostPattern = /https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const match of matchAll(text, hostPattern)) {
      fail(
        `${repoPath(file)}: hostname literal ${match[0]} — derive absolute URLs from APP_BASE_URL.`,
      );
    }
  }
}

/**
 * 7b. The club's own hostname appears only in SETUP.md §26.
 *
 * Every other document writes <domain>. Until the domain is registered and bound at the end
 * of M1, a real hostname anywhere else publishes a name nobody owns yet — cheap to squat,
 * and the domain gates Mailgun sending-domain verification, so losing it blocks the launch.
 * checkHostnameLiterals cannot catch this: it only walks src/, which does not exist yet.
 */
async function checkOwnDomainLiterals() {
  let listing;
  try {
    listing = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // Never pass silently: an unscanned repository is not a clean one.
    fail(`could not list files to scan for hostname leaks: ${error.message}`);
    return;
  }

  for (const relative of [...new Set(listing.split("\0").filter(Boolean))]) {
    if (relative === "SETUP.md") continue; // §26 is the one table that holds the real value
    if (BINARY_FILE.test(relative)) continue;

    const buffer = await readFile(path.join(ROOT, relative)).catch(() => null);
    if (buffer === null) continue; // listed but gone

    const folded = foldHomoglyphs(decodeText(buffer));
    // A hard wrap at 100 columns splits a hostname across lines without anyone intending it,
    // so scan a de-wrapped copy too. Only word-character breaks are joined, which leaves
    // ordinary sentence boundaries alone.
    const dewrapped = folded.replace(/([A-Za-z0-9-])[ \t]*\r?\n[ \t>*#-]*([A-Za-z0-9-])/g, "$1$2");

    const reported = new Set();
    const passes = dewrapped === folded ? [[false, folded]] : [[false, folded], [true, dewrapped]];
    for (const [isDewrapped, text] of passes) {
      for (const match of matchAll(text, OWN_HOST)) {
        // The repository's own clone URL: a bare repo name plus ".git", nothing either side.
        if (/^(?:brasovrunners|brasov-runners)\.git$/i.test(match[0])) continue;
        // A clone URL followed by the next command joins into "….gitcd" when de-wrapped.
        // A genuinely wrapped hostname never contains ".git", so this costs no coverage.
        if (isDewrapped && /\.git/i.test(match[0])) continue;
        if (reported.has(match[0].toLowerCase())) continue;
        reported.add(match[0].toLowerCase());
        fail(
          `${relative}: hostname ${match[0]} — write <domain> instead. SETUP.md §26 is the only place the club's own hostname belongs.`,
        );
      }
    }

    // A punycode label hides a diacritic spelling of the club name, which is separately
    // registerable. Nothing in this repository has a legitimate reason to contain one.
    for (const match of matchAll(folded, /\bxn--[a-z0-9-]+/gi)) {
      fail(`${relative}: punycode label ${match[0]} — decode it and write <domain> instead.`);
    }
  }
}

/** Windows editors still write UTF-16; decoding those as UTF-8 hides the text from the scan. */
function decodeText(buffer) {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le", 2);
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return Buffer.from(buffer).swap16().toString("utf16le", 2);
    }
  }
  return buffer.toString("utf8");
}

/**
 * Fold the spellings a browser still resolves to the same host: fullwidth and ideographic
 * dots (the WHATWG URL parser maps them to "."), zero-width characters, and percent-escapes.
 * Without this, a hostname written with a fullwidth dot stays a live clickable link while
 * reading as absent to a plain substring search.
 */
function foldHomoglyphs(text) {
  let folded = text.normalize("NFKC").replace(/[​-‍⁠﻿­]/g, "");
  try {
    folded = decodeURIComponent(folded.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
  } catch {
    // An invalid escape somewhere in the document; scan the un-decoded form instead.
  }
  // Source-code escapes for "." and "-": what a minifier or JSON serializer emits, and what
  // evaluates back to the real hostname at runtime once application code exists.
  folded = folded.replace(/\\u002[eE]|\\x2[eE]/g, ".").replace(/\\u002[dD]|\\x2[dD]/g, "-");
  return folded.replace(/[。．｡]/g, ".");
}

/** 8. README links every tracked documentation and configuration file. */
async function checkReadmeCoverage() {
  const readmePath = path.join(ROOT, "README.md");
  if (!existsSync(readmePath)) return;
  const readme = await readFile(readmePath, "utf8");
  const linked = new Set(
    matchAll(readme, /\]\(\.\/([^)\s#]+)(?:#[^)\s]*)?\)/g).map((m) => m[1].replace(/\/$/, "")),
  );

  const roots = ["", "docs", "scripts", ".github", ".githooks"];
  const seen = new Set();
  for (const root of roots) {
    const dir = path.join(ROOT, root);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = repoPath(full);
      if (SCAN_IGNORE.has(entry.name) || SCAN_IGNORE.has(relative)) continue;
      if (entry.isDirectory()) {
        if (root === "") continue; // top-level directories are covered by their own root entry
        for (const file of await collectFiles(full)) seen.add(repoPath(file));
      } else {
        seen.add(relative);
      }
    }
  }
  seen.delete("README.md");
  seen.delete("package-lock.json");

  // Files git ignores are on disk but never published, so they need no README row:
  // next-env.d.ts, a developer's .env.local, and similar.
  let ignored = new Set();
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    ignored = new Set(out.split(" ").filter(Boolean));
  } catch {
    // Not a git checkout: index everything on disk.
  }
  for (const file of ignored) seen.delete(file);

  for (const file of [...seen].sort()) {
    if (!linked.has(file)) {
      fail(`README.md does not link ${file}; every documentation and configuration file must appear in the README index.`);
    }
  }
}

async function main() {
  await checkRequiredFiles();

  const present = ROOT_DOCUMENTS.filter((name) => existsSync(path.join(ROOT, name)));
  const docs = await Promise.all(
    present.map(async (name) => [name, await readDoc(name)]),
  );

  await checkBaseline(docs);
  await checkLinks(docs);

  const business = docs.find(([name]) => name === "BUSINESS.md")?.[1];
  const specs = docs.find(([name]) => name === "SPECS.md")?.[1];

  if (business && specs) {
    const definedBusinessIds = checkBusinessReferences(business, specs);
    checkCoverage(definedBusinessIds, specs);
    await checkRequirementReferences(specs);
  }

  await checkHostnameLiterals();
  await checkOwnDomainLiterals();
  await checkReadmeCoverage();

  for (const message of warnings) {
    console.warn(`warning: ${message}`);
  }

  if (failures.length > 0) {
    console.error(`\ndocs:check failed with ${failures.length} problem(s):\n`);
    for (const message of failures) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }

  console.log(`docs:check passed (${present.length} root documents).`);
}

main().catch((error) => {
  console.error("docs:check crashed:", error);
  process.exit(1);
});
