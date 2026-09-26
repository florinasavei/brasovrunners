import { describe, expect, it } from "vitest";
import { entryFromResults, isBlankFixReport, mergeCriteria, rewriteFreeSectionRefs, withoutHousekeeping } from "../../../scripts/land-entry.mjs";

/**
 * §NNN — what `yarn docs:land` lands from one item's saved results. The cases are the defects
 * BR-V1.91's landing had, and the blank fix report the dispatcher met afterwards.
 */
const impl = {
  decisionsTitle: "The listing card's handshake",
  decisionsSection: "The owner asked for a handshake on a partnered card.\n\nIt is drawn in the card's own ink.",
  changelogLine: "- **A handshake on a partnered card** — the listing, the calendar and the page. §NNN.",
  specsCriteria: [{ requirement: "BR-REQ-040-01", text: "7. (new) A partnered event's card carries the handshake (2026-09-25, `DECISIONS.md` §NNN)." }],
};
const fixer = (over: Record<string, unknown> = {}) => ({
  committed: true,
  commitSha: "abc1234",
  summary: "Fixed the two should-fix findings.",
  decisionsTitle: impl.decisionsTitle,
  decisionsSection: impl.decisionsSection,
  changelogLine: "- **Fix round**: answered the review. §NNN.",
  specsCriteria: impl.specsCriteria,
  ...over,
});
const round = (over: Record<string, unknown> = {}) => ({
  fixed: { committed: true, commitSha: "def5678", summary: "Answered the re-review.", decisionsAddendum: "", changelogLine: "", specsCriteria: [], ...over },
  rereview: { verdict: "ship" },
});

describe("§NNN docs:land — a blank fix report is refused", () => {
  it("knows a blank report: no result, not an object, or no summary", () => {
    expect(isBlankFixReport(null)).toBe(true);
    expect(isBlankFixReport(undefined)).toBe(true);
    expect(isBlankFixReport({ committed: true, summary: "  " })).toBe(true);
    expect(isBlankFixReport({ committed: false, summary: "Nothing needed a change: the finding was already answered." })).toBe(false);
  });

  it("refuses a round whose result is empty, naming the item and the round", () => {
    expect(() => entryFromResults({ impl }, [{ fixed: null, rereview: null }], {}, "feat/x")).toThrow(/feat\/x: fix round 1's report is blank/);
    expect(() => entryFromResults({ impl }, [round(), round({ summary: "" })], {}, "feat/x")).toThrow(/fix round 2/);
  });

  it("refuses a chain whose own fix report is blank, and lands a clean ship", () => {
    expect(() => entryFromResults({ impl, fixed: { committed: true, summary: "" } })).toThrow(/chain's fix report is blank/);
    expect(entryFromResults({ impl, fixed: null }).body).toBe(impl.decisionsSection);
  });

  it("lands nothing from a round that committed nothing, and says so", () => {
    const entry = entryFromResults({ impl }, [round({ committed: false, decisionsAddendum: "A paragraph that did not happen." })]);
    expect(entry.body).toBe(impl.decisionsSection);
    expect(entry.notes.join("\n")).toMatch(/fix round 1 committed nothing/);
  });
});

describe("§NNN docs:land — the CHANGELOG bullet is the implementer's", () => {
  it("never takes a fixer's changelogLine, from the chain or a round, and prints it for the dispatcher", () => {
    const entry = entryFromResults({ impl, fixed: fixer() }, [round({ changelogLine: "- **Round two** fixed things. §NNN." })]);
    expect(entry.changelog).toBe(impl.changelogLine);
    expect(entry.notes.filter((n) => /proposed another CHANGELOG bullet/.test(n))).toHaveLength(2);
  });

  it("takes the manifest item's changelog when the dispatcher rewrote it", () => {
    const entry = entryFromResults({ impl, fixed: fixer() }, [], { changelog: "- **The dispatcher's bullet**. §NNN." });
    expect(entry.changelog).toBe("- **The dispatcher's bullet**. §NNN.");
  });

  it("refuses a blank bullet", () => {
    expect(() => entryFromResults({ impl: { ...impl, changelogLine: " " } }, [], {}, "feat/x")).toThrow(/feat\/x: blank changelogLine/);
  });
});

describe("§NNN docs:land — a blank decisionsTitle is refused", () => {
  it("keeps the implementer's title when the fixer's is blank or a placeholder", () => {
    expect(entryFromResults({ impl, fixed: fixer({ decisionsTitle: "" }) }).title).toBe(impl.decisionsTitle);
    expect(entryFromResults({ impl, fixed: fixer({ decisionsTitle: "Unchanged" }) }).title).toBe(impl.decisionsTitle);
    expect(entryFromResults({ impl, fixed: fixer({ decisionsTitle: "(carried forward)" }) }).title).toBe(impl.decisionsTitle);
    expect(entryFromResults({ impl, fixed: fixer({ decisionsTitle: "The handshake, in the card's ink" }) }).title).toBe("The handshake, in the card's ink");
  });

  it("refuses when every title is blank, and takes the manifest item's title", () => {
    const untitled = { impl: { ...impl, decisionsTitle: "" }, fixed: fixer({ decisionsTitle: " " }) };
    expect(() => entryFromResults(untitled, [], {}, "feat/x")).toThrow(/feat\/x: blank decisionsTitle/);
    expect(entryFromResults(untitled, [], { title: "The handshake" }).title).toBe("The handshake");
  });
});

describe("§NNN docs:land — a fixer's housekeeping never lands", () => {
  it("keeps the implementer's section when the fixer's only says it carried it forward", () => {
    for (const text of ["Carried forward from the implementer, unchanged.", "(carried forward)", "Unchanged.", "N/A", ""]) {
      const entry = entryFromResults({ impl, fixed: fixer({ decisionsSection: text }) });
      expect(entry.body, text).toBe(impl.decisionsSection);
    }
  });

  it("drops a round's 'no DECISIONS.md edit was made' sentence and keeps the substance around it", () => {
    // The sentence BR-V1.91's landing put into DECISIONS.md, verbatim in shape.
    const addendum =
      "This round made the helper the one every listing spec uses. " +
      "No DECISIONS.md, CHANGELOG.md, SPECS.md or PROJECT_BASELINE edit was made, per the branch's rules; the changelogLine and specsCriteria above are text for the orchestrator to place.";
    const entry = entryFromResults({ impl }, [round({ decisionsAddendum: addendum })]);
    expect(entry.body).toBe(`${impl.decisionsSection}\n\nThis round made the helper the one every listing spec uses.`);
    expect(entry.notes.some((n) => n.startsWith("dropped from fix round 1: \"No DECISIONS.md"))).toBe(true);
  });

  it("drops an addendum that is nothing but housekeeping", () => {
    for (const addendum of ["The § text, changelog line and SPECS criteria are carried forward unchanged.", "None.", "No changes to DECISIONS.md were needed."]) {
      const entry = entryFromResults({ impl }, [round({ decisionsAddendum: addendum })]);
      expect(entry.body, addendum).toBe(impl.decisionsSection);
    }
  });

  it("keeps a fixer's sentence that talks about the documents but is the fix itself", () => {
    const kept = [
      "The review found §372 did not say what changed at 320 pixels; the card now wraps.",
      "A waiting-list offer's deadline is carried forward to the next day when the start is sooner than the offer's hours, which the old text said nowhere in its rules for the queue.",
      "SPECS criterion 6 is now measured at a tenth of a pixel.",
    ];
    for (const sentence of kept) expect(withoutHousekeeping(sentence), sentence).toEqual({ text: sentence, dropped: [] });
  });

  it("keeps paragraphs and lists as they were written", () => {
    const text = "First paragraph. It has two sentences.\n\n- one\n- two\n\nNo CHANGELOG.md edit was made.";
    expect(withoutHousekeeping(text).text).toBe("First paragraph. It has two sentences.\n\n- one\n- two");
  });

  it("does not let an empty criterion replace a real one for its requirement", () => {
    const entry = entryFromResults({ impl }, [round({ specsCriteria: [{ requirement: "BR-REQ-040-01", text: "Unchanged." }] })]);
    expect(entry.criteria).toEqual(impl.specsCriteria);
  });

  it("still lets a later round's real criteria replace the earlier ones per requirement", () => {
    const later = [{ requirement: "BR-REQ-040-01", text: "7. (amended) The card and the calendar carry it (2026-09-26, `DECISIONS.md` §NNN)." }];
    expect(entryFromResults({ impl }, [round({ specsCriteria: later })]).criteria).toEqual(later);
    expect(mergeCriteria(impl.specsCriteria, later)).toEqual(later);
  });

  it("keeps a fixer's sentence that mentions the documents but is not about editing them", () => {
    const kept = [
      "A declined offer carries the place forward to the next person.",
      "The gated migration run of DECISIONS.md §31 is unchanged: production still migrates only through it.",
      "The SPECS criterion for BR-REQ-051-01 did not change the allocator.",
    ];
    for (const sentence of kept) expect(withoutHousekeeping(sentence), sentence).toEqual({ text: sentence, dropped: [] });
  });
});

describe("§NNN docs:land — a committed fix report needs a commitSha", () => {
  it("refuses the chain's fix report when committed but the commitSha is blank", () => {
    expect(() => entryFromResults({ impl, fixed: fixer({ commitSha: "" }) }, [], {}, "feat/x")).toThrow(/feat\/x: the chain's fix report says committed with a blank commitSha/);
  });

  it("refuses a fix round's report when committed but the commitSha is blank", () => {
    expect(() => entryFromResults({ impl }, [round({ commitSha: "" })], {}, "feat/x")).toThrow(/fix round 1's report says committed with a blank commitSha/);
  });

  it("accepts a committed report with a commitSha", () => {
    expect(entryFromResults({ impl, fixed: fixer({ commitSha: "d249ec37" }) }).body).toBe(impl.decisionsSection);
  });
});

describe("§NNN docs:land — a SPECS criterion needs a full BR-REQ id", () => {
  it("drops a criterion whose requirement is not BR-REQ-NNN-NN, with a note", () => {
    const entry = entryFromResults({ impl }, [round({ specsCriteria: [{ requirement: "CI tooling", text: "Some new rule." }, { requirement: "BR-REQ-051", text: "Missing its suffix." }] })]);
    expect(entry.criteria).toEqual(impl.specsCriteria);
    expect(entry.notes.some((n) => n.includes("no BR-REQ-NNN-NN id") && n.includes("CI tooling"))).toBe(true);
    expect(entry.notes.some((n) => n.includes("no BR-REQ-NNN-NN id") && n.includes("BR-REQ-051"))).toBe(true);
  });

  it("keeps a criterion with a full id", () => {
    const criteria = [{ requirement: "BR-REQ-051-01", text: "A real criterion." }];
    const entry = entryFromResults({ impl }, [round({ specsCriteria: criteria })]);
    expect(entry.criteria).toEqual([...impl.specsCriteria, ...criteria]);
  });
});

describe("§NNN docs:land — a literal §N above the next free number becomes §NNN", () => {
  it("rewrites a body's, a bullet's and a criterion's §999 to §NNN, above the threshold", () => {
    const entry = { title: "A title", body: "See §999 for the rule.", changelog: "- x §999.", criteria: [{ requirement: "BR-REQ-051-01", text: "1. (new) §999 says so." }] };
    const rewrites = rewriteFreeSectionRefs(entry, 400);
    expect(entry).toEqual({ title: "A title", body: "See §NNN for the rule.", changelog: "- x §NNN.", criteria: [{ requirement: "BR-REQ-051-01", text: "1. (new) §NNN says so." }] });
    expect(rewrites).toEqual(["§999 → §NNN", "§999 → §NNN", "§999 → §NNN"]);
  });

  it("leaves a §N at or below the threshold alone — it names a decision that already exists", () => {
    const entry = { title: "A title", body: "The gated migration run of §31 is unchanged.", changelog: "- x §31.", criteria: [] };
    const rewrites = rewriteFreeSectionRefs(entry, 400);
    expect(entry.body).toBe("The gated migration run of §31 is unchanged.");
    expect(rewrites).toEqual([]);
  });
});
