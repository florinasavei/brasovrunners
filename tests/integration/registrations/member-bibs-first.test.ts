import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { type BibSheetInput, sheetPages } from "@/modules/registrations/bibs-pdf";
import { countBibs } from "@/modules/registrations/bibs";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-038-01 — the sheet's route prints the members' race numbers (§664) first, on pages
 * of their own, and `part=members` / `part=others` print one pile; an unknown part is the whole
 * sheet. The file's name says which part. The role check is the one it was (§289), and no
 * download — whole or part — marks a bib printed: the mark stays the club's own press (§264).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, drawn: [] as unknown[] }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ namespace }: { namespace: string }) =>
    createTranslator({ locale: "ro", messages: (ro as unknown as Record<string, never>)[namespace] }),
}));
// The real renderer, with what it was asked to draw kept for the test.
vi.mock("@/modules/registrations/bibs-pdf", async (original) => {
  const actual = await original<typeof import("@/modules/registrations/bibs-pdf")>();
  return {
    ...actual,
    renderBibSheet: async (input: BibSheetInput) => {
      state.drawn.push(input);
      return actual.renderBibSheet(input);
    },
  };
});

const { GET } = await import("@/app/api/admin/events/[id]/bibs/route");

describe("§NNN the members' race numbers print first, on their own pages", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  async function event(memberBib: boolean) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date("2026-10-11T07:00:00Z"),
        registrationMode: "INTERNAL",
        locationName: "Start",
        bibDesign: memberBib ? { member: { enabled: true, bandColour: "#6a1b9a" } } : null,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", title: "Crosul Tâmpei", slug: `crosul-tampei-${row.id.slice(0, 8)}` },
      { eventId: row.id, locale: "en", title: "The Tâmpa cross", slug: `tampa-cross-${row.id.slice(0, 8)}` },
    ]);
    return row.id;
  }

  async function confirmed(email: string, bibNumber: number, wanted: boolean) {
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: email })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status: "CONFIRMED",
      kind: "REAL",
      locale: "ro",
      registeredName: email,
      displayName: email,
      clubMemberDeclared: wanted,
      memberBibWanted: wanted,
      bibNumber,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: new Date("2026-09-01T00:00:00Z"),
      confirmedAt: new Date("2026-09-02T10:00:00Z"),
    });
  }

  beforeEach(async () => {
    await resetTables(db);
    state.drawn = [];
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    state.actor = admin;
    eventId = await event(true);
    // Three member accounts (§662): their addresses verify. Numbers 1–7, members on 2, 4 and 7.
    for (const email of ["m2@example.test", "m4@example.test", "m7@example.test"]) {
      await db.insert(staffUsers).values({ email, displayName: email, role: "MEMBER" });
    }
    for (const number of [1, 2, 3, 4, 5, 6, 7]) {
      const isMember = [2, 4, 7].includes(number);
      await confirmed(isMember ? `m${number}@example.test` : `o${number}@example.test`, number, isMember);
    }
  });

  const ask = (query = "") => GET(new Request(`http://localhost/api/admin/events/${eventId}/bibs?locale=ro${query}`), { params: Promise.resolve({ id: eventId }) });
  const pageCount = async (response: Response) => Buffer.from(await response.arrayBuffer()).toString("latin1").match(/\/Type \/Page\b/g)?.length;
  /** The pages the route drew, as numbers, from what it handed the renderer. */
  const drawnPages = (index = 0) => {
    const input = state.drawn[index] as BibSheetInput;
    return sheetPages(input.rows, { part: input.part, layout: input.layout, membersOn: input.design?.member.enabled }).map((page) =>
      page.map((row) => row?.bibNumber ?? null),
    );
  };
  const fileName = (response: Response) => response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];

  it("prints the whole sheet with the members' pages first, a blank half after the odd one", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(drawnPages()).toEqual([
      [2, 4],
      [7, null],
      [1, 3],
      [5, 6],
    ]);
    expect(await pageCount(response)).toBe(4);
    expect(fileName(response)).toBe(`bibs-${eventId.slice(0, 8)}.pdf`);
  });

  it("prints the members' pile alone with `part=members`, and the rest with `part=others`", async () => {
    const members = await ask("&part=members");
    expect(members.status).toBe(200);
    expect(drawnPages(0)).toEqual([
      [2, 4],
      [7, null],
    ]);
    expect(await pageCount(members)).toBe(2);
    expect(fileName(members)).toBe(`bibs-${eventId.slice(0, 8)}-members.pdf`);

    const others = await ask("&part=others");
    expect(others.status).toBe(200);
    expect(drawnPages(1)).toEqual([
      [1, 3],
      [5, 6],
    ]);
    expect(await pageCount(others)).toBe(2);
    expect(fileName(others)).toBe(`bibs-${eventId.slice(0, 8)}-without-members.pdf`);
    // The members' header is fetched only for a file that prints a member's bib.
    expect((state.drawn[1] as BibSheetInput).memberLabelDefault).toBeUndefined();
  });

  it("reads an unknown part as the whole sheet, never an error", async () => {
    const response = await ask("&part=everything");
    expect(response.status).toBe(200);
    expect((state.drawn[0] as BibSheetInput).part).toBe("all");
    expect(await pageCount(response)).toBe(4);
    expect(fileName(response)).toBe(`bibs-${eventId.slice(0, 8)}.pdf`);
  });

  it("keeps the number order and today's pairs on an event that does not offer the members' bib", async () => {
    const plain = await event(false);
    eventId = plain;
    for (const number of [1, 2, 3]) await confirmed(`p${number}@example.test`, number, number === 2);
    const response = await ask();
    expect(drawnPages()).toEqual([
      [1, 2],
      [3, null],
    ]);
    expect(await pageCount(response)).toBe(2);
  });

  it("refuses a role that may not read the registrations, a part asked or not", async () => {
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    state.actor = volunteer;
    expect((await ask("&part=members")).status).toBe(403);
    expect((await ask()).status).toBe(403);
    expect(state.drawn).toHaveLength(0);
  });

  it("marks nothing printed, whole or part: the mark is the club's own press (§264)", async () => {
    await ask("&part=members");
    await ask("&part=others");
    await ask();
    expect(await countBibs(db, eventId)).toEqual({ total: 7, unprinted: 7 });
  });
});
