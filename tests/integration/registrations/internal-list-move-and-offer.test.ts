import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Mută pe lista oficială» and «Oferă-i un loc acum» (§888; BR-REQ-037-05, BR-REQ-034-02, BR-REQ-060-01) — the
 * owner, 2026-11-01: the internal list is notes, the official waiting list the real queue, and a line moves from
 * the first to the second in one press, or is offered a place at once.
 *
 * Both verbs are the official list's add form (§872) fed from the line: the address vouched for by the
 * Administrator, the one allocator under the event lock, the back of the line or a counted free place, the
 * ordinary email and no verification email — and, for «Oferă-i un loc acum», §642's offer in the same
 * transaction, with one supplementary place only when its dialog named the new capacity. The note follows and
 * the line goes in that same transaction; any refusal writes nothing and keeps the line. The Administrator's
 * alone; after the start, refused. The same second button sits on the official list's add form.
 *
 * The two-connection race on the last place is `tests/concurrency/capacity.test.ts` (the offer's own path).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, revalidated: [] as string[] }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  // The coarse gate stands aside here: the services' own assertions are what the Organizer's case exercises.
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
// The data cache in memory (`helpers/next-cache.ts`), the page's redraw watched.
vi.mock("next/cache", async () => ({
  ...(await import("../../helpers/next-cache")).fakeNextCache.module,
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
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

const { addToWaitlistAction, moveReserveEntryAction } = await import("@/app/[locale]/admin/registrations/actions");
const { addReserveEntry, moveReserveEntryToWaitlist, settleReserveEntry } = await import("@/modules/registrations/reserve-list");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");
const { staffOfferIfMadeNow, waitlistOfferQuestion } = await import("@/modules/registrations/give-place-tip");

// The actions read the wall clock, so the fixture is set against it: a race a month from now, every press today.
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
  state.revalidated = [];
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
const NOTE = "A scris pe formularul de contact pe 30 oct.";

async function createEvent(capacity: number, options: { startsAt?: Date; closesAt?: Date } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: false,
      registrationClosesAt: options.closesAt ?? null,
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
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

/** One person on their own address through the public door, as far as the address's confirmation: the event's one place. */
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
    PUBLIC,
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, NOW);
}

/** A line of the internal list, as «Adaugă pe lista internă» writes it. */
async function line(eventId: string, name: string, email: string | null = `${name.toLowerCase()}@example.ro`) {
  const { id } = await addReserveEntry(db, admin, eventId, { firstName: name, lastName: "Munteanu", email: email ?? "", note: NOTE }, NOW);
  return id;
}

/** The line's move form as posted: which button, the dialog's tick, the capacity its question named, an address typed. */
function press(entryId: string, options: { intent?: "move" | "offer"; relay?: boolean; addPlace?: number; email?: string } = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("entryId", entryId);
  form.set("intent", options.intent ?? "move");
  form.set("relayedByParticipantRequest", options.relay === false ? "" : "on");
  if (options.addPlace !== undefined) form.set("addPlace", String(options.addPlace));
  if (options.email !== undefined) form.set("email", options.email);
  return form;
}

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

const emailsOf = (registrationId: string, messageType: "VERIFY_REGISTRATION_EMAIL" | "WAITLIST_JOINED" | "COMPLETE_DECLARATION" | "WAITLIST_SPOT_OFFER") =>
  db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.messageType, messageType)));
const capacityOf = async (eventId: string) => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity;
const linesOf = (eventId: string) => db.select().from(eventReserveEntries).where(eq(eventReserveEntries.eventId, eventId));
const notesOf = async (registrationId: string) => (await db.select().from(registrationNotes).where(eq(registrationNotes.registrationId, registrationId))).map((note) => note.body);
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("§888 «Mută pe lista oficială» on a line of the internal list", () => {
  it("a free place: the line's person is entered with the address vouched for and gets the declaration email, no verification email; the note follows and the line is gone, in one press", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara");

    await expect(moveReserveEntryAction(null, press(entryId))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${event.id}&saved=waitlistPlaced&from=reserve#registrations-reserve`,
    );
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_DECLARATION");
    expect(mara.source).toBe("STAFF");
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    // Never a disclosure the person did not ask for (§323), and the backoffice's language.
    expect(mara.listOptOut).toBe(true);
    expect(mara.locale).toBe("ro");
    const [participant] = await db.select().from(participants).where(eq(participants.id, mara.participantId));
    expect(participant.emailVerifiedAt).toBeNull();
    expect(await emailsOf(mara.id, "COMPLETE_DECLARATION")).toHaveLength(1);
    expect(await emailsOf(mara.id, "VERIFY_REGISTRATION_EMAIL")).toEqual([]);
    // The note, on the registration (§777); the line, gone; the trail names the line and the row, never the person.
    expect(await notesOf(mara.id)).toEqual([NOTE]);
    expect(await linesOf(event.id)).toEqual([]);
    const [moved] = await trail("event_reserve.moved");
    expect(moved.metadataJson).toEqual({ entryId, registrationId: mara.id });
    expect(JSON.stringify(moved)).not.toContain("Mara");
    expect(await capacityOf(event.id)).toBe(2);
  });

  it("a full event: the person joins the back of the line with the waiting-list email, and nothing is raised", async () => {
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana")).status).toBe("PENDING_DECLARATION");
    const entryId = await line(event.id, "Mara");

    await expect(moveReserveEntryAction(null, press(entryId))).rejects.toThrow(`saved=waitlistAdded&from=reserve#registrations-reserve`);
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("WAITLISTED");
    expect(await emailsOf(mara.id, "WAITLIST_JOINED")).toHaveLength(1);
    expect(await notesOf(mara.id)).toEqual([NOTE]);
    expect(await linesOf(event.id)).toEqual([]);
    expect(await capacityOf(event.id)).toBe(1);
  });

  it("the relay tick is asked in the dialog: without it the move is refused naming it, and nothing is written", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara");
    expect(await moveReserveEntryAction(null, press(entryId, { relay: false }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["relayedByParticipantRequest"] });
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await linesOf(event.id)).toHaveLength(1);
  });

  it("a line written without an address takes the one typed for the official list, and is refused naming the box without one", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara", null);

    expect(await moveReserveEntryAction(null, press(entryId))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["email"] });
    expect(await linesOf(event.id)).toHaveLength(1);

    await expect(moveReserveEntryAction(null, press(entryId, { email: "mara.m@example.ro" }))).rejects.toThrow(/saved=waitlistPlaced/);
    const mara = await rowOf("Mara");
    const [participant] = await db.select().from(participants).where(eq(participants.id, mara.participantId));
    expect(participant.deliveryEmail).toBe("mara.m@example.ro");
    expect(await linesOf(event.id)).toEqual([]);
  });

  it("a second press on a line already moved finds it gone, and enters nobody twice", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara");
    await expect(moveReserveEntryAction(null, press(entryId))).rejects.toThrow(/REDIRECT/);
    expect(await moveReserveEntryAction(null, press(entryId))).toMatchObject({ error: "NOT_FOUND" });
    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(1);
  });
});

describe("§888 «Oferă-i un loc acum» on a line of the internal list: the same entry, and §642's offer in the same transaction", () => {
  it("a full event, the supplementary place confirmed by the dialog: one place added and offered to the person in the same press — one email, the offer — audited, the note carried and the line gone", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana");
    const entryId = await line(event.id, "Mara");

    await expect(moveReserveEntryAction(null, press(entryId, { intent: "offer", addPlace: 2 }))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${event.id}&saved=registrationOfferedRaised&count=2&from=reserve#registrations-reserve`,
    );
    expect(await capacityOf(event.id)).toBe(2);
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("WAITLIST_OFFERED");
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    // The offer's email says everything: the waiting-list email the entry queued a moment before never leaves.
    expect(await emailsOf(mara.id, "WAITLIST_SPOT_OFFER")).toHaveLength(1);
    expect(await emailsOf(mara.id, "WAITLIST_JOINED")).toEqual([]);
    expect(await emailsOf(mara.id, "VERIFY_REGISTRATION_EMAIL")).toEqual([]);
    // §642's trail: who raised it, from, to and for which registration; and who offered.
    const [raised] = await trail("event.capacity_raised_for_offer");
    expect(raised.actorStaffUserId).toBe(admin.id);
    // …with «Istoric capacitate»'s fields (§NNN): the row's version, the places taken and the press — the move's offer.
    expect(raised.metadataJson).toEqual({ from: 1, to: 2, registrationId: mara.id, version: expect.any(Number), occupied: 1, via: "moveAndOffer" });
    expect((await trail("registration.offered_by_staff")).map((row) => row.entityId)).toEqual([mara.id]);
    expect((await trail("event_reserve.moved"))[0].metadataJson).toEqual({ entryId, registrationId: mara.id, offerNow: true });
    expect(await notesOf(mara.id)).toEqual([NOTE]);
    expect(await linesOf(event.id)).toEqual([]);
    // Ana keeps her place: nobody lost one to the press.
    expect((await rowOf("Ana")).status).toBe("PENDING_DECLARATION");
  });

  it("the same press without the dialog's confirmation is refused, and writes nothing: no registration, no person, no place, and the line keeps its note", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana");
    const entryId = await line(event.id, "Mara");

    expect(await moveReserveEntryAction(null, press(entryId, { intent: "offer" }))).toMatchObject({ error: "SUPPLEMENTARY_PLACE_UNCONFIRMED", fields: [] });
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.ro"))).toEqual([]);
    expect(await capacityOf(event.id)).toBe(1);
    expect((await linesOf(event.id)).map((row) => row.note)).toEqual([NOTE]);
    expect(await trail("event_reserve.moved")).toEqual([]);
    expect(await trail("event.capacity_raised_for_offer")).toEqual([]);
    // The page is drawn again, so its question asks with the numbers of now.
    expect(state.revalidated).toEqual(["/ro/admin/registrations"]);
    // A confirmation of another capacity is no confirmation of this one.
    expect(await moveReserveEntryAction(null, press(entryId, { intent: "offer", addPlace: 3 }))).toMatchObject({ error: "SUPPLEMENTARY_PLACE_UNCONFIRMED" });
    expect(await capacityOf(event.id)).toBe(1);
  });

  it("with a place free the ordinary outcome is enough: the place and the declaration email, no offer and no raise", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara");
    await expect(moveReserveEntryAction(null, press(entryId, { intent: "offer" }))).rejects.toThrow(/saved=waitlistPlaced/);
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_DECLARATION");
    expect(await emailsOf(mara.id, "COMPLETE_DECLARATION")).toHaveLength(1);
    expect(await emailsOf(mara.id, "WAITLIST_SPOT_OFFER")).toEqual([]);
    expect(await capacityOf(event.id)).toBe(2);
    expect(await trail("registration.offered_by_staff")).toEqual([]);
  });

  it("after the close it still offers, capped by the start; after the start both verbs are refused and nothing is written", async () => {
    const closed = await createEvent(1);
    await confirmedAddress(closed, "Ana");
    await db.update(events).set({ registrationClosesAt: at(-60) }).where(eq(events.id, closed.id));
    const lateLine = await line(closed.id, "Mara");
    await expect(moveReserveEntryAction(null, press(lateLine, { intent: "offer", addPlace: 2 }))).rejects.toThrow(/saved=registrationOfferedRaised/);
    expect((await rowOf("Mara")).status).toBe("WAITLIST_OFFERED");

    const started = await createEvent(3, { startsAt: at(-60) });
    const entryId = await line(started.id, "Luca");
    for (const intent of ["move", "offer"] as const) {
      expect(await moveReserveEntryAction(null, press(entryId, { intent }))).toMatchObject({ error: "VOUCHED_ENTRY_AFTER_START" });
    }
    expect(await rowOf("Luca")).toBeUndefined();
    expect(await linesOf(started.id)).toHaveLength(1);
  });

  it("the dialog names the address and, on a full race, the capacity it becomes, its button the added place; with a place free it is the plain question — in both languages", async () => {
    const full = await createEvent(1);
    await confirmedAddress(full, "Ana");
    const forecast = await staffOfferIfMadeNow(full.id, "ro");
    expect(forecast).toMatchObject({ raisedTo: 2, afterClose: false });
    for (const [messages, locale] of [[ro, "ro"], [en, "en"]] as const) {
      const say = createTranslator({ locale, messages, namespace: "Admin" }) as unknown as (key: string, values?: Record<string, string>) => string;
      const question = waitlistOfferQuestion(say, "mara@example.ro", forecast!);
      expect(question.body).toContain("mara@example.ro");
      expect(question.body).toContain(say("confirm.offerPlaceRaise", { n: "2" }));
      expect(question.confirmLabel).toBe(say("confirm.waitlistOfferRaiseConfirm"));
    }
    const free = await createEvent(2);
    const plain = waitlistOfferQuestion(createTranslator({ locale: "ro", messages: ro, namespace: "Admin" }) as never, "mara@example.ro", (await staffOfferIfMadeNow(free.id, "ro"))!);
    expect(plain.confirmLabel).toBe("Oferă-i un loc acum");
    expect(plain.body).not.toContain("capacitatea devine");
  });
});

describe("§888 the Administrator's alone (BR-REQ-060-01): the Organizer keeps the list's add, note and delete", () => {
  it("an Organizer's press of either verb is refused by the service, and the line stays; nor does the full form carry the note for them", async () => {
    const event = await createEvent(2);
    const entryId = await line(event.id, "Mara");
    state.actor = organizer;
    for (const intent of ["move", "offer"] as const) {
      expect(await moveReserveEntryAction(null, press(entryId, { intent }))).toMatchObject({ error: "FORBIDDEN" });
    }
    const direct = await refusal(moveReserveEntryToWaitlist(db, organizer, entryId, { email: null, relayedByParticipantRequest: true, locale: "ro" }, NOW));
    expect(isDomainError(direct) && direct.code).toBe("FORBIDDEN");
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await linesOf(event.id)).toHaveLength(1);

    // The full form's settle (§854) asks the same role now: an Organizer's entry leaves the line and its note alone.
    const settle = await refusal(settleReserveEntry(db, organizer, entryId, "00000000-0000-4000-8000-000000000000", NOW));
    expect(isDomainError(settle) && settle.code).toBe("FORBIDDEN");
    expect(await linesOf(event.id)).toHaveLength(1);
  });
});

describe("§888 «Oferă-i un loc acum» on the official list's add form", () => {
  /** The add form as posted by its second button. */
  function offerFromForm(eventId: string, name: string, addPlace?: number): FormData {
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("eventId", eventId);
    form.set("firstName", name);
    form.set("lastName", "Munteanu");
    form.set("email", `${name.toLowerCase()}@example.ro`);
    form.set("note", "");
    form.set("relayedByParticipantRequest", "on");
    form.set("intent", "offer");
    if (addPlace !== undefined) form.set("addPlace", String(addPlace));
    return form;
  }

  it("a full event: the entry and the offer in one press with the confirmed supplementary place; unconfirmed, refused with nothing written", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana");

    expect(await addToWaitlistAction(null, offerFromForm(event.id, "Luca"))).toMatchObject({ error: "SUPPLEMENTARY_PLACE_UNCONFIRMED", fields: [] });
    expect(await rowOf("Luca")).toBeUndefined();
    expect(await capacityOf(event.id)).toBe(1);

    await expect(addToWaitlistAction(null, offerFromForm(event.id, "Mara", 2))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?saved=registrationOfferedRaised&count=2&eventId=${event.id}#registrations-waitlist-add`,
    );
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("WAITLIST_OFFERED");
    expect(await capacityOf(event.id)).toBe(2);
    expect(await emailsOf(mara.id, "WAITLIST_SPOT_OFFER")).toHaveLength(1);
    expect(await emailsOf(mara.id, "WAITLIST_JOINED")).toEqual([]);
  });

  it("its first button is the add alone: on a full event the person waits at the back, and the capacity stays", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana");
    const form = offerFromForm(event.id, "Mara", 2);
    form.set("intent", "add");
    await expect(addToWaitlistAction(null, form)).rejects.toThrow(/saved=waitlistAdded/);
    expect((await rowOf("Mara")).status).toBe("WAITLISTED");
    expect(await capacityOf(event.id)).toBe(1);
  });
});
