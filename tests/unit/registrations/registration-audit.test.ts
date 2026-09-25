import { describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { describeMovedOnDeclarationLink } from "@/modules/registrations/domain/link-status";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { publicFormEvent } from "@/modules/registrations/public-form-event";

/**
 * The registration audit (§420), its two pure halves.
 *
 * - **A live declaration link on a registration that has moved on** (AGENTS.md §14.3): only a hold
 *   or an offer can be signed, so every other state is a notice in the form's place — the sentence
 *   a spent link gets for the same state.
 * - **The public form's event** (§104): both of the form's doors hand the allocator the
 *   participation window, which is what decides a verified restart's hold.
 */
describe("§420 a live declaration link on a registration that has moved on", () => {
  it.each(["PENDING_DECLARATION", "WAITLIST_OFFERED"] as const)("shows the form for %s", (status) => {
    expect(describeMovedOnDeclarationLink("COMPLETE_DECLARATION", status)).toBeNull();
    expect(describeMovedOnDeclarationLink("WAITLIST_OFFER", status)).toBeNull();
  });

  it.each([
    ["CANCELLED", { message: "CANCELLED", next: "REGISTER_AGAIN" }],
    ["EXPIRED", { message: "LAPSED", next: "REGISTER_AGAIN" }],
    ["WAITLISTED", { message: "WAITLISTED", next: "NONE" }],
    ["CONFIRMED", { message: "CONFIRMED", next: "RESEND" }],
    ["PENDING_EMAIL_CONFIRMATION", { message: "CONFIRM_EMAIL", next: "RESEND" }],
  ] as const)("says where a %s registration stands instead", (status, expected) => {
    expect(describeMovedOnDeclarationLink("COMPLETE_DECLARATION", status)).toEqual(expected);
    expect(describeMovedOnDeclarationLink("WAITLIST_OFFER", status)).toEqual(expected);
  });
});

describe("§420 §104 the public form hands the allocator the participation window", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    eventStatus: "SCHEDULED",
    registrationMode: "INTERNAL",
    startsAt: new Date("2026-11-21T07:00:00.000Z"),
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 100,
    raceId: null,
    timezone: "Europe/Bucharest",
    minAge: 14,
    confirmationOpensDaysBefore: 7,
    confirmationDeadlineDaysBefore: 2,
    reminderHoursBefore: 24,
  } satisfies Parameters<typeof publicFormEvent>[0];

  it("carries the window, the reminder lead, the zone and the minimum age off the row", () => {
    const publishedAt = new Date("2026-09-01T00:00:00.000Z");
    const event = publicFormEvent(row, publishedAt);
    expect(event).toMatchObject({
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      reminderHoursBefore: 24,
      timezone: "Europe/Bucharest",
      minAge: 14,
      publishedAt,
    });
    // …which is what the allocator reads a hold's deadline from: two days before the start.
    expect(confirmationWindow(event)?.deadline).toEqual(new Date("2026-11-19T07:00:00.000Z"));
  });

  it("reads every column it needs from the events table", () => {
    for (const column of Object.keys(row)) expect(Object.keys(events)).toContain(column);
  });
});
