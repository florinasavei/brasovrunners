import { describe, expect, it } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { DepartureContext } from "@/modules/notifications/domain/departure";
import { receiptValues, type ReceiptRow, summarizeReceipt } from "@/modules/notifications/domain/press-receipt";
import { decodeFlash, encodeFlash } from "@/shared/feedback/notice";

/**
 * The toast after a press (the design «telling the owner about every email a staff press sends», slice 2, its
 * sections 3 and 7): what the press queued, sorted into the person's own email, the club's, other people's and test
 * addresses, each part's departure the queue's own judgement (`departureOf`) — and the flash values it becomes are
 * tokens, counts and instants, never a name or an address, and survive the cookie.
 */

// 10:00 in Brașov on 4 November 2026 (UTC+2): a day hour, the outbox job's next run a quarter of an hour away.
const NOW = new Date("2026-11-04T08:00:00.000Z");
const NEXT_TICK = new Date("2026-11-04T08:15:00.000Z");

function context(over: Partial<DepartureContext> = {}): DepartureContext {
  return {
    now: NOW,
    timing: "scheduled",
    nextTickAt: NEXT_TICK,
    runIntervalMinutes: 0,
    overdueCadenceMinutes: 15,
    overdueAfterMs: 90 * 60_000,
    deferredBeyondMs: 6 * 3_600_000,
    hourPaceHolds: false,
    mailgunReopensAt: null,
    pingerMinutesAt: () => 15,
    ...over,
  };
}

function row(messageType: EmailMessageType, over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    status: "PENDING",
    messageType,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: NOW,
    lastError: null,
    familyHeld: false,
    sentNow: false,
    onMailgunRoad: true,
    clubCopy: false,
    test: false,
    ...over,
  };
}

const times = (count: number, make: () => ReceiptRow) => Array.from({ length: count }, make);

describe("the receipt of one press: whose each email is", () => {
  it("tells the person's own email from the club's and from what reached somebody else", () => {
    const receipt = summarizeReceipt(
      "registrations.cancel",
      [row("REGISTRATION_CANCELLED"), row("REGISTRATION_CANCELLED", { clubCopy: true }), row("WAITLIST_SPOT_OFFER"), row("WAITLIST_SPOT_OFFER", { clubCopy: true })],
      context(),
    );
    expect(receipt.line).toMatchObject({ to: "people", types: ["REGISTRATION_CANCELLED"], count: 1, when: { kind: "at", at: NEXT_TICK }, later: null, rolesHeld: false });
    expect(receipt.club).toBe(2);
    expect(receipt.others).toEqual({ count: 1, type: "WAITLIST_SPOT_OFFER" });
    expect(receipt.test).toBe(0);
  });

  it("counts the declaration's archive, «cineva a confirmat» and a notice to the club's people as the club's, never as other people (Critic correction 4)", () => {
    const desk = summarizeReceipt(
      "registrations.confirmPaper",
      [row("REGISTRATION_CONFIRMED"), row("DECLARATION_ARCHIVE"), row("CLUB_CONFIRMATION_NOTICE"), row("CLUB_CONFIRMATION_NOTICE")],
      context(),
    );
    expect(desk.club).toBe(3);
    expect(desk.others).toBeNull();
    const shop = summarizeReceipt("club.shopOrderForMember", [row("SHOP_ORDER_PLACED"), row("SHOP_ORDER_PAID"), row("SHOP_ORDER_CLUB_NOTICE")], context());
    // A member's two receipts are one person's; the shop's notice is the club's.
    expect(shop.line).toMatchObject({ to: "people", types: ["SHOP_ORDER_PAID", "SHOP_ORDER_PLACED"], count: 1 });
    expect(shop.club).toBe(1);
  });

  it("names other people's email when the person got none, and a test address's apart from the people", () => {
    const erased = summarizeReceipt("registrations.erase", [row("WAITLIST_SPOT_OFFER"), row("WAITLIST_SPOT_OFFER", { clubCopy: true })], context());
    expect(erased.line).toMatchObject({ to: "others", types: ["WAITLIST_SPOT_OFFER"], count: 1 });
    expect(erased.others).toBeNull();

    const mixed = summarizeReceipt("events.save", [row("WAITLIST_SPOT_OFFER"), row("COMPLETE_DECLARATION")], context());
    expect(mixed.line).toMatchObject({ to: "others", types: [], count: 2 });

    const testOnly = summarizeReceipt("events.testRegistrations", [row("VERIFY_REGISTRATION_EMAIL", { test: true }), row("VERIFY_REGISTRATION_EMAIL", { test: true })], context());
    expect(testOnly.line).toMatchObject({ to: "test", types: ["VERIFY_REGISTRATION_EMAIL"], count: 2 });

    const withTest = summarizeReceipt("registrations.bulkCancel", [row("REGISTRATION_CANCELLED"), row("REGISTRATION_CANCELLED", { test: true })], context());
    expect(withTest.line).toMatchObject({ to: "people", count: 1 });
    expect(withTest.test).toBe(1);
  });

  it("is no line when the press queued nothing — the toast then says nothing about email", () => {
    const receipt = summarizeReceipt("events.save", [], context());
    expect(receipt.line).toBeNull();
    expect(receiptValues(receipt, NOW)).toEqual({});
  });
});

describe("the receipt of one press: when each part leaves", () => {
  it("says now for a press's «Trimite acum» and for the «imediat» timing's drain", () => {
    expect(summarizeReceipt("registrations.resend", [row("COMPLETE_DECLARATION", { sentNow: true })], context()).line?.when).toEqual({ kind: "now" });
    expect(summarizeReceipt("registrations.cancel", [row("REGISTRATION_CANCELLED")], context({ timing: "immediate" })).line?.when).toEqual({ kind: "now" });
  });

  it("says when Mailgun resumes while it is stopped and nothing carries the row, and never «now» for the drain then", () => {
    const reopens = new Date("2026-11-05T00:00:00.000Z");
    const stopped = context({ timing: "immediate", mailgunReopensAt: reopens });
    expect(summarizeReceipt("registrations.cancel", [row("REGISTRATION_CANCELLED")], stopped).line?.when.kind).toBe("reset");
    // A row Gmail carries does not wait for Mailgun.
    expect(summarizeReceipt("registrations.cancel", [row("REGISTRATION_CANCELLED", { onMailgunRoad: false })], stopped).line?.when).toEqual({ kind: "now" });
    // A press's own «Trimite acum» was asked with room to send.
    expect(summarizeReceipt("registrations.resend", [row("COMPLETE_DECLARATION", { sentNow: true })], stopped).line?.when).toEqual({ kind: "now" });
  });

  it("includes the volunteer roles' two-minute hold in the hour, and notes it", () => {
    const held = new Date(NOW.getTime() + 2 * 60_000);
    const receipt = summarizeReceipt("volunteers.assign", [row("VOLUNTEER_ROLE_ASSIGNED", { nextAttemptAt: held })], context({ nextTickAt: new Date(NOW.getTime() + 60_000) }));
    // The tick after the hold, not the tick a minute away.
    expect(receipt.line?.when.kind).toBe("at");
    expect((receipt.line?.when as { at: Date }).at.getTime()).toBeGreaterThanOrEqual(held.getTime());
    expect(receipt.line?.rolesHeld).toBe(true);
  });

  it("splits a send between two moments: the first, and how many leave later", () => {
    const rows = [...times(40, () => row("ORGANIZER_MESSAGE", { sentNow: true })), ...times(5, () => row("ORGANIZER_MESSAGE"))];
    const receipt = summarizeReceipt("events.participantMessage", rows, context());
    expect(receipt.line).toMatchObject({ count: 40, when: { kind: "now" }, later: { count: 5, when: { kind: "at", at: NEXT_TICK } } });
  });

  it("leaves the part of a newsletter today's room cannot hold for the next days, on Mailgun's road only", () => {
    const rows = times(10, () => row("NEWSLETTER"));
    expect(summarizeReceipt("club.newsletter", rows, context(), 4).line).toMatchObject({ count: 4, when: { kind: "at" }, later: { count: 6, when: { kind: "days" } } });
    expect(summarizeReceipt("club.newsletter", rows, context(), 0).line).toMatchObject({ count: 10, when: { kind: "days" }, later: null });
    expect(summarizeReceipt("club.newsletter", rows, context(), null).line).toMatchObject({ count: 10, later: null });
    expect(summarizeReceipt("club.newsletter", times(10, () => row("NEWSLETTER", { onMailgunRoad: false })), context(), 0).line).toMatchObject({ count: 10, later: null });
  });
});

describe("the receipt's flash values", () => {
  const receipt = summarizeReceipt(
    "registrations.cancel",
    [row("REGISTRATION_CANCELLED"), row("REGISTRATION_CANCELLED", { clubCopy: true }), row("WAITLIST_SPOT_OFFER"), row("REGISTRATION_CANCELLED", { test: true })],
    context(),
  );

  it("are tokens, counts and instants: what left, to how many, when", () => {
    expect(receiptValues(receipt, NOW, { road: "gmail" })).toEqual({
      mail: "at",
      mailAt: NEXT_TICK.toISOString(),
      mailTo: "people",
      mailPeople: "1",
      mailPressedAt: NOW.toISOString(),
      mailType: "REGISTRATION_CANCELLED",
      mailClub: "1",
      mailTest: "1",
      mailOthers: "1",
      mailOtherType: "WAITLIST_SPOT_OFFER",
      mailRoad: "gmail",
    });
    expect(receiptValues(summarizeReceipt("club.staffInvite", [row("STAFF_INVITATION")], context()), NOW, { zitadel: true }).mailZitadel).toBe("1");
  });

  it("carry no name and no address, and survive the flash cookie whole", () => {
    const values = receiptValues(receipt, NOW, { road: "mailgun" });
    expect(JSON.stringify(values)).not.toMatch(/@/);
    const notice = { kind: "success" as const, key: "registrationCancelled", values };
    expect(decodeFlash(encodeFlash(notice))).toEqual(notice);
  });
});
