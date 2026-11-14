import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { pickConfirm, fillFromForm, resolveAlso } from "@/shared/feedback/notice";
import { staffEntryConfirm } from "@/modules/registrations/staff-entry-confirm";
import { STAFF_ROLES, canManageRegistrations, canWorkTheDesk, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { atTheClock } from "../../helpers/clock";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Elită» from the start (§917; the owner, 2026-11-04: «înscriu pe cineva de mână, sau trimit invitație, ar trebui să pot
 * bifa direct că e elită, dar asta e ceva intern — ei nu știu că sunt bifați ca elite»; BR-REQ-037-05, BR-REQ-060-01):
 *
 * - the staff entry — the full form in each of its ways (ordinary, «Direct pe lista de așteptare», the desk's fast track)
 *   and the one-press «Adaugă pe lista de așteptare» — takes an «Elită» tick: the registration and its mark in one
 *   transaction, the mark exactly as «Marchează ca elită» writes it (§897), audited `via: "entry"`; any role but the
 *   Administrator posting it is refused and nothing is written;
 * - an invitation sent with «Elită» stores it, and the registration it becomes — by the link, or by another route that
 *   takes it over — is marked in that transaction, the trail naming the Administrator who sent it; a withdrawn or expired
 *   one marks nobody; «Invitații» wears the registrations' «Elită» chip on it;
 * - the person is told nothing: no email, link page or own page of theirs says «elită».
 *
 * Read from a real database (PGlite).
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  /** Every tell of the public pages, with how many of the test's own `db.transaction` were open at that moment. */
  told: [] as { contents: string[]; depth: number }[],
  depth: 0,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    state.told.push({ contents, depth: state.depth });
  },
}));
// «Invitații» is a Server Component: its words from the catalogues, as the page has them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: state.locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});
vi.mock("@/shared/feedback/confirm-words", async (original) => ({
  ...(await original<typeof import("@/shared/feedback/confirm-words")>()),
  confirmWords: async () => ({ cancel: "Cancel" }),
}));

const { cancelRegistrationByStaff, createRegistrationByStaff, enterOnWaitlistByStaff } = await import("@/modules/registrations/admin-service");
const { setRegistrationElite, setRegistrationEliteTick } = await import("@/modules/registrations/elite-mark");
const { confirmEmail, inviteToEventByStaff, signDeclaration, submitRegistration, withdrawInvitationByStaff } = await import("@/modules/registrations/service");
const { acceptInvitation, readInvitationLink } = await import("@/modules/registrations/invitations");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { createRegistrationAction: createNow, addToWaitlistAction: addNow } = await import("@/app/[locale]/admin/registrations/actions");
const { inviteAction: inviteNow } = await import("@/app/[locale]/admin/registrations/invitation-actions");
const { default: InvitationsPanel } = await import("@/modules/registrations/ui/InvitationsPanel");
const { default: StatusChip } = await import("@/shared/ui/StatusChip");

const NOW = new Date("2026-09-25T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** A race in five days: inside the declaration window, so a place given is a declaration hold (§104). */
const STARTS = new Date(NOW.getTime() + 5 * DAY);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** The actions read the request's own clock: pressed at NOW, on the fixture's calendar (§712). */
const createRegistrationAction = (...args: Parameters<typeof createNow>) => atTheClock(NOW, () => createNow(...args));
const addToWaitlistAction = (...args: Parameters<typeof addNow>) => atTheClock(NOW, () => addNow(...args));
const inviteAction = (...args: Parameters<typeof inviteNow>) => atTheClock(NOW, () => inviteNow(...args));

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
  state.locale = "ro";
  state.told = [];
  state.depth = 0;
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

async function createEvent(capacity: number | null): Promise<EventInput> {
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

/** The staff entry of one person, as the full form posts it: the relay tick and whichever boxes. */
const entryOf = (eventId: string, name: string, boxes: { vouchAddress?: boolean; fastTrack?: boolean; elite?: boolean } = {}) => ({
  eventId,
  firstName: name,
  lastName: "Munteanu",
  email: `${name.toLowerCase()}@example.invalid`,
  locale: "ro" as const,
  listOptOut: true,
  relayedByParticipantRequest: true,
  ...boxes,
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

const eliteTrail = (registrationId: string) =>
  db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.elite_marked"), eq(auditLogs.entityId, registrationId)));

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

/** Where a press that succeeded sends the browser: Next's redirect, thrown with the address in its digest. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const digest = String((error as { digest?: unknown } | null)?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest;
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

/** The word, as a word of its own: «elită», «elite», «Elite»… — never inside another (`EmailSampleLiteral`). */
const ELITE_WORD = /(?<!\p{L})elit/iu;

/** Render one outbox row as the drain would. */
async function rendered(row: typeof emailOutbox.$inferSelect, when: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
}

/** The secret the newest invitation email to `email` carries, and the email itself as rendered. */
async function invitationEmailTo(email: string, when: Date) {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION")))
    .filter((row) => row.recipientEmail === email)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = await rendered(rows[0], when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return { secret: match[1], message };
}

describe("§917 «Elită» at the staff entry: marked in the entry's own transaction, as «Marchează ca elită» marks it", () => {
  it.each([
    ["the ordinary entry (the person's own link)", {}, "PENDING_EMAIL_CONFIRMATION"],
    ["«Direct pe lista de așteptare» (§872)", { vouchAddress: true }, "PENDING_DECLARATION"],
    ["the desk's fast track (BR-REQ-037-07)", { fastTrack: true }, "CONFIRMED"],
  ] as const)("%s: the row lands as without the tick, marked, one trail row `via: \"entry\"` under the Administrator", async (_, boxes, landed) => {
    const event = await createEvent(5);
    const { registrationId } = await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { ...boxes, elite: true }), at(5));
    const mara = await rowOf("Mara");
    expect(mara.id).toBe(registrationId);
    expect(mara.status).toBe(landed);
    expect(mara.elite).toBe(true);
    // Only the mark: the club's two ticks (§910) stay as they were — the person's own consent decides.
    expect(mara).toMatchObject({ eliteHiddenFromResults: false, eliteHiddenFromSite: false, listOptOut: true });
    const trail = await eliteTrail(mara.id);
    expect(trail.map((row) => [row.actorStaffUserId, row.entityType, row.metadataJson])).toEqual([[admin.id, "registration", { elite: true, via: "entry" }]]);
    // The entry's own row is there too, as ever, and the trail names nobody.
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.created_by_staff"), eq(auditLogs.entityId, mara.id)))).toHaveLength(1);
    expect(JSON.stringify(trail)).not.toContain("Mara");
  });

  it("the one-press «Adaugă pe lista de așteptare» (§872) marks it in the same entry, the row in the line as without the tick", async () => {
    const event = await createEvent(1);
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Ana", { vouchAddress: true }), at(1));
    const entered = await enterOnWaitlistByStaff(
      db,
      admin,
      { eventId: event.id, firstName: "Mara", lastName: "Munteanu", email: "mara@example.invalid", locale: "ro", relayedByParticipantRequest: true, elite: true },
      at(5),
    );
    expect(entered.status).toBe("WAITLISTED");
    const mara = await rowOf("Mara");
    expect(mara.elite).toBe(true);
    expect((await eliteTrail(mara.id)).map((row) => row.metadataJson)).toEqual([{ elite: true, via: "entry" }]);
  });

  it("without the tick nothing changes: not marked, no elite row in the trail", async () => {
    const event = await createEvent(5);
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara"), at(5));
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Ion", { vouchAddress: true, elite: false }), at(6));
    for (const name of ["Mara", "Ion"]) expect((await rowOf(name)).elite, name).toBe(false);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);
  });

  it("is the Administrator's alone (BR-REQ-060-01): every desk role posting it is refused before anything is written, never left unmarked", async () => {
    const event = await createEvent(5);
    const deskRoles = STAFF_ROLES.filter((role) => canWorkTheDesk(role) && !canManageRegistrations(role));
    expect(deskRoles).toEqual(expect.arrayContaining(["CONTRIBUTOR", "MODERATOR"]));
    for (const role of deskRoles) {
      const actor = await staff(role);
      for (const boxes of [{}, { fastTrack: true }]) {
        const error = await refusal(createRegistrationByStaff(db, actor, entryOf(event.id, "Mara", { ...boxes, elite: true }), at(5)));
        expect(isDomainError(error) && error.code, role).toBe("FORBIDDEN");
      }
    }
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.invalid"))).toEqual([]);
    expect(await db.select().from(auditLogs)).toEqual([]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
    // Without the box the Organizer's entry is the ordinary one.
    await createRegistrationByStaff(db, organizer, entryOf(event.id, "Mara"), at(6));
    expect((await rowOf("Mara")).elite).toBe(false);
  });

  it("the one-press on a restarted row whose club ticks (§910) the mark brings back: the public pages told again once the press's own transaction committed", async () => {
    const event = await createEvent(5);
    // Mara marked, hidden from the site by the club, unmarked, cancelled: her row keeps the club's tick, inert.
    const { registrationId } = await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true, elite: true }), at(1));
    await setRegistrationEliteTick(db, admin, registrationId!, "onSite", false, at(2));
    await setRegistrationElite(db, admin, registrationId!, false, at(3));
    await cancelRegistrationByStaff(db, admin, registrationId!, "a test", at(4));
    expect(await rowOf("Mara")).toMatchObject({ status: "CANCELLED", elite: false, eliteHiddenFromSite: true });

    // The press's transaction counted: a tell made inside it is made before its commit.
    const transaction = db.transaction.bind(db);
    db.transaction = (async (...args: Parameters<typeof transaction>) => {
      state.depth += 1;
      try {
        return await transaction(...args);
      } finally {
        state.depth -= 1;
      }
    }) as typeof db.transaction;
    state.told = [];
    try {
      await enterOnWaitlistByStaff(
        db,
        admin,
        { eventId: event.id, firstName: "Mara", lastName: "Munteanu", email: "mara@example.invalid", locale: "ro", relayedByParticipantRequest: true, elite: true },
        at(5),
      );
    } finally {
      db.transaction = transaction;
    }
    const mara = await rowOf("Mara");
    expect(mara).toMatchObject({ id: registrationId, elite: true, eliteHiddenFromSite: true });
    expect(mara.status).not.toBe("CANCELLED");
    expect(state.told).toContainEqual({ contents: ["events", "places"], depth: 0 });
  });

  it("a refused entry takes the mark with it: the line full, nothing written — no row, no mark, no trail", async () => {
    const event = await createEvent(1);
    await db.update(events).set({ waitlistCapacity: 0 }).where(eq(events.id, event.id));
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Ana", { vouchAddress: true }), at(1));
    await refusal(createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true, elite: true }), at(5)));
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);
  });
});

describe("§917 «Elită» on the staff forms' presses", () => {
  const fullForm = (eventId: string, extra: Record<string, string> = {}) =>
    form({ eventId, firstName: "Mara", lastName: "Munteanu", email: "mara@example.invalid", participantLocale: "ro", relayedByParticipantRequest: "on", ...extra });

  it("«Adaugă o înscriere» with «Elită» ticked, by the Administrator: entered and marked", async () => {
    const event = await createEvent(5);
    state.actor = admin;
    expect(await redirectOf(createRegistrationAction(null, fullForm(event.id, { elite: "on" })))).toContain("saved=registrationCreated");
    expect((await rowOf("Mara")).elite).toBe(true);
  });

  it.each<StaffRole>(["CONTRIBUTOR", "MODERATOR"])("%s posting «Elită» is told FORBIDDEN, the boxes kept, and nothing is written", async (role) => {
    const event = await createEvent(5);
    state.actor = await staff(role);
    const outcome = await createRegistrationAction(null, fullForm(event.id, { elite: "on", back: "desk" }));
    expect(outcome?.error).toBe("FORBIDDEN");
    expect(outcome?.values).toMatchObject({ firstName: ["Mara"], elite: ["on"] });
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("the one-press «Adaugă pe lista de așteptare» with «Elită» ticked: marked", async () => {
    const event = await createEvent(5);
    state.actor = admin;
    const back = await redirectOf(
      addToWaitlistAction(null, form({ eventId: event.id, firstName: "Mara", lastName: "Munteanu", email: "mara@example.invalid", relayedByParticipantRequest: "on", intent: "add", elite: "on" })),
    );
    expect(back).toContain("#registrations-waitlist-add");
    expect((await rowOf("Mara")).elite).toBe(true);
  });
});

describe("§917 «Elită» on an invitation: stored at the send, carried onto the registration it becomes", () => {
  it("the send stores the tick on each invitation of the batch, and its trail says so; without it, nothing", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ion Pop", email: "ion@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    await inviteToEventByStaff(db, event, { people: [{ name: "Dan Pop", email: "dan@example.invalid" }], days: 3, outsideCapacity: false }, admin, at(1));
    const stored = await db.select({ name: eventInvitations.name, elite: eventInvitations.elite }).from(eventInvitations).where(eq(eventInvitations.eventId, event.id));
    expect(Object.fromEntries(stored.map((row) => [row.name, row.elite]))).toEqual({ "Ana Pop": true, "Ion Pop": true, "Dan Pop": false });
    const sent = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_sent"));
    expect(sent.filter((row) => (row.metadataJson as { elite?: boolean }).elite === true)).toHaveLength(2);
    // Nothing is marked before a registration exists.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);
  });

  it("the send's form posts it per batch, beside «Pe lista de invitați speciali»", async () => {
    const event = await createEvent(5);
    state.actor = admin;
    const posted = form({ eventId: event.id, days: "3", elite: "1" });
    posted.append("inviteeName", "Ana Pop");
    posted.append("inviteeEmail", "ana@example.invalid");
    expect(await redirectOf(inviteAction(null, posted))).toContain("saved=invitationsSent");
    const [invitation] = await db.select().from(eventInvitations);
    expect(invitation).toMatchObject({ elite: true, outsideCapacity: false });
  });

  it("the link's press: the registration marked in the same transaction, the trail naming the Administrator who sent it", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    const { secret } = await invitationEmailTo("ana@example.invalid", at(1));
    // A refused form takes nothing with it: no registration, no mark, and the same link still works.
    expect(await refusal(acceptInvitation(db, secret, { ...submission("Ana", "x@example.invalid", at(2)), termsAccepted: false }, at(2)))).toBeTruthy();
    expect(await db.select().from(registrations)).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);

    const accepted = await acceptInvitation(db, secret, submission("Ana", "x@example.invalid", at(3)), at(3));
    expect(accepted.ok).toBe(true);
    const registration = accepted.ok ? accepted.registration : null;
    expect(registration).toMatchObject({ status: "PENDING_DECLARATION", elite: true });
    expect((await rowOf("Ana")).elite).toBe(true);
    const trail = await eliteTrail(registration!.id);
    expect(trail.map((row) => [row.actorStaffUserId, row.metadataJson])).toEqual([[admin.id, { elite: true, via: "invitation" }]]);
  });

  it("an invitation sent without it: the registration is not marked", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    const { secret } = await invitationEmailTo("ana@example.invalid", at(1));
    const accepted = await acceptInvitation(db, secret, submission("Ana", "x@example.invalid", at(2)), at(2));
    expect(accepted.ok && accepted.registration.elite).toBe(false);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);
  });

  it("taken over by another route (the public form and its confirmation, §647): the registration it became is marked", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    await submitRegistration(db, event, submission("Ana", "ana@example.invalid", at(2)), at(2), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
    expect((await rowOf("Ana")).elite).toBe(false);
    const confirmed = await confirmEmail(db, event, (await rowOf("Ana")).id, at(3));
    expect(confirmed.status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Ana")).elite).toBe(true);
    expect((await eliteTrail(confirmed.id)).map((row) => [row.actorStaffUserId, row.metadataJson])).toEqual([[admin.id, { elite: true, via: "invitation" }]]);
  });

  it("withdrawn, or past its deadline: it marks nobody — the person who registers anyway is not elite", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 1, outsideCapacity: false, elite: true }, admin, NOW);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ion Pop", email: "ion@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    const [ion] = await db.select().from(eventInvitations).where(eq(eventInvitations.name, "Ion Pop"));
    await withdrawInvitationByStaff(db, ion.id, admin, at(1));

    const later = new Date(NOW.getTime() + 2 * DAY);
    for (const name of ["Ana", "Ion"]) {
      await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.invalid`, later), later, "REAL", { source: "PUBLIC", createdByStaffUserId: null });
      await confirmEmail(db, event, (await rowOf(name)).id, later);
      expect((await rowOf(name)).elite, name).toBe(false);
    }
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.elite_marked"))).toEqual([]);
  });
});

/** Every element of a Server Component's tree, children first-level and deeper, as drawn (not rendered). */
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

describe("§917 «Invitații» wears the «Elită» chip on an elite invitation, open or accepted — staff-only", () => {
  it.each(["ro", "en"] as const)("%s: the registrations' own chip and glyph on Ana's, none on Dan's nor on a withdrawn one", async (locale) => {
    state.locale = locale;
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ion Pop", email: "ion@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    await inviteToEventByStaff(db, event, { people: [{ name: "Dan Pop", email: "dan@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    const [ion] = await db.select().from(eventInvitations).where(eq(eventInvitations.name, "Ion Pop"));
    await withdrawInvitationByStaff(db, ion.id, admin, at(1));

    const tree = await InvitationsPanel({ db, actor: { role: "MODERATOR" }, locale, eventId: event.id, mayManage: false, sendAction: (async () => null) as never, resendAction: (async () => null) as never, withdrawAction: (async () => null) as never, deleteAction: (async () => null) as never, now: at(2) });
    const rows = elementsOf(tree).filter((element) => element.props["data-testid"] === "invitation-row");
    expect(rows).toHaveLength(3);
    const chipsOf = (row: ReactElement<Record<string, unknown>>) => elementsOf(row).filter((element) => element.type === StatusChip && element.props.testId === "invitation-elite-chip");
    const nameOf = (row: ReactElement<Record<string, unknown>>) => elementsOf(row).map((element) => element.props.children).find((child) => typeof child === "string" && / Pop$/.test(child));
    const chips = Object.fromEntries(rows.map((row) => [nameOf(row), chipsOf(row).map((chip) => [chip.props.glyph, chip.props.label])]));
    const word = (locale === "ro" ? ro : en).Admin.registrations.elite.chip;
    expect(chips).toEqual({ "Ana Pop": [["elite", word]], "Ion Pop": [], "Dan Pop": [] });
  });

  it("an accepted invitation wears the mark of the registration it became, as it stands: «Nu mai e elită» takes the chip off, «Marchează ca elită» puts it on", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    await inviteToEventByStaff(db, event, { people: [{ name: "Dan Pop", email: "dan@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    const accepted: Record<string, string> = {};
    for (const [name, email] of [["Ana", "ana@example.invalid"], ["Dan", "dan@example.invalid"]] as const) {
      const { secret } = await invitationEmailTo(email, at(1));
      const outcome = await acceptInvitation(db, secret, submission(name, `${name.toLowerCase()}-x@example.invalid`, at(2)), at(2));
      if (!outcome.ok) throw new Error(`${name}'s invitation was not accepted`);
      accepted[name] = outcome.registration.id;
    }

    const chipsNow = async () => {
      const tree = await InvitationsPanel({ db, actor: { role: "MODERATOR" }, locale: "ro", eventId: event.id, mayManage: false, sendAction: (async () => null) as never, resendAction: (async () => null) as never, withdrawAction: (async () => null) as never, deleteAction: (async () => null) as never, now: at(3) });
      const rows = elementsOf(tree).filter((element) => element.props["data-testid"] === "invitation-row");
      const nameOf = (row: ReactElement<Record<string, unknown>>) => elementsOf(row).map((element) => element.props.children).find((child) => typeof child === "string" && / Pop$/.test(child));
      return Object.fromEntries(rows.map((row) => [nameOf(row), elementsOf(row).some((element) => element.type === StatusChip && element.props.testId === "invitation-elite-chip")]));
    };
    expect(await chipsNow()).toEqual({ "Ana Pop": true, "Dan Pop": false });

    await setRegistrationElite(db, admin, accepted.Ana, false, at(3));
    await setRegistrationElite(db, admin, accepted.Dan, true, at(3));
    expect(await chipsNow()).toEqual({ "Ana Pop": false, "Dan Pop": true });
    // The send's own tick stays what it was: the trail of what was sent.
    const stored = await db.select({ name: eventInvitations.name, elite: eventInvitations.elite }).from(eventInvitations);
    expect(Object.fromEntries(stored.map((row) => [row.name, row.elite]))).toEqual({ "Ana Pop": true, "Dan Pop": false });
  });
});

describe("§917 internal: the person is never told", () => {
  it("an elite invitation: its email, the link's page, the declaration's and the confirmation's emails and «Înregistrările mele» say nothing of it", async () => {
    const event = await createEvent(5);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false, elite: true }, admin, NOW);
    const { secret, message } = await invitationEmailTo("ana@example.invalid", at(1));
    for (const part of [message.subject, message.text, message.html]) expect(part).not.toMatch(ELITE_WORD);
    for (const locale of ["ro", "en"] as const) expect(JSON.stringify(await readInvitationLink(db, secret, locale, at(1)))).not.toMatch(ELITE_WORD);

    const accepted = await acceptInvitation(db, secret, submission("Ana", "x@example.invalid", at(2)), at(2));
    const registration = accepted.ok ? accepted.registration : null;
    expect(registration?.elite).toBe(true);
    await signDeclaration(db, event, registration!.id, await signingInput(db, at(3), "Ana Munteanu"), at(3));
    expect((await rowOf("Ana")).status).toBe("CONFIRMED");

    const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration!.id));
    expect(mail.map((row) => row.messageType)).toEqual(expect.arrayContaining(["COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED"]));
    for (const row of mail) {
      const sent = await rendered(row, at(4));
      for (const part of [sent.subject, sent.text, sent.html]) expect(part, row.messageType).not.toMatch(ELITE_WORD);
    }
    for (const locale of ["ro", "en"] as const) {
      const mine = await listActiveRegistrationsForParticipant(db, registration!.participantId, locale, at(4));
      expect(mine).toHaveLength(1);
      expect(JSON.stringify(mine)).not.toMatch(ELITE_WORD);
    }
  });

  it("an elite staff entry: the person's own emails and «Înregistrările mele» say nothing of it", async () => {
    const event = await createEvent(5);
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { elite: true }), at(1));
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Ion", { vouchAddress: true, elite: true }), at(2));
    const marked = [await rowOf("Mara"), await rowOf("Ion")];
    expect(marked.map((row) => row.elite)).toEqual([true, true]);
    const mail = await db.select().from(emailOutbox);
    expect(mail.map((row) => row.messageType).sort()).toEqual(["COMPLETE_DECLARATION", "VERIFY_REGISTRATION_EMAIL"]);
    for (const row of mail) {
      const sent = await rendered(row, at(3));
      for (const part of [sent.subject, sent.text, sent.html]) expect(part, row.messageType).not.toMatch(ELITE_WORD);
    }
    for (const row of marked) expect(JSON.stringify(await listActiveRegistrationsForParticipant(db, row.participantId, "ro", at(3)))).not.toMatch(ELITE_WORD);
  });

  it("no page, form, email template or word the person reads names it", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });
    const participantCode = [
      ...files("src/app/[locale]/registrations"),
      // The person's signed declaration (its PDF) and the desk code's picture.
      ...files("src/app/api/registrations"),
      ...files("src/modules/legal-documents"),
      ...files("src/modules/notifications"),
      ...files("src/infrastructure/email"),
      "src/modules/registrations/my-registrations.ts",
      "src/modules/registrations/form-view.ts",
      "src/modules/registrations/form-mapping.ts",
      "src/modules/registrations/ui/registration-form.tsx",
      "src/modules/registrations/ui/RegistrationJourney.tsx",
    ];
    for (const file of participantCode) expect(readFileSync(file, "utf8"), file).not.toMatch(ELITE_WORD);
    // The public form's and the person's pages' words, in both languages.
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      for (const namespace of ["Registration", "Registrations"] as const) {
        expect(JSON.stringify((catalogue as Record<string, unknown>)[namespace] ?? {}), `${locale} ${namespace}`).not.toMatch(ELITE_WORD);
      }
    }
  });
});

describe("§917 the words, Română and English", () => {
  it.each([
    ["ro", ro],
    ["en", en],
  ] as const)("%s: the entry's tick, its line and its dialog line; the invitation's tick, line and dialog line", (_, catalogue) => {
    const admin = catalogue.Admin;
    for (const text of [admin.registrations.elite.entry, admin.registrations.elite.entryHelp, admin.registrations.elite.entryConfirm, admin.invitations.eliteLabel, admin.invitations.eliteHelp, admin.invitations.dialog.elite]) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
    // The tick is named by the chip's own word.
    expect(admin.registrations.elite.entry).toBe(admin.registrations.elite.chip);
  });

  it("the staff entry's dialog says the mark in one quieter line only while «Elită» is ticked, in each of its three questions", () => {
    const line = ro.Admin.registrations.elite.entryConfirm;
    const specs = staffEntryConfirm({
      title: "T",
      body: "B",
      vouchBody: "V {email}",
      mail: { ordinary: { email: "o" }, vouched: { email: "v" }, fastTrack: { email: "f" } },
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      elite: line,
    });
    const posted = (fields: Record<string, string>) => (field: string) => fields[field] ?? null;
    const ways: Record<string, string>[] = [{}, { vouchAddress: "on" }, { fastTrack: "on" }];
    for (const fields of ways) {
      const ticked = posted({ ...fields, elite: "on" });
      const asked = resolveAlso(fillFromForm(pickConfirm(specs, ticked)!, ticked), ticked);
      expect(asked.also?.map((also) => also.text)).toEqual([line]);
      const unticked = posted(fields);
      expect(resolveAlso(fillFromForm(pickConfirm(specs, unticked)!, unticked), unticked).also).toBeUndefined();
    }
    // Where the tick is not drawn (a role that may not mark), no line at all.
    const without = staffEntryConfirm({ title: "T", body: "B", vouchBody: "V", mail: { ordinary: { email: "o" }, vouched: { email: "v" }, fastTrack: { email: "f" } }, confirmLabel: "OK", cancelLabel: "C" });
    expect(without.every((spec) => spec.also === undefined)).toBe(true);
  });
});

/*
  The owner, 2026-11-04: «trebuie să poată lumea să se înscrie prin invitație, chiar dacă înscrierile pe site sunt închise».
  The invitation is its own door (§647, §906): «Înscrieri publice deschise» unticked, «Locurile libere le dau doar eu»
  ticked and the registration window closed shut the site's form, never an invitation — sent, its link open, accepted
  and signed — and the place it holds is the invitation's.
*/
describe("§647, §906 an invitation is its own door: the site's door shut and the window closed take no invitation away", () => {
  it("sent, opened, accepted and signed while the public form is refused", async () => {
    const event = await createEvent(5);
    const closedAt = new Date(NOW.getTime() - DAY);
    await db.update(events).set({ publicRegistrationOpen: false, freePlacesByOfferOnly: true, registrationClosesAt: closedAt }).where(eq(events.id, event.id));
    const shut = { ...event, publicRegistrationOpen: false, freePlacesByOfferOnly: true, registrationClosesAt: closedAt } as EventInput;

    // The site's own form: refused, nothing written.
    expect(await refusal(submitRegistration(db, shut, submission("Public", "public@example.invalid", at(1)), at(1), "REAL", { source: "PUBLIC", createdByStaffUserId: null }))).toBeTruthy();
    expect(await db.select().from(registrations)).toEqual([]);

    // The invitation: sent, its link open, accepted into a held place, signed.
    await inviteToEventByStaff(db, shut, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, at(2));
    const { secret } = await invitationEmailTo("ana@example.invalid", at(3));
    expect((await readInvitationLink(db, secret, "ro", at(3))).kind).toBe("open");
    const accepted = await acceptInvitation(db, secret, submission("Ana", "ana@example.invalid", at(4)), at(4));
    expect(accepted.ok).toBe(true);
    const registration = accepted.ok ? accepted.registration : null;
    expect(registration).toMatchObject({ status: "PENDING_DECLARATION", elite: false });
    await signDeclaration(db, shut, registration!.id, await signingInput(db, at(5), "Ana Munteanu"), at(5));
    expect((await rowOf("Ana")).status).toBe("CONFIRMED");
  });
});
