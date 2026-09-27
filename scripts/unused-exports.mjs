// Exports under src/ that nothing uses — the dead-code sweep, repeatable (§NNN).
//
//   node scripts/unused-exports.mjs            values (functions, constants, classes) nothing uses
//   node scripts/unused-exports.mjs --types    and types and interfaces nothing uses
//   node scripts/unused-exports.mjs --local    and exports only their own file uses
//
// A grep walk, not a module graph, and deliberately so: no dependency (no knip), a few dozen
// lines, and the answer a person checks by hand anyway. An export is listed when its name, as a
// whole word, appears in no other file under src/, tests/, scripts/ or docs/ (nor a root config
// file) and nowhere in its own file but its declaration — dead code, not merely an export that
// could be private (`--local` lists those too). It errs towards silence: a name that is also a word
// in a comment elsewhere is not listed. A listed name is a candidate, not a verdict — read it
// before deleting it. Types are opt-in because a table's `$inferSelect` row type or a schema's
// `z.infer` is the module's vocabulary whether or not anyone imports it yet.
//
// Not listed, because the framework or the reader is their user:
//   - the names Next.js reads off a route file (a page's `generateMetadata`, a route's `GET`…);
//   - ALLOWLIST and ALLOWLIST_PATTERNS below: exports kept on purpose, each with its reason.
//
// It prints the candidates and exits 0; it is not part of `yarn check`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INCLUDE_TYPES = process.argv.includes("--types");
const INCLUDE_LOCAL = process.argv.includes("--local");
const SOURCE_DIRS = ["src", "tests", "scripts", "docs"];
const EXTENSIONS = /\.(ts|tsx|mts|mjs|js|cjs|md|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "migrations", "dist", "coverage"]);

/** Names Next.js itself reads off a route segment's files; nothing in the repository imports them. */
const NEXT_ROUTE_EXPORTS = new Set([
  "metadata", "generateMetadata", "generateStaticParams", "generateViewport", "generateImageMetadata",
  "generateSitemaps", "viewport", "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime",
  "preferredRegion", "maxDuration", "alt", "size", "contentType", "config", "middleware", "proxy",
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "register", "onRequestError",
]);

/** Exports kept on purpose although nothing names them. Each says why. */
const ALLOWLIST = new Map([
  // A compile-time proof: the typecheck fails when the difficulty enum gains a level the scale lacks (§412).
  ["DIFFICULTY_LEVELS_COVER_THE_ENUM", "type-level guard"],
]);
const ALLOWLIST_PATTERNS = [
  // The day a provider's price or limit was last read off its site, kept beside the figure for the
  // person who updates it (Costuri, §479): a record for a reader, not a value for the code.
  [/_CHECKED_ON$/, "the date a figure was checked"],
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir), []));
for (const name of readdirSync(ROOT)) {
  if (/\.(ts|mts|mjs|js|cjs)$/.test(name) && statSync(path.join(ROOT, name)).isFile()) files.push(path.join(ROOT, name));
}

const words = (text) => text.match(/[A-Za-z_$][\w$]*/g) ?? [];

/** Every identifier-shaped word → the files it appears in; and each file's words, counted. */
const filesOfWord = new Map();
const texts = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  texts.set(file, text);
  for (const word of new Set(words(text))) {
    let set = filesOfWord.get(word);
    if (!set) filesOfWord.set(word, (set = new Set()));
    set.add(file);
  }
}

const DECLARED_VALUE = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const DECLARED_TYPE = /^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const LISTED = /^export\s+(type\s+)?\{([^}]*)\}(?!\s*from)/gm;

const kept = (name) => ALLOWLIST.has(name) || ALLOWLIST_PATTERNS.some(([pattern]) => pattern.test(name));

const candidates = [];
for (const file of files) {
  const relative = path.relative(ROOT, file);
  if (!relative.startsWith(`src${path.sep}`) || !/\.(ts|tsx)$/.test(file)) continue;
  const text = texts.get(file);
  const isRouteFile = relative.startsWith(path.join("src", "app")) || /[\\/](instrumentation|proxy|middleware)\.ts$/.test(relative);
  const names = [...text.matchAll(DECLARED_VALUE)].map((match) => match[1]);
  if (INCLUDE_TYPES) names.push(...[...text.matchAll(DECLARED_TYPE)].map((match) => match[1]));
  for (const match of text.matchAll(LISTED)) {
    if (match[1] && !INCLUDE_TYPES) continue;
    for (const part of match[2].split(",")) {
      if (/^\s*type\s/.test(part) && !INCLUDE_TYPES) continue;
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "default") names.push(name);
    }
  }
  for (const name of new Set(names)) {
    if (kept(name)) continue;
    if (isRouteFile && NEXT_ROUTE_EXPORTS.has(name)) continue;
    const elsewhere = [...(filesOfWord.get(name) ?? [])].filter((other) => other !== file);
    if (elsewhere.length > 0) continue;
    const ownUses = words(text).filter((word) => word === name).length;
    if (ownUses > 1 && !INCLUDE_LOCAL) continue;
    candidates.push(`${relative.split(path.sep).join("/")}: ${name}${ownUses > 1 ? " (used in its own file)" : ""}`);
  }
}

candidates.sort();
for (const line of candidates) console.log(line);
console.log(`\n${candidates.length} export(s) nothing uses.`);
