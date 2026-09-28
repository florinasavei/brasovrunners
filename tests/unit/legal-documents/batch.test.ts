import { describe, expect, it } from "vitest";
import { type BatchVersion, deletionOrder, draftApprovalOutcome, regenerationOutcome } from "@/modules/legal-documents/domain/batch";
import { batchConfirmationPhrase, matchesBatchConfirmation } from "@/modules/legal-documents/domain/confirmation";

/** BR-REQ-053-02 (§532) — the plans behind the presses over every legal text at once. */
const row = (overrides: Partial<BatchVersion> & Pick<BatchVersion, "id" | "version">): BatchVersion => ({
  key: "TERMS",
  isApproved: false,
  withdrawnAt: null,
  contentSha256: `hash-${overrides.id}`,
  ...overrides,
});

describe("regenerationOutcome", () => {
  it("is unchanged when the text in force already is the template", () => {
    const rows = [row({ id: "a", version: 1, isApproved: true, contentSha256: "T" })];
    expect(regenerationOutcome("TERMS", "T", rows, "a")).toBe("unchanged");
  });

  it("creates when only an older, superseded approved version had the template's words", () => {
    const rows = [
      row({ id: "a", version: 1, isApproved: true, contentSha256: "T" }),
      row({ id: "b", version: 2, isApproved: true, contentSha256: "X" }),
    ];
    expect(regenerationOutcome("TERMS", "T", rows, "b")).toBe("create");
  });

  it("is draftExists when a draft of the text is waiting, and reads only its own key", () => {
    const rows = [row({ id: "a", version: 1, contentSha256: "T" }), row({ id: "b", version: 1, key: "PRIVACY_NOTICE", contentSha256: "P" })];
    expect(regenerationOutcome("TERMS", "T", rows, undefined)).toBe("draftExists");
    expect(regenerationOutcome("PRIVACY_NOTICE", "T", rows, undefined)).toBe("draftExists");
    expect(regenerationOutcome("EVENT_DECLARATION", "T", rows, undefined)).toBe("create");
  });

  it("never offers to supersede a waiting draft whose words the club changed (a placeholder typed in, the long way)", () => {
    const rows = [
      row({ id: "a", version: 1, isApproved: true, contentSha256: "OLD" }),
      row({ id: "d", version: 2, contentSha256: "FILLED-IN" }),
    ];
    expect(regenerationOutcome("TERMS", "TEMPLATE", rows, "a")).toBe("draftExists");
  });

  it("is not held back by a draft numbered below an offered approved version", () => {
    const rows = [
      row({ id: "d", version: 1, contentSha256: "STALE" }),
      row({ id: "a", version: 2, isApproved: true, contentSha256: "OLD" }),
    ];
    expect(regenerationOutcome("TERMS", "TEMPLATE", rows, "a")).toBe("create");
  });

  it("ignores a withdrawn version's words", () => {
    const rows = [row({ id: "a", version: 1, isApproved: true, withdrawnAt: new Date(), contentSha256: "T" })];
    expect(regenerationOutcome("TERMS", "T", rows, undefined)).toBe("create");
  });
});

describe("draftApprovalOutcome", () => {
  it("names superseded, behind, placeholders and ready, in that order of precedence", () => {
    const older = row({ id: "d1", version: 1 });
    const newer = row({ id: "d2", version: 3 });
    const approved = row({ id: "a2", version: 2, isApproved: true });
    const rows = [older, approved, newer];
    expect(draftApprovalOutcome(older, rows, false)).toBe("superseded");
    expect(draftApprovalOutcome(newer, rows, true)).toBe("placeholders");
    expect(draftApprovalOutcome(newer, rows, false)).toBe("ready");
    expect(draftApprovalOutcome(older, [older, approved], false)).toBe("behind");
    expect(draftApprovalOutcome(older, [older, { ...approved, withdrawnAt: new Date() }], false)).toBe("ready");
  });
});

describe("deletionOrder", () => {
  it("takes each key's lowest number first", () => {
    const rows = [row({ id: "t3", version: 3 }), row({ id: "p2", version: 2, key: "PRIVACY_NOTICE" }), row({ id: "t1", version: 1 })];
    expect(deletionOrder(rows).map((entry) => entry.id)).toEqual(["p2", "t1", "t3"]);
  });
});

describe("the batch phrase", () => {
  it("counts the approved versions, forgiving case and spaces only", () => {
    expect(batchConfirmationPhrase(2)).toBe("DELETE 2");
    expect(matchesBatchConfirmation("  delete   2 ", 2)).toBe(true);
    expect(matchesBatchConfirmation("DELETE 3", 2)).toBe(false);
    expect(matchesBatchConfirmation("DELETE", 2)).toBe(false);
  });
});
