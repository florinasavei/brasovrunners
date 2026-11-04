import { and, eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { PUBLIC_REGISTRATION_PAUSED } from "@/modules/registrations/domain/public-door";
import { NO_WAITLIST } from "@/modules/registrations/domain/waitlist";
import { isDomainError } from "@/shared/errors/domain-error";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The Administrator's control over the site's door (§906; the owner, 2026-11-03: «cumva trebuie să pot controla mai
 * bine»), on a real database:
 *
 * - «Înscrieri publice deschise» unticked refuses the public form on the server — from the caller's row and again
 *   under the lock — while every staff verb keeps working, and is set from the registrations page by an
 *   Administrator alone, audited;
 * - «Locurile libere le dau doar eu» sends a public entry to the waiting list beside a free place (or refuses it
 *   like a full race when the list takes nobody), while a staff entry still takes the free place; and while it is on
 *   no place is offered by itself, «Da» or not — the staff give every one;
 * - «Oferă-i un loc acum» ends with the person offered, so the waiting list's limit — 0 included — never refuses it;
 *   «Adaugă pe lista de așteptare» alone still honours it;
 * - «Anunță-mă când rămân N locuri» emails the Administrators once per crossing, re-armed above N;
 * - «Pe site acum» says each state the public card's predicate draws, and hands the Administrator a real tick whose
 *   save asks first — one question to close, another to open (its element tree walked, as a Server Component's);
 *   shut by that tick, the Administrator's line says only «înscrierile sunt oprite» and links to no editor, the tick
 *   «Înscrierile pe site sunt deschise» right under it with a help that follows the state saved;
 * - the editor's own save of the three settings leaves the trail, from → to, once per change, from both save paths.
 *
 * The two-connection race on the last place is `tests/concurrency/capacity.test.ts`; the switch only ever narrows
 * who takes a free place, so it adds no new way to pass the capacity.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");
const { cancelRegistrationByStaff, enterOnWaitlistByStaff, offerPlaceByStaff, setPublicRegistrationOpenByStaff } = await import("@/modules/registrations/admin-service");
const { addReserveEntry, moveReserveEntryToWaitlist } = await import("@/modules/registrations/reserve-list");
const { readPublicDoor } = await import("@/modules/registrations/public-now");
const { readWaitlistPosition } = await import("@/modules/registrations/repository");
const { saveEventAndTranslations, saveEventFields } = await import("@/modules/content/events/service");
const { default: PublicNowLine } = await import("@/modules/registrations/ui/PublicNowLine");
const { renderOutboxMessage } = await import("@/modules/notifications/render");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first: a Server Component's tree, read without a browser. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let superadmin: StaffUser;
let organizer: StaffUser;
let declarationId: string;

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
    const id = await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
    if (key === "EVENT_DECLARATION") declarationId = id;
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN", preferredLocale: "ro" }).returning();
  [superadmin] = await db.insert(staffUsers).values({ email: "super@example.ro", displayName: "Super", role: "SUPERADMIN", preferredLocale: "en" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.ro", displayName: "Organizer", role: "MODERATOR" }).returning();
});

type Over = Partial<typeof events.$inferInsert>;

async function createEvent(capacity: number | null, over: Over = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: false,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      ...over,
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
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
    publicRegistrationOpen: event.publicRegistrationOpen,
  } as EventInput;
}

const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

/** The public form as a person sends it. */
function publicSubmission(event: EventInput, name: string) {
  return submitRegistration(
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
}

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** The public form and its address confirmed: the allocator's decision for a public entry. */
async function publicEntry(event: EventInput, name: string) {
  await publicSubmission(event, name);
  return confirmEmail(db, event, (await rowOf(name)).id, NOW);
}

/** «Adaugă pe lista de așteptare», or with `offerNow` «Oferă-i un loc acum» (§872, §888). */
function staffEntry(eventId: string, name: string, offerNow?: { addPlaceTo?: number | null }) {
  return enterOnWaitlistByStaff(
    db,
    admin,
    { eventId, firstName: name, lastName: "Munteanu", email: `${name.toLowerCase()}@example.ro`, locale: "ro", relayedByParticipantRequest: true, offerNow: offerNow ?? null },
    NOW,
  );
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

const capacityOf = async (eventId: string) => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity;
const alerts = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "PLACES_ALERT"));
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

describe("«Înscrieri publice deschise» (§906)", () => {
  it("unticked, the public form is refused on the server with its marker, and nothing is written", async () => {
    const event = await createEvent(10, { publicRegistrationOpen: false });
    const error = await refusal(publicSubmission(event, "Ana"));
    expect(isDomainError(error) && error.fields).toEqual([PUBLIC_REGISTRATION_PAUSED]);
    expect(await db.select().from(registrations)).toEqual([]);
  });

  it("is asked again under the lock: a form read while the door was open meets the tick taken off since", async () => {
    const event = await createEvent(10);
    await db.update(events).set({ publicRegistrationOpen: false }).where(eq(events.id, event.id));
    // The caller's copy still says open — the row under the lock decides.
    const error = await refusal(publicSubmission({ ...event, publicRegistrationOpen: true }, "Ana"));
    expect(isDomainError(error) && error.fields).toEqual([PUBLIC_REGISTRATION_PAUSED]);
    expect(await db.select().from(registrations)).toEqual([]);
  });

  it("leaves every staff verb working: the vouched entry, «Oferă-i un loc acum» and «Trimite-i oferta»", async () => {
    const event = await createEvent(1, { publicRegistrationOpen: false });
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await staffEntry(event.id, "Ioana")).status).toBe("WAITLISTED");
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Ioana")).id, NOW, { addPlaceTo: 2 });
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect((await staffEntry(event.id, "Dana", { addPlaceTo: 3 })).status).toBe("WAITLIST_OFFERED");
  });

  it("an address confirmed after the door shut goes on as it would have: the form was sent while it was open", async () => {
    const event = await createEvent(10);
    await publicSubmission(event, "Ana");
    await db.update(events).set({ publicRegistrationOpen: false }).where(eq(events.id, event.id));
    expect((await confirmEmail(db, event, (await rowOf("Ana")).id, NOW)).status).toBe("PENDING_DECLARATION");
  });

  it("is set beside «Locuri» by an Administrator alone, audited once per change, the row's version moved", async () => {
    const event = await createEvent(10);
    const [before] = await db.select({ version: events.version }).from(events).where(eq(events.id, event.id));
    await expect(setPublicRegistrationOpenByStaff(db, organizer, event.id, false, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await setPublicRegistrationOpenByStaff(db, admin, event.id, false, NOW)).toBe(true);
    // The same tick again writes nothing.
    expect(await setPublicRegistrationOpenByStaff(db, admin, event.id, false, NOW)).toBe(false);
    const [after] = await db.select({ open: events.publicRegistrationOpen, version: events.version }).from(events).where(eq(events.id, event.id));
    expect(after).toEqual({ open: false, version: before.version + 1 });
    const rows = await trail("event.public_registration_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadataJson).toEqual({ from: true, to: false, via: "registrations" });
    expect(rows[0].actorStaffUserId).toBe(admin.id);
  });
});

describe("«Locurile libere le dau doar eu» (§906)", () => {
  it("a staff entry takes a free place; a public entry joins the waiting list beside the one left, given only by the staff", async () => {
    const event = await createEvent(3, { freePlacesByOfferOnly: true });
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    // The line's order stands: the next public entry waits behind Ana, and so does a staff entry now (§615, never ahead of anyone).
    expect((await publicEntry(event, "Ioana")).status).toBe("WAITLISTED");
    expect((await staffEntry(event.id, "Dana")).status).toBe("WAITLISTED");
    // The free places are the staff's to give: «Trimite-i oferta» to whom they choose, counted, nothing added.
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Ioana")).id, NOW, {})).status).toBe("WAITLIST_OFFERED");
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Ana")).id, NOW, {})).status).toBe("WAITLIST_OFFERED");
    expect(await capacityOf(event.id)).toBe(3);
  });

  it("with no waiting list, a public entry is refused like a full race, beside a free place", async () => {
    const event = await createEvent(5, { freePlacesByOfferOnly: true, waitlistCapacity: 0 });
    const error = await refusal(publicSubmission(event, "Ana"));
    expect(isDomainError(error) && error.fields).toEqual([NO_WAITLIST]);
    expect(await db.select().from(registrations)).toEqual([]);
    // The staff's entry takes the free place all the same.
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
  });

  it("on an uncapped event the tick means nothing: nothing is scarce, so a public entry takes its place", async () => {
    const event = await createEvent(null, { freePlacesByOfferOnly: true, waitlistAutoOffer: true });
    expect((await publicEntry(event, "Ana")).status).toBe("PENDING_DECLARATION");
  });

  it("unticked, a public entry takes a free place as before", async () => {
    const event = await createEvent(2);
    expect((await publicEntry(event, "Ana")).status).toBe("PENDING_DECLARATION");
  });

  it("wins over automatic offers: the public entry waits beside the free places, and nothing is offered by itself", async () => {
    // «Da» on the line (§615) — the tick still says «only I give the free places»: no offer to the stranger the tick
    // sent to the line a moment ago (the owner's incident), and the line's sentence promises no automatic offer.
    const event = await createEvent(2, { freePlacesByOfferOnly: true, waitlistAutoOffer: true });
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    expect((await readWaitlistPosition(db, (await rowOf("Ana")).id))?.autoOffer).toBe(false);
    // A place freed is not offered by itself either: two free now, Ana still waits.
    await cancelRegistrationByStaff(db, admin, (await rowOf("Mara")).id, "", NOW);
    expect((await rowOf("Ana")).status).toBe("WAITLISTED");
    // The staff give it: «Trimite-i oferta», counted, nothing added.
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Ana")).id, NOW, {})).status).toBe("WAITLIST_OFFERED");
    expect(await capacityOf(event.id)).toBe(2);
  });

  it("unticked again, «Da» offers the line the free places by itself once more (§615)", async () => {
    const event = await createEvent(2, { freePlacesByOfferOnly: true, waitlistAutoOffer: true });
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    await db.update(events).set({ freePlacesByOfferOnly: false }).where(eq(events.id, event.id));
    // The next allocator write fills the line first (`fillAvailableSpots`), then seats the newcomer.
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Ana")).status).toBe("WAITLIST_OFFERED");
  });
});

describe("The waiting list's emails say what the allocator does (§906)", () => {
  /** The one message of this type queued for the person, rendered as it would leave now: both halves, as text. */
  async function sent(name: string, messageType: "WAITLIST_JOINED" | "WAITLIST_SPOT_OFFER"): Promise<string> {
    const registration = await rowOf(name);
    const [row] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registration.id), eq(emailOutbox.messageType, messageType)));
    if (!row) throw new Error(`no ${messageType} queued for ${name}`);
    return (await renderOutboxMessage(row, db, NOW)).text;
  }
  const byHand = {
    ro: "La Crosul, locurile le dau organizatorii, pe rând: te-am trecut pe lista de așteptare și îți scriem când îți putem da un loc.",
    en: "At The cross, the organizers give out the places one at a time: we have put you on the waiting list and will write to you when we can give you a place.",
  };
  /** The promise after «este complet momentan»: a notice when a place frees up, or the organizers' word. */
  const autoPromise = { ro: "Te vom anunța dacă se eliberează un loc.", en: "We'll let you know if a place opens up." };
  const byHandPromise = {
    ro: "Locurile le dau organizatorii, pe rând: îți scriem când îți putem da un loc.",
    en: "The organizers give out the places one at a time: we will write to you when we can give you a place.",
  };

  it("WAITLIST_JOINED: sent to the line by the tick, the person is told the organizers give the places — never «este complet»", async () => {
    // Beside free places: the event is not full.
    const event = await createEvent(3, { freePlacesByOfferOnly: true, waitlistAutoOffer: true });
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    const beside = await sent("Ana", "WAITLIST_JOINED");
    expect(beside).toContain(byHand.ro);
    expect(beside).toContain(byHand.en);
    expect(beside).not.toContain("este complet");
    expect(beside).not.toContain("is full");

    // Every place held, the tick still in force: no place goes out by itself — still the organizers' words.
    const full = await createEvent(1, { freePlacesByOfferOnly: true });
    expect((await staffEntry(full.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(full, "Ioana")).status).toBe("WAITLISTED");
    expect(await sent("Ioana", "WAITLIST_JOINED")).toContain(byHand.ro);
  });

  it("WAITLIST_JOINED: «este complet» only while every place is held — a place freed beside the line under «Nu» is not «full»", async () => {
    const event = await createEvent(1);
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    const full = await sent("Ana", "WAITLIST_JOINED");
    // Full is true, but with «Nu» no freed place reaches anybody by itself: the organizers' promise, never «Te vom anunța…».
    expect(full).toContain(`Crosul este complet momentan, așa că te-am adăugat pe lista de așteptare. ${byHandPromise.ro}`);
    expect(full).toContain(`The cross is full right now, so we added you to the waiting list. ${byHandPromise.en}`);
    expect(full).not.toContain(autoPromise.ro);
    expect(full).not.toContain(autoPromise.en);
    expect(full).not.toContain(byHand.ro);
    // The place is freed; with «Nu» nobody is offered it by itself. The same message, rendered now, says who gives it.
    await cancelRegistrationByStaff(db, admin, (await rowOf("Mara")).id, "", NOW);
    expect((await rowOf("Ana")).status).toBe("WAITLISTED");
    const freed = await sent("Ana", "WAITLIST_JOINED");
    expect(freed).toContain(byHand.ro);
    expect(freed).toContain(byHand.en);
    expect(freed).not.toContain("este complet");
  });

  it("WAITLIST_JOINED: full with «Da» and the tick off, a freed place goes to the line by itself — the promise that says so", async () => {
    const event = await createEvent(1, { waitlistAutoOffer: true });
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(event, "Ana")).status).toBe("WAITLISTED");
    const full = await sent("Ana", "WAITLIST_JOINED");
    expect(full).toContain(`Crosul este complet momentan, așa că te-am adăugat pe lista de așteptare. ${autoPromise.ro}`);
    expect(full).toContain(`The cross is full right now, so we added you to the waiting list. ${autoPromise.en}`);
    expect(full).not.toContain(byHandPromise.ro);
    expect(full).not.toContain(byHandPromise.en);
  });

  it("WAITLIST_SPOT_OFFER: after the deadline the place passes on by itself only while places go out by themselves", async () => {
    // The tick: the Administrator's offer; after its deadline the organizers give the place again.
    const ticked = await createEvent(2, { freePlacesByOfferOnly: true, waitlistAutoOffer: true });
    expect((await publicEntry(ticked, "Ana")).status).toBe("WAITLISTED");
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Ana")).id, NOW, {})).status).toBe("WAITLIST_OFFERED");
    const byHandOffer = await sent("Ana", "WAITLIST_SPOT_OFFER");
    expect(byHandOffer).toContain("după acest termen, organizatorii pot da locul altcuiva.");
    expect(byHandOffer).toContain("after that, the organizers may give the place to someone else.");
    expect(byHandOffer).not.toContain("trece la următorul");
    expect(byHandOffer).not.toContain("passes to the next person");

    // «Da», the tick off: the freed place is offered by itself, and after its deadline passes to the next in line.
    const auto = await createEvent(1, { waitlistAutoOffer: true });
    expect((await staffEntry(auto.id, "Mara")).status).toBe("PENDING_DECLARATION");
    expect((await publicEntry(auto, "Ioana")).status).toBe("WAITLISTED");
    await cancelRegistrationByStaff(db, admin, (await rowOf("Mara")).id, "", NOW);
    expect((await rowOf("Ioana")).status).toBe("WAITLIST_OFFERED");
    const passes = await sent("Ioana", "WAITLIST_SPOT_OFFER");
    expect(passes).toContain("după acest termen, locul trece la următorul de pe lista de așteptare.");
    expect(passes).toContain("after that, the place passes to the next person on the waiting list.");
    expect(passes).not.toContain("organizatorii pot da locul altcuiva");
  });
});

describe("«Oferă-i un loc acum» is never refused by the waiting list's limit (§906)", () => {
  it("a full event with no waiting list: the entry ends offered, with the one supplementary place the dialog named", async () => {
    const event = await createEvent(1, { waitlistCapacity: 0 });
    expect((await staffEntry(event.id, "Mara")).status).toBe("PENDING_DECLARATION");
    const entered = await staffEntry(event.id, "Ioana", { addPlaceTo: 2 });
    expect(entered).toMatchObject({ status: "WAITLIST_OFFERED", capacityRaisedTo: 2 });
    expect(await capacityOf(event.id)).toBe(2);
    // «Istoric capacitate»'s fields on the raise (§NNN): the row's version, the places taken and the press.
    expect((await trail("event.capacity_raised_for_offer")).map((row) => row.metadataJson)).toEqual([
      { from: 1, to: 2, registrationId: entered.registrationId, version: expect.any(Number), occupied: 1, via: "offerNow" },
    ]);
  });

  it("a full line at its limit: the same", async () => {
    const event = await createEvent(1, { waitlistCapacity: 1 });
    await staffEntry(event.id, "Mara");
    expect((await staffEntry(event.id, "Ana")).status).toBe("WAITLISTED");
    expect((await staffEntry(event.id, "Ioana", { addPlaceTo: 2 })).status).toBe("WAITLIST_OFFERED");
  });

  it("from a line of the internal list too, the line gone", async () => {
    const event = await createEvent(1, { waitlistCapacity: 0 });
    await staffEntry(event.id, "Mara");
    const { id } = await addReserveEntry(db, admin, event.id, { firstName: "Ioana", lastName: "Munteanu", email: "ioana@example.ro", note: "" }, NOW);
    const placed = await moveReserveEntryToWaitlist(db, admin, id, { email: "", relayedByParticipantRequest: true, locale: "ro", offerNow: { addPlaceTo: 2 } }, NOW);
    expect(placed.status).toBe("WAITLIST_OFFERED");
    expect(await db.select().from(eventReserveEntries).where(eq(eventReserveEntries.eventId, event.id))).toEqual([]);
  });

  it("«Adaugă pe lista de așteptare» alone, which leaves the person waiting, still honours the limit (§348)", async () => {
    const event = await createEvent(1, { waitlistCapacity: 0 });
    await staffEntry(event.id, "Mara");
    const error = await refusal(staffEntry(event.id, "Ioana"));
    expect(isDomainError(error) && error.fields).toEqual([NO_WAITLIST]);
    expect(await rowOf("Ioana")).toBeUndefined();
  });

  it("an offer the dialog did not confirm takes the whole entry back: nobody is left waiting past the limit", async () => {
    const event = await createEvent(1, { waitlistCapacity: 0 });
    await staffEntry(event.id, "Mara");
    await expect(staffEntry(event.id, "Ioana", {})).rejects.toBeTruthy();
    expect(await rowOf("Ioana")).toBeUndefined();
  });
});

describe("«Anunță-mă când rămân N locuri» (§906)", () => {
  it("emails every Administrator once per crossing — down to N, then 0 — and again only after climbing back above N", async () => {
    const event = await createEvent(3, { placesAlertAt: 1 });
    await staffEntry(event.id, "Ana");
    expect(await alerts()).toEqual([]);

    // 3 → 1 free: the «N or fewer» email, to the Administrator and the Superadministrator, each in their language; never the Organizer.
    await staffEntry(event.id, "Mara");
    let sent = await alerts();
    expect(sent.map((row) => [row.recipientEmail, row.locale]).sort()).toEqual([
      [admin.email, "ro"],
      [superadmin.email, "en"],
    ]);
    expect(sent.every((row) => (row.payloadJson as { stage: string; free: number }).stage === "LOW" && (row.payloadJson as { free: number }).free === 1)).toBe(true);

    // 1 → 0: the «full» email, once.
    await staffEntry(event.id, "Ioana");
    sent = await alerts();
    expect(sent.filter((row) => (row.payloadJson as { stage: string }).stage === "FULL")).toHaveLength(2);

    // A place frees (0 → 1, still ≤ N) and is taken again: nothing more.
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ioana")).id, "", NOW);
    await staffEntry(event.id, "Dana");
    expect(await alerts()).toHaveLength(4);

    // Two places free (2 > N): re-armed; down to 1 again: one more «N or fewer» email each.
    await cancelRegistrationByStaff(db, admin, (await rowOf("Dana")).id, "", NOW);
    await cancelRegistrationByStaff(db, admin, (await rowOf("Mara")).id, "", NOW);
    const [armed] = await db.select({ sent: events.placesAlertSent }).from(events).where(eq(events.id, event.id));
    expect(armed.sent).toBeNull();
    await staffEntry(event.id, "Elena");
    expect((await alerts()).filter((row) => (row.payloadJson as { stage: string }).stage === "LOW")).toHaveLength(4);
  });

  it("a drop straight to 0 sends the «full» email alone; a public entry's place crosses it too", async () => {
    const event = await createEvent(1, { placesAlertAt: 0 });
    await publicEntry(event, "Ana");
    const sent = await alerts();
    expect(sent).toHaveLength(2);
    expect(sent.every((row) => (row.payloadJson as { stage: string }).stage === "FULL")).toBe(true);
  });

  it("off, nobody is emailed", async () => {
    const event = await createEvent(1);
    await staffEntry(event.id, "Ana");
    expect(await alerts()).toEqual([]);
  });
});

describe("«Pe site acum» (§906)", () => {
  async function line(eventId: string): Promise<string> {
    const door = await readPublicDoor(db, eventId, NOW);
    if (!door) throw new Error("no door");
    return renderToStaticMarkup(await PublicNowLine({ door, eventId, locale: "ro", listQuery: "" }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("says the button while a newcomer takes a free place", async () => {
    const event = await createEvent(5);
    expect(await line(event.id)).toContain("Pe site acum: butonul «Înscrie-te» — primul venit ia un loc liber.");
  });

  it("says the waiting list's door, with how full the line is, when the places are the staff's or gone", async () => {
    const offersOnly = await createEvent(5, { freePlacesByOfferOnly: true, waitlistCapacity: 20 });
    expect(await line(offersOnly.id)).toContain("Pe site acum: «Intră pe lista de așteptare» — 0 din 20 de locuri pe listă.");
    const full = await createEvent(1);
    await staffEntry(full.id, "Mara");
    await staffEntry(full.id, "Ana");
    expect(await line(full.id)).toContain("Pe site acum: «Intră pe lista de așteptare» — 1 pe listă, fără limită.");
  });

  it("says closed, and why: the tick, the line that takes nobody, the dates", async () => {
    const paused = await createEvent(5, { publicRegistrationOpen: false });
    expect(await line(paused.id)).toContain("Pe site acum: înscrierile sunt închise — bifa «Înscrieri publice deschise» e scoasă.");
    const offersOnly = await createEvent(5, { freePlacesByOfferOnly: true, waitlistCapacity: 0 });
    expect(await line(offersOnly.id)).toContain("locurile libere le dai doar tu, iar lista de așteptare nu mai primește pe nimeni");
    const noList = await createEvent(1, { waitlistCapacity: 0 });
    await staffEntry(noList.id, "Mara");
    expect(await line(noList.id)).toContain("locurile s-au ocupat și evenimentul nu are listă de așteptare");
    const over = await createEvent(5, { registrationClosesAt: new Date(NOW.getTime() - 60_000) });
    expect(await line(over.id)).toContain("perioada de înscriere s-a încheiat");
  });

  it("links to the editor's fold that changes it, and tells the Organizer the tick's state read-only", async () => {
    const paused = await createEvent(5, { publicRegistrationOpen: false });
    const door = await readPublicDoor(db, paused.id, NOW);
    if (!door) throw new Error("no door");
    const html = renderToStaticMarkup(await PublicNowLine({ door, eventId: paused.id, locale: "ro", listQuery: "" }));
    expect(html).toContain(`/ro/admin/events/${paused.id}#box-registration-window`);
    expect(html).toContain("Înscrierile pe site sunt oprite de un Administrator.");
    expect(html).not.toContain("registrations-public-door-form");
  });

  it("hands the Administrator a real tick and its own save, which asks first: one question to close, another to open", async () => {
    const event = await createEvent(5);
    const action = vi.fn();
    const drawn = async (listQuery: string) => {
      const door = await readPublicDoor(db, event.id, NOW);
      if (!door) throw new Error("no door");
      return elements(await PublicNowLine({ door, eventId: event.id, locale: "ro", listQuery, publicDoorAction: action }));
    };
    const all = await drawn("eventId=1");
    const form = all.find((element) => element.props.scope === "public-door");
    expect(form?.props.action).toBe(action);
    // The question is chosen by the box as it is pressed: unticked closes, ticked opens — each in its own words.
    expect(form?.props.confirm).toEqual([
      {
        when: [{ field: "publicRegistrationOpen", notEquals: "on" }],
        title: ro.Admin.confirm.publicDoorCloseTitle,
        body: ro.Admin.confirm.publicDoorCloseBody,
        confirmLabel: ro.Admin.confirm.publicDoorCloseConfirm,
        cancelLabel: ro.Admin.confirm.cancel,
      },
      {
        when: [{ field: "publicRegistrationOpen", equals: "on" }],
        title: ro.Admin.confirm.publicDoorOpenTitle,
        body: ro.Admin.confirm.publicDoorOpenBody,
        confirmLabel: ro.Admin.confirm.publicDoorOpenConfirm,
        cancelLabel: ro.Admin.confirm.cancel,
      },
    ]);
    // A real tick box, ticked as the row stands — never a toggle button — and its own save, with a glyph.
    expect(all.find((element) => element.props.name === "publicRegistrationOpen")?.props).toMatchObject({ defaultChecked: true, children: ro.Admin.registrations.publicDoor.label });
    expect(all.find((element) => element.props["data-testid"] === "registrations-public-door-save")?.props).toMatchObject({ icon: "save", type: "submit" });
    // What the action reads: the language, the event and the list to come back to.
    const hidden = all.filter((element) => element.type === "input" && element.props.type === "hidden").map((element) => [element.props.name, element.props.value]);
    expect(Object.fromEntries(hidden)).toEqual({ uiLocale: "ro", eventId: event.id, listQuery: "eventId=1" });

    // The tick off on the row: drawn unticked, so the press that saves it ticked is the opening one.
    await db.update(events).set({ publicRegistrationOpen: false }).where(eq(events.id, event.id));
    expect((await drawn("")).find((element) => element.props.name === "publicRegistrationOpen")?.props.defaultChecked).toBe(false);
  });

  describe("shut by the tick, with the tick drawn under it (the owner, 2026-11-04: the setting offered twice on one line)", () => {
    /** The Administrator's line and tick, as a tree: the sentence, the editor's link, the tick and its help. */
    async function administrators(eventId: string) {
      const door = await readPublicDoor(db, eventId, NOW);
      if (!door) throw new Error("no door");
      const all = elements(await PublicNowLine({ door, eventId, locale: "ro", listQuery: "", publicDoorAction: vi.fn() }));
      const byTestId = (id: string) => all.find((element) => element.props["data-testid"] === id);
      return {
        sentence: byTestId("registrations-public-now-line")?.props.children,
        editorLink: byTestId("registrations-public-now-setting"),
        tick: all.find((element) => element.props.name === "publicRegistrationOpen")?.props,
        help: byTestId("registrations-public-door-help")?.props.children,
      };
    }

    it("says only that registration is stopped, links to no editor, and the tick under it says how to open it again", async () => {
      const paused = await createEvent(5, { publicRegistrationOpen: false });
      const drawn = await administrators(paused.id);
      expect(drawn.sentence).toBe("Pe site acum: înscrierile sunt oprite.");
      expect(drawn.editorLink).toBeUndefined();
      expect(drawn.tick).toMatchObject({ defaultChecked: false, children: "Înscrierile pe site sunt deschise" });
      expect(drawn.help).toBe("Bifează și apasă «Salvează» ca să le redeschizi.");
    });

    it("open, the tick's help says how to stop it, and the line keeps the editor's link", async () => {
      const open = await createEvent(5);
      const drawn = await administrators(open.id);
      expect(drawn.sentence).toBe("Pe site acum: butonul «Înscrie-te» — primul venit ia un loc liber.");
      expect(drawn.editorLink?.props.href).toBe(`/ro/admin/events/${open.id}#box-places-control`);
      expect(drawn.tick).toMatchObject({ defaultChecked: true, children: "Înscrierile pe site sunt deschise" });
      expect(drawn.help).toBe("Debifează și apasă «Salvează» ca să le oprești; tot ce face echipa merge mai departe.");
    });

    it("shut by anything else — the dates, the tick off as well — keeps the reason and the editor, where that changes", async () => {
      const over = await createEvent(5, { publicRegistrationOpen: false, registrationClosesAt: new Date(NOW.getTime() - 60_000) });
      const drawn = await administrators(over.id);
      expect(drawn.sentence).toBe("Pe site acum: înscrierile sunt închise — perioada de înscriere s-a încheiat.");
      expect(drawn.editorLink?.props.href).toBe(`/ro/admin/events/${over.id}#box-registration-window`);
      const shut = await createEvent(5, { freePlacesByOfferOnly: true, waitlistCapacity: 0 });
      const offersOnly = await administrators(shut.id);
      expect(offersOnly.sentence).toContain("locurile libere le dai doar tu");
      expect(offersOnly.editorLink?.props.href).toBe(`/ro/admin/events/${shut.id}#box-places-control`);
    });

    it("the Organizer, who is handed no tick, keeps the reason and the editor's link, and reads the state", async () => {
      const paused = await createEvent(5, { publicRegistrationOpen: false });
      const door = await readPublicDoor(db, paused.id, NOW);
      if (!door) throw new Error("no door");
      const html = renderToStaticMarkup(await PublicNowLine({ door, eventId: paused.id, locale: "ro", listQuery: "" }));
      expect(html).toContain("bifa «Înscrieri publice deschise» e scoasă");
      expect(html).not.toContain("înscrierile sunt oprite.");
      expect(html).toContain("registrations-public-now-setting");
      expect(html).toContain("Înscrierile pe site sunt oprite de un Administrator.");
    });
  });

  it("says, while «Locurile libere le dau doar eu» is on, that no place goes out by itself — and nothing of it otherwise", async () => {
    const note = ro.Admin.registrations.publicNow.offersOnly;
    // «Da» on the line, the tick on: the place is the staff's to give all the same (option a).
    const offersOnly = await createEvent(5, { freePlacesByOfferOnly: true, waitlistAutoOffer: true, waitlistCapacity: 20 });
    expect(await line(offersOnly.id)).toContain(note);
    const shut = await createEvent(5, { freePlacesByOfferOnly: true, waitlistCapacity: 0 });
    expect(await line(shut.id)).toContain(note);
    expect(await line((await createEvent(5, { waitlistAutoOffer: true })).id)).not.toContain(note);
    // Uncapped, the tick means nothing, so nothing is said of it.
    expect(await line((await createEvent(null, { freePlacesByOfferOnly: true })).id)).not.toContain(note);
  });
});

describe("The editor's save of the registration controls leaves the trail (§906)", () => {
  /** The editor's fields for the row as posted (as `cms/capacity-raise.test.ts` posts them), with the changes given. */
  async function editorFields(eventId: string, changes: Record<string, unknown>) {
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    return {
      row,
      fields: {
        type: row.type,
        eventStatus: row.eventStatus,
        timezone: row.timezone,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        endsAtWallTime: toWallTimeInput(row.endsAt, row.timezone),
        raceStartsAtWallTime: "",
        locationName: row.locationName ?? "",
        locationAddress: "",
        surface: row.surface,
        difficulty: null,
        costType: null,
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: row.registrationMode,
        participantListVisibility: "HIDDEN" as const,
        capacity: row.capacity === null ? "" : String(row.capacity),
        registrationOpensAtWallTime: toWallTimeInput(row.registrationOpensAt, row.timezone),
        registrationClosesAtWallTime: toWallTimeInput(row.registrationClosesAt, row.timezone),
        declarationDocumentId: row.declarationDocumentId ?? "",
        externalProvider: "",
        externalRegistrationUrl: "",
        ...changes,
      },
    };
  }

  /** The editor's one save of the fields and the translations (`saveEventAndTranslations`). */
  async function editorSave(eventId: string, changes: Record<string, unknown>) {
    const { row, fields } = await editorFields(eventId, changes);
    const translation = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId))).find((t) => t.locale === "ro");
    if (!translation) throw new Error("no ro translation");
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId,
      fields,
      expectedVersion: row.version,
      translations: [
        {
          translationId: translation.id,
          expectedVersion: translation.version,
          fields: { slug: translation.slug, title: translation.title, excerpt: translation.excerpt ?? "", seoTitle: "", seoDescription: "" },
        },
      ],
      acknowledgeLiveEdit: true,
      scope: "this",
      now: NOW,
    });
  }

  /** The fields-only save (`saveEventFields`): the editor's other path to the same columns. */
  async function fieldsSave(eventId: string, changes: Record<string, unknown>) {
    const { row, fields } = await editorFields(eventId, changes);
    return saveEventFields(db, { actor: admin, eventId, fields, expectedVersion: row.version, now: NOW });
  }

  it("unticking «Înscrieri publice deschise» in the editor writes one row, from → to; a save that moves nothing writes none", async () => {
    const event = await createEvent(10, { surface: "ASPHALT", declarationDocumentId: declarationId });
    await editorSave(event.id, { publicRegistrationOpen: false });
    const [saved] = await db.select().from(events).where(eq(events.id, event.id));
    expect(saved.publicRegistrationOpen).toBe(false);
    const rows = await trail("event.public_registration_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: event.id, metadataJson: { from: true, to: false } });

    await editorSave(event.id, { publicRegistrationOpen: false });
    expect(await trail("event.public_registration_changed")).toHaveLength(1);
  });

  it("«Locurile libere le dau doar eu» and «Anunță-mă când rămân N locuri» each leave their own row", async () => {
    const event = await createEvent(10, { surface: "ASPHALT", declarationDocumentId: declarationId });
    await editorSave(event.id, { freePlacesByOfferOnly: true, placesAlertAt: "3" });
    expect((await trail("event.free_places_by_offer_only_changed")).map((row) => row.metadataJson)).toEqual([{ from: false, to: true }]);
    expect((await trail("event.places_alert_changed")).map((row) => row.metadataJson)).toEqual([{ from: null, to: 3 }]);
    expect(await trail("event.public_registration_changed")).toEqual([]);
  });

  it("the fields-only save leaves the same trail: the door unticked, then ticked again, one row each", async () => {
    const event = await createEvent(10, { surface: "ASPHALT", declarationDocumentId: declarationId });
    await fieldsSave(event.id, { publicRegistrationOpen: false });
    await fieldsSave(event.id, { publicRegistrationOpen: false });
    await fieldsSave(event.id, { publicRegistrationOpen: true });
    const rows = await trail("event.public_registration_changed");
    expect(rows.map((row) => [row.actorStaffUserId, row.entityId, row.metadataJson])).toEqual([
      [admin.id, event.id, { from: true, to: false }],
      [admin.id, event.id, { from: false, to: true }],
    ]);
  });

  it("a new N forgets what the alert said for the old one, from either save path, so a raised N is told again; the same N keeps it", async () => {
    const event = await createEvent(10, { surface: "ASPHALT", declarationDocumentId: declarationId, placesAlertAt: 2 });
    const remembered = async () => (await db.select({ sent: events.placesAlertSent }).from(events).where(eq(events.id, event.id)))[0].sent;
    // Ten places, eight taken: two free, at N — the «N or fewer» email to the two Administrators, remembered.
    for (const name of ["Ana", "Mara", "Ioana", "Dana", "Elena", "Irina", "Oana", "Raluca"]) await staffEntry(event.id, name);
    expect(await remembered()).toBe("LOW");
    expect(await alerts()).toHaveLength(2);

    // Saved with the same N: the memory stays, and the next place taken tells nobody again.
    await editorSave(event.id, { placesAlertAt: "2" });
    expect(await remembered()).toBe("LOW");

    // N raised to 5 while two are free: forgotten — the next place taken tells the Administrators at the new N.
    await editorSave(event.id, { placesAlertAt: "5" });
    expect(await remembered()).toBeNull();
    await staffEntry(event.id, "Paula");
    expect(await remembered()).toBe("LOW");
    const sent = await alerts();
    expect(sent).toHaveLength(4);
    // One «N or fewer» email to each Administrator, at the new N.
    expect(sent.filter((row) => (row.payloadJson as { alertAt: number }).alertAt === 5).map((row) => (row.payloadJson as { stage: string }).stage)).toEqual(["LOW", "LOW"]);

    // The fields-only save does the same: a new N forgets, the same N keeps.
    await fieldsSave(event.id, { placesAlertAt: "5" });
    expect(await remembered()).toBe("LOW");
    await fieldsSave(event.id, { placesAlertAt: "3" });
    expect(await remembered()).toBeNull();
  });
});
