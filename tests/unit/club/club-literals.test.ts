import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import guardWordsFile from "@club/guard-words.json";
import { CLUB } from "@/club/config";
import type { ClubConfig, ClubGuardWords } from "@/club/schema";
import { KNOWN_LEAKS } from "./known-leaks";

/**
 * BR-REQ-101-01 (§882, amending §369): the club's words are written in `club/club.json` and read through
 * `theme/brand.ts`, `events/domain/place.ts` and `i18n/dates.ts` — never typed again as a literal.
 *
 * The forbidden words are built from the config itself, so a fork's guard forbids the fork's words: the name,
 * folded and with optional separators between its words (it catches «Brașov Runners», «BRASOV RUNNERS»,
 * «brasov-runners» and «brasovrunners» alike); the wordmark; the slug; the short name and the nicknames as whole
 * words of three letters or more; the locality and the county; the identity card example; the hashtags; and the
 * club's guard words (its places, its parks, its programmes) — `club/guard-words.json`, a file of their own that
 * this test alone reads, so that no bundle the application builds carries the list.
 *
 * Scanned: every string a program hands a person or another system — a string literal, each piece of a template
 * literal and the text between JSX tags — in `src/**\/*.ts(x)` and `scripts/**`; every leaf of both catalogues;
 * the lines of the workflows that are not comments; `package.json` and `docker-compose.yml`. Comments are not
 * nodes of the tree, so the owner's own words quoted in one are not counted. Exempt: `club/**`, `tests/**`, every
 * `*.md`, `src/db/migrations/**` (history), and — until the seeds read the config — `src/db/seeds/**`.
 *
 * `KNOWN_LEAKS` (`./known-leaks.ts`) lists what is still written as a literal today, file by file — the legal
 * templates' and the catalogues' wording, the scripts — for the later changes that move them. It is a ratchet:
 * a new leak fails, and so does an entry that no longer leaks, so the list only ever shrinks.
 */
const ROOT = path.resolve(__dirname, "../../..");

/** Diacritics and case folded: «Brașov», «BRASOV» and «brasov» are one word. */
const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_WORD = "[^\\p{L}\\p{N}]";

type Forbidden = { label: string; pattern: RegExp };

/** A phrase whose words may stand glued or apart, behind any separator: «brasov runners», «brasov_runners», «brasovrunners». */
const glued = (label: string): Forbidden => ({
  label,
  pattern: new RegExp(
    fold(label)
      .split(new RegExp(`${NOT_WORD}+`, "u"))
      .filter(Boolean)
      .map(escape)
      .join(`${NOT_WORD}*`),
    "u",
  ),
});

/**
 * The name with its words apart, behind a space or a hyphen («Brașov Runners», «brasov-runners») — §369's own pattern,
 * counted under a label of its own: the glued count alone would let a string that drops «brasovrunners» pay for a new
 * «Echipa Brașov Runners», and the catalogues, where §369 allowed none, must stay at none.
 */
const apart = (label: string): Forbidden => ({
  label: `${label} (apart)`,
  pattern: new RegExp(
    fold(label)
      .split(new RegExp(`${NOT_WORD}+`, "u"))
      .filter(Boolean)
      .map(escape)
      .join("[\\s-]+"),
    "u",
  ),
});

/** A word or a phrase standing on its own, never inside a longer word: «tractorul», not «tractorului». */
const whole = (label: string): Forbidden => ({
  label,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(label)).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u"),
});

/** The club's words, from its own file. Deduplicated by what they match: the county is the locality in Brașov. */
function forbiddenWords(club: ClubConfig, guardWords: ClubGuardWords): Forbidden[] {
  const words: Forbidden[] = [
    glued(club.name),
    apart(club.name),
    glued(club.wordmark),
    whole(club.slug),
    ...[club.shortName, ...club.shortForms.nicknames].filter((word) => /^[\p{L}\p{N}]{3,}$/u.test(word)).map(whole),
    whole(club.place.locality),
    whole(club.place.county),
    glued(club.place.idExample),
    ...club.hashtags.map(whole),
    ...guardWords.map(whole),
  ];
  const seen = new Set<string>();
  return words.filter(({ pattern }) => !seen.has(pattern.source) && seen.add(pattern.source));
}

const GUARD_WORDS: ClubGuardWords = guardWordsFile;
const FORBIDDEN = forbiddenWords(CLUB, GUARD_WORDS);

/** The labels of the forbidden words a text says. */
const said = (text: string): string[] => {
  const folded = fold(text);
  return FORBIDDEN.filter(({ pattern }) => pattern.test(folded)).map(({ label }) => label);
};

/** Every string a program can hand a person or another system — a literal, a template's pieces, JSX text. */
function programStrings(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.(mjs|cjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every leaf of a JSON document, keys included. */
function jsonLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonLeaves);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => [key, ...jsonLeaves(child)]);
  return [];
}

/** The lines of a YAML or shell file that are not comments. */
const nonCommentLines = (text: string) => text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : filesUnder(full);
    return [full];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

/** Exempt: the club's own folder, the tests, prose, the migrations' history and (for now) the seeds. */
const EXEMPT = (file: string) =>
  file.startsWith("club/") || file.startsWith("tests/") || file.endsWith(".md") || file.startsWith("src/db/migrations/") || file.startsWith("src/db/seeds/");

/** What one file says that the club's file should say instead: the texts to read, by kind. */
function textsOf(file: string): string[] {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  if (/\.(ts|tsx|mts|mjs|cjs|js)$/.test(file)) return programStrings(file, text);
  if (file.endsWith(".json")) return jsonLeaves(JSON.parse(text));
  if (/\.(ya?ml|sh)$/.test(file)) return nonCommentLines(text);
  return [];
}

function scannedFiles(): string[] {
  const src = filesUnder(path.join(ROOT, "src")).filter((file) => /\.tsx?$/.test(file));
  const scripts = filesUnder(path.join(ROOT, "scripts"));
  const workflows = filesUnder(path.join(ROOT, ".github/workflows")).filter((file) => /\.ya?ml$/.test(file));
  const singles = ["messages/ro.json", "messages/en.json", "package.json", "docker-compose.yml"].map((file) => path.join(ROOT, file));
  return [...src, ...scripts, ...workflows, ...singles]
    .map(relative)
    .filter((file) => !EXEMPT(file))
    .sort();
}

/** How many of a text list's strings say each forbidden word: label → count of strings. */
export function countSaid(texts: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const text of texts) for (const label of new Set(said(text))) counts[label] = (counts[label] ?? 0) + 1;
  return counts;
}

/** File → word → how many strings of it say the word. A new string is a new count, even in a listed file. */
export function leaks(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {};
  for (const file of scannedFiles()) {
    const counts = countSaid(textsOf(file));
    if (Object.keys(counts).length > 0) found[file] = counts;
  }
  return found;
}

/** The differences between what is listed and what is found, as lines: «file: word listed N, found M». */
export function ratchetDifferences(found: Record<string, Record<string, number>>, listed: Record<string, Record<string, number>>) {
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const file of new Set([...Object.keys(found), ...Object.keys(listed)])) {
    for (const word of new Set([...Object.keys(found[file] ?? {}), ...Object.keys(listed[file] ?? {})])) {
      const have = found[file]?.[word] ?? 0;
      const allowed = listed[file]?.[word] ?? 0;
      if (have > allowed) fresh.push(`${file}: ${word} listed ${allowed}, found ${have}`);
      if (have < allowed) stale.push(`${file}: ${word} listed ${allowed}, found ${have}`);
    }
  }
  return { fresh, stale };
}

describe("BR-REQ-101-01: the club's words come from club/club.json, never a literal (§882)", () => {
  it("builds its words from the club's file, and finds them in a string, a template and JSX text, not in a comment", () => {
    const labels = FORBIDDEN.map(({ label }) => label);
    expect(labels).toContain(CLUB.name);
    expect(labels).toContain(CLUB.place.locality);
    for (const word of GUARD_WORDS) expect(labels).toContain(word);
    const probe = programStrings(
      "probe.tsx",
      [
        `// ${CLUB.name}, in a comment`,
        `const a = "Echipa ${CLUB.name}";`,
        `const b = \`-//${fold(CLUB.name)}//\${x}\`;`,
        `const c = <div>${CLUB.wordmark}</div>;`,
        `const d = "@${CLUB.slug}";`,
        `const e = "un ${CLUB.place.locality.toUpperCase()} oarecare";`,
      ].join("\n"),
    ).flatMap(said);
    expect(probe).toEqual(expect.arrayContaining([CLUB.name, CLUB.place.locality]));
    expect(programStrings("probe.ts", `// ${CLUB.name}\n/* ${CLUB.place.locality} */ const z = 1;`).flatMap(said)).toEqual([]);
  });

  it("matches a word whole and the name glued: never a word inside a longer one", () => {
    const name = FORBIDDEN.find(({ label }) => label === CLUB.name);
    const locality = FORBIDDEN.find(({ label }) => label === CLUB.place.locality);
    expect(name?.pattern.test(fold(CLUB.slug))).toBe(true);
    expect(name?.pattern.test(fold(CLUB.name).replace(/\s+/g, "_"))).toBe(true);
    expect(locality?.pattern.test(`${fold(CLUB.place.locality)}x`)).toBe(false);
    expect(locality?.pattern.test(`x ${fold(CLUB.place.locality)}, ro`)).toBe(true);
  });

  it("finds no leak that KNOWN_LEAKS does not count, and no counted leak that is gone", () => {
    const { fresh, stale } = ratchetDifferences(leaks(), KNOWN_LEAKS);
    expect(fresh, "a new literal of the club's: read it from brand.ts, place.ts or dates.ts").toEqual([]);
    expect(stale, "a listed leak that is gone: lower or take off its count in KNOWN_LEAKS").toEqual([]);
  });

  it("keeps §369's pin: no catalogue string names the club with its words apart, and a glued string cannot pay for one", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      expect(countSaid(textsOf(file))[`${CLUB.name} (apart)`] ?? 0, file).toBe(0);
      expect(KNOWN_LEAKS[file]?.[`${CLUB.name} (apart)`], file).toBeUndefined();
    }
    const swapped = countSaid([`Echipa ${CLUB.name}`]);
    expect(swapped[`${CLUB.name} (apart)`]).toBe(1);
    expect(countSaid([`@${fold(CLUB.name).replace(/\s+/g, "")}`])[`${CLUB.name} (apart)`]).toBeUndefined();
  });

  it("lists no catalogue: the platform's words are neutral, and this club's own sentences live in club/messages (§887)", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      expect(KNOWN_LEAKS[file], file).toBeUndefined();
      expect(countSaid(textsOf(file)), file).toEqual({});
    }
    // A new message that says the name or a place of the club's fails at once, in a file with no row.
    const probed = countSaid([...textsOf("messages/ro.json"), `Echipa ${CLUB.name} te așteaptă la ${GUARD_WORDS[0]}`]);
    const { fresh } = ratchetDifferences({ "messages/ro.json": probed }, KNOWN_LEAKS);
    expect(fresh.some((line) => line.includes(`${CLUB.name} listed 0`))).toBe(true);
    expect(fresh.some((line) => line.includes(`${GUARD_WORDS[0]} listed 0`))).toBe(true);
  });

  it("sees one more string in a listed file: a new string that says the name fails though the file is grandfathered", () => {
    const file = "scripts/calendar-image-preview/june.json";
    expect(KNOWN_LEAKS[file]?.[CLUB.name]).toBeGreaterThan(0);
    const probe = { ...KNOWN_LEAKS[file] };
    const probed = countSaid([...textsOf(file), `Echipa ${CLUB.name} te așteaptă la ${GUARD_WORDS[0]}, ${CLUB.shortName}`]);
    const { fresh } = ratchetDifferences({ [file]: probed }, { [file]: probe });
    expect(fresh.length).toBeGreaterThanOrEqual(2);
    expect(fresh.some((line) => line.includes(`${CLUB.name} listed`))).toBe(true);
    expect(fresh.some((line) => line.includes(`${GUARD_WORDS[0]} listed`))).toBe(true);
    // and a second guard word in a listed program file is seen the same way
    expect(ratchetDifferences({ f: { w: 2 } }, { f: { w: 1 } }).fresh).toHaveLength(1);
    expect(ratchetDifferences({ f: { w: 1 } }, { f: { w: 2 } }).stale).toHaveLength(1);
  });
});
