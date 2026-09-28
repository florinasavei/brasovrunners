import { describe, expect, it } from "vitest";
import {
  conflictKind,
  dedupeJsonKeys,
  mergeImportLines,
  mergeJson3,
  rebuildJournal,
  relinkSnapshots,
  shippedJournalProblems,
  unionConflicts,
  ZERO_ID,
} from "../../../scripts/merge-resolve.mjs";

/**
 * §NNN — the resolvers a batch merge uses, in the repository rather than on one PC, so a landing
 * can run on GitHub Actions: the journal, the catalogues and the tests by rule, anything else a stop.
 */
describe("§NNN which conflicts a rule resolves", () => {
  it("resolves the journal, the two catalogues and test sources, and nothing else", () => {
    expect(conflictKind("src/db/migrations/meta/_journal.json")).toBe("journal");
    expect(conflictKind("messages/ro.json")).toBe("catalogue");
    expect(conflictKind("messages\\en.json")).toBe("catalogue");
    expect(conflictKind("tests/unit/scripts/a.test.ts")).toBe("union");
    expect(conflictKind("tests/e2e/a.spec.ts")).toBe("union");
    for (const other of ["src/app/page.tsx", "CLAUDE.md", "tests/fixtures/photo.jpg", "src/db/migrations/meta/0105_snapshot.json", "package.json"]) {
      expect(conflictKind(other), other).toBeNull();
    }
  });
});

describe("§NNN the journal after two branches each added a migration", () => {
  const base = { version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1000, tag: "0001_a", breakpoints: true }] };
  const ours = { ...base, entries: [...base.entries, { idx: 1, version: "7", when: 3000, tag: "0002_ours", breakpoints: true }] };
  const theirs = { ...base, entries: [...base.entries, { idx: 1, version: "7", when: 2000, tag: "0003_theirs", breakpoints: true }] };

  it("keeps every side's entry, in file order, idx from 0 and every when after the one before", () => {
    const { journal, missing, dropped } = rebuildJournal([ours, theirs, base], ["0003_theirs", "0001_a", "0002_ours"]);
    expect(missing).toEqual([]);
    expect(dropped).toEqual([]);
    expect(journal.entries.map((e) => [e.idx, e.tag, e.when])).toEqual([
      [0, "0001_a", 1000],
      [1, "0002_ours", 3000],
      [2, "0003_theirs", 4000],
    ]);
  });

  it("reports a file no side has an entry for, and drops an entry whose file is gone", () => {
    const { missing, dropped } = rebuildJournal([ours, null, base], ["0001_a", "0004_orphan"]);
    expect(missing).toEqual(["0004_orphan"]);
    expect(dropped).toEqual(["0002_ours"]);
  });
});

describe("§NNN the catalogues merged by key", () => {
  it("keeps both sides' new keys, a one-sided change and a one-sided deletion", () => {
    const base = { Admin: { a: "A", gone: "G", same: "S" } };
    const ours = { Admin: { a: "A", gone: "G", same: "S2", mine: "M" } };
    const theirs = { Admin: { a: "A", same: "S", yours: "Y" }, Public: { x: "X" } };
    const { merged, conflicts } = mergeJson3(base, ours, theirs);
    expect(JSON.parse(JSON.stringify(merged))).toEqual({ Admin: { a: "A", same: "S2", mine: "M", yours: "Y" }, Public: { x: "X" } });
    expect(conflicts).toEqual([]);
  });

  it("gives a leaf both sides changed to theirs, and says where", () => {
    const { merged, conflicts } = mergeJson3({ A: { t: "base" } }, { A: { t: "ours" } }, { A: { t: "theirs" } });
    expect(JSON.parse(JSON.stringify(merged))).toEqual({ A: { t: "theirs" } });
    expect(conflicts).toEqual(["A.t"]);
  });
});

describe("§NNN a test file both sides appended to", () => {
  it("merges two imports of one module into one carrying both sides' specifiers", () => {
    const text = ["<<<<<<< HEAD", 'import { a, c } from "./x";', "=======", 'import { a, b } from "./x";', ">>>>>>> feat/y"].join("\n");
    expect(unionConflicts(text).text).toBe('import { a, c, b } from "./x";');
    expect(mergeImportLines('import type { A } from "./t";', 'import type { B as C } from "./t";')).toBe('import type { A, B as C } from "./t";');
    // A type import and a value import, or a default import, are not one line: both are kept.
    expect(mergeImportLines('import type { A } from "./t";', 'import { a } from "./t";')).toBeNull();
    expect(mergeImportLines('import x from "./t";', 'import { a } from "./t";')).toBeNull();
    const both = unionConflicts(["<<<<<<< HEAD", 'import x from "./t";', "=======", 'import { a } from "./t";', ">>>>>>> y"].join("\n")).text;
    expect(both).toBe('import x from "./t";\nimport { a } from "./t";');
  });

  it("keeps our lines then theirs, one import per module with both lists, the file's line ending", () => {
    const text = [
      "<<<<<<< HEAD",
      'import { a } from "./x";',
      'it("ours", () => {});',
      "=======",
      'import { a, b } from "./x";',
      'it("theirs", () => {});',
      ">>>>>>> feat/y",
      "done();",
    ].join("\r\n");
    const { text: out, blocks } = unionConflicts(text);
    expect(blocks).toBe(1);
    expect(out.split("\r\n")).toEqual(['import { a, b } from "./x";', 'it("ours", () => {});', 'it("theirs", () => {});', "done();"]);
  });

  it("ignores a diff3 base section, and refuses an unterminated block", () => {
    const { text } = unionConflicts(["<<<<<<< HEAD", "ours", "||||||| base", "old", "=======", "theirs", ">>>>>>> x"].join("\n"));
    expect(text).toBe("ours\ntheirs");
    expect(() => unionConflicts("<<<<<<< HEAD\nours\n")).toThrow(/unterminated/);
  });
});

describe("§NNN a key git's line merge left twice", () => {
  it("finds it at any depth and keeps the last value", () => {
    const raw = '{\r\n  "A": { "k": "first", "o": 1, "k": "last" },\r\n  "B": [ { "x": 1, "x": 2 } ]\r\n}\r\n';
    const { duplicates, text } = dedupeJsonKeys(raw);
    expect(duplicates).toEqual(["A.k", "B[].x"]);
    expect(JSON.parse(text!)).toEqual({ A: { o: 1, k: "last" }, B: [{ x: 2 }] });
    expect(text!.endsWith("}\r\n")).toBe(true);
  });

  it("leaves a clean file alone, and a key named __proto__ is a key", () => {
    expect(dedupeJsonKeys('{"a": 1, "b": {"c": "\\"q\\""}}')).toEqual({ duplicates: [], text: null });
    expect(dedupeJsonKeys('{"__proto__": 1, "__proto__": 2}').duplicates).toEqual(["__proto__"]);
  });
});

describe("§NNN production's migrations stay as production applied them", () => {
  const shipped = { entries: [{ idx: 0, tag: "0001_a", when: 1000 }, { idx: 1, tag: "0002_b", when: 2000 }] };

  it("passes a tree that only adds after the last shipped entry", () => {
    expect(shippedJournalProblems({ entries: [...shipped.entries, { idx: 2, tag: "0003_c", when: 3000 }] }, shipped)).toEqual([]);
  });

  it("names a missing, a renumbered and a back-dated entry", () => {
    const problems = shippedJournalProblems({ entries: [{ idx: 0, tag: "0001_a", when: 1500 }, { idx: 1, tag: "0003_c", when: 1900 }] }, shipped);
    expect(problems).toEqual([
      "shipped 0001_a changed: idx 0 → 0, when 1000 → 1500",
      "shipped migration 0002_b is missing from this tree",
      "new 0003_c has when 1900, not after the last shipped 0002_b (2000)",
    ]);
  });
});

describe("§NNN the snapshot chain after sibling migrations", () => {
  it("links each snapshot to the one before it in journal order", () => {
    const snaps = [
      { id: "a", prevId: ZERO_ID },
      { id: "b", prevId: "a" },
      { id: "c", prevId: "a" },
    ];
    expect(relinkSnapshots(snaps)).toEqual([2]);
    expect(snaps.map((s) => s.prevId)).toEqual([ZERO_ID, "a", "b"]);
  });
});
