import { describe, expect, it } from "vitest";
import { entryFromResults, isBlankFixReport, mergeCriteria, withoutHousekeeping } from "../../../scripts/land-entry.mjs";

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
  summary: "Fixed the two should-fix findings.",
  decisionsTitle: impl.decisionsTitle,
  decisionsSection: impl.decisionsSection,
  changelogLine: "- **Fix round**: answered the review. §NNN.",
  specsCriteria: impl.specsCriteria,
  ...over,
});
const round = (over: Record<string, unknown> = {}) => ({
  fixed: { committed: true, summary: "Answered the re-review.", decisionsAddendum: "", changelogLine: "", specsCriteria: [], ...over },
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
});
