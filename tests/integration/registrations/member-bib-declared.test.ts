import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findRegistrationDetailForAdmin, listDeskRegistrations, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { listBibs } from "@/modules/registrations/bibs";
import type { BibSheetInput } from "@/modules/registrations/bibs-pdf";
import { printsMemberBib } from "@/modules/registrations/domain/member-bib";
import { PRINTS_MEMBER_BIB } from "@/modules/registrations/member-bib";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §972 (the owner, 2026-11-17, printing the race's bibs: «că momentan nu se deosebesc cu nimic»; his choice: everyone
 * who ticked at registration that they are a member of the club, no account, no second tick), BR-REQ-038-01,
 * BR-REQ-031-06, BR-REQ-037-04 (a test registration in no condition, and off every count and file the club is given)
 * — the members' race number by one rule, read from a real database (PGlite): the event's bib design
 * offers it, the registration's `club_member_declared` is true, and it is not marked «Elită» (§897). Nothing else — no
 * account on «Echipa», no «Vreau numărul de membru», no `kind`, no state.
 *
 * Proved here: the SQL rule and its TypeScript twin agree over every combination, in any query shape; the sheet prints
 * the members' bib for the tick with or without an account, the members' pages first (§681); the design's switch off
 * prints nobody's; an elite bib is never the members' design; a cancelled registration and a test one never reach the
 * paper (a test one answers the rule like a real one: `kind` is in no condition); the bib's picture draws what the sheet
 * prints; the export's «Member bib» says it, and the list's, the registration's and the desk's rows carry it; and a
 * restart writes the retired wish false. The pages that show it — the
 * print card's counts, the registration's line, the forms without the question — are
 * `member-bib-declared-screens.test.ts`.
 */
const NOW = new Date("2026-11-17T10:00:00.000Z");

const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, drawn: [] as Array<Record<string, unknown>>, sheets: [] as BibSheetInput[] }));

vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
// What the bib's picture was asked to draw: the drawing itself is `tests/unit/registrations/member-bib.test.ts`'s.
vi.mock("@/modules/registrations/bib-image", async (original) => ({
  ...(await original<typeof import("@/modules/registrations/bib-image")>()),
  renderBibImage: async (input: Record<string, unknown>) => {
    state.drawn.push(input);
    return new Response("png", { headers: { "Content-Type": "image/png" } });
  },
}));
// What the sheet was asked to print: its pages are `sheetPages`' (the real one), the drawing `member-bibs-first.test.ts`'s.
vi.mock("@/modules/registrations/bibs-pdf", async (original) => {
  const actual = await original<typeof import("@/modules/registrations/bibs-pdf")>();
  return {
    ...actual,
    renderBibSheet: async (input: BibSheetInput) => {
      state.sheets.push(input);
      return Buffer.from("%PDF-1.4\n");
    },
  };
});

const { GET: sheetRoute } = await import("@/app/api/admin/events/[id]/bibs/route");
const { GET: previewRoute } = await import("@/app/api/admin/events/[id]/bibs/preview/route");
const { GET: exportRoute } = await import("@/app/api/admin/registrations/export/route");
const { sheetPages } = await import("@/modules/registrations/bibs-pdf");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.drawn = [];
  state.sheets = [];
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

/** A race on this site, its members' bib offered or not, with both translations (the sheet and the picture read one). */
async function race(memberBib: boolean): Promise<string> {
  serial += 1;
  const [row] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      registrationMode: "INTERNAL",
      locationName: "Start",
      bibDesign: memberBib ? { member: { enabled: true, bandColour: "#6a1b9a" } } : null,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: row.id, locale: "ro", title: "Crosul", slug: `crosul-${serial}` },
    { eventId: row.id, locale: "en", title: "The cross", slug: `cross-${serial}` },
  ]);
  return row.id;
}

type RunnerOptions = { declared: boolean; bib?: number | null; status?: RegistrationStatus; kind?: RegistrationKind; elite?: boolean; wanted?: boolean; email?: string };

/** A registration in the shape each state's CHECKs ask; a confirmed one wears `bib` (a cancelled one keeps it, retired). */
async function runner(eventId: string, options: RunnerOptions): Promise<string> {
  serial += 1;
  const email = options.email ?? `runner-${serial}@example.org`;
  const status = options.status ?? "CONFIRMED";
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: email, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status,
      kind: options.kind ?? "REAL",
      locale: "ro",
      registeredName: email,
      displayName: email,
      clubMemberDeclared: options.declared,
      memberBibWanted: options.wanted ?? false,
      elite: options.elite ?? false,
      bibNumber: options.bib ?? null,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
      confirmedAt: status === "CONFIRMED" || status === "CANCELLED" ? NOW : null,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
    })
    .returning({ id: registrations.id });
  return row.id;
}

const bibOf = (id: string) => db.select({ number: registrations.bibNumber }).from(registrations).where(eq(registrations.id, id));
const sheet = (eventId: string, query = "") => sheetRoute(new Request(`http://localhost/api/admin/events/${eventId}/bibs?locale=ro${query}`), { params: Promise.resolve({ id: eventId }) });
const picture = (eventId: string, registrationId: string) =>
  previewRoute(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?registration=${registrationId}&locale=ro`), { params: Promise.resolve({ id: eventId }) });
/** The pages the route handed the renderer, as race numbers (null: a blank half). */
const pagesOf = (input: BibSheetInput) =>
  sheetPages(input.rows, { part: input.part, layout: input.layout, membersOn: input.design?.member.enabled }).map((page) => page.map((row) => row?.bibNumber ?? null));

describe("§972 the one rule: the SQL and its TypeScript twin agree", () => {
  it("answers offered ∧ ticked ∧ ¬elite over every combination, in a one-table select, a joined one and a WHERE", async () => {
    const cases: Array<{ id: string; offered: boolean; declared: boolean; elite: boolean }> = [];
    for (const offered of [true, false]) {
      const eventId = await race(offered);
      for (const declared of [true, false]) {
        for (const elite of [true, false]) cases.push({ id: await runner(eventId, { declared, elite, bib: cases.length + 1 }), offered, declared, elite });
      }
    }
    // The column's own default for the wish on every row: the rule never reads it (set true on half, below, to show it).
    await db.update(registrations).set({ memberBibWanted: true }).where(inArray(registrations.id, cases.filter((_, index) => index % 2 === 0).map((row) => row.id)));

    const oneTable = new Map((await db.select({ id: registrations.id, prints: PRINTS_MEMBER_BIB }).from(registrations)).map((row) => [row.id, row.prints]));
    const joined = new Map(
      (await db.select({ id: registrations.id, prints: PRINTS_MEMBER_BIB }).from(registrations).innerJoin(events, eq(events.id, registrations.eventId))).map((row) => [row.id, row.prints]),
    );
    const filtered = new Set((await db.select({ id: registrations.id }).from(registrations).where(PRINTS_MEMBER_BIB)).map((row) => row.id));
    for (const { id, ...facts } of cases) {
      const expected = printsMemberBib(facts);
      expect(expected, JSON.stringify(facts)).toBe(facts.offered && facts.declared && !facts.elite);
      expect(oneTable.get(id), `one table ${JSON.stringify(facts)}`).toBe(expected);
      expect(joined.get(id), `joined ${JSON.stringify(facts)}`).toBe(expected);
      expect(filtered.has(id), `where ${JSON.stringify(facts)}`).toBe(expected);
    }
  });

  it("reads neither `kind` nor the state: a test registration and a cancelled one answer like a confirmed real one", async () => {
    const eventId = await race(true);
    const test = await runner(eventId, { declared: true, kind: "TEST", bib: 1 });
    const cancelled = await runner(eventId, { declared: true, status: "CANCELLED", bib: 2 });
    const waiting = await runner(eventId, { declared: true, status: "WAITLISTED" });
    const rows = new Map((await db.select({ id: registrations.id, prints: PRINTS_MEMBER_BIB }).from(registrations)).map((row) => [row.id, row.prints]));
    expect([rows.get(test), rows.get(cancelled), rows.get(waiting)]).toEqual([true, true, true]);
  });
});

describe("§972 the sheet prints the members' bib for the member tick, members first (§681)", () => {
  it("flags every confirmed runner who ticked «Sunt membru», with no account on «Echipa» at all, and prints their pages first", async () => {
    const eventId = await race(true);
    const ids = [];
    for (const [bib, declared] of [[1, false], [2, true], [3, false], [4, true], [5, true]] as const) ids.push(await runner(eventId, { declared, bib }));
    // Nobody's address is an account's but the Administrator's own, and no runner registered with it.
    expect(await db.select({ email: staffUsers.email }).from(staffUsers)).toEqual([{ email: "admin@dev.test" }]);

    expect((await listBibs(db, eventId)).map((row) => [row.bibNumber, row.member])).toEqual([
      [1, false],
      [2, true],
      [3, false],
      [4, true],
      [5, true],
    ]);
    expect((await sheet(eventId)).status).toBe(200);
    expect(pagesOf(state.sheets[0])).toEqual([
      [2, 4],
      [5, null],
      [1, 3],
    ]);
    expect((await sheet(eventId, "&part=members")).status).toBe(200);
    expect(pagesOf(state.sheets[1])).toEqual([
      [2, 4],
      [5, null],
    ]);
    // The members' label is read for a sheet that prints a member's bib, in the sheet's language.
    expect(state.sheets[0].memberLabelDefault).toBe("Membru Brașov Runners");
  });

  it("prints the ordinary bib for an account on «Echipa» whose registration did not tick, and the members' bib for one that did", async () => {
    const eventId = await race(true);
    await db.insert(staffUsers).values([
      { email: "cont-fara-bifa@example.org", displayName: "Fără bifă", role: "MEMBER" },
      { email: "cont-cu-bifa@example.org", displayName: "Cu bifă", role: "MEMBER" },
    ]);
    const accountOnly = await runner(eventId, { declared: false, bib: 1, email: "cont-fara-bifa@example.org" });
    const both = await runner(eventId, { declared: true, bib: 2, email: "cont-cu-bifa@example.org" });
    const tickOnly = await runner(eventId, { declared: true, bib: 3 });
    const member = new Map((await listBibs(db, eventId)).map((row) => [row.id, row.member]));
    expect([member.get(accountOnly), member.get(both), member.get(tickOnly)]).toEqual([false, true, true]);
  });

  it("prints nobody the members' bib while the design's switch is off: one pile, in number order", async () => {
    const eventId = await race(false);
    for (const [bib, declared] of [[1, true], [2, false], [3, true]] as const) await runner(eventId, { declared, bib });
    expect((await listBibs(db, eventId)).every((row) => !row.member)).toBe(true);
    await sheet(eventId);
    expect(pagesOf(state.sheets[0])).toEqual([
      [1, 2],
      [3, null],
    ]);
    expect(state.sheets[0].memberLabelDefault).toBeUndefined();
  });

  it("never prints the members' design on an elite bib: the marked runner who ticked is on the elite sheet alone", async () => {
    const eventId = await race(true);
    const elite = await runner(eventId, { declared: true, elite: true, bib: 1 });
    const member = await runner(eventId, { declared: true, bib: 2 });
    expect((await listBibs(db, eventId)).map((row) => [row.id, row.member])).toEqual([[member, true]]);
    expect((await listBibs(db, eventId, { elite: true })).map((row) => [row.id, row.member, row.elite])).toEqual([[elite, false, true]]);
    await sheet(eventId, "&elite=1");
    expect(state.sheets[0].rows.map((row) => [row.bibNumber, row.member === true])).toEqual([[1, false]]);
  });

  it("never prints a cancelled registration's bib, nor a test registration's, members' or not", async () => {
    const eventId = await race(true);
    const cancelled = await runner(eventId, { declared: true, status: "CANCELLED", bib: 1 });
    const test = await runner(eventId, { declared: true, kind: "TEST", bib: 2 });
    const member = await runner(eventId, { declared: true, bib: 3 });
    // The cancelled one keeps its number, retired (§173): only the sheet's scope keeps it off the paper.
    expect(await bibOf(cancelled)).toEqual([{ number: 1 }]);
    expect((await listBibs(db, eventId)).map((row) => row.id)).toEqual([member]);
    await sheet(eventId);
    expect(pagesOf(state.sheets[0])).toEqual([[3, null]]);
    // Neither has a picture: the preview draws only what the sheet prints.
    expect((await picture(eventId, cancelled)).status).toBe(404);
    expect((await picture(eventId, test)).status).toBe(404);
  });
});

describe("§972 the bib's picture draws what the sheet prints", () => {
  it("draws the members' design for the tick, account or not, and the ordinary bib otherwise — the design off, no tick, or elite", async () => {
    const on = await race(true);
    const off = await race(false);
    await db.insert(staffUsers).values({ email: "cont@example.org", displayName: "Cont", role: "MEMBER" });
    const cases = [
      { eventId: on, id: await runner(on, { declared: true, bib: 1 }), member: true },
      { eventId: on, id: await runner(on, { declared: false, bib: 2, email: "cont@example.org" }), member: false },
      { eventId: on, id: await runner(on, { declared: true, elite: true, bib: 3 }), member: false },
      { eventId: off, id: await runner(off, { declared: true, bib: 1 }), member: false },
    ];
    for (const { eventId, id, member } of cases) {
      state.drawn = [];
      expect((await picture(eventId, id)).status).toBe(200);
      expect(state.drawn[0]?.member, id).toBe(member);
      if (member) expect(state.drawn[0]).toMatchObject({ memberLabelDefault: "Membru Brașov Runners" });
    }
    // The elite one draws as the sheet prints it: an elite bib (§897).
    state.drawn = [];
    await picture(on, cases[2].id);
    expect(state.drawn[0]).toHaveProperty("elite");
  });
});

describe("§972 the list, the registration's page and the export read the same rule", () => {
  it("says «Member bib» = yes for the tick (no account needed) and empty otherwise, in the CSV and the workbook; a test row stays out", async () => {
    const eventId = await race(true);
    await db.insert(staffUsers).values({ email: "cont@example.org", displayName: "Cont", role: "MEMBER" });
    const expected = new Map<string, string>([
      ["ticked@example.org", "yes"],
      ["cont@example.org", ""],
      ["nothing@example.org", ""],
      ["elite@example.org", ""],
      // The column reads the rule, as §664's did, whatever the state: what prints is the sheet's scope, never this cell.
      ["cancelled@example.org", "yes"],
    ]);
    await runner(eventId, { declared: true, bib: 1, email: "ticked@example.org" });
    await runner(eventId, { declared: false, bib: 2, email: "cont@example.org" });
    await runner(eventId, { declared: false, bib: 3, email: "nothing@example.org" });
    await runner(eventId, { declared: true, elite: true, bib: 4, email: "elite@example.org" });
    await runner(eventId, { declared: true, status: "CANCELLED", bib: 5, email: "cancelled@example.org" });
    await runner(eventId, { declared: true, kind: "TEST", bib: 6, email: "test@example.org" });

    const csv = await (await exportRoute(new Request(`http://localhost/api/admin/registrations/export?eventId=${eventId}`))).text();
    const [header, ...lines] = csv.split("\r\n").filter((line) => line !== "");
    const at = header.split(",").indexOf("Member bib");
    expect(at).toBeGreaterThan(-1);
    for (const [email, cell] of expected) expect(lines.find((line) => line.includes(email))?.split(",")[at], `CSV ${email}`).toBe(cell);
    // A test registration is omitted from every file the club is given (§30).
    expect(lines.some((line) => line.includes("test@example.org"))).toBe(false);

    const workbook = await exportRoute(new Request(`http://localhost/api/admin/registrations/export?eventId=${eventId}&format=xlsx`));
    const { rows } = readSheet(Buffer.from(await workbook.arrayBuffer()));
    const column = rows[0].indexOf("Member bib");
    expect(column).toBeGreaterThan(-1);
    for (const [email, cell] of expected) {
      const row = rows.find((cells) => cells.includes(email));
      expect(row, `workbook ${email}`).toBeDefined();
      // An empty cell is written as no cell at all, or as an empty string.
      expect(row?.[column] ?? "", `workbook ${email}`).toBe(cell);
    }
    expect(rows.some((cells) => cells.includes("test@example.org"))).toBe(false);
  });

  it("carries `memberBib` on the list's rows, the registration's page and the desk's row by the same rule — a test row like a real one", async () => {
    const on = await race(true);
    const off = await race(false);
    const ticked = await runner(on, { declared: true, bib: 1 });
    const test = await runner(on, { declared: true, kind: "TEST", bib: 2 });
    const plain = await runner(on, { declared: false, bib: 3 });
    const elite = await runner(on, { declared: true, elite: true, bib: 4 });
    const designOff = await runner(off, { declared: true, bib: 1 });
    const cases = [
      [ticked, true],
      [test, true],
      [plain, false],
      [elite, false],
      [designOff, false],
    ] as const;
    const rows = new Map((await listRegistrationsForAdmin(db, {}, undefined, NOW)).map((row) => [row.id, row.memberBib]));
    for (const [id, memberBib] of cases) {
      expect(rows.get(id), `list ${id}`).toBe(memberBib);
      expect((await findRegistrationDetailForAdmin(db, id, NOW))?.memberBib, `page ${id}`).toBe(memberBib);
    }
    // The desk's row (the review of §972): its picture's address carries the flag (`m=1`), so a corrected tick is a fresh picture.
    const desk = new Map(
      [...(await listDeskRegistrations(db, { eventId: on, query: "", locale: "ro" })), ...(await listDeskRegistrations(db, { eventId: off, query: "", locale: "ro" }))].map((row) => [row.id, row.memberBib]),
    );
    for (const [id, memberBib] of cases) expect(desk.get(id), `desk ${id}`).toBe(memberBib);
  });
});

describe("§972 «Vreau numărul de membru» is written false by every door, a restart's included", () => {
  async function approveLegalDocuments() {
    const text: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
      await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(text), translations: text, now: NOW });
    }
  }

  it("rewrites an old «yes» to false when the person registers again on a cancelled registration, and keeps the tick", async () => {
    await approveLegalDocuments();
    const eventId = await race(true);
    const forRegistration: EventForRegistration = {
      id: eventId,
      eventStatus: "SCHEDULED",
      registrationMode: "INTERNAL",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      registrationOpensAt: null,
      registrationClosesAt: null,
      capacity: null,
      raceId: null,
      publishedAt: NOW,
    };
    const form = {
      firstName: "Ana",
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email: "ana@example.ro",
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      clubMemberDeclared: true,
      // The retired box, as a stale page would post it: never read.
      memberBibWanted: true,
    };
    await submitRegistration(db, forRegistration, form, NOW);
    const [first] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(first).toMatchObject({ memberBibWanted: false, clubMemberDeclared: true });
    // A row from before §972 that still says yes, cancelled since.
    await db
      .update(registrations)
      .set({ memberBibWanted: true, status: "CANCELLED", cancelledAt: NOW, cancellationSource: "PARTICIPANT" })
      .where(eq(registrations.id, first.id));

    await submitRegistration(db, forRegistration, form, new Date(NOW.getTime() + 60_000));
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, memberBibWanted: false, clubMemberDeclared: true });
    expect(rows[0].status).not.toBe("CANCELLED");
  });
});
