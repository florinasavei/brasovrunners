import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §758 — the volunteer agreement's PDF route (BR-REQ-060-01, BR-REQ-053-03): «PDF contract» and «PDF de semnat»
 * on the event's «Voluntari» card. The PDF carries a person's name and the text they accepted, so the route asks
 * the role again on the server (`canManageVolunteers`: the Organizer and the Administrators) whatever the card
 * drew, refuses a stranger, answers NOT_FOUND for another event's volunteer or a malformed id — never a person
 * of another event through a forged address — and records each download with the volunteer's id and never a name.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const route = await import("@/app/api/admin/events/[id]/volunteers/[volunteerId]/agreement/route");

const NOW = new Date("2026-10-13T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;
let otherEventId: string;
let volunteerId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  state.actor = undefined;
  for (const [role, name] of [
    ["ADMIN", "Ana Admin"],
    ["MODERATOR", "Oana Organizator"],
    ["DEV", "Tudor Tehnic"],
    ["COPYWRITER", "Rada Redactor"],
    ["CONTRIBUTOR", "Vlad Voluntar"],
    ["MEMBER", "Membru Club"],
  ] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  }
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
  await insertLegalDocumentVersion(db, {
    key: "VOLUNTEER_AGREEMENT",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
  const [first, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), acceptsVolunteers: true },
      { type: "RACE", startsAt: new Date(NOW.getTime() + 40 * DAY), acceptsVolunteers: true },
    ])
    .returning();
  eventId = first.id;
  otherEventId = second.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul", title: "Crosul", locationName: "Parcul central" },
    { eventId, locale: "en", slug: "the-cross", title: "The cross", locationName: "Central park" },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3 }).returning();
  const [person] = await db
    .insert(eventVolunteers)
    .values({
      eventId,
      roleId: role.id,
      name: "Ion Popescu",
      email: "ion@example.test",
      canonicalEmail: "ion@example.test",
      canonicalizationVersion: 2,
      phone: "+40712345679",
      source: "STAFF",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  volunteerId = person.id;
});

async function get(actor: StaffUser | undefined, id = eventId, person = volunteerId) {
  state.actor = actor;
  return route.GET(new Request(`https://example.test/api/admin/events/${id}/volunteers/${person}/agreement`), { params: Promise.resolve({ id, volunteerId: person }) });
}

const downloads = () => db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.agreement_downloaded"));

describe("§758 the volunteer agreement's PDF route", () => {
  it("refuses every role that may not manage volunteers with a 403 and a stranger with a 401, writing no audit row", async () => {
    for (const key of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) expect((await get(staff[key]!)).status, key).toBe(403);
    expect((await get(undefined)).status).toBe(401);
    expect(await downloads()).toEqual([]);
  });

  it("answers 404 for another event's volunteer, a malformed id or nobody — never the person through a forged address", async () => {
    expect((await get(staff.ADMIN!, otherEventId)).status).toBe(404);
    expect((await get(staff.ADMIN!, "not-an-id")).status).toBe(404);
    expect((await get(staff.ADMIN!, eventId, "not-an-id")).status).toBe(404);
    expect((await get(staff.ADMIN!, eventId, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await downloads()).toEqual([]);
  });

  it("gives the Organizer and an Administrator the PDF, and records each download with the id and never the name", async () => {
    for (const key of ["ADMIN", "MODERATOR"] as const) {
      const response = await get(staff[key]!);
      expect(response.status, key).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/pdf");
      expect(Buffer.from(await response.arrayBuffer()).toString("latin1").startsWith("%PDF-1.")).toBe(true);
    }
    const rows = await downloads();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actorStaffUserId: staff.ADMIN!.id, entityId: eventId, metadataJson: { volunteerId, accepted: false } });
    expect(JSON.stringify(rows.map((row) => row.metadataJson))).not.toContain("Ion");
  });
});
