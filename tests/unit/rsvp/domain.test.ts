import { describe, expect, it } from "vitest";
import { cleanDisplayName, identityOf, isConsistent, isVerifiedSource, RSVP_NAME_MAX, RSVP_SOURCES, type RsvpIdentity } from "@/modules/rsvp/domain/identity";
import { islandFace, rememberedHeading } from "@/modules/rsvp/domain/island";
import { type RsvpGateInput, rsvpOffered } from "@/modules/rsvp/domain/offered";
import { publicRsvpName } from "@/modules/rsvp/domain/public-name";
import { parseRsvpOutcome, RSVP_BOX_ID, RSVP_OUTCOME_QUERY } from "@/modules/rsvp/rsvp-box";

/**
 * §811 («Vin!» part 1) — the pure rules: the one gate, the identity's sources, the name a public count may carry, the box's outcomes.
 * The service that uses them is proved in `tests/integration/rsvp/`.
 */
const NOW = new Date("2026-10-20T10:00:00.000Z");
const ahead = new Date("2026-10-22T15:30:00.000Z");
const offered: RsvpGateInput = {
  publishedAt: new Date("2026-10-01T00:00:00.000Z"),
  eventStatus: "SCHEDULED",
  registrationMode: "NONE",
  startsAt: ahead,
  rsvpEnabled: true,
};

describe("§811 rsvpOffered — the one gate", () => {
  it("offers «Vin!» on a published, scheduled, upcoming turn-up event the club ticked, under a notice that describes it", () => {
    expect(rsvpOffered(offered, NOW, true)).toBe(true);
  });

  it.each([
    ["the notice in force does not describe it", { ...offered }, false],
    ["the event is not published", { ...offered, publishedAt: null }, true],
    ["the event is cancelled", { ...offered, eventStatus: "CANCELLED" as const }, true],
    ["the event is completed", { ...offered, eventStatus: "COMPLETED" as const }, true],
    ["the event takes registrations on the site", { ...offered, registrationMode: "INTERNAL" as const }, true],
    ["the event sends people to somebody else's registration", { ...offered, registrationMode: "EXTERNAL" as const }, true],
    ["the club did not tick it", { ...offered, rsvpEnabled: false }, true],
    ["a page that predates the field says nothing of it", { ...offered, rsvpEnabled: undefined }, true],
    ["the start is not announced (no date)", { ...offered, startsAt: null }, true],
    ["the date is to be announced", { ...offered, dateToBeAnnounced: true }, true],
    ["only the time is to be announced", { ...offered, timeToBeAnnounced: true }, true],
    ["the start has passed", { ...offered, startsAt: new Date(NOW.getTime() - 60_000) }, true],
    ["the start is this very instant", { ...offered, startsAt: NOW }, true],
  ])("shows nothing when %s", (_why, event, noticeDescribes) => {
    expect(rsvpOffered(event, NOW, noticeDescribes)).toBe(false);
  });

  it("is a function of its arguments: the same event is offered before the start and not after", () => {
    expect(rsvpOffered(offered, new Date(ahead.getTime() - 1), true)).toBe(true);
    expect(rsvpOffered(offered, ahead, true)).toBe(false);
  });
});

describe("§811 the identity — a source and a verified flag, never a bare address", () => {
  const parts = { email: "ana@example.test", showName: false, locale: "ro" as const };

  it("knows four sources, and only the typed form proves nothing", () => {
    expect([...RSVP_SOURCES]).toEqual(["page", "remembered", "account", "link"]);
    expect(RSVP_SOURCES.filter((source) => !isVerifiedSource(source))).toEqual(["page"]);
  });

  it("builds the flag from the source, so a caller cannot claim more than the source proved", () => {
    expect(identityOf("page", parts).verified).toBe(false);
    for (const source of ["remembered", "account", "link"] as const) expect(identityOf(source, parts).verified).toBe(true);
  });

  it("refuses an identity whose flag says more or less than its source proves", () => {
    const typed: RsvpIdentity = { ...parts, source: "page", verified: true };
    const remembered: RsvpIdentity = { ...parts, source: "remembered", verified: false };
    expect(isConsistent(typed)).toBe(false);
    expect(isConsistent(remembered)).toBe(false);
    expect(isConsistent(identityOf("account", parts))).toBe(true);
  });

  it("keeps a shown name tidy: trimmed, one space, at most eighty characters, empty is none", () => {
    expect(cleanDisplayName("  Ana   Maria\tPopescu ")).toBe("Ana Maria Popescu");
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName(null)).toBeNull();
    expect(cleanDisplayName(undefined)).toBeNull();
    expect(cleanDisplayName("x".repeat(200))).toHaveLength(RSVP_NAME_MAX);
  });
});

describe("§811 publicRsvpName — a public name is a disclosure (§143, §396)", () => {
  const confirmed = { confirmed: true, showName: true, displayName: "Ana Popescu", privacyNoticeVersion: 3, firstRsvpNoticeVersion: 3 };

  it("names a confirmed answer whose person ticked, under the first notice that described «Vin!» or a later one", () => {
    expect(publicRsvpName(confirmed)).toBe("Ana Popescu");
    expect(publicRsvpName({ ...confirmed, privacyNoticeVersion: 7 })).toBe("Ana Popescu");
    expect(publicRsvpName({ ...confirmed, displayName: "  Ana  " })).toBe("Ana");
  });

  it.each([
    ["the person did not tick", { ...confirmed, showName: false }],
    ["the address never used the link", { ...confirmed, confirmed: false }],
    ["the tick was given under an older notice", { ...confirmed, privacyNoticeVersion: 2 }],
    ["no notice ever described «Vin!»", { ...confirmed, firstRsvpNoticeVersion: null }],
    ["there is no name", { ...confirmed, displayName: null }],
    ["the name is blank", { ...confirmed, displayName: "   " }],
  ])("shows no name when %s", (_why, row) => {
    expect(publicRsvpName(row)).toBeNull();
  });
});

describe("§812 which face the island shows", () => {
  it("falls back to the typed form without a hint, when the state could not be read, or when the server no longer backs the browser", () => {
    expect(islandFace({ hasHint: false, readFailed: false, state: null })).toBe("typed");
    expect(islandFace({ hasHint: true, readFailed: true, state: null })).toBe("typed");
    expect(islandFace({ hasHint: true, readFailed: false, state: { remembered: false } })).toBe("typed");
    expect(islandFace({ hasHint: true, readFailed: false, state: { remembered: true, offered: false } })).toBe("typed");
  });

  it("stays on the one-tap face while the state is pending and once it is known — a failed PRESS is not a reason to leave it, so its alert can be seen", () => {
    expect(islandFace({ hasHint: true, readFailed: false, state: null })).toBe("onetap");
    expect(islandFace({ hasHint: true, readFailed: false, state: { remembered: true, offered: true } })).toBe("onetap");
  });
});

describe("§811 the island's heading and the box's outcomes", () => {
  it("answers as the masked address, the name first when the person gave one", () => {
    expect(rememberedHeading({ masked: "an…@gmail.com", name: null })).toBe("an…@gmail.com");
    expect(rememberedHeading({ masked: "an…@gmail.com", name: "Ana" })).toBe("Ana · an…@gmail.com");
  });

  it("reads the typed form's outcome from \`?vin=\` and nothing else", () => {
    expect(RSVP_BOX_ID).toBe("vin");
    expect(parseRsvpOutcome("1")).toBe("sent");
    expect(parseRsvpOutcome("retras")).toBe("withdrawSent");
    expect(parseRsvpOutcome("invalid")).toBe("invalid");
    expect(parseRsvpOutcome("captcha")).toBe("captcha");
    for (const stray of [undefined, "", "0", "yes", "SENT"]) expect(parseRsvpOutcome(stray)).toBeNull();
    // Every outcome round-trips through the query it travels as.
    for (const [outcome, query] of Object.entries(RSVP_OUTCOME_QUERY)) expect(parseRsvpOutcome(query)).toBe(outcome);
  });
});
