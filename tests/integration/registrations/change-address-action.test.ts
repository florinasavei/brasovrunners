import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { canManageRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Schimbă adresa» — the press behind the card «Adresa de email», through the real action on a real database
 * (BR-REQ-060-01, BR-REQ-037-03). Each of the seven roles presses it: the Administrator and the Superadministrator
 * move the registration and come back to its page with a toast that names no address; every other role is refused
 * and writes nothing — by the action's gate, and with the gate standing aside, by the service. A refusal is said at
 * the box, with what was typed kept, by its own sentence.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, gate: true, flashed: [] as unknown[] }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
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
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { changeRegistrationAddressAction } = await import("@/app/[locale]/admin/registrations/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let registrationId: string;
let eventId: string;

const NEW = "dora.noua@example.org";

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Tester ${role}`, role }).returning();
  return user;
}
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const press = (email: string) => changeRegistrationAddressAction(null, form({ uiLocale: "ro", registrationId, email }));

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

async function seedParticipant(email: string, name: string) {
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  return participant;
}
async function seedRegistration(participantId: string, name: string, checkinCode: string | null = null) {
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      nameKey: name.toLowerCase(),
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: new Date(),
      checkinCode,
    })
    .returning({ id: registrations.id });
  return created.id;
}

/** Everything a refused press must leave as it was. */
async function snapshot() {
  return {
    registrations: await db.select().from(registrations),
    participants: (await db.select().from(participants)).length,
    outbox: (await db.select().from(emailOutbox)).length,
    audit: (await db.select().from(auditLogs)).length,
  };
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
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  const ana = await seedParticipant("ana@example.org", "Ana Test");
  registrationId = await seedRegistration(ana.id, "Ana Test", "ABCDEFGHJK");
});

describe("«Schimbă adresa» — every role", () => {
  for (const role of STAFF_ROLES) {
    const may = canManageRegistrations(role);
    it(`${role}: ${may ? "moves the registration and comes back to its page, no address in the toast" : "is refused and writes nothing"}`, async () => {
      state.actor = await staff(role);
      const before = await snapshot();
      const pressed = press(NEW);
      if (may) {
        const to = await redirectedTo(pressed);
        expect(to).toBe(`/ro/admin/registrations/${registrationId}?saved=addressChanged#admin-alert`);
        const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
        const [target] = await db.select().from(participants).where(eq(participants.canonicalEmail, NEW));
        expect(row.participantId).toBe(target.id);
        // The press's emails carry its cause and who pressed (`notifications/press.ts`).
        const notices = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId))).filter((r) => r.messageType.startsWith("REGISTRATION_ADDRESS_"));
        expect(notices.map((r) => r.cause)).toEqual(["registrations.changeAddress", "registrations.changeAddress"]);
        expect(JSON.stringify(state.flashed)).not.toContain("@");
        expect(to).not.toContain("@");
      } else {
        expect(await pressed).toMatchObject({ error: "FORBIDDEN" });
        expect(await snapshot()).toEqual(before);
      }
    });

    if (!may) {
      it(`${role}: the service refuses too when the action's gate stands aside`, async () => {
        state.actor = await staff(role);
        state.gate = false;
        const before = await snapshot();
        expect(await press(NEW)).toMatchObject({ error: "FORBIDDEN" });
        expect(await snapshot()).toEqual(before);
      });
    }
  }

  it("the roles that move an address are exactly the Administrator and the Superadministrator", () => {
    expect(STAFF_ROLES.filter((role) => canManageRegistrations(role)).sort()).toEqual(["ADMIN", "SUPERADMIN"]);
  });
});

describe("«Schimbă adresa» — a refusal is said at the box and writes nothing", () => {
  const cases: [string, () => Promise<string>, string][] = [
    ["an address that is not one", async () => "nu-e-o-adresa", "ADDRESS_INVALID"],
    ["the same address", async () => "ANA@example.org", "ADDRESS_UNCHANGED"],
    [
      "the same runner already on the new address",
      async () => {
        const dora = await seedParticipant(NEW, "Ana Test");
        await seedRegistration(dora.id, "Ana Test");
        return NEW;
      },
      "ADDRESS_ALREADY_HELD",
    ],
  ];
  for (const [what, setUp, code] of cases) {
    it(what, async () => {
      state.actor = await staff("ADMIN");
      const email = await setUp();
      const before = await snapshot();
      const refused = await press(email);
      expect(refused).toMatchObject({ error: code, fields: ["email"], values: { email: [email] } });
      expect(await snapshot()).toEqual(before);
      expect(state.flashed).toHaveLength(0);
      // A sentence in both catalogues, never a raw code on the screen.
      expect((ro.Admin.errors as Record<string, string>)[code]).toEqual(expect.any(String));
      expect((en.Admin.errors as Record<string, string>)[code]).toEqual(expect.any(String));
    });
  }

  it("an erased registration is NOT_FOUND", async () => {
    state.actor = await staff("ADMIN");
    await db.delete(registrations).where(eq(registrations.id, registrationId));
    expect(await press(NEW)).toMatchObject({ error: "NOT_FOUND" });
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, NEW))).toHaveLength(0);
  });
});
