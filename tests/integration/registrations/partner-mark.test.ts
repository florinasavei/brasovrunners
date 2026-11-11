import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { PARTNER_NAME_MAX, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canKeepRegistrationNotes, canManageRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { HIDDEN_LIST_OFF } from "@/modules/registrations/domain/hidden-list";
import { isDomainError } from "@/shared/errors/domain-error";
import { readSheet } from "../../helpers/xlsx";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «De la parteneri» (the decision «De la parteneri»; the owner, 2026-11-11: who came through a partner or a sponsor, by the
 * partner's name; BR-REQ-037-05, BR-REQ-060-01) — one nullable `partner_name` on a registration, a line of the internal list
 * and an invitation, set by a tick and its box, carried with the person, read by the backoffice alone, audited without the name.
 * Read from a real database (PGlite, the same migrations as Neon), with made-up people and made-up partners.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  // The coarse gate, as the real one asks it: the role's capability, refused FORBIDDEN otherwise.
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
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
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { cancelRegistrationByStaff, createRegistrationByStaff, deleteRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { confirmEmail, inviteToEventByStaff, submitRegistration } = await import("@/modules/registrations/service");
const { acceptInvitation } = await import("@/modules/registrations/invitations");
const { addReserveEntry, listReserveEntries, moveReserveEntryToElite, moveReserveEntryToOwnAddress, moveReserveEntryToWaitlist, saveReservePartner, settleReserveEntry } = await import(
  "@/modules/registrations/reserve-list"
);
const { listPartnerSuggestions, parsePartnerMark, setRegistrationPartner, suggestPartnerNames } = await import("@/modules/registrations/partner-mark");
const { countRegistrationsForAdmin, listRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");
const { exportPersonData } = await import("@/modules/registrations/person-data");
const { pruneExpiredRows } = await import("@/modules/jobs/retention");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { addReserveEntryAction, saveReservePartnerAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");
const { setRegistrationPartnerAction } = await import("@/app/[locale]/admin/registrations/[id]/partner-actions");
const { inviteAction } = await import("@/app/[locale]/admin/registrations/invitation-actions");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

// The actions read the wall clock: a race a month from now, every press today.
const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** Made-up partners: no real sponsor's name. */
const PARTNER = "Brutăria Exemplu";
const OTHER_PARTNER = "Cafeneaua de Test";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let serial = 0;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  admin = await staff("ADMIN");
  organizer = await staff("MODERATOR");
  state.actor = admin;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@example.invalid`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function createEvent(capacity: number | null, extra: Partial<typeof events.$inferInsert> = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: false,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      ...extra,
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

/** The public form, as the invitation's link or anybody posts it. */
const submission = (firstName: string, email: string, sentAt: Date) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** A registration through the staff entry, its address vouched for: in the event's places. */
async function entered(eventId: string, name: string): Promise<string> {
  const { registrationId } = await createRegistrationByStaff(
    db,
    admin,
    { eventId, firstName: name, lastName: "Munteanu", email: `${name.toLowerCase()}@example.invalid`, locale: "ro", listOptOut: true, relayedByParticipantRequest: true, vouchAddress: true },
    at(1),
  );
  return registrationId!;
}

const ENTRY = (name: string, extra: Record<string, unknown> = {}) => ({ firstName: name, lastName: "Munteanu", email: `${name.toLowerCase()}@example.invalid`, note: "", ...extra });

async function refusal(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

/** Where a press that succeeded sends the browser: the mocked redirect's address. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

const partnerTrail = () => db.select().from(auditLogs).where(eq(auditLogs.action, "registration.partner_set"));

/** The secret the newest invitation email to `email` carries, and the email's words. */
async function invitationSecretFor(email: string, when: Date): Promise<{ secret: string; words: string }> {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION")))
    .filter((row) => row.recipientEmail === email)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = await renderOutboxMessage({ ...rows[0], status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return { secret: match[1], words: [message.subject, message.text, message.html].join("\n") };
}

/**
 * Every email the outbox holds that would still leave, rendered as the drain would: subject, text and HTML. An invitation's
 * email whose invitation was taken up is withdrawn at its render (`OutboxMessageWithdrawn`): nothing leaves, nothing to read.
 */
async function everyEmail(when: Date): Promise<string> {
  const rows = await db.select().from(emailOutbox);
  const texts: string[] = [];
  for (const row of rows) {
    try {
      const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
      texts.push(message.subject, message.text, message.html);
    } catch (error) {
      if ((error as Error).name !== "OutboxMessageWithdrawn" && !/no longer open/.test((error as Error).message)) throw error;
    }
  }
  expect(texts.length).toBeGreaterThan(0);
  return texts.join("\n");
}

describe("the tick and its box", () => {
  it("is the name when ticked, none when unticked, and refused at the box when ticked without one", () => {
    expect(parsePartnerMark({ partner: "on", partnerName: `  ${PARTNER}  ` })).toBe(PARTNER);
    expect(parsePartnerMark({ partner: null, partnerName: PARTNER })).toBeNull();
    expect(parsePartnerMark({ partner: undefined, partnerName: undefined })).toBeNull();
    for (const empty of ["", "   ", null]) {
      let error: unknown;
      try {
        parsePartnerMark({ partner: "on", partnerName: empty });
      } catch (caught) {
        error = caught;
      }
      expect(isDomainError(error) && [error.code, error.fields]).toEqual(["PARTNER_NAME_MISSING", ["partnerName"]]);
    }
    let long: unknown;
    try {
      parsePartnerMark({ partner: "on", partnerName: "x".repeat(PARTNER_NAME_MAX + 1) });
    } catch (caught) {
      long = caught;
    }
    expect(isDomainError(long) && long.fields).toEqual(["partnerName"]);
    expect(parsePartnerMark({ partner: "on", partnerName: "x".repeat(PARTNER_NAME_MAX) })).toHaveLength(PARTNER_NAME_MAX);
  });
});

describe("who may set it, in each of the three places (the service and the action, every role)", () => {
  it("a line of the internal list — at the add and in the line's fold — the Organizer and above", async () => {
    const event = await createEvent(5);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      const allowed = canKeepRegistrationNotes(role);
      if (allowed) {
        const { id } = await addReserveEntry(db, actor, event.id, ENTRY(`Ana${role}`, { partner: "on", partnerName: PARTNER }), at(1));
        expect((await saveReservePartner(db, actor, id, { partner: "on", partnerName: OTHER_PARTNER }, at(2))).changed, role).toBe(true);
      } else {
        expect((await refusal(addReserveEntry(db, actor, event.id, ENTRY(`Ana${role}`, { partner: "on", partnerName: PARTNER }), at(1)))).code, role).toBe("FORBIDDEN");
        const { id } = await addReserveEntry(db, organizer, event.id, ENTRY(`Ion${role}`), at(1));
        expect((await refusal(saveReservePartner(db, actor, id, { partner: "on", partnerName: PARTNER }, at(2)))).code, role).toBe("FORBIDDEN");
      }
      // The presses, behind the same gate.
      state.actor = actor;
      const added = addReserveEntryAction(null, form({ eventId: event.id, firstName: `Dan${role}`, lastName: "Munteanu", email: "", note: "", partner: "on", partnerName: PARTNER }));
      if (allowed) expect(await redirectOf(added), role).toContain("saved=reserveAdded");
      else expect((await added)?.error, role).toBe("FORBIDDEN");
      const { id: lineId } = await addReserveEntry(db, organizer, event.id, ENTRY(`Eva${role}`), at(3));
      const saved = saveReservePartnerAction(null, form({ entryId: lineId, partner: "on", partnerName: PARTNER, listQuery: `eventId=${event.id}&sort=name` }));
      if (allowed) {
        const to = await redirectOf(saved);
        expect(to, role).toContain("saved=partnerSaved");
        expect(to, role).toContain("sort=name");
        // Nothing typed in the address.
        expect(decodeURIComponent(to), role).not.toContain(PARTNER);
      } else expect((await saved)?.error, role).toBe("FORBIDDEN");
    }
    const lines = await listReserveEntries(db, organizer, event.id);
    // Written exactly where a role was allowed.
    for (const role of STAFF_ROLES) {
      const own = lines.find((line) => line.firstName === `Ana${role}`);
      expect(own?.partnerName ?? null, role).toBe(canKeepRegistrationNotes(role) ? OTHER_PARTNER : null);
      expect(lines.find((line) => line.firstName === `Eva${role}`)?.partnerName ?? null, role).toBe(canKeepRegistrationNotes(role) ? PARTNER : null);
    }
  });

  it("an invitation's send — one tick and name for the press — the Administrator alone", async () => {
    const event = await createEvent(20);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      const send = inviteToEventByStaff(db, event, { people: [{ name: `Mara ${role}`, email: `mara-${role.toLowerCase()}@example.invalid` }], days: 3, outsideCapacity: false, partnerName: PARTNER }, actor, at(1));
      if (canManageRegistrations(role)) await send;
      else expect((await refusal(send)).code, role).toBe("FORBIDDEN");
      state.actor = actor;
      const posted = form({ eventId: event.id, days: "3", partner: "on", partnerName: OTHER_PARTNER });
      posted.append("inviteeName", `Dan ${role}`);
      posted.append("inviteeEmail", `dan-${role.toLowerCase()}@example.invalid`);
      const pressed = inviteAction(null, posted);
      if (canManageRegistrations(role)) expect(await redirectOf(pressed), role).toContain("saved=invitationsSent");
      else expect((await pressed)?.error, role).toBe("FORBIDDEN");
    }
    const stored = await db.select({ name: eventInvitations.name, partnerName: eventInvitations.partnerName }).from(eventInvitations);
    expect(stored.map((row) => row.name).sort()).toEqual(["Dan ADMIN", "Dan SUPERADMIN", "Mara ADMIN", "Mara SUPERADMIN"]);
    for (const row of stored) expect(row.partnerName, row.name).toBe(row.name.startsWith("Mara") ? PARTNER : OTHER_PARTNER);
  });

  it("a registration — on its page — the Administrator alone", async () => {
    const event = await createEvent(20);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      const id = await entered(event.id, `Ana${role}`);
      const set = setRegistrationPartner(db, actor, id, { partner: "on", partnerName: PARTNER }, at(2));
      if (canManageRegistrations(role)) expect((await set).changed, role).toBe(true);
      else expect((await refusal(set)).code, role).toBe("FORBIDDEN");
      state.actor = actor;
      const pressed = setRegistrationPartnerAction(null, form({ registrationId: id, partner: "on", partnerName: OTHER_PARTNER }));
      if (canManageRegistrations(role)) {
        const to = await redirectOf(pressed);
        expect(to, role).toContain("saved=partnerSaved");
        expect(decodeURIComponent(to), role).not.toContain(OTHER_PARTNER);
      } else expect((await pressed)?.error, role).toBe("FORBIDDEN");
      expect((await rowOf(`Ana${role}`)).partnerName, role).toBe(canManageRegistrations(role) ? OTHER_PARTNER : null);
    }
  });
});

describe("the tick without a name is refused at the box, and unticking clears it", () => {
  it("on a line: at the add and in the fold", async () => {
    const event = await createEvent(5);
    const missing = await refusal(addReserveEntry(db, organizer, event.id, ENTRY("Ana", { partner: "on", partnerName: "  " }), at(1)));
    expect([missing.code, missing.fields]).toEqual(["PARTNER_NAME_MISSING", ["partnerName"]]);
    expect(await db.select().from(eventReserveEntries)).toEqual([]);
    // The press keeps what was typed and names the box.
    state.actor = organizer;
    const outcome = await addReserveEntryAction(null, form({ eventId: event.id, firstName: "Ana", lastName: "Munteanu", email: "", note: "", partner: "on", partnerName: "" }));
    expect(outcome).toMatchObject({ error: "PARTNER_NAME_MISSING", fields: ["partnerName"], values: { firstName: ["Ana"], partner: ["on"] } });

    const { id } = await addReserveEntry(db, organizer, event.id, ENTRY("Ana", { partner: "on", partnerName: PARTNER }), at(1));
    expect((await refusal(saveReservePartner(db, organizer, id, { partner: "on", partnerName: "" }, at(2)))).code).toBe("PARTNER_NAME_MISSING");
    expect(await saveReservePartner(db, organizer, id, { partner: "on", partnerName: PARTNER }, at(3))).toEqual({ eventId: event.id, changed: false });
    expect(await saveReservePartner(db, organizer, id, { partner: null, partnerName: PARTNER }, at(4))).toEqual({ eventId: event.id, changed: true });
    expect((await listReserveEntries(db, organizer, event.id))[0].partnerName).toBeNull();
  });

  it("at the send: nothing is sent", async () => {
    const event = await createEvent(5);
    state.actor = admin;
    const posted = form({ eventId: event.id, days: "3", partner: "on", partnerName: " " });
    posted.append("inviteeName", "Mara Munteanu");
    posted.append("inviteeEmail", "mara@example.invalid");
    expect((await inviteAction(null, posted))?.error).toBe("PARTNER_NAME_MISSING");
    expect(await db.select().from(eventInvitations)).toEqual([]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("on a registration: refused at the box, cleared by the untick, a second save writing nothing", async () => {
    const event = await createEvent(5);
    const id = await entered(event.id, "Ana");
    state.actor = admin;
    const outcome = await setRegistrationPartnerAction(null, form({ registrationId: id, partner: "on", partnerName: "" }));
    expect(outcome).toMatchObject({ error: "PARTNER_NAME_MISSING", fields: ["partnerName"] });
    expect((await rowOf("Ana")).partnerName).toBeNull();
    expect(await redirectOf(setRegistrationPartnerAction(null, form({ registrationId: id, partner: "on", partnerName: PARTNER })))).toContain("saved=partnerSaved");
    expect(await redirectOf(setRegistrationPartnerAction(null, form({ registrationId: id, partner: "on", partnerName: PARTNER })))).toContain("saved=partnerUnchanged");
    expect(await redirectOf(setRegistrationPartnerAction(null, form({ registrationId: id, partnerName: PARTNER })))).toContain("saved=partnerCleared");
    expect((await rowOf("Ana")).partnerName).toBeNull();
    // Two changes, two trail rows: whether a name is present, never the name.
    expect((await partnerTrail()).map((row) => [row.actorStaffUserId, row.entityId, row.metadataJson])).toEqual([
      [admin.id, id, { partner: true }],
      [admin.id, id, { partner: false }],
    ]);
  });
});

describe("it travels with the person", () => {
  it("«Mută pe lista oficială» carries it onto the registration in the move's transaction", async () => {
    const event = await createEvent(5);
    const { id } = await addReserveEntry(db, admin, event.id, ENTRY("Mara", { partner: "on", partnerName: PARTNER }), at(1));
    const moved = await moveReserveEntryToWaitlist(db, admin, id, { email: null, relayedByParticipantRequest: true, locale: "ro" }, at(2));
    const mara = await rowOf("Mara");
    expect(mara.id).toBe(moved.registrationId);
    expect(mara.partnerName).toBe(PARTNER);
    expect((await partnerTrail()).map((row) => [row.actorStaffUserId, row.entityId, row.metadataJson])).toEqual([[admin.id, mara.id, { partner: true, via: "reserve" }]]);
    expect(await db.select().from(eventReserveEntries)).toEqual([]);
  });

  it("«Oferă-i un loc acum» carries it, the person offered the one supplementary place", async () => {
    const event = await createEvent(1);
    await entered(event.id, "Ana");
    const { id } = await addReserveEntry(db, admin, event.id, ENTRY("Mara", { partner: "on", partnerName: PARTNER }), at(1));
    const moved = await moveReserveEntryToWaitlist(db, admin, id, { email: null, relayedByParticipantRequest: true, locale: "ro", offerNow: { addPlaceTo: 2 } }, at(2));
    expect(moved.status).toBe("WAITLIST_OFFERED");
    expect((await rowOf("Mara")).partnerName).toBe(PARTNER);
  });

  it("«Pe adresa mea, invitat special» carries it; a refused press writes nothing and keeps the line's name", async () => {
    const off = await createEvent(5);
    const { id: kept } = await addReserveEntry(db, admin, off.id, ENTRY("Ion", { email: "", partner: "on", partnerName: PARTNER }), at(1));
    expect((await refusal(moveReserveEntryToOwnAddress(db, admin, kept, { relayedByParticipantRequest: true, locale: "ro" }, at(2)))).fields).toContain(HIDDEN_LIST_OFF);
    expect((await listReserveEntries(db, admin, off.id))[0].partnerName).toBe(PARTNER);
    expect(await partnerTrail()).toEqual([]);

    const on = await createEvent(5, { hiddenListEnabled: true });
    const { id } = await addReserveEntry(db, admin, on.id, ENTRY("Mara", { email: "", partner: "on", partnerName: PARTNER }), at(3));
    await moveReserveEntryToOwnAddress(db, admin, id, { relayedByParticipantRequest: true, locale: "ro" }, at(4));
    const mara = await rowOf("Mara");
    expect(mara).toMatchObject({ partnerName: PARTNER, outsideCapacity: true });
  });

  it("the full form's «Trece pe lista oficială» carries it as it carries the note", async () => {
    const event = await createEvent(5);
    const { id } = await addReserveEntry(db, admin, event.id, ENTRY("Mara", { partner: "on", partnerName: PARTNER }), at(1));
    const registrationId = await entered(event.id, "Mara");
    await settleReserveEntry(db, admin, id, registrationId, at(2));
    expect((await rowOf("Mara")).partnerName).toBe(PARTNER);
    expect(await db.select().from(eventReserveEntries)).toEqual([]);
  });

  it("«Mută pe lista de elită» registers nobody and drops it", async () => {
    const event = await createEvent(5);
    const { id } = await addReserveEntry(db, admin, event.id, ENTRY("Mara", { partner: "on", partnerName: PARTNER }), at(1));
    await moveReserveEntryToElite(db, admin, id, at(2));
    const [elite] = await db.select().from(eventEliteEntries);
    expect(elite.name).toBe("Mara Munteanu");
    expect(JSON.stringify(elite)).not.toContain(PARTNER);
    expect(await db.select().from(registrations)).toEqual([]);
    expect(await db.select().from(eventReserveEntries)).toEqual([]);
    expect(await partnerTrail()).toEqual([]);
  });

  it("an invitation's name: written at the link's press, under the sender, and said in no email", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Munteanu", email: "ana@example.invalid" }, { name: "Ion Munteanu", email: "ion@example.invalid" }], days: 3, outsideCapacity: false, partnerName: PARTNER }, admin, at(1));
    // Each invitation of the press stores it, and the send's trail says so without the name.
    expect((await db.select({ partnerName: eventInvitations.partnerName }).from(eventInvitations)).map((row) => row.partnerName)).toEqual([PARTNER, PARTNER]);
    const sent = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_sent"));
    expect(sent.map((row) => (row.metadataJson as { partner?: boolean }).partner)).toEqual([true, true]);
    expect(await partnerTrail()).toEqual([]);

    const { secret, words } = await invitationSecretFor("ana@example.invalid", at(2));
    // The invitation's own email: no word of the label.
    expect(words).not.toContain(PARTNER);
    const accepted = await acceptInvitation(db, secret, submission("Ana", "x@example.invalid", at(3)), at(3));
    expect(accepted.ok && accepted.registration.partnerName).toBe(PARTNER);
    const ana = await rowOf("Ana");
    expect(ana.partnerName).toBe(PARTNER);
    expect((await partnerTrail()).map((row) => [row.actorStaffUserId, row.entityId, row.metadataJson])).toEqual([[admin.id, ana.id, { partner: true, via: "invitation" }]]);
    // The invitation's email, the declaration's: no word of the label.
    expect(await everyEmail(at(4))).not.toContain(PARTNER);
  });

  it("an invitation's name: written where a registration of the address takes the invitation over", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Munteanu", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, partnerName: PARTNER }, admin, at(1));
    await submitRegistration(db, event, submission("Ana", "ana@example.invalid", at(2)), at(2), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
    expect((await rowOf("Ana")).partnerName).toBeNull();
    const confirmed = await confirmEmail(db, event, (await rowOf("Ana")).id, at(3));
    expect(confirmed.status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Ana")).partnerName).toBe(PARTNER);
    expect((await partnerTrail()).map((row) => [row.actorStaffUserId, row.metadataJson])).toEqual([[admin.id, { partner: true, via: "invitation" }]]);
    expect(await everyEmail(at(4))).not.toContain(PARTNER);
  });

  it("an invitation sent without it writes none", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Munteanu", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, at(1));
    const { secret } = await invitationSecretFor("ana@example.invalid", at(2));
    const accepted = await acceptInvitation(db, secret, submission("Ana", "x@example.invalid", at(3)), at(3));
    expect(accepted.ok && accepted.registration.partnerName).toBeNull();
    expect(await partnerTrail()).toEqual([]);
  });

  it("a registration restarted on the same row keeps what the staff set", async () => {
    const event = await createEvent(5);
    await submitRegistration(db, event, submission("Ana", "ana@example.invalid", at(1)), at(1), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
    const first = await rowOf("Ana");
    await setRegistrationPartner(db, admin, first.id, { partner: "on", partnerName: PARTNER }, at(2));
    await confirmEmail(db, event, first.id, at(2));
    await cancelRegistrationByStaff(db, admin, first.id, "a test", at(3));
    await submitRegistration(db, event, submission("Ana", "ana@example.invalid", at(4)), at(4), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
    const again = await rowOf("Ana");
    expect(again.id).toBe(first.id);
    expect(again.status).not.toBe("CANCELLED");
    expect(again.partnerName).toBe(PARTNER);
  });

  it("changes nothing else: the state, the place, the counts and the outbox are as without it", async () => {
    const event = await createEvent(1);
    const ana = await entered(event.id, "Ana");
    const before = await db.select().from(registrations).where(eq(registrations.id, ana));
    const outbox = (await db.select().from(emailOutbox)).length;
    await setRegistrationPartner(db, admin, ana, { partner: "on", partnerName: PARTNER }, at(5));
    const [after] = await db.select().from(registrations).where(eq(registrations.id, ana));
    expect(after.partnerName).toBe(PARTNER);
    // Every other column as it was: the label and the row's own last-write moment are all that moved.
    expect({ ...after, partnerName: null, updatedAt: null }).toEqual({ ...before[0], partnerName: null, updatedAt: null });
    expect(await db.select().from(emailOutbox)).toHaveLength(outbox);
    const [{ capacity }] = await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, event.id));
    expect(capacity).toBe(1);
  });
});

describe("the list's filter «De la parteneri»", () => {
  it("narrows the rows, the count and the pages in the list's one query", async () => {
    const event = await createEvent(20);
    const other = await createEvent(20);
    const names = ["Ana", "Bia", "Cor", "Dan", "Eva"];
    for (const name of names) await entered(event.id, name);
    for (const name of ["Ana", "Cor", "Eva"]) await setRegistrationPartner(db, admin, (await rowOf(name)).id, { partner: "on", partnerName: PARTNER }, at(2));
    await setRegistrationPartner(db, admin, await entered(other.id, "Ion"), { partner: "on", partnerName: PARTNER }, at(3));

    const filters = { eventId: event.id, fromPartner: true };
    expect(await countRegistrationsForAdmin(db, filters)).toBe(3);
    expect(await countRegistrationsForAdmin(db, { eventId: event.id })).toBe(5);
    const page = (offset: number) => listRegistrationsForAdmin(db, filters, { limit: 2, offset, sort: "name", dir: "asc" }, at(4));
    expect((await page(0)).map((row) => [row.registeredName, row.partnerName])).toEqual([
      ["Ana Munteanu", PARTNER],
      ["Cor Munteanu", PARTNER],
    ]);
    expect((await page(2)).map((row) => row.registeredName)).toEqual(["Eva Munteanu"]);
    // Without the filter, a row without a name reads none.
    expect((await listRegistrationsForAdmin(db, { eventId: event.id }, undefined, at(4))).find((row) => row.registeredName === "Bia Munteanu")?.partnerName).toBeNull();
  });
});

describe("the registrations' Excel and CSV", () => {
  const url = (eventId: string, extra = "") => `https://example.test/api/admin/registrations/export?eventId=${eventId}${extra}`;

  it("carry «Partener» for every role that gets the file, before «Note interne», which stays last", async () => {
    const event = await createEvent(20);
    await setRegistrationPartner(db, admin, await entered(event.id, "Ana"), { partner: "on", partnerName: PARTNER }, at(2));
    await entered(event.id, "Bia");
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      const { rows } = readSheet(Buffer.from(await (await exportRegistrations(new Request(url(event.id, "&format=xlsx")))).arrayBuffer()));
      const header = rows[0] as string[];
      expect(header.at(-1), role).toBe("Note interne");
      expect(header.at(-2), role).toBe("Partener");
      const cell = (name: string) => rows.find((row) => row?.[header.indexOf("Name")] === name)?.[header.indexOf("Partener")] ?? "";
      expect(cell("Ana Munteanu"), role).toBe(PARTNER);
      expect(cell("Bia Munteanu"), role).toBe("");
      const csv = await (await exportRegistrations(new Request(url(event.id)))).text();
      const [csvHeader, ...lines] = csv.split("\r\n");
      expect(csvHeader.split(",").slice(-2), role).toEqual(["Partener", "Note interne"]);
      expect(lines.find((line) => line.includes("Ana Munteanu"))?.split(",").at(-2), role).toBe(PARTNER);
    }
    // In English, its English word.
    state.actor = admin;
    const english = readSheet(Buffer.from(await (await exportRegistrations(new Request(url(event.id, "&format=xlsx&lang=en")))).arrayBuffer()));
    expect((english.rows[0] as string[]).slice(-2)).toEqual(["Partner", "Internal notes"]);
  });

  it("follows the list's filter: the file is the rows on screen", async () => {
    const event = await createEvent(20);
    await setRegistrationPartner(db, admin, await entered(event.id, "Ana"), { partner: "on", partnerName: PARTNER }, at(2));
    await entered(event.id, "Bia");
    const csv = await (await exportRegistrations(new Request(url(event.id, "&partner=1")))).text();
    expect(csv).toContain("Ana Munteanu");
    expect(csv).not.toContain("Bia Munteanu");
  });
});

describe("the box's suggestions", () => {
  it("are the event's earlier names, each once whatever its capitals, newest first", () => {
    expect(
      suggestPartnerNames([
        { name: "Brutăria Exemplu", at: at(1) },
        { name: "Cafeneaua de Test", at: at(3) },
        { name: "brutăria exemplu", at: at(5) },
        { name: "  ", at: at(6) },
      ]),
    ).toEqual(["brutăria exemplu", "Cafeneaua de Test"]);
  });

  it("read the registrations, the lines and the invitations of this event alone, for the Organizer and above", async () => {
    const event = await createEvent(20);
    const other = await createEvent(20);
    await setRegistrationPartner(db, admin, await entered(event.id, "Ana"), { partner: "on", partnerName: PARTNER }, at(1));
    await addReserveEntry(db, admin, event.id, ENTRY("Bia", { partner: "on", partnerName: PARTNER.toUpperCase() }), at(2));
    await inviteToEventByStaff(db, event, { people: [{ name: "Cor Munteanu", email: "cor@example.invalid" }], days: 3, outsideCapacity: false, partnerName: OTHER_PARTNER }, admin, at(3));
    await addReserveEntry(db, admin, other.id, ENTRY("Dan", { partner: "on", partnerName: "Alt Partener Inventat" }), at(4));
    expect(await listPartnerSuggestions(db, organizer, event.id)).toEqual([OTHER_PARTNER, PARTNER.toUpperCase()]);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canKeepRegistrationNotes(role)) expect(await listPartnerSuggestions(db, actor, event.id), role).toHaveLength(2);
      else expect((await refusal(listPartnerSuggestions(db, actor, event.id))).code, role).toBe("FORBIDDEN");
    }
  });
});

describe("the trail, the person's record, the erase and the sweep", () => {
  it("no trail row holds a partner's name, wherever it was set", async () => {
    const event = await createEvent(5);
    const { id } = await addReserveEntry(db, admin, event.id, ENTRY("Mara", { partner: "on", partnerName: PARTNER }), at(1));
    await saveReservePartner(db, admin, id, { partner: "on", partnerName: OTHER_PARTNER }, at(2));
    await moveReserveEntryToWaitlist(db, admin, id, { email: null, relayedByParticipantRequest: true, locale: "ro" }, at(3));
    await setRegistrationPartner(db, admin, (await rowOf("Mara")).id, { partner: null, partnerName: "" }, at(4));
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Munteanu", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, partnerName: PARTNER }, admin, at(5));
    const trail = await db.select().from(auditLogs);
    const actions = trail.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["event_reserve.added", "event_reserve.partner_saved", "event_reserve.moved", "registration.partner_set", "event.invitation_sent"]));
    expect(trail.find((row) => row.action === "event_reserve.added")?.metadataJson).toEqual({ entryId: id, partner: true });
    expect(trail.find((row) => row.action === "event_reserve.partner_saved")?.metadataJson).toEqual({ entryId: id, partner: true });
    const words = JSON.stringify(trail);
    for (const name of [PARTNER, OTHER_PARTNER, "Brutăria", "Cafeneaua"]) expect(words).not.toContain(name);
  });

  it("«Toate datele unei persoane» lists it on the registration, the line and the invitation; the erase takes it with the row", async () => {
    const event = await createEvent(5);
    const ana = await entered(event.id, "Ana");
    await setRegistrationPartner(db, admin, ana, { partner: "on", partnerName: PARTNER }, at(1));
    await addReserveEntry(db, admin, event.id, ENTRY("Ana", { partner: "on", partnerName: OTHER_PARTNER }), at(2));
    const other = await createEvent(5);
    await inviteToEventByStaff(db, other, { people: [{ name: "Ana Munteanu", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, partnerName: PARTNER }, admin, at(3));
    const data = await exportPersonData(db, admin, "ana@example.invalid", at(4));
    expect(data.registrations.map((row) => row.partnerName)).toEqual([PARTNER]);
    expect(data.reserveEntries.map((row) => row.partnerName)).toEqual([OTHER_PARTNER]);
    expect(data.eventInvitations.map((row) => row.partnerName)).toEqual([PARTNER]);

    await deleteRegistrationByStaff(db, admin, ana, "cerere de ștergere", at(5));
    expect(await db.select().from(registrations).where(eq(registrations.id, ana))).toEqual([]);
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(PARTNER);
  });

  it("the retention sweep takes it with the row it deletes", async () => {
    const event = await createEvent(5);
    const ana = await entered(event.id, "Ana");
    await setRegistrationPartner(db, admin, ana, { partner: "on", partnerName: PARTNER }, at(1));
    // Never confirmed, lapsed long ago: the sweep's «unconfirmed-registrations» step.
    await db
      .update(registrations)
      .set({ status: "EXPIRED", expiryReason: "EMAIL_CONFIRMATION_LAPSED", expiredAt: new Date("2020-01-01T00:00:00.000Z"), holdExpiresAt: null })
      .where(eq(registrations.id, ana));
    await pruneExpiredRows(db, NOW);
    expect(await db.select().from(registrations).where(and(eq(registrations.id, ana)))).toEqual([]);
  });
});

describe("the migration and its CHECKs", () => {
  const MIGRATIONS = path.join(process.cwd(), "src/db/migrations");

  it("is 0199, expand only: three nullable columns and their three CHECKs, nothing dropped or rewritten", () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)?.tag).toBe("0199_partner_mark");
    const statements = readFileSync(path.join(MIGRATIONS, "0199_partner_mark.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n");
    for (const table of ["registrations", "event_reserve_entries", "event_invitations"]) {
      expect(statements).toContain(`ALTER TABLE "${table}" ADD COLUMN "partner_name" text;`);
      expect(statements).toContain(`ADD CONSTRAINT "${table}_partner_name_length" CHECK`);
    }
    expect(statements).not.toMatch(/DROP|RENAME|ALTER COLUMN|NOT NULL|UPDATE |DELETE /);
  });

  it("refuses a name with spaces at its ends, an empty one and one too long, on each table", async () => {
    const event = await createEvent(5);
    const ana = await entered(event.id, "Ana");
    const { id: line } = await addReserveEntry(db, admin, event.id, ENTRY("Bia"), at(1));
    await inviteToEventByStaff(db, event, { people: [{ name: "Cor Munteanu", email: "cor@example.invalid" }], days: 3, outsideCapacity: false }, admin, at(2));
    const [invitation] = await db.select({ id: eventInvitations.id }).from(eventInvitations);
    const refused = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch {
        return true;
      }
      return false;
    };
    for (const bad of [" Brutăria", "", "x".repeat(PARTNER_NAME_MAX + 1)]) {
      expect(await refused(db.update(registrations).set({ partnerName: bad }).where(eq(registrations.id, ana))), bad).toBe(true);
      expect(await refused(db.update(eventReserveEntries).set({ partnerName: bad }).where(eq(eventReserveEntries.id, line))), bad).toBe(true);
      expect(await refused(db.update(eventInvitations).set({ partnerName: bad }).where(eq(eventInvitations.id, invitation.id))), bad).toBe(true);
    }
    expect(await refused(db.update(registrations).set({ partnerName: "x".repeat(PARTNER_NAME_MAX) }).where(eq(registrations.id, ana)))).toBe(false);
    expect(await refused(db.update(registrations).set({ partnerName: null }).where(eq(registrations.id, ana)))).toBe(false);
    // The two addresses (Ana's, Cor's), untouched by any of it; a line has none.
    expect(await db.select().from(participants)).toHaveLength(2);
  });
});
