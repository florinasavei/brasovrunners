import { describe, expect, it } from "vitest";
import { draftRemedies, seriesDrafts } from "@/modules/events/domain/series-drafts";

/**
 * `DECISIONS.md` §341 — the owner, of a series row reading "Publicat · 8 date · Ciornă · 1
 * date": "ce înseamnă această 1 ciornă?". `seriesDrafts` names the dates a series is missing
 * from the site, soonest-first among the ones still ahead, why `materializeSeries`
 * (`src/modules/content/events/service.ts`) made them drafts — the rule's own switch is off, or
 * its source is not published — and which date holds the rule; `draftRemedies` (§NNN) says what
 * the line offers to do about each case.
 */
describe("§341 seriesDrafts — the dates a series is missing from the site", () => {
  const source = (repeatRule: unknown) => ({ editorialStatus: "PUBLISHED" as const, startsAt: new Date("2026-01-01T00:00:00Z"), repeatRule });
  const child = (startsAt: string, editorialStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED" = "PUBLISHED") => ({
    editorialStatus,
    startsAt: new Date(startsAt),
    repeatRule: null,
  });

  it("finds no draft, and no reason, in a series with none", () => {
    expect(seriesDrafts([source(null), child("2026-01-08"), child("2026-01-15")], new Date("2026-01-10"))).toEqual({
      drafts: [],
      reason: null,
      source: null,
    });
  });

  it("orders the drafts still ahead soonest first, and leaves the past ones out entirely", () => {
    const members = [
      source({ cadence: "WEEKLY", weekdays: [], until: null, publish: true }),
      child("2025-12-18", "DRAFT"), // past, earlier
      child("2026-01-15", "DRAFT"), // ahead, later
      child("2026-01-08", "DRAFT"), // ahead, sooner
      child("2025-12-25", "DRAFT"), // past, later than the first
    ];
    const { drafts } = seriesDrafts(members, new Date("2026-01-05"));
    // Nothing left to publish about a date whose day already came and went — a past draft
    // reads as an ask nobody can act on, so it is not named at all (§341).
    expect(drafts.map((d) => d.startsAt.toISOString().slice(0, 10))).toEqual([
      "2026-01-08", // ahead, soonest first
      "2026-01-15",
    ]);
  });

  it("never counts an archived or a published date among the drafts — the line's 'Publică' posts exactly these", () => {
    const members = [
      source({ cadence: "WEEKLY", weekdays: [], until: null, publish: false }),
      child("2026-01-08", "ARCHIVED"),
      child("2026-01-15", "PUBLISHED"),
      child("2026-01-22", "DRAFT"),
    ];
    const { drafts } = seriesDrafts(members, new Date("2026-01-05"));
    expect(drafts).toEqual([members[3]]);
  });

  it("finds no draft and no reason when every draft is in the past", () => {
    const members = [source({ cadence: "WEEKLY", weekdays: [], until: null, publish: false }), child("2025-12-18", "DRAFT")];
    expect(seriesDrafts(members, new Date("2026-01-05"))).toMatchObject({ drafts: [], reason: null });
  });

  it("names 'autoPublishOff' when the source is published but the rule would not publish", () => {
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

  it("names 'sourceNotPublished' — not 'autoPublishOff' — for a draft source whose rule also has publish:false", () => {
    // The common case: a series started from the new-event form's "creează ca ciornă" (§341).
    // `repeatEvent` always stores `publish: false` on the rule when the source is not published,
    // whatever the tick said, so the flag cannot be trusted to mean "the tick is off" here — the
    // source being unpublished is the real, actionable reason, and the only one with a switch a
    // draft source's editor actually shows.
    const members = [
      { editorialStatus: "DRAFT" as const, startsAt: new Date("2026-01-01"), repeatRule: { cadence: "WEEKLY", weekdays: [], until: null, publish: false } },
      child("2026-01-08", "DRAFT"),
    ];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBe("sourceNotPublished");
  });

  it("names no reason for a draft the rule would not have made — a hand-made set, or a rule that publishes from a published source", () => {
    const members = [source({ cadence: "WEEKLY", weekdays: [], until: null, publish: true }), child("2026-01-08", "DRAFT")];
    expect(seriesDrafts(members, new Date("2026-01-01")).reason).toBeNull();
  });

  it("names no reason, and no source, for a set of dates made once, with no rule among them", () => {
    const members = [
      { editorialStatus: "PUBLISHED" as const, startsAt: new Date("2026-01-01"), repeatRule: null },
      child("2026-01-08", "DRAFT"),
    ];
    const answer = seriesDrafts(members, new Date("2026-01-01"));
    expect(answer.reason).toBeNull();
    expect(answer.source).toBeNull();
  });

  it("hands back the date that holds the rule — the one the auto-publish switch and 'Deschide seria' aim at (§NNN)", () => {
    // The source is not necessarily first in the list the page hands over, nor still ahead.
    const holder = { ...source({ cadence: "WEEKLY", weekdays: [], until: null, publish: false }), id: "source" };
    const members = [{ ...child("2026-01-08", "DRAFT"), id: "copy-1" }, holder, { ...child("2026-01-15", "DRAFT"), id: "copy-2" }];
    const answer = seriesDrafts(members, new Date("2026-01-05"));
    expect(answer.source).toBe(holder);
    expect(answer.drafts.map((draft) => draft.id)).toEqual(["copy-1", "copy-2"]);
  });
});

describe("§NNN draftRemedies — what the draft line offers, by why the dates are drafts", () => {
  it("offers both 'Publică' and the rule's switch for dates the series made with auto-publish off", () => {
    expect(draftRemedies("autoPublishOff")).toEqual({ publish: true, autoPublish: true, openSource: false });
  });

  it("offers only the way to the source when the source is not published — the switch could not take effect", () => {
    expect(draftRemedies("sourceNotPublished")).toEqual({ publish: false, autoPublish: false, openSource: true });
  });

  it("offers 'Publică' alone for drafts made by hand", () => {
    expect(draftRemedies(null)).toEqual({ publish: true, autoPublish: false, openSource: false });
  });
});
