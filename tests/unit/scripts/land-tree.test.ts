import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../scripts/land-entry.mjs";
import {
  clauseOf,
  currentBaseline,
  duplicateBranches,
  entryPathOf,
  handWork,
  nextBaseline,
  normalizeBaseline,
  numberForLine,
  orderEntries,
  releaseTitle,
  slugOf,
  todayIn,
  typedBaseline,
  validateEntry,
  withBatchLine,
  withReleasedRow,
} from "../../../scripts/land-tree.mjs";

// An id SPECS.md does not define, built so docs:check does not read it as a reference.
const UNKNOWN = ["BR", "REQ", "099", "09"].join("-");

/**
 * §NNN — the release facts travel with the branch: one `.release/<slug>.json` per change, landed
 * by `yarn docs:land --tree` on the PC or by `.github/workflows/release.yml` from a phone. The
 * baselines here are invented (V9.x in 2031): a landing bumps every literal of the current one.
 */
const entry = {
  branch: "feat/night-pill",
  decisionsTitle: "The night pill says «Noapte»",
  decisionsSection: "**Decision.** A crescent and one word.",
  changelogLine: `- **«Noapte»** on the night pill. ${PLACEHOLDER}.`,
  specsCriteria: [{ requirement: "BR-REQ-041-01", text: "The pill reads «Noapte»." }],
};

describe("§NNN .release entries — named after their branch, and checked before anything lands", () => {
  it("names the file after the branch", () => {
    expect(slugOf("feat/night-pill")).toBe("feat-night-pill");
    expect(slugOf("claude/dreamy knuth")).toBe("claude-dreamy-knuth");
    expect(entryPathOf("fix/a/b")).toBe(".release/fix-a-b.json");
  });

  it("is the file the two workflows tell implementers and fixers to write, by the same slug", () => {
    const rule = ".replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '')";
    expect(readFileSync("scripts/land-tree.mjs", "utf8").replace(/"/g, "'").replace(/\s+/g, "")).toContain(rule.replace(/\s+/g, ""));
    for (const file of [".claude/workflows/br-chain.js", ".claude/workflows/br-fix-round.js"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain(rule);
      expect(source, file).toContain("const ENTRY = `.release/${");
    }
  });

  it("accepts a complete entry, and one without the optional fields", () => {
    expect(validateEntry(entry, ".release/feat-night-pill.json")).toEqual([]);
    const bare: Record<string, unknown> = { ...entry };
    delete bare.specsCriteria;
    expect(validateEntry(bare, ".release/feat-night-pill.json")).toEqual([]);
  });

  it("names every blank required field, a bad requirement id, and a file named for another branch", () => {
    const problems = validateEntry(
      { branch: "feat/x", decisionsTitle: " ", decisionsSection: "", specsCriteria: [{ requirement: "BR-REQ-41", text: "" }], batchLine: 3 },
      ".release/feat-y.json",
    );
    expect(problems.join("\n")).toMatch(/"decisionsTitle" is missing or blank/);
    expect(problems.join("\n")).toMatch(/"decisionsSection" is missing or blank/);
    expect(problems.join("\n")).toMatch(/"changelogLine" is missing or blank/);
    expect(problems.join("\n")).toMatch(/full BR-REQ-NNN-NN id, got "BR-REQ-41"/);
    expect(problems.join("\n")).toMatch(/specsCriteria\[0\]\.text is blank/);
    expect(problems.join("\n")).toMatch(/"batchLine" must be text/);
    expect(problems.join("\n")).toMatch(/named for another branch — "feat\/x" writes \.release\/feat-x\.json/);
    expect(validateEntry([], "x.json")).toEqual(["x.json: not a JSON object"]);
  });

  it("refuses two entries for one branch", () => {
    const a = { file: ".release/a.json", entry };
    const b = { file: ".release/b.json", entry };
    expect(duplicateBranches([a, b])).toEqual([".release/a.json and .release/b.json are both for feat/night-pill"]);
  });

  it("numbers entries in the order they were added, an uncommitted one last", () => {
    const ordered = orderEntries([
      { file: ".release/c.json", addedAt: undefined },
      { file: ".release/b.json", addedAt: 200 },
      { file: ".release/a.json", addedAt: 300 },
    ]);
    expect(ordered.map((e) => e.file)).toEqual([".release/b.json", ".release/a.json", ".release/c.json"]);
  });
});

describe("§NNN the baseline a phone release takes — BR-V2.NN, never a letter", () => {
  it("is the next minor, two digits, dated the landing day", () => {
    expect(nextBaseline("BR-V9.40-2031-01-01", "2031-01-02")).toBe("BR-V9.41-2031-01-02");
    expect(nextBaseline("BR-V9.09-2031-01-01", "2031-01-02")).toBe("BR-V9.10-2031-01-02");
    expect(nextBaseline("BR-V9.99-2031-01-01", "2031-01-02")).toBe("BR-V10.00-2031-01-02");
    expect(() => nextBaseline("BR-V9.40B-2031-01-01", "2031-01-02")).toThrow(/not a baseline/);
  });

  it("takes a typed baseline in any of the short forms, and refuses anything else", () => {
    expect(normalizeBaseline("BR-V9.42", "2031-01-02")).toBe("BR-V9.42-2031-01-02");
    expect(normalizeBaseline("v9.42", "2031-01-02")).toBe("BR-V9.42-2031-01-02");
    expect(normalizeBaseline("9.5", "2031-01-02")).toBe("BR-V9.05-2031-01-02");
    expect(normalizeBaseline("BR-V9.42-2031-01-05", "2031-01-02")).toBe("BR-V9.42-2031-01-05");
    expect(() => normalizeBaseline("V9.42B", "2031-01-02")).toThrow(/write it like BR-V2.18/);
  });

  it("refuses a typed baseline that does not come after the current one — a phone's `2.1` for `2.18` never lands backwards", () => {
    expect(typedBaseline("9.41", "BR-V9.40-2031-01-01", "2031-01-02")).toBe("BR-V9.41-2031-01-02");
    expect(typedBaseline("BR-V10.00", "BR-V9.99-2031-01-01", "2031-01-02")).toBe("BR-V10.00-2031-01-02");
    expect(() => typedBaseline("9.4", "BR-V9.40-2031-01-01", "2031-01-02")).toThrow(/BR-V9.04 does not come after the current BR-V9.40/);
    expect(() => typedBaseline("BR-V9.40", "BR-V9.40-2031-01-01", "2031-01-02")).toThrow(/does not come after/);
    expect(() => typedBaseline("8.99", "BR-V9.40-2031-01-01", "2031-01-02")).toThrow(/does not come after/);
    expect(() => typedBaseline("V9.41B", "BR-V9.40-2031-01-01", "2031-01-02")).toThrow(/write it like BR-V2.18/);
  });

  it("dates the landing in Brașov: 23:30 UTC on the 1st is already the 2nd there", () => {
    expect(todayIn("Europe/Bucharest", new Date("2031-01-01T23:30:00Z"))).toBe("2031-01-02");
    expect(todayIn("Europe/Bucharest", new Date("2031-01-01T12:00:00Z"))).toBe("2031-01-01");
  });

  it("reads the current baseline from CLAUDE.md's bold line", () => {
    expect(currentBaseline("# x\n\n**Baseline `BR-V9.40-2031-01-01`** · [changelog]")).toBe("BR-V9.40-2031-01-01");
    expect(() => currentBaseline("no baseline")).toThrow(/CLAUDE\.md shows no/);
  });
});

describe("§NNN the hand steps of a landing, written by the landing", () => {
  const clauses = [clauseOf({ ...entry, batchLine: `the night pill (see ${PLACEHOLDER})` }, 530), clauseOf(entry, 531)];

  it("words each change by its batch line, else its title, with its number", () => {
    expect(clauses).toEqual(["the night pill (see §530) (§530)", "The night pill says «Noapte» (§531)"]);
    expect(releaseTitle(clauses)).toBe("the night pill (see §530) · The night pill says «Noapte»: 2 changes");
    expect(releaseTitle(["one change (§1)"])).toBe("one change");
    expect(releaseTitle(["x".repeat(300)]).length).toBe(180);
  });

  it("adds the batch line before the /admin/tasks line, numbered one past the last batch", () => {
    const claude = ["- **Batch 7 (2031-01-01, `BR-V9.40`):** old (§12).", "- `/admin/tasks`: what the club still owes and what it pays", ""].join("\r\n");
    const out = withBatchLine(claude, { to: "BR-V9.41-2031-01-02", date: "2031-01-02", clauses });
    expect(out.split("\r\n")).toEqual([
      "- **Batch 7 (2031-01-01, `BR-V9.40`):** old (§12).",
      "- **Batch 8 (2031-01-02, `BR-V9.41`):** the night pill (see §530) (§530) · The night pill says «Noapte» (§531).",
      "- `/admin/tasks`: what the club still owes and what it pays",
      "",
    ]);
    expect(() => withBatchLine("no anchor", { to: "BR-V9.41-2031-01-02", date: "2031-01-02", clauses })).toThrow(/admin\/tasks/);
  });

  it("adds the release as the newest Released row", () => {
    const queue = "## Later\n\n## Released\n\n| Release | What |\n| --- | --- |\n| `BR-V9.40` | old |\n";
    expect(withReleasedRow(queue, { to: "BR-V9.41-2031-01-02", clauses: ["a (§530)"] })).toBe(
      "## Later\n\n## Released\n\n| Release | What |\n| --- | --- |\n| `BR-V9.41` | a (§530) |\n| `BR-V9.40` | old |\n",
    );
    expect(() => withReleasedRow("## Later\n", { to: "BR-V9.41-2031-01-02", clauses: [] })).toThrow(/Released/);
  });
});

describe("§NNN which change a placeholder line belongs to", () => {
  const numberOf = new Map([["aaa", 530]]);
  const inBatch = new Set(["aaa", "mmm"]);
  const uncommitted = "0".repeat(40);

  it("is the change whose branch wrote the line", () => {
    expect(numberForLine({ sha: "aaa", numberOf, inBatch, uncommitted, onlyNumber: null })).toBe(530);
  });

  it("with one change in the release, every line this batch wrote — the merge with qa included — is that change's", () => {
    expect(numberForLine({ sha: "mmm", numberOf, inBatch, uncommitted, onlyNumber: 530 })).toBe(530);
    expect(numberForLine({ sha: uncommitted, numberOf, inBatch, uncommitted, onlyNumber: 530 })).toBe(530);
  });

  it("leaves a line already on the base alone, and a merge's line for a person when several changes land", () => {
    expect(numberForLine({ sha: "old", numberOf, inBatch, uncommitted, onlyNumber: 530 })).toBeNull();
    expect(numberForLine({ sha: "mmm", numberOf, inBatch, uncommitted, onlyNumber: null })).toBeNull();
  });
});

describe("§NNN an entry checked on its pull request, and what an unattended landing refuses", () => {
  const entry = {
    branch: "feat/x",
    decisionsTitle: "X",
    decisionsSection: "Body.",
    changelogLine: "- **X**.",
    specsCriteria: [{ requirement: "BR-REQ-041-01", text: "t" }, { requirement: UNKNOWN, text: "t" }],
  };

  it("names a requirement SPECS.md does not define when it is given the defined ones", () => {
    expect(validateEntry(entry, ".release/feat-x.json")).toEqual([]);
    expect(validateEntry(entry, ".release/feat-x.json", { requirements: new Set(["BR-REQ-041-01"]) })).toEqual([
      `.release/feat-x.json: specsCriteria[1].requirement ${UNKNOWN} is not a requirement in SPECS.md`,
    ]);
  });

  it("lists docsNotes, missing requirements and unnumbered lines as hand work, and nothing when there is none", () => {
    expect(handWork({})).toEqual([]);
    const work = handWork({ docsNotes: ["§1: SETUP.md"], missing: [`${UNKNOWN} (§1)`], manual: ["a.ts:1 x"] });
    expect(work).toHaveLength(3);
    expect(work[0]).toMatch(/^docsNotes left for a person/);
    expect(work[1]).toContain(UNKNOWN);
    expect(work[2]).toMatch(/a\.ts:1 x/);
  });
});
