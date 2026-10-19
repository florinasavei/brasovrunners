import { describe, expect, it } from "vitest";
import {
  invitationExpiry,
  invitationStandingOf,
  mayVolunteerWith,
  parseInvitationAddresses,
  readVolunteersAccess,
  VOLUNTEERS_ACCESS,
  volunteerDoorFor,
  VolunteerInvitationRefusal,
  type InviteReading,
  type VolunteersAccess,
} from "@/modules/volunteers/domain/access";

/**
 * §820 — who may offer as a volunteer, as pure rules (BR-REQ-060-01, BR-REQ-036-02): the three choices, the door each opens for a
 * stranger, a member and a person holding an emailed link, the standing of an invitation, and the box of addresses. The server's
 * second asking of the same rule (`mayVolunteerWith`) is held to the first (`volunteerDoorFor`) here.
 */
const NOW = new Date("2026-10-19T10:00:00.000Z");
const EARLIER = new Date(NOW.getTime() - 60_000);

describe("§820 the choice", () => {
  it("is a closed set of three, «Oricine» first, and anything else is none", () => {
    expect(VOLUNTEERS_ACCESS).toEqual(["ANYONE", "MEMBERS", "INVITED"]);
    for (const value of VOLUNTEERS_ACCESS) expect(readVolunteersAccess(value)).toBe(value);
    for (const value of ["anyone", "ALL", "", null, undefined, 3, {}]) expect(readVolunteersAccess(value)).toBeNull();
  });
});

describe("§820 the door the volunteers' page opens", () => {
  const readings: InviteReading[] = [{ standing: "open" }, { standing: "used" }, { standing: "withdrawn" }, { standing: "expired" }, { standing: "invalid" }];

  it("«Oricine»: the form for everybody — a stranger, a member — and a link that no longer works does not shut it, it says so above it", () => {
    expect(volunteerDoorFor({ access: "ANYONE", member: false, invite: null })).toEqual({ kind: "open" });
    expect(volunteerDoorFor({ access: "ANYONE", member: true, invite: null })).toEqual({ kind: "open" });
    expect(volunteerDoorFor({ access: "ANYONE", member: false, invite: { standing: "used" } })).toEqual({ kind: "open", refused: "used" });
    // A link that names nothing has nothing to say where the form needed none.
    expect(volunteerDoorFor({ access: "ANYONE", member: false, invite: { standing: "invalid" } })).toEqual({ kind: "open" });
  });

  it("«Doar membrii»: the form for a member, a sentence and the sign-in for a stranger — never the form — whatever a dead link says", () => {
    expect(volunteerDoorFor({ access: "MEMBERS", member: true, invite: null })).toEqual({ kind: "member" });
    expect(volunteerDoorFor({ access: "MEMBERS", member: false, invite: null })).toEqual({ kind: "signIn" });
    expect(volunteerDoorFor({ access: "MEMBERS", member: true, invite: { standing: "withdrawn" } })).toEqual({ kind: "member", refused: "withdrawn" });
    expect(volunteerDoorFor({ access: "MEMBERS", member: false, invite: { standing: "expired" } })).toEqual({ kind: "signIn", refused: "expired" });
    expect(volunteerDoorFor({ access: "MEMBERS", member: false, invite: { standing: "invalid" } })).toEqual({ kind: "signIn" });
  });

  it("«Doar cu invitație»: 404 without a link or with one that names nothing, whoever asks — a member included; a spent, withdrawn or run-out link says which", () => {
    expect(volunteerDoorFor({ access: "INVITED", member: false, invite: null })).toEqual({ kind: "closed" });
    expect(volunteerDoorFor({ access: "INVITED", member: true, invite: null })).toEqual({ kind: "closed" });
    expect(volunteerDoorFor({ access: "INVITED", member: false, invite: { standing: "invalid" } })).toEqual({ kind: "closed" });
    for (const reason of ["used", "withdrawn", "expired"] as const) {
      expect(volunteerDoorFor({ access: "INVITED", member: false, invite: { standing: reason } })).toEqual({ kind: "inviteRefused", reason });
    }
  });

  it("a live invitation is a door in every choice; every other reading leaves the choice's own door, with the reason above it where there is one to give", () => {
    for (const access of VOLUNTEERS_ACCESS) {
      for (const member of [false, true]) {
        for (const reading of readings) {
          const door = volunteerDoorFor({ access, member, invite: reading });
          if (reading?.standing === "open") {
            expect(door).toEqual({ kind: "invite" });
            continue;
          }
          const own = volunteerDoorFor({ access, member, invite: null });
          const reason = reading?.standing === "invalid" ? undefined : reading?.standing;
          if (access === "INVITED") expect(door).toEqual(reason ? { kind: "inviteRefused", reason } : own);
          else expect(door).toEqual(reason ? { ...own, refused: reason } : own);
        }
      }
    }
  });

  it("is the same rule the server asks again: it accepts a post exactly where the page drew a form, with no link or with a live one", () => {
    for (const access of VOLUNTEERS_ACCESS as readonly VolunteersAccess[]) {
      for (const member of [false, true]) {
        for (const invite of [null, { standing: "open" } as const]) {
          const door = volunteerDoorFor({ access, member, invite });
          const formDrawn = door.kind === "open" || door.kind === "member" || door.kind === "invite";
          expect(mayVolunteerWith({ access, member, invite: invite !== null }), `${access} member=${member} link=${invite !== null}`).toBe(formDrawn);
        }
      }
    }
  });
});

describe("§820 where an invitation stands", () => {
  const open = { usedAt: null, withdrawnAt: null };
  it("is two stamps and the event's own state: open, used, withdrawn, expired — used first, then withdrawn, then the event", () => {
    expect(invitationStandingOf(open, true)).toBe("open");
    expect(invitationStandingOf({ ...open, usedAt: EARLIER }, true)).toBe("used");
    expect(invitationStandingOf({ ...open, withdrawnAt: EARLIER }, true)).toBe("withdrawn");
    expect(invitationStandingOf(open, false)).toBe("expired");
    // A spent link says so even after the event, and a withdrawn one before it says it ran out.
    expect(invitationStandingOf({ usedAt: EARLIER, withdrawnAt: EARLIER }, false)).toBe("used");
    expect(invitationStandingOf({ usedAt: null, withdrawnAt: EARLIER }, false)).toBe("withdrawn");
  });

  it("records, at the send, the event's end — its start with no end, a year for a date still to be announced (a record: the standing asks the event)", () => {
    const start = new Date("2026-11-21T08:00:00.000Z");
    const end = new Date("2026-11-21T14:00:00.000Z");
    expect(invitationExpiry({ startsAt: start, endsAt: end }, NOW)).toEqual(end);
    expect(invitationExpiry({ startsAt: start, endsAt: null }, NOW)).toEqual(start);
    expect(invitationExpiry({ startsAt: null, endsAt: null }, NOW).getTime() - NOW.getTime()).toBe(365 * 24 * 60 * 60_000);
  });
});

describe("§820 «Adrese (una pe rând)»", () => {
  it("reads one address per line, and commas, semicolons and spaces as line ends, once by identity, in the order typed", () => {
    const read = parseInvitationAddresses("Ioana@Example.test\n andrei@example.test, ioana@example.test;vlad+club@gmail.com  \n\n");
    expect(read.unread).toEqual([]);
    expect(read.addresses.map((address) => address.canonicalEmail)).toEqual(["ioana@example.test", "andrei@example.test", "vlad@gmail.com"]);
    // The address is kept as typed where the email goes.
    expect(read.addresses[2].deliveryEmail).toBe("vlad+club@gmail.com");
    expect(read.addresses.every((address) => address.canonicalizationVersion >= 1)).toBe(true);
  });

  it("returns the pieces it cannot read, as typed and cut to a short length, and still reads the rest", () => {
    const read = parseInvitationAddresses(`bun@example.test nu-e-adresa ${"x".repeat(200)}`);
    expect(read.addresses).toHaveLength(1);
    expect(read.unread).toHaveLength(2);
    expect(read.unread[0]).toBe("nu-e-adresa");
    expect(read.unread[1].length).toBeLessThanOrEqual(80);
  });

  it("refuses by a marker and carries the lines it could not read, never an address that was read", () => {
    const refusal = new VolunteerInvitationRefusal("VINVITE_BAD_ADDRESS", ["nu-e-adresa"]);
    expect(refusal).toMatchObject({ code: "VALIDATION_ERROR", refusal: "VINVITE_BAD_ADDRESS", unread: ["nu-e-adresa"], fields: ["VINVITE_BAD_ADDRESS"] });
    expect(new VolunteerInvitationRefusal("VINVITE_NOBODY").unread).toEqual([]);
  });
});
