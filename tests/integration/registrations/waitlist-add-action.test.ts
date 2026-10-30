import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Adaugă pe lista de așteptare» (§NNN; BR-REQ-037-05, BR-REQ-060-01) — the owner, 2026-10-30, asked what was
 * still missing after the staff entry's tick: «a short «Adaugă» form on the waiting-list panel, like «Adaugă pe
 * lista internă»: name and email right in the panel, one press».
 *
 * The action behind that form: the staff entry with the vouching tick on, posted from the queue panel or the
 * registrations list, the Administrator's alone, the relay tick still required; a refusal keeps what was typed
 * and writes nothing; a success returns to the panel it came from with the state the row landed in.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  // The coarse gate stands aside here: the service's own assertion is what the organizer's case exercises.
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined, flash: async () => undefined }));
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

const { addToWaitlistAction } = await import("@/app/[locale]/admin/registrations/actions");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");

// The action reads the wall clock, so the fixture is set against it: a race a month from now, every press today.
const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.ro", displayName: "Organizer", role: "MODERATOR" }).returning();
  state.actor = admin;
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

async function createEvent(capacity: number, waitlistCapacity: number | null = null): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistCapacity,
      waitlistAutoOffer: false,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
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

/** One person on their own address through the public door, as far as the address's confirmation. */
async function confirmedAddress(event: EventInput, name: string, minute: number) {
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
      renderedAt: new Date(at(minute).getTime() - 30_000).toISOString(),
    },
    at(minute),
    "REAL",
    PUBLIC,
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, at(minute));
}

/** The short form as posted: the name, the address, the note and the tick, from one of its two homes. */
function press(eventId: string, name: string, options: { note?: string; relay?: boolean; back?: "event" } = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("firstName", name);
  form.set("lastName", "Munteanu");
  form.set("email", `${name.toLowerCase()}@example.ro`);
  form.set("note", options.note ?? "");
  if (options.relay !== false) form.set("relayedByParticipantRequest", "on");
  if (options.back) form.set("back", options.back);
  return form;
}

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

describe("§NNN «Adaugă pe lista de așteptare»: the one-press entry onto the official waiting list", () => {
  it("a full event: the row is on the waiting list at once, vouched for by the Administrator, with its note, the waiting-list email and the way back to the list's panel", async () => {
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");

    await expect(addToWaitlistAction(null, press(event.id, "Mara", { note: "A scris pe formularul de contact." }))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?saved=waitlistAdded&eventId=${event.id}#registrations-waitlist-add`,
    );
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("WAITLISTED");
    expect(mara.source).toBe("STAFF");
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    // Never a disclosure the person did not ask for (§323): the short form has no list tick.
    expect(mara.listOptOut).toBe(true);
    expect(mara.locale).toBe("ro");
    // The note, on the registration (§777), the Administrator's.
    const notes = await db.select().from(registrationNotes).where(eq(registrationNotes.registrationId, mara.id));
    expect(notes.map((note) => note.body)).toEqual(["A scris pe formularul de contact."]);
    // The state's email, and no link to confirm an address the club vouched for.
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, mara.id), eq(emailOutbox.messageType, "WAITLIST_JOINED")))).toHaveLength(1);
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, mara.id), eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL")))).toEqual([]);
  });

  it("from the queue panel on the event's page, the press goes back there; a free place says so in the toast", async () => {
    const event = await createEvent(2);
    await expect(addToWaitlistAction(null, press(event.id, "Mara", { back: "event" }))).rejects.toThrow(`REDIRECT /ro/admin/events/${event.id}?saved=waitlistPlaced#box-queue`);
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_DECLARATION");
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, mara.id), eq(emailOutbox.messageType, "COMPLETE_DECLARATION")))).toHaveLength(1);
    // An empty note box is no note.
    expect(await db.select().from(registrationNotes).where(eq(registrationNotes.registrationId, mara.id))).toEqual([]);
  });

  it("the relay tick is binding (§33): unticked, the entry is refused naming the box, every box kept, nothing written", async () => {
    const event = await createEvent(1);
    const refused = await addToWaitlistAction(null, press(event.id, "Mara", { relay: false, note: "o notă" }));
    expect(refused).toMatchObject({ error: "VALIDATION_ERROR", fields: ["relayedByParticipantRequest"] });
    expect(refused?.values).toMatchObject({ firstName: ["Mara"], lastName: ["Munteanu"], email: ["mara@example.ro"], note: ["o notă"] });
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.ro"))).toEqual([]);
  });

  it("the Administrator's alone (BR-REQ-060-01): an Organizer's press is refused by the service, nothing written", async () => {
    const event = await createEvent(1);
    state.actor = organizer;
    expect(await addToWaitlistAction(null, press(event.id, "Mara"))).toMatchObject({ error: "FORBIDDEN" });
    expect(await rowOf("Mara")).toBeUndefined();
  });

  it("the same person again on the address is said plainly, as the full form says it, with the address box named", async () => {
    const event = await createEvent(3);
    await expect(addToWaitlistAction(null, press(event.id, "Mara"))).rejects.toThrow(/REDIRECT/);
    expect(await addToWaitlistAction(null, press(event.id, "Mara"))).toMatchObject({ error: "STAFF_ALREADY_ON_ADDRESS", fields: ["email"] });
  });

  it("the line full (§348): refused with the line's sentence, no box named, nothing written", async () => {
    const event = await createEvent(1, 1);
    await confirmedAddress(event, "Ana", 0);
    expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");
    expect(await addToWaitlistAction(null, press(event.id, "Mara"))).toMatchObject({ error: "WAITLIST_FULL", fields: [] });
    expect(await rowOf("Mara")).toBeUndefined();
  });

  it("an over-long note is refused at its own box before any row exists", async () => {
    const event = await createEvent(3);
    expect(await addToWaitlistAction(null, press(event.id, "Mara", { note: "x".repeat(2001) }))).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["note"] });
    expect(await rowOf("Mara")).toBeUndefined();
  });
});
