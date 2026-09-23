import { describe, expect, it } from "vitest";
import {
  EVENT_NOTICE_TEXT_MAX,
  type EventChangeFacts,
  eventChangesToAnnounce,
  eventNoticeTextSchema,
  readEventChanges,
  readEventNoticeText,
} from "@/modules/events/domain/event-changes";

/**
 * `DECISIONS.md` §NNN — what a save changed that a registered runner plans by: the place, the
 * start, the programme's timing, the event on again. Compared on the event as loaded and as
 * written; only the kinds come back, never a value.
 */
const BEFORE: EventChangeFacts = {
  eventStatus: "SCHEDULED",
  startsAt: new Date("2026-10-11T05:00:00.000Z"),
  raceStartsAt: new Date("2026-10-11T06:00:00.000Z"),
  locationName: "Parcul Tractorul",
  locationAddress: null,
  mapUrl: "https://maps.example.test/a",
  scheduleItems: [
    { startsAt: "2026-10-11T05:00:00.000Z", endsAt: null, label: { ro: "Kituri", en: "Kits" }, place: "Cort" },
  ],
};

const after = (changes: Partial<EventChangeFacts>): EventChangeFacts => ({ ...BEFORE, ...changes });

describe("§NNN the changes worth telling the participants about", () => {
  it("nothing changed is nothing to tell", () => {
    expect(eventChangesToAnnounce(BEFORE, after({}))).toEqual([]);
  });

  it("the place: a new name, a new map link, or a language's own name for it", () => {
    expect(eventChangesToAnnounce(BEFORE, after({ locationName: "Poiana Brașov" }))).toEqual(["place"]);
    expect(eventChangesToAnnounce(BEFORE, after({ mapUrl: "https://maps.example.test/b" }))).toEqual(["place"]);
    expect(
      eventChangesToAnnounce(BEFORE, BEFORE, [{ locale: "en", locationName: null }], [{ locale: "en", locationName: "Tractorul Park" }]),
    ).toEqual(["place"]);
    // Spacing is not a new place, and neither is a language's name that says what the event says.
    expect(eventChangesToAnnounce(BEFORE, after({ locationName: "  Parcul   Tractorul " }))).toEqual([]);
    expect(
      eventChangesToAnnounce(BEFORE, BEFORE, [{ locale: "ro", locationName: null }], [{ locale: "ro", locationName: "Parcul Tractorul" }]),
    ).toEqual([]);
  });

  it("an older event's address folded into the one field on its first save is the same place", () => {
    const older = after({ locationName: "Parcul Tractorul", locationAddress: "Str. Turnului 5" });
    expect(eventChangesToAnnounce(older, after({ locationName: "Parcul Tractorul, Str. Turnului 5", locationAddress: null }))).toEqual([]);
  });

  it("the time: the start, or a race's gun time — never the end alone", () => {
    expect(eventChangesToAnnounce(BEFORE, after({ startsAt: new Date("2026-10-11T06:00:00.000Z") }))).toEqual(["time"]);
    expect(eventChangesToAnnounce(BEFORE, after({ raceStartsAt: new Date("2026-10-11T06:30:00.000Z") }))).toEqual(["time"]);
    expect(eventChangesToAnnounce(BEFORE, after({ raceStartsAt: null }))).toEqual(["time"]);
  });

  it("the programme: a row's time, its place, a row added — not a label reworded", () => {
    const row = (changes: Record<string, unknown>) => [{ ...(BEFORE.scheduleItems as Record<string, unknown>[])[0], ...changes }];
    expect(eventChangesToAnnounce(BEFORE, after({ scheduleItems: row({ startsAt: "2026-10-11T05:30:00.000Z" }) }))).toEqual(["programme"]);
    expect(eventChangesToAnnounce(BEFORE, after({ scheduleItems: row({ place: "Tribuna" }) }))).toEqual(["programme"]);
    expect(eventChangesToAnnounce(BEFORE, after({ scheduleItems: null }))).toEqual(["programme"]);
    expect(eventChangesToAnnounce(BEFORE, after({ scheduleItems: row({ label: { ro: "Ridicarea kiturilor", en: "Kit pick-up" } }) }))).toEqual([]);
  });

  it("on again after a cancellation, in the order a runner reads a morning", () => {
    expect(
      eventChangesToAnnounce(after({ eventStatus: "CANCELLED" }), after({ locationName: "Poiana", startsAt: new Date("2026-10-12T05:00:00.000Z") })),
    ).toEqual(["reinstated", "place", "time"]);
  });

  it("reads back only the kinds it knows, from whatever an outbox row holds", () => {
    expect(readEventChanges(["time", "place", "nonsense", 3])).toEqual(["place", "time"]);
    expect(readEventChanges("place")).toEqual([]);
    expect(readEventChanges(undefined)).toEqual([]);
  });
});

describe("§NNN the organizer's note and reason, as plain text", () => {
  it("trims, keeps line breaks as one kind, and drops every other control character", () => {
    expect(eventNoticeTextSchema.parse("  Adu frontala.\r\nParcarea e închisă.\u0007  ")).toBe("Adu frontala.\nParcarea e închisă.");
    expect(readEventNoticeText("   ")).toBeUndefined();
    expect(readEventNoticeText(42)).toBeUndefined();
    expect(readEventNoticeText(" Ploaie. ")).toBe("Ploaie.");
  });

  it("refuses more than five hundred characters, counted after trimming", () => {
    expect(eventNoticeTextSchema.safeParse("x".repeat(EVENT_NOTICE_TEXT_MAX)).success).toBe(true);
    expect(eventNoticeTextSchema.safeParse(` ${"x".repeat(EVENT_NOTICE_TEXT_MAX)} `).success).toBe(true);
    expect(eventNoticeTextSchema.safeParse("x".repeat(EVENT_NOTICE_TEXT_MAX + 1)).success).toBe(false);
    expect(readEventNoticeText("x".repeat(EVENT_NOTICE_TEXT_MAX + 1))).toBeUndefined();
  });
});
