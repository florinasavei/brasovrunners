import { describe, expect, it } from "vitest";
import {
  publicVolunteerName,
  VOLUNTEERS_LIST_NAMES_SHOWN,
  type VolunteerListRow,
  type VolunteersListGate,
  volunteersListExpired,
  volunteersListState,
  volunteersListView,
} from "@/modules/volunteers/domain/public-list";

/**
 * §NNN — the volunteers' public list (BR-REQ-039-01, BR-REQ-050-02; the disclosure rule of §143 and §396 reaching volunteers): the pure gate
 * and the rule that names a person. A public name is a disclosure: only a CONFIRMED volunteer who ticked «Vreau să apar pe lista publică a
 * voluntarilor» under a privacy notice that described the list (the first such version or a later one) is named; everyone else is a count.
 */
const DAY = 86_400_000;
const NOW = new Date("2026-10-19T10:00:00.000Z");

const row = (over: Partial<VolunteerListRow> = {}): VolunteerListRow => ({
  state: "CONFIRMED",
  name: "Ana Popescu",
  listOptIn: true,
  privacyNoticeVersion: 3,
  roleNameRo: "Punct de apă",
  roleNameEn: "Water point",
  ...over,
});

const gate = (over: Partial<VolunteersListGate> = {}): VolunteersListGate => ({
  listPublic: true,
  acceptsVolunteers: true,
  noticeDescribes: true,
  published: true,
  membersOnly: false,
  offerOpen: true,
  named: 1,
  startsAt: new Date(NOW.getTime() + 10 * DAY),
  now: NOW,
  ...over,
});

describe("§NNN publicVolunteerName — who may be named", () => {
  const input = (over: Partial<Parameters<typeof publicVolunteerName>[0]> = {}) => ({ ...row(), firstListNoticeVersion: 3, ...over });

  it("names a confirmed volunteer who ticked under the first notice that described the list", () => {
    expect(publicVolunteerName(input())).toBe("Ana Popescu");
  });

  it("names one who ticked under a later notice too", () => {
    expect(publicVolunteerName(input({ privacyNoticeVersion: 4 }))).toBe("Ana Popescu");
  });

  it("does not name one who did not tick", () => {
    expect(publicVolunteerName(input({ listOptIn: false }))).toBeNull();
  });

  it("does not name one whose tick was given under an older notice that said nothing about the list", () => {
    expect(publicVolunteerName(input({ privacyNoticeVersion: 2 }))).toBeNull();
  });

  it("does not name anyone while no approved notice has described the list yet", () => {
    expect(publicVolunteerName(input({ firstListNoticeVersion: null }))).toBeNull();
  });

  it("does not name a tick that recorded no notice at all", () => {
    expect(publicVolunteerName(input({ privacyNoticeVersion: null }))).toBeNull();
  });

  it("does not name a person nobody confirmed, or one who withdrew", () => {
    expect(publicVolunteerName(input({ state: "REGISTERED" }))).toBeNull();
    expect(publicVolunteerName(input({ state: "CANCELLED" }))).toBeNull();
  });

  it("does not name a blank name, and reads a name's spaces as one", () => {
    expect(publicVolunteerName(input({ name: "   " }))).toBeNull();
    expect(publicVolunteerName(input({ name: "  Ana   Maria  Popescu " }))).toBe("Ana Maria Popescu");
  });
});

describe("§NNN volunteersListView — the names, the role given and the count", () => {
  it("lists the named in the order given, with the role in both languages, and counts the unticked as «și încă N»", () => {
    const view = volunteersListView(
      [
        row({ name: "Ana Popescu" }),
        row({ name: "Ion Ionescu", listOptIn: false, roleNameRo: null, roleNameEn: null }),
        row({ name: "Maria Test", roleNameRo: null, roleNameEn: null }),
        row({ name: "Cineva Anulat", state: "CANCELLED" }),
        row({ name: "Cineva Neconfirmat", state: "REGISTERED" }),
      ],
      3,
    );
    expect(view.named).toEqual([
      { name: "Ana Popescu", roleNameRo: "Punct de apă", roleNameEn: "Water point" },
      // A person with no role given is named without one: their own wish list is not shown.
      { name: "Maria Test", roleNameRo: null, roleNameEn: null },
    ]);
    // Three confirmed people: two named, one only counted. The cancelled and the unconfirmed are nobody.
    expect(view.count).toBe(3);
    expect(view.others).toBe(1);
  });

  it("names nobody and counts everybody while no notice has described the list", () => {
    const view = volunteersListView([row(), row({ name: "Ion" })], null);
    expect(view).toEqual({ count: 2, named: [], others: 2 });
  });

  it("names nobody whose tick predates the notice that described the list, and counts them", () => {
    const view = volunteersListView([row({ privacyNoticeVersion: 1 }), row({ name: "Ion", privacyNoticeVersion: 5 })], 3);
    expect(view.named.map((person) => person.name)).toEqual(["Ion"]);
    expect(view.others).toBe(1);
  });

  it("caps the names it lists and counts the rest among the others", () => {
    const many = Array.from({ length: VOLUNTEERS_LIST_NAMES_SHOWN + 5 }, (_, index) => row({ name: `Voluntar ${index}` }));
    const view = volunteersListView(many, 3);
    expect(view.named).toHaveLength(VOLUNTEERS_LIST_NAMES_SHOWN);
    expect(view.count).toBe(VOLUNTEERS_LIST_NAMES_SHOWN + 5);
    expect(view.others).toBe(5);
  });

  it("carries nothing a public page could leak: a name, a role and a count", () => {
    const view = volunteersListView([row({ name: "Ana Popescu" })], 3);
    expect(Object.keys(view).sort()).toEqual(["count", "named", "others"]);
    expect(Object.keys(view.named[0]).sort()).toEqual(["name", "roleNameEn", "roleNameRo"]);
  });
});

describe("§NNN volunteersListState — does the page draw the card, and in which shape", () => {
  it("draws the list when the club's tick is on, the notice describes it and somebody may be named", () => {
    expect(volunteersListState(gate())).toBe("list");
  });

  it("draws nothing while the club's tick is off — the default", () => {
    expect(volunteersListState(gate({ listPublic: false }))).toBe("hidden");
  });

  it("draws nothing while the notice in force does not describe the list, whoever ticked", () => {
    expect(volunteersListState(gate({ noticeDescribes: false }))).toBe("hidden");
    expect(volunteersListState(gate({ noticeDescribes: false, named: 0 }))).toBe("hidden");
  });

  it("draws nothing once the event no longer takes volunteers, is a draft or is for the members alone", () => {
    expect(volunteersListState(gate({ acceptsVolunteers: false }))).toBe("hidden");
    expect(volunteersListState(gate({ published: false }))).toBe("hidden");
    expect(volunteersListState(gate({ membersOnly: true }))).toBe("hidden");
  });

  it("says only that the team is forming when nobody ticked and the offer is open", () => {
    expect(volunteersListState(gate({ named: 0, offerOpen: true }))).toBe("forming");
  });

  it("draws nothing when nobody ticked and the offer is closed", () => {
    expect(volunteersListState(gate({ named: 0, offerOpen: false }))).toBe("hidden");
  });

  it("stops drawing the card on the day the volunteers' rows may be deleted, thirty days after the start", () => {
    const startsAt = new Date(NOW.getTime() - 29 * DAY);
    expect(volunteersListExpired(startsAt, NOW)).toBe(false);
    expect(volunteersListState(gate({ startsAt }))).toBe("list");
    const old = new Date(NOW.getTime() - 30 * DAY);
    expect(volunteersListExpired(old, NOW)).toBe(true);
    expect(volunteersListState(gate({ startsAt: old }))).toBe("hidden");
  });

  it("has no expiry for an event whose date is still to be announced", () => {
    expect(volunteersListExpired(null, NOW)).toBe(false);
    expect(volunteersListState(gate({ startsAt: null }))).toBe("list");
  });
});
