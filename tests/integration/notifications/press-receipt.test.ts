import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The toast after a press (the design «telling the owner about every email a staff press sends», slice 2, its
 * sections 3 and 7): a real press runs through its action, inside its email press scope, and the flash it leaves in
 * the cookie carries what the press queued — read back by the press's id once its transaction committed: the type,
 * how many, the club's copies, when — and never a name or an address. A press that queued nothing adds nothing, and a
 * Zitadel failure on an invitation is toasted only for the club's email that still left.
 *
 * Against PGlite, the migrations included (`helpers/db.ts`); the cookie jar is the request's, faked.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  jar: new Map<string, string>(),
  set: [] as { name: string; value: string }[],
}));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      state.set.push({ name, value });
      state.jar.set(name, value);
    },
    delete: (name: string) => state.jar.delete(name),
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/cache", async () => ({ ...(await import("../../helpers/next-cache")).fakeNextCache.module, revalidatePath: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));

const { inEmailPress } = await import("@/modules/notifications/press");
const { enqueueEmail } = await import("@/modules/notifications/outbox");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { flashOutcome } = await import("@/shared/feedback/flash");
const { addToWaitlistAction } = await import("@/app/[locale]/admin/registrations/actions");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");

const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);
const COPY = "copii@club.test";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.jar.clear();
  state.set.length = 0;
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Ana Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

/** The flash the last press left, read back as the admin layout reads it. */
const flashed = () => decodeFlash(state.set.filter((cookie) => cookie.name === FLASH_COOKIE).at(-1)?.value);

async function createEvent(capacity: number): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: STARTS, registrationMode: "INTERNAL", capacity, waitlistAutoOffer: false, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

/** One person through the public door, as far as the address's confirmation: the event's one place, held. */
async function confirmedAddress(event: EventInput, name: string) {
  await submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Munteanu",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    },
    NOW,
    "REAL",
    { source: "PUBLIC", createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, NOW);
}

describe("the toast after a press says what the press queued", () => {
  it("«Oferă-i un loc acum» on a full race: the offer to the person, the club's copy, when — and no name or address in the cookie", async () => {
    await updateClubNotices(db, admin, { participants: { bcc: [COPY] } }, NOW);
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana")).status).toBe("PENDING_DECLARATION");
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("eventId", event.id);
    form.set("firstName", "Mara");
    form.set("lastName", "Munteanu");
    form.set("email", "mara@example.ro");
    form.set("relayedByParticipantRequest", "on");
    form.set("intent", "offer");
    form.set("addPlace", "2");

    await expect(addToWaitlistAction(null, form)).rejects.toThrow(/^REDIRECT /);

    const notice = flashed();
    expect(notice?.key).toBe("registrationOfferedRaised");
    expect(notice?.values).toMatchObject({ mailTo: "people", mailType: "WAITLIST_SPOT_OFFER", mailPeople: "1", mailClub: "1" });
    expect(["now", "at"]).toContain(notice?.values?.mail);
    // The waiting-list email the offer replaced in the same press was withdrawn: it is nowhere in the receipt.
    expect(notice?.values?.mailOthers).toBeUndefined();
    const cookie = state.set.filter((entry) => entry.name === FLASH_COOKIE).at(-1)?.value ?? "";
    expect(decodeURIComponent(cookie)).not.toMatch(/Mara|Munteanu|@/);
  });

  it("adds nothing to a press that queued nothing: its toast says nothing about email", async () => {
    await inEmailPress("events.save", async (press) => {
      press.by(admin.id);
      await flashOutcome({ saved: "event" });
    });
    expect(flashed()).toEqual({ kind: "success", key: "event" });
  });

  it("keeps the plain notice outside a press, as before", async () => {
    await flashOutcome({ saved: "checkedIn" });
    expect(flashed()).toEqual({ kind: "success", key: "checkedIn" });
  });

  it("toasts a Zitadel failure on an invitation only for the club's email that still left, and never as a green tick", async () => {
    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await flashOutcome({ saved: "invitedProviderFailed" });
    });
    expect(flashed()).toBeNull();

    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) =>
        enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: "noua@example.ro",
          payload: {},
          idempotencyKey: "staff-invitation:test",
          now: new Date(),
        }),
      );
      await flashOutcome({ saved: "invitedProviderFailed" });
    });
    const notice = flashed();
    expect(notice).toMatchObject({ kind: "info", key: "invitedProviderFailed", values: { mailType: "STAFF_INVITATION", mailPeople: "1" } });
    expect(JSON.stringify(notice)).not.toContain("noua@");
  });

  it("names Zitadel's own email beside the club's invitation when Zitadel invited the person", async () => {
    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) =>
        enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: "alta@example.ro",
          payload: {},
          idempotencyKey: "staff-invitation:zitadel",
          now: new Date(),
        }),
      );
      await flashOutcome({ saved: "invited", invite: "invited" });
    });
    expect(flashed()).toMatchObject({ kind: "success", key: "invited", values: { mailType: "STAFF_INVITATION", mailZitadel: "1" } });
  });
});
