import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { REGISTRATION_NOTE_MAX, registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { canKeepRegistrationNotes, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Note interne» first on the registration's page, and a note from a row of the list (amending §777; BR-REQ-060-01) —
 * the press behind «Adaugă o notă» on a list row, through the real action on a real database.
 *
 * Each of the seven roles presses it: the three that may keep notes write exactly one note and one
 * `registration.note_added` row with empty metadata and come back to the SAME list address (filters, sort, page);
 * every other is refused and writes nothing — by the coarse gate, and, with the gate standing aside, by the service.
 * A refusal keeps the words and writes nothing; nothing typed is in the address or the flash; a hand-made
 * `listQuery` cannot choose where the browser goes.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, gate: true, flashed: [] as unknown[] }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  // The coarse gate as the real one answers; `gate = false` stands it aside, so the service's own assertion is what refuses.
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (state.gate && !capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params?: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`,
}));
vi.mock("@/shared/feedback/flash", () => ({
  flashOutcome: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
  flash: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { addRegistrationNoteFromListAction } = await import("@/app/[locale]/admin/registrations/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let registrationId: string;

const ROLES: readonly StaffRole[] = ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"];
const LIST_QUERY = "eventId=11111111-1111-4111-8111-111111111111&status=CONFIRMED&sort=name&dir=asc&page=3";

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Tester ${role}`, role }).returning();
  return user;
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const press = (fields: Record<string, string>) =>
  addRegistrationNoteFromListAction(null, form({ uiLocale: "ro", registrationId, listQuery: LIST_QUERY, ...fields }));

/** The address the action redirected to, or null when it returned a state instead. */
async function redirectedTo(pressed: Promise<unknown>): Promise<string | null> {
  try {
    await pressed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  return null;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.gate = true;
  state.flashed = [];
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: "ana@example.org", normalizedEmail: "ana@example.org", canonicalEmail: "ana@example.org", canonicalizationVersion: 2, defaultName: "Ana Test", preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId: event.id,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Test",
      displayName: resolveDisplayName({ legalName: "Ana Test" }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
    })
    .returning({ id: registrations.id });
  registrationId = created.id;
});

describe("«Salvează nota» from a row of the list — every role", () => {
  for (const role of ROLES) {
    const may = canKeepRegistrationNotes(role);
    it(`${role}: ${may ? "writes one note and one trail row and returns to the same list address" : "is refused and writes nothing"}`, async () => {
      const actor = await staff(role);
      state.actor = actor;
      const to = await redirectedTo(press({ body: "  cere tricou S  " }));
      const notes = await db.select().from(registrationNotes);
      const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"));
      if (may) {
        // The same list, on the row the note was written for (§NNN): the toast says «Nota a fost salvată».
        expect(to).toBe(`/ro/admin/registrations?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(LIST_QUERY)), saved: "noteAdded" }).toString()}#reg-${registrationId}`);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ registrationId, body: "cere tricou S", authorStaffUserId: actor.id });
        expect(trail).toHaveLength(1);
        expect(trail[0]).toMatchObject({ actorStaffUserId: actor.id, entityId: registrationId, metadataJson: {} });
        // Nothing typed anywhere but the table: not the address, not the toast, not the trail.
        expect(to).not.toContain("tricou");
        expect(JSON.stringify(state.flashed)).not.toContain("tricou");
        expect(JSON.stringify(trail)).not.toContain("tricou");
      } else {
        expect(to).toBeNull();
        expect(notes).toHaveLength(0);
        expect(trail).toHaveLength(0);
      }
    });

    if (!may) {
      it(`${role}: the service refuses too when the coarse gate stands aside`, async () => {
        state.actor = await staff(role);
        state.gate = false;
        expect(await press({ body: "intrus" })).toMatchObject({ error: "FORBIDDEN" });
        expect(await db.select().from(registrationNotes)).toHaveLength(0);
        expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"))).toHaveLength(0);
      });
    }
  }

  it("the three roles that may keep notes are exactly the three that wrote", () => {
    expect(ROLES.filter((role) => canKeepRegistrationNotes(role)).sort()).toEqual(["ADMIN", "MODERATOR", "SUPERADMIN"]);
  });
});

describe("a refusal and the return", () => {
  it("answers an empty or too long note with the form's own state — the words still in the box — and writes nothing", async () => {
    state.actor = await staff("MODERATOR");
    expect(await press({ body: "   " })).toMatchObject({ error: "NOTE_EMPTY", fields: ["body"] });
    const long = "x".repeat(REGISTRATION_NOTE_MAX + 1);
    const refused = await press({ body: long });
    expect(refused).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["body"] });
    expect(refused?.values.body).toEqual([long]);
    expect(refused?.values.listQuery).toEqual([LIST_QUERY]);
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"))).toHaveLength(0);
    expect(state.flashed).toHaveLength(0);
  });

  it("says so when the registration was erased meanwhile, and writes nothing", async () => {
    state.actor = await staff("ADMIN");
    await db.delete(registrations).where(eq(registrations.id, registrationId));
    expect(await press({ body: "prea târziu" })).toMatchObject({ error: "NOT_FOUND", values: { body: ["prea târziu"] } });
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
  });

  it("flashes the existing toast and never the note", async () => {
    state.actor = await staff("MODERATOR");
    await redirectedTo(press({ body: "secret" }));
    expect(state.flashed).toEqual([{ saved: "noteAdded" }]);
  });

  it("cannot be made to go anywhere but the list: only the query travels, the path is rebuilt", async () => {
    state.actor = await staff("MODERATOR");
    const to = await redirectedTo(press({ body: "una", listQuery: "https://evil.example/x?y=1&saved=hack&error=X" }));
    expect(to?.startsWith("/ro/admin/registrations?")).toBe(true);
    expect(to).not.toContain("evil.example/x");
    expect(new URL(`http://x${to}`).searchParams.get("saved")).toBe("noteAdded");
    // An empty query comes back to the plain list.
    expect(await redirectedTo(press({ body: "doua", listQuery: "" }))).toBe(`/ro/admin/registrations?saved=noteAdded#reg-${registrationId}`);
  });
});
