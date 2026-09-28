/**
 * How a batch merge resolves the conflicts every batch has (§NNN) — the pure half of
 * `yarn batch:merge` (`scripts/merge-branches.mjs`), kept apart so the rules are testable.
 *
 * Sibling branches cut from the same `qa` collide in the same few files on every batch: the
 * migrations' journal (each appended an entry), the two message catalogues (each added keys), and
 * the tests (each appended a case to the same file). These resolvers lived in the dispatcher's
 * scratch folder on one PC; they are here now so a landing can run anywhere — on GitHub Actions
 * started from a phone included. Anything outside this list is not resolved by a rule: the merge
 * stops and names the files, for a person or a merge agent.
 */

/** The four kinds of path a batch merge resolves by rule, or null for "stop and ask". */
export function conflictKind(path) {
  const p = String(path).replace(/\\/g, "/");
  if (p === "src/db/migrations/meta/_journal.json") return "journal";
  if (p === "messages/ro.json" || p === "messages/en.json") return "catalogue";
  if (p.startsWith("tests/") && /\.(ts|tsx|mjs|js)$/.test(p)) return "union";
  return null;
}

/** Whether the paths a merge changed include the dependencies — `package.json` or `yarn.lock` at the root — so the install must run again. */
export function dependenciesChanged(paths) {
  return paths.some((p) => ["package.json", "yarn.lock"].includes(String(p).replace(/\\/g, "/").trim()));
}

/**
 * The migrations' journal after a merge: every entry either side (or the base) knew, restricted to
 * the migration files present, in file-number order, `idx` from 0, and each `when` strictly after
 * the one before — the migrator applies only entries newer than the last one it applied, so an
 * entry that sorts back in time would be skipped on a deployed database. A file with no entry on any
 * side is reported, never invented; an entry whose file is gone is dropped and reported.
 *
 * @param {Array<{ version?: string, dialect?: string, entries?: Array<{ idx: number, version?: string, when: number, tag: string, breakpoints?: boolean }> } | null>} sides  ours first; null for a side that has no journal
 * @param {string[]} tags  the migration files present, without `.sql`
 */
export function rebuildJournal(sides, tags) {
  const byTag = new Map();
  let version = "7";
  let dialect = "postgresql";
  for (const side of sides.filter(Boolean)) {
    version = side.version || version;
    dialect = side.dialect || dialect;
    for (const e of side.entries ?? []) if (!byTag.has(e.tag)) byTag.set(e.tag, e);
  }
  const sorted = [...tags].sort();
  const missing = sorted.filter((t) => !byTag.has(t));
  const dropped = [...byTag.keys()].filter((t) => !sorted.includes(t));
  let lastWhen = 0;
  const entries = sorted
    .filter((t) => byTag.has(t))
    .map((tag, idx) => {
      const e = byTag.get(tag);
      const when = Number(e.when) > lastWhen ? Number(e.when) : lastWhen + 1000;
      lastWhen = when;
      return { idx, version: e.version || version, when, tag, breakpoints: e.breakpoints !== false };
    });
  return { journal: { version, dialect, entries }, missing, dropped };
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A three-way merge of two JSON documents (a message catalogue): a key only one side changed takes
 * that side; keys either side added are kept; a key one side deleted and the other left alone is
 * deleted; objects both sides changed merge key by key; a leaf or a list both sides changed takes
 * THEIRS — the branch being merged in, which is the newer intent — and is reported.
 *
 * Returns { merged, conflicts: string[] } — the dotted paths where theirs won.
 */
export function mergeJson3(base, ours, theirs) {
  const conflicts = [];
  const merge = (b, o, t, path) => {
    if (same(o, t)) return o;
    if (same(o, b)) return t;
    if (same(t, b)) return o;
    if (isObject(o) && isObject(t)) {
      const out = Object.create(null);
      for (const k of new Set([...Object.keys(o), ...Object.keys(t)])) {
        const inO = k in o;
        const inT = k in t;
        const inB = isObject(b) && k in b;
        if (inO && inT) out[k] = merge(isObject(b) ? b[k] : undefined, o[k], t[k], path ? `${path}.${k}` : k);
        else if (inO) {
          if (!(inB && same(o[k], b[k]))) out[k] = o[k]; // theirs deleted what ours left alone: deleted
        } else if (!(inB && same(t[k], b[k]))) out[k] = t[k]; // ours deleted what theirs left alone: deleted
      }
      return out;
    }
    conflicts.push(path || "(root)");
    return t;
  };
  return { merged: merge(base, ours, theirs, ""), conflicts };
}

const moduleOf = (line) => line.match(/from\s+["']([^"']+)["']/)?.[1] ?? null;

/** A one-line named import, `import [type] { a, b as c } from "m";`, as its parts; null for any other line. */
const NAMED_IMPORT = /^(\s*import\s+(?:type\s+)?)\{([^{}]*)\}(\s*from\s+["'][^"']+["'];?\s*)$/;

/**
 * Two imports of the same module as one: every specifier either side names, ours first in our
 * order, then theirs that are new. Null when either line is not a one-line named import or they
 * differ in `import type` — the caller then keeps both lines rather than guess.
 */
export function mergeImportLines(ours, theirs) {
  const o = ours.match(NAMED_IMPORT);
  const t = theirs.match(NAMED_IMPORT);
  if (!o || !t || o[1].replace(/\s+/g, " ") !== t[1].replace(/\s+/g, " ")) return null;
  const names = (list) => list.split(",").map((s) => s.trim()).filter(Boolean);
  const merged = [...names(o[2])];
  for (const n of names(t[2])) if (!merged.includes(n)) merged.push(n);
  return `${o[1]}{ ${merged.join(", ")} }${o[3]}`;
}

/**
 * Every conflict block of a text file resolved as the union: our lines, then theirs that are not
 * already there — an import from a module both sides import becomes one import with both sides'
 * specifiers (`mergeImportLines`); two imports of one module it cannot read as one-line named
 * imports are both kept, for the typecheck to judge. For a test file, where both sides appended a
 * case, that is what a person would do. A line both sides changed differently is kept in both
 * versions: CI's typecheck and the tests judge it, and `yarn batch:merge` runs the typecheck
 * before it says done. Throws if a marker would remain. Returns { text, blocks }.
 */
export function unionConflicts(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out = [];
  let blocks = 0;
  for (let i = 0; i < lines.length; ) {
    if (!lines[i].startsWith("<<<<<<< ")) {
      out.push(lines[i++]);
      continue;
    }
    // A diff3 block carries the base between `|||||||` and `=======`: the union ignores it.
    const base = lines.findIndex((l, k) => k > i && l.startsWith("||||||| "));
    const mid = lines.findIndex((l, k) => k > i && l === "=======");
    const end = lines.findIndex((l, k) => k > mid && l.startsWith(">>>>>>> "));
    if (mid < 0 || end < 0) throw new Error("an unterminated conflict block");
    const ours = lines.slice(i + 1, base > i && base < mid ? base : mid);
    const theirs = lines.slice(mid + 1, end);
    const merged = [...ours];
    for (const t of theirs) {
      if (t.trim() !== "" && merged.includes(t)) continue;
      const mod = moduleOf(t);
      const j = mod && /^\s*import\b/.test(t) ? merged.findIndex((o) => /^\s*import\b/.test(o) && moduleOf(o) === mod) : -1;
      const one = j >= 0 ? mergeImportLines(merged[j], t) : null;
      if (one) {
        merged[j] = one;
        continue;
      }
      merged.push(t);
    }
    out.push(...merged);
    blocks++;
    i = end + 1;
  }
  if (out.some((l) => /^(<<<<<<< |=======$|>>>>>>> |\|\|\|\|\|\|\| )/.test(l))) throw new Error("conflict markers remain");
  return { text: out.join(eol), blocks };
}

/**
 * A JSON text's duplicate keys — which `JSON.parse` silently collapses to the last — as dotted
 * paths, and the text rewritten keeping the last of each (two-space indent, the text's own line
 * ending). Git's line merge can leave a catalogue with one key twice when both sides added it in
 * different places, and a duplicate is a translation that silently disappears.
 *
 * Returns { duplicates: string[], text } — `text` is null when there is nothing to fix.
 */
export function dedupeJsonKeys(raw) {
  const s = raw;
  let i = 0;
  const duplicates = [];
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const str = () => {
    const start = i;
    i++;
    while (s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(s.slice(start, i));
  };
  const value = (path) => {
    ws();
    if (s[i] === "{") {
      i++;
      const out = Object.create(null); // a key named "__proto__" is a key, not a prototype
      ws();
      if (s[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        ws();
        const key = str();
        ws();
        i++; // ':'
        const v = value(path ? `${path}.${key}` : key);
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          duplicates.push(path ? `${path}.${key}` : key);
          delete out[key]; // the last occurrence wins, in its own position
        }
        out[key] = v;
        ws();
        if (s[i++] === ",") continue;
        return out;
      }
    }
    if (s[i] === "[") {
      i++;
      const out = [];
      ws();
      if (s[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(`${path}[]`));
        ws();
        if (s[i++] === ",") continue;
        return out;
      }
    }
    if (s[i] === '"') return str();
    const m = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i));
    if (!m) throw new Error(`not JSON at character ${i}`);
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  const tree = value("");
  if (duplicates.length === 0) return { duplicates, text: null };
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { duplicates, text: JSON.stringify(tree, null, 2).replace(/\n/g, eol) + eol };
}

/**
 * What differs from production in the journal: every migration already shipped (production's
 * journal) must be in this tree with the same `idx` and `when`, and every new one must sort after
 * the last shipped — drizzle applies by `when`, so a renumbered or back-dated entry is skipped
 * on production without an error. Returns the problems as sentences; empty is good.
 */
export function shippedJournalProblems(mine, shipped) {
  const problems = [];
  const byTag = new Map((mine.entries ?? []).map((e) => [e.tag, e]));
  for (const s of shipped.entries ?? []) {
    const m = byTag.get(s.tag);
    if (!m) problems.push(`shipped migration ${s.tag} is missing from this tree`);
    else if (m.idx !== s.idx || m.when !== s.when) problems.push(`shipped ${s.tag} changed: idx ${s.idx} → ${m.idx}, when ${s.when} → ${m.when}`);
  }
  const lastShipped = (shipped.entries ?? []).at(-1);
  if (lastShipped) {
    const shippedTags = new Set(shipped.entries.map((e) => e.tag));
    for (const e of mine.entries ?? []) {
      if (!shippedTags.has(e.tag) && e.when <= lastShipped.when) problems.push(`new ${e.tag} has when ${e.when}, not after the last shipped ${lastShipped.tag} (${lastShipped.when})`);
    }
  }
  return problems;
}

export const ZERO_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The snapshots' `prevId` re-linked in journal order (what `tests/unit/db/migration-chain.test.ts`
 * holds): siblings that each generated on the same parent all name that parent. Mutates the
 * snapshots in place and returns the indexes it changed.
 *
 * @param {Array<{ id: string, prevId: string }>} snapshots  in journal order
 */
export function relinkSnapshots(snapshots) {
  const changed = [];
  snapshots.forEach((snap, i) => {
    const want = i === 0 ? ZERO_ID : snapshots[i - 1].id;
    if (snap.prevId !== want) {
      snap.prevId = want;
      changed.push(i);
    }
  });
  return changed;
}
