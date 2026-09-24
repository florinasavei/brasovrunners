import { describe, expect, it } from "vitest";
import { draftExplanation, seriesDrafts } from "@/modules/events/domain/series-drafts";

/**
 * `DECISIONS.md` §NNN — the owner, of a series row reading "Publicat · 8 date · Ciornă · 1
 * date": "ce înseamnă această 1 ciornă?". `seriesDrafts` names the dates a series is missing
 * from the site, soonest-first among the ones still ahead; `draftExplanation` says why, when
 * `materializeSeries` (`src/modules/content/events/service.ts`) can tell — the rule's own switch
 * is off, or its source is not published.
 */
describe("§NNN seriesDrafts — the dates a series is missing from the site", () => {
  const source = (repeatRule: unknown) => ({ editorialStatus: "PUBLISHED" as const, startsAt: new Date("2026-01-01T00:00:00Z"), repeatRule });
  const child = (startsAt: string, editorialStatus: "DRAFT" | "PUBLISHED" = "PUBLISHED") => ({
    editorialStatus,
    startsAt: new Date(startsAt),
    repeatRule: null,
  });

  it("finds no draft, and no reason, in a series with none", () => {
    expect(seriesDrafts([source(null), child("2026-01-08"), child("2026-01-15")], new Date("2026-01-10"))).toEqual({
      drafts: [],
      reason: null,
    });
  });

  it("orders the drafts still ahead soonest first, and the past ones latest first, ahead before past", () => {
    const members = [
      source({ cadence: "WEEKLY", weekdays: [], until: null, publish: true }),
      child("2025-12-18", "DRAFT"), // past, earlier
      child("2026-01-15", "DRAFT"), // ahead, later
      child("2026-01-08", "DRAFT"), // ahead, sooner
      child("2025-12-25", "DRAFT"), // past, later than the first
    ];
    const { drafts } = seriesDrafts(members, new Date("2026-01-05"));
    expect(drafts.map((d) => d.startsAt.toISOString().slice(0, 10))).toEqual([
      "2026-01-08", // ahead, soonest first
      "2026-01-15",
      "2025-12-25", // past, latest first
      "2025-12-18",
    ]);
  });

  it("names 'autoPublishOff' when the rule would not publish", () => {
    const members = [source({ cadence: "WEEKLY", weekdays: [], until: null, publish: false }), child("2026-01-08", "DRAFT")];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBe("autoPublishOff");
  });

  it("names 'sourceNotPublished' when the rule would publish but its source is not published", () => {
    const members = [
      { editorialStatus: "DRAFT" as const, startsAt: new Date("2026-01-01"), repeatRule: { cadence: "WEEKLY", weekdays: [], until: null, publish: true } },
      child("2026-01-08", "DRAFT"),
    ];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBe("sourceNotPublished");
  });

  it("names no reason for a draft the rule would not have made — a hand-made set, or a rule that publishes from a published source", () => {
    const members = [source({ cadence: "WEEKLY", weekdays: [], until: null, publish: true }), child("2026-01-08", "DRAFT")];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBeNull();
  });

  it("names no reason for a set of dates made once, with no rule among them", () => {
    const members = [
      { editorialStatus: "PUBLISHED" as const, startsAt: new Date("2026-01-01"), repeatRule: null },
      child("2026-01-08", "DRAFT"),
    ];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBeNull();
  });
});

describe("§NNN draftExplanation — the hint behind the draft line's \"?\"", () => {
  const sentences = { always: "always.", autoPublishOff: "off.", sourceNotPublished: "source." };

  it("is only the general sentence when there is no reason to name", () => {
    expect(draftExplanation(null, sentences)).toBe("always.");
  });

  it("appends the named reason, joined by a line break", () => {
    expect(draftExplanation("autoPublishOff", sentences)).toBe("always.\noff.");
    expect(draftExplanation("sourceNotPublished", sentences)).toBe("always.\nsource.");
  });
});
