import { describe, expect, it } from "vitest";
import {
  CAPACITY_HISTORY_ACTIONS,
  type CapacityAuditRow,
  capacityHistory,
  type HistoryEntry,
  type HistoryLine,
  inOrder,
  parseCapacityRow,
  registrationIdOf,
  WHY_KEYS,
  withGaps,
} from "@/modules/registrations/domain/capacity-history";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Istoric capacitate» (§NNN) — BR-REQ-034-02: every change of an event's places read back from the audit trail by
 * its plain action strings, tolerant of the rows written before the editor's writers existed and of any field nobody
 * wrote; in the order the changes took effect; with a line wherever the capacity changed without a row; and who did it.
 */
const BASE = Date.UTC(2026, 10, 3, 12, 0, 0);
let serial = 0;

/** An audit row `minutes` after the base instant; the id orders rows of one instant. */
function row(action: string, metadata: unknown, minutes: number, actorName: string | null = "Amalia"): CapacityAuditRow {
  serial += 1;
  return { id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`, action, at: new Date(BASE + minutes * 60_000), actorName, metadata };
}

const REGISTRATION = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const GONE = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const parse = (r: CapacityAuditRow, existing: ReadonlySet<string> = new Set()) => parseCapacityRow(r, existing) as HistoryEntry;
const kinds = (lines: readonly HistoryLine[]) => lines.map((line) => (line.kind === "gap" ? `gap ${line.from}→${line.to}` : line.kind === "places" ? `${line.field} ${line.from}→${line.to}` : line.kind));

describe("BR-REQ-034-02 «Istoric capacitate» reads the trail as it was written (§NNN)", () => {
  it("reads a supplementary place written before this screen: from, to and the registration, no version", () => {
    const entry = parse(row("event.capacity_raised_for_offer", { from: 175, to: 176, registrationId: REGISTRATION }, 0), new Set([REGISTRATION]));
    expect(entry).toMatchObject({ kind: "places", field: "capacity", from: 175, to: 176, why: "anyOffer", version: null, occupied: null, registrationId: REGISTRATION, registrationExists: true, forInvitation: false });
    expect(entry.who).toEqual({ kind: "staff", name: "Amalia" });
  });

  it("reads the richer shape: occupied, offers, why, the reason typed and the version", () => {
    const entry = parse(row("event.capacity_changed", { from: 175, to: 190, occupied: 175, offered: 3, via: "editor", reason: "  Încă 15 locuri   de la sponsor  ", version: 41 }, 0));
    expect(entry).toMatchObject({ kind: "places", field: "capacity", from: 175, to: 190, occupied: 175, offered: 3, why: "editor", reason: "Încă 15 locuri de la sponsor", version: 41 });
    // A reason is at most the 200 characters the editor takes, whatever was stored.
    expect((parse(row("event.capacity_changed", { from: 1, to: 2, reason: "x".repeat(500) }, 0)) as { reason: string }).reason).toHaveLength(200);
  });

  it("names the press a supplementary place was added for, from the row's via or the action", () => {
    const why = (action: string, via?: string) => (parse(row(action, { from: 1, to: 2, ...(via ? { via } : {}) }, 0)) as { why: string }).why;
    expect(why("event.capacity_raised_for_offer", "offer")).toBe("offer");
    expect(why("event.capacity_raised_for_offer", "offerNow")).toBe("offerNow");
    expect(why("event.capacity_raised_for_offer", "moveAndOffer")).toBe("moveAndOffer");
    expect(why("event.capacity_raised_for_place_now")).toBe("placeNow");
    expect(why("event.capacity_raised_for_invitation")).toBe("invitation");
    expect(parse(row("event.capacity_raised_for_invitation", { from: 1, to: 2, invitationId: REGISTRATION }, 0))).toMatchObject({ forInvitation: true, registrationId: null });
  });

  it("reads «fără limită» as null and anything unreadable as unknown, never throwing", () => {
    expect(parse(row("event.capacity_changed", { from: null, to: 120, via: "editor" }, 0))).toMatchObject({ from: null, to: 120 });
    for (const metadata of [null, [], "175", { from: "175", to: -1 }, { from: 1.5, to: Number.NaN }]) {
      expect(parse(row("event.capacity_changed", metadata, 0)), JSON.stringify(metadata)).toMatchObject({ kind: "places", from: undefined, to: undefined, why: null, reason: null, version: null });
    }
    expect(parse(row("event.places_kept_changed", { from: 0, to: 10, via: "editor", version: 7 }, 0))).toMatchObject({ field: "kept", from: 0, to: 10, version: 7 });
  });

  it("reads the switches and the release at the deadline", () => {
    expect(parse(row("event.free_places_by_offer_only_changed", { from: false, to: true, via: "deadline" }, 0, null))).toMatchObject({ kind: "setting", setting: "offersOnly", from: false, to: true, why: "deadline", who: { kind: "automatic" } });
    expect(parse(row("event.public_registration_changed", { from: true, to: false, via: "registrations" }, 0))).toMatchObject({ setting: "publicRegistration", from: true, to: false, why: "registrations" });
    expect(parse(row("event.places_alert_changed", { from: null, to: 10 }, 0))).toMatchObject({ setting: "placesAlert", from: null, to: 10 });
    expect(parse(row("event.waitlist_auto_offer_changed", { from: true, to: "no" }, 0))).toMatchObject({ setting: "autoOffer", from: true, to: undefined });
    expect(parse(row("event.release_unsigned_changed", { from: false, to: true }, 0))).toMatchObject({ setting: "releaseUnsigned", from: false, to: true });
    const released = parse(row("event.unsigned_released", { deadline: "2026-11-15T08:00:00.000Z", released: 12, test: 1, free: 14, waiting: 20, offerOnlyTicked: true }, 0, null));
    expect(released).toMatchObject({ kind: "released", released: 12, test: 1, free: 14, waiting: 20, offerOnlyTicked: true, who: { kind: "automatic" } });
    expect((released as { deadline: Date }).deadline.toISOString()).toBe("2026-11-15T08:00:00.000Z");
    expect(parse(row("event.unsigned_released", { deadline: "soon" }, 0, null))).toMatchObject({ deadline: null, released: null, offerOnlyTicked: false });
    expect(parseCapacityRow(row("event.emergency_sheet_viewed", {}, 0), new Set())).toBeNull();
  });

  it("says who: the staff member, «automat» for the job, «cont șters» for an account removed since", () => {
    expect(parse(row("event.capacity_changed", { from: 1, to: 2, via: "series_generated" }, 0, null)).who).toEqual({ kind: "automatic" });
    expect(parse(row("event.capacity_changed", { from: 1, to: 2, via: "editor" }, 0, null)).who).toEqual({ kind: "removed" });
    expect(parse(row("event.capacity_raised_for_place_now", { from: 1, to: 2 }, 0, null)).who).toEqual({ kind: "removed" });
    // The release names no via (the critic's correction 27): it is the job's by its action.
    expect(parse(row("event.unsigned_released", { released: 0 }, 0, null)).who).toEqual({ kind: "automatic" });
  });

  it("links a registration that still exists and says so of one erased since", () => {
    const existing = new Set([REGISTRATION]);
    expect(parse(row("event.capacity_raised_for_offer", { from: 1, to: 2, registrationId: GONE }, 0), existing)).toMatchObject({ registrationId: GONE, registrationExists: false });
    expect(parse(row("event.capacity_raised_for_offer", { from: 1, to: 2, registrationId: "not-an-id" }, 0), existing)).toMatchObject({ registrationId: null, registrationExists: null });
    expect(registrationIdOf({ registrationId: REGISTRATION.toUpperCase() })).toBe(REGISTRATION);
    expect(registrationIdOf(null)).toBeNull();
  });
});

describe("BR-REQ-034-02 «Istoric capacitate» in the order the changes took effect (§NNN)", () => {
  it("orders by time, then the versioned rows by version in the places such rows hold", () => {
    // The raise read its clock before waiting for the lock: stamped first, it took effect after the editor's save.
    const raise = row("event.capacity_raised_for_offer", { from: 190, to: 191, version: 42 }, 0);
    const save = row("event.capacity_changed", { from: 175, to: 190, version: 41 }, 0.01);
    const switched = row("event.public_registration_changed", { from: true, to: false }, 0.005);
    const old = row("event.capacity_raised_for_offer", { from: 174, to: 175 }, -60);
    expect(inOrder([raise, save, switched, old].map((r) => parse(r))).map((entry) => entry.id)).toEqual([old.id, save.id, switched.id, raise.id]);
  });

  it("keeps the rows of one version in their order by time", () => {
    const capacity = row("event.capacity_changed", { from: 175, to: 185, version: 9 }, 0);
    const kept = row("event.places_kept_changed", { from: 0, to: 10, version: 9 }, 0);
    expect(inOrder([kept, capacity].map((r) => parse(r))).map((entry) => entry.id)).toEqual([capacity.id, kept.id]);
  });
});

describe("BR-REQ-034-02 «Istoric capacitate» says where the capacity changed without a row (§NNN)", () => {
  it("puts a gap between two rows that do not join, and one against the capacity of now", () => {
    const lines = withGaps(
      [
        parse(row("event.capacity_raised_for_offer", { from: 175, to: 176 }, 0)),
        parse(row("event.places_kept_changed", { from: 0, to: 10 }, 1)),
        parse(row("event.capacity_raised_for_place_now", { from: 180, to: 181 }, 2)),
        parse(row("event.capacity_changed", { from: 181, to: 190, version: 50 }, 3)),
      ],
      200,
    );
    expect(kinds(lines)).toEqual(["capacity 175→176", "kept 0→10", "gap 176→180", "capacity 180→181", "capacity 181→190", "gap 190→200"]);
  });

  it("claims no gap across a row it cannot read, nor before the first row, nor when nothing changed since", () => {
    const lines = withGaps(
      [
        parse(row("event.capacity_raised_for_offer", { from: 175, to: 176 }, 0)),
        parse(row("event.capacity_changed", { garbled: true }, 1)),
        parse(row("event.capacity_raised_for_offer", { from: 190, to: 191 }, 2)),
      ],
      191,
    );
    expect(lines.some((line) => line.kind === "gap")).toBe(false);
    expect(withGaps([parse(row("event.capacity_changed", { from: 100, to: null }, 0))], null).some((line) => line.kind === "gap")).toBe(false);
    expect(kinds(withGaps([parse(row("event.capacity_changed", { from: null, to: 150 }, 0))], null))).toEqual(["capacity null→150", "gap 150→null"]);
    expect(withGaps([], 175)).toEqual([]);
  });

  it("gives the history newest first, its count and when it last changed", () => {
    const history = capacityHistory(
      [
        row("event.capacity_raised_for_offer", { from: 176, to: 177 }, 5),
        row("event.capacity_raised_for_offer", { from: 175, to: 176 }, 0),
        row("event.public_registration_changed", { from: true, to: false }, 9),
      ],
      { current: 190 },
    );
    expect(kinds(history.lines)).toEqual(["gap 177→190", "setting", "capacity 176→177", "capacity 175→176"]);
    expect(history.count).toBe(3);
    expect(history.lastAt?.getTime()).toBe(BASE + 9 * 60_000);
    expect(history.current).toBe(190);
    expect(history.limited).toBe(false);
    expect(capacityHistory([], { current: null, limited: true })).toEqual({ lines: [], count: 0, lastAt: null, current: null, limited: true });
  });
});

describe("BR-REQ-040-04 the history's words in both languages (§NNN)", () => {
  it("names every why, every switch and every action it reads", () => {
    for (const catalogue of [ro, en]) {
      const words = (catalogue.Admin as unknown as { capacityHistory: { why: Record<string, string>; what: Record<string, string> } }).capacityHistory;
      expect(Object.keys(words.why).sort()).toEqual([...WHY_KEYS].sort());
      for (const key of ["capacity", "kept", "released", "publicRegistration", "offersOnly", "placesAlert", "autoOffer", "releaseUnsigned"]) expect(words.what[key], key).toBeTruthy();
    }
    expect(new Set(CAPACITY_HISTORY_ACTIONS).size).toBe(CAPACITY_HISTORY_ACTIONS.length);
  });
});
