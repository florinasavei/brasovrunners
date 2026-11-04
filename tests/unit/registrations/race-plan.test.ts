import { describe, expect, it } from "vitest";
import { resolveLocaleSwitch } from "@/modules/events/locale-switch";
import { computeOccupied, type OccupiedCounts, placesTaken } from "@/modules/registrations/domain/capacity";
import {
  breakdownOf,
  kitsNow,
  ORDER_PART_KEYS,
  orderTotals,
  outsideOf,
  PLAN_ROW_KEYS,
  type PlanRow,
  type RacePlanBreakdown,
  type RacePlanInput,
  racePlanRows,
  type RegistrationGroup,
  runnersOf,
} from "@/modules/registrations/domain/race-plan";
import { placeOutlook } from "@/modules/registrations/domain/place-outlook";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Planul locurilor» (§NNN) — the arithmetic of «Pe categorii» and «De comandat», BR-REQ-034-02: inside the places
 * the kinds are the allocator's own and add up to the places taken; nobody outside the places — a special guest, an
 * invitation «Pe lista de invitați speciali», an elite line, a volunteer — is ever counted among them; the runners are
 * the places taken, the special guests and the elite list's lines, a registration marked elite once; and the totals to
 * order are the sum of the parts the page writes out, the elite list's lines among them.
 */
const NONE: RacePlanBreakdown = { eliteConfirmed: 0, eliteDeclaration: 0, outsideConfirmed: 0, outsideDeclaration: 0, outsideOffered: 0, waiting: 0, test: 0 };

/** A plan's input from the allocator's counts, the way `readRacePlan` builds it from `readPlaceOutlook`. */
function inputFrom(capacity: number, counts: OccupiedCounts, extra: Partial<RacePlanInput> = {}): RacePlanInput {
  const outlook = placeOutlook({ ...placesTaken(capacity, counts), occupied: computeOccupied(counts), waiting: 4, internal: 2, outside: 3 });
  return {
    capacity,
    taken: { confirmed: outlook.confirmed, declaration: outlook.declaration, offered: outlook.offered, invited: outlook.invited, family: outlook.family, occupied: outlook.occupied },
    free: outlook.free,
    waiting: outlook.waiting,
    internal: outlook.internal,
    outside: outlook.outside,
    lapsed: 0,
    breakdown: NONE,
    outsideInvitations: 0,
    eliteEntries: 0,
    volunteersWithKit: 0,
    ...extra,
  };
}

const count = (rows: readonly PlanRow[], key: string) => rows.find((row) => row.key === key)?.count;
const TOP = ["confirmed", "declaration", "offered", "invited", "family"];

describe("BR-REQ-034-02 «Pe categorii» (§NNN)", () => {
  const counts: OccupiedCounts = { confirmed: 150, pendingDeclarationHolds: 9, unexpiredWaitlistOfferedHolds: 2, familyReservations: 1, familyPlaceHolds: 1, invitationHolds: 2 };

  it("adds the five kinds up to the places taken, and the places taken and the free ones up to the capacity", () => {
    const rows = racePlanRows(inputFrom(175, counts));
    const kinds = rows.inside.filter((row) => TOP.includes(row.key));
    expect(kinds.map((row) => row.key)).toEqual(TOP);
    expect(kinds.reduce((sum, row) => sum + (row.count ?? 0), 0)).toBe(count(rows.inside, "occupied"));
    expect(count(rows.inside, "occupied")).toBe(computeOccupied(counts));
    expect(count(rows.inside, "family")).toBe(2);
    expect((count(rows.inside, "occupied") ?? 0) + (count(rows.inside, "free") ?? 0)).toBe(count(rows.inside, "capacity"));
    expect(rows.inside.find((row) => row.key === "occupied")?.total).toBe(true);
    expect(rows.inside.find((row) => row.key === "capacity")?.total).toBe(true);
  });

  it("never counts anybody outside the places among the places taken", () => {
    const lone = racePlanRows(inputFrom(175, counts));
    const crowded = racePlanRows(
      inputFrom(175, counts, {
        outside: 12,
        breakdown: { ...NONE, outsideConfirmed: 7, outsideDeclaration: 3, outsideOffered: 2 },
        outsideInvitations: 4,
        eliteEntries: 6,
        volunteersWithKit: 33,
      }),
    );
    expect(crowded.inside).toEqual(lone.inside);
    expect(count(crowded.outside, "outside")).toBe(12);
    // The special guests by state, each part of the line above it, adding up to it.
    const parts = crowded.outside.filter((row) => row.part);
    expect(parts.map((row) => row.key)).toEqual(["outsideConfirmed", "outsideDeclaration", "outsideOffered"]);
    expect(parts.reduce((sum, row) => sum + (row.count ?? 0), 0)).toBe(12);
    expect(count(crowded.outside, "outsideInvitations")).toBe(4);
    expect(count(crowded.outside, "eliteEntries")).toBe(6);
    expect(count(crowded.outside, "volunteersWithKit")).toBe(33);
    expect(crowded.lists.map((row) => [row.key, row.count])).toEqual([
      ["waiting", 4],
      ["internal", 2],
    ]);
  });

  it("counts every runner: the places taken, the special guests and the elite list's lines — never a volunteer", () => {
    const rows = racePlanRows(inputFrom(175, counts, { outside: 12, outsideInvitations: 4, eliteEntries: 6, volunteersWithKit: 33 }));
    expect(rows.runners).toEqual([
      { key: "runnersNow", count: 165 + 12 + 6, total: true },
      // If every place fills: the capacity, the special guests, their invitations not yet answered, the elite lines.
      { key: "runnersIfFull", count: 175 + 12 + 4 + 6, total: true },
    ]);
    // The capacity lowered under the places taken: every one of those still runs.
    expect(count(racePlanRows(inputFrom(150, counts, { eliteEntries: 6 })).runners, "runnersIfFull")).toBe(165 + 3 + 6);
    // With no limit, only the runners of now.
    expect(racePlanRows({ ...inputFrom(175, counts, { eliteEntries: 6 }), capacity: null, free: null }).runners).toEqual([{ key: "runnersNow", count: 165 + 3 + 6, total: true }]);
  });

  it("counts a registration marked elite once, in its place: «din care elită» is a part, never added", () => {
    const plain = racePlanRows(inputFrom(175, counts, { eliteEntries: 2 }));
    const marked = racePlanRows(inputFrom(175, counts, { eliteEntries: 2, breakdown: { ...NONE, eliteConfirmed: 5, eliteDeclaration: 1 } }));
    expect(marked.runners).toEqual(plain.runners);
    expect(count(marked.inside, "occupied")).toBe(count(plain.inside, "occupied"));
    expect(count(marked.runners, "runnersNow")).toBe(165 + 3 + 2);
  });

  it("says «din care …» only when it has something to say, and never more than the line it is part of", () => {
    const quiet = racePlanRows(inputFrom(175, counts));
    expect(quiet.inside.some((row) => row.part)).toBe(false);
    const said = racePlanRows(inputFrom(175, counts, { lapsed: 40, breakdown: { ...NONE, eliteConfirmed: 5, eliteDeclaration: 1 } }));
    expect(said.inside.map((row) => row.key)).toEqual(["confirmed", "eliteConfirmed", "declaration", "lapsed", "eliteDeclaration", "offered", "invited", "family", "occupied", "free", "capacity"]);
    // A read between the two queries cannot make «cu termenul trecut» say more than the holds to sign.
    expect(count(said.inside, "lapsed")).toBe(9);
    expect(count(said.inside, "eliteConfirmed")).toBe(5);
    expect(said.inside.filter((row) => row.part).map((row) => row.key)).toEqual(["eliteConfirmed", "lapsed", "eliteDeclaration"]);
  });

  it("has no free places to count for an event with no limit, and says the capacity as «fără limită»", () => {
    const rows = racePlanRows({ ...inputFrom(175, counts), capacity: null, free: null });
    expect(rows.inside.some((row) => row.key === "free")).toBe(false);
    expect(rows.inside.at(-1)).toEqual({ key: "capacity", count: null, total: true });
  });

  it("keeps the free places at 0 when the capacity was lowered under the places taken", () => {
    const rows = racePlanRows(inputFrom(150, counts));
    expect(count(rows.inside, "occupied")).toBe(165);
    expect(count(rows.inside, "free")).toBe(0);
  });
});

describe("BR-REQ-034-02 the grouped read, as «Locuri» counts (§NNN)", () => {
  const group = (status: RegistrationGroup["status"], total: number, over: Partial<RegistrationGroup> = {}): RegistrationGroup => ({ status, outside: false, elite: false, kind: "REAL", total, ...over });

  it("counts the elite inside the places, the special guests by state and the line, as the outlook does", () => {
    const breakdown = breakdownOf([
      group("CONFIRMED", 100),
      group("CONFIRMED", 4, { elite: true }),
      // A test row the allocator counts like any other (§30): the elite among the confirmed too.
      group("CONFIRMED", 1, { elite: true, kind: "TEST" }),
      group("PENDING_DECLARATION", 2, { elite: true }),
      group("CONFIRMED", 3, { outside: true }),
      group("CONFIRMED", 1, { outside: true, elite: true }),
      group("PENDING_DECLARATION", 2, { outside: true }),
      group("WAITLIST_OFFERED", 1, { outside: true }),
      // Not a special guest's state, nor a real one: `countOutsideCapacity` reads neither.
      group("PENDING_EMAIL_CONFIRMATION", 5, { outside: true }),
      group("CONFIRMED", 2, { outside: true, kind: "TEST" }),
      group("WAITLISTED", 7),
      group("WAITLISTED", 1, { kind: "TEST" }),
      group("CANCELLED", 9, { elite: true }),
    ]);
    expect(breakdown).toEqual({ eliteConfirmed: 5, eliteDeclaration: 2, outsideConfirmed: 4, outsideDeclaration: 2, outsideOffered: 1, waiting: 8, test: 2 });
    expect(outsideOf(breakdown)).toBe(7);
  });

  it("counts the test rows in an active state inside the places, never an ended one or one outside", () => {
    const breakdown = breakdownOf([
      group("CONFIRMED", 2, { kind: "TEST" }),
      group("PENDING_EMAIL_CONFIRMATION", 1, { kind: "TEST" }),
      group("EXPIRED", 3, { kind: "TEST" }),
      group("CANCELLED", 3, { kind: "TEST" }),
      group("CONFIRMED", 4, { kind: "TEST", outside: true }),
    ]);
    expect(breakdown.test).toBe(3);
  });
});

describe("BR-REQ-034-02 «De comandat» if every place fills (§NNN)", () => {
  const input = { capacity: 175, occupied: 170, outside: 4, outsideInvitations: 2, volunteersWithKit: 33, eliteEntries: 12, spares: 6 };

  it("is the sum of the parts it writes out, a kit and a bib for every elite line", () => {
    const totals = orderTotals(input);
    expect(totals?.kits.parts).toEqual([
      { key: "places", count: 175 },
      { key: "outside", count: 4 },
      { key: "outsideInvitations", count: 2 },
      { key: "eliteEntries", count: 12 },
      { key: "volunteersWithKit", count: 33 },
    ]);
    expect(totals?.kits.total).toBe(175 + 4 + 2 + 12 + 33);
    expect(totals?.bibs.parts.map((part) => part.key)).toEqual(["places", "outside", "outsideInvitations", "eliteEntries", "spares"]);
    expect(totals?.bibs.total).toBe(175 + 4 + 2 + 12 + 6);
    for (const total of [totals?.kits, totals?.bibs]) expect(total?.parts.reduce((sum, part) => sum + part.count, 0)).toBe(total?.total);
    // The runners if every place fills, plus the volunteers' kits or the desk's spare numbers.
    const runners = runnersOf(input).ifFull ?? 0;
    expect(totals?.kits.total).toBe(runners + input.volunteersWithKit);
    expect(totals?.bibs.total).toBe(runners + input.spares);
  });

  it("adds the elite list's lines and the volunteers with a kit to the kits needed now, with or without a limit", () => {
    const now = kitsNow({ registrations: 150, invitations: 3, eliteEntries: 12, volunteersWithKit: 33 });
    expect(now.parts).toEqual([
      { key: "registrations", count: 150 },
      { key: "invitations", count: 3 },
      { key: "eliteEntries", count: 12 },
      { key: "volunteersWithKit", count: 33 },
    ]);
    expect(now.total).toBe(198);
  });

  it("counts the places taken when the capacity was lowered under them, and nothing for an event with no limit", () => {
    expect(orderTotals({ ...input, capacity: 150 })?.kits.parts[0]).toEqual({ key: "places", count: 170 });
    expect(orderTotals({ ...input, capacity: null })).toBeNull();
  });
});

describe("BR-REQ-040-01 the plan in the other language (§NNN)", () => {
  it("keeps the event's plan when the language switches: one spelling in both locales, the id the same", async () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    // A staff route carries an id, never a slug: the switch reads no database for it.
    expect(await resolveLocaleSwitch(undefined as never, `/ro/admin/events/${id}/locuri`, "en")).toBe(`/en/admin/events/${id}/locuri`);
    expect(await resolveLocaleSwitch(undefined as never, `/en/admin/events/${id}/locuri`, "ro")).toBe(`/ro/admin/events/${id}/locuri`);
  });
});

describe("BR-REQ-040-04 the plan's words in both languages (§NNN)", () => {
  it("names every row and every part in Română and English", () => {
    for (const catalogue of [ro, en]) {
      const words = (catalogue.Admin as unknown as { racePlan: { rows: Record<string, string>; order: { parts: Record<string, string> } } }).racePlan;
      for (const key of PLAN_ROW_KEYS) expect(words.rows[key], key).toBeTruthy();
      for (const key of ORDER_PART_KEYS) expect(words.order.parts[key], key).toBeTruthy();
      expect(Object.keys(words.rows).sort()).toEqual([...PLAN_ROW_KEYS].sort());
      expect(Object.keys(words.order.parts).sort()).toEqual([...ORDER_PART_KEYS].sort());
    }
  });
});
