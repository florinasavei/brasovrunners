import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { issueActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §947 — «Trimite și linkul pentru semnarea declarației» on «Trimite un mesaj participanților» (the owner, 2026-11-16:
 * «vreau ca cei care nu au semnat declaratia sa o poata semna»; BR-REQ-080-01, BR-REQ-080-02, BR-REQ-036-02,
 * BR-REQ-060-01).
 *
 * One tick, off by default. Ticked, the send puts a flag — never a link — on the outbox rows of the registrations that
 * owe their declaration as it queues them, a test row too, and counts them in its audit row; the renderer asks each
 * registration's state again when its email leaves, and only somebody who owes the declaration then, at the
 * registration's own address, before the start of an event that runs, reads «Semnează declarația» under the organizers'
 * words — on a declaration link minted for that email, single use and hashed at rest, which replaces the registration's
 * earlier one. Everybody else — confirmed, waiting, offered, signed or cancelled since — gets the message as without the
 * tick, and the club's one copy carries no flag and nobody's link (§320). No registration's state, place or deadline
 * moves: the link opens the declaration's own page, which signs as it always did. All people here are made up.
 */
const DAY = 86_400_000;

const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { sendParticipantMessage, previewParticipantMessage, listParticipantMessages, readKeptMessage } = await import("@/modules/notifications/participant-messages");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { sendParticipantMessageAction, previewParticipantMessageAction } = await import("@/app/[locale]/admin/events/[id]/mesaje/actions");

const WORDS = {
  subject: { ro: "Ne vedem la {eventTitle}", en: "See you at {eventTitle}" },
  body: { ro: "Bună, {participantName}!\n\nMasa de ridicare se deschide la 8:00.", en: "Hi {participantName}!\n\nThe pickup desk opens at 8:00." },
};

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let startsAt: Date;
let organizer: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  organizer = await staff("MODERATOR");
  state.actor = organizer;
  startsAt = new Date(Date.now() + 10 * DAY);
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt,
      timezone: "Europe/Bucharest",
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: `crosul-${eventId.slice(0, 8)}` },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: `tampa-cross-${eventId.slice(0, 8)}` },
  ]);
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Staff ${serial}`, role }).returning();
  return user;
}

async function address(email: string) {
  const identity = canonicalizeEmail(email);
  const [existing] = await db.select().from(participants).where(eq(participants.canonicalEmail, identity.canonicalEmail));
  if (existing) return existing;
  const [created] = await db
    .insert(participants)
    .values({ ...identity, defaultName: email.split("@")[0] })
    .returning();
  return created;
}

type Extra = { kind?: "REAL" | "TEST"; locale?: "ro" | "en" };

/** A made-up registration at `status`, on its own address. */
async function person(name: string, status: RegistrationStatus, extra: Extra = {}): Promise<Registration> {
  const owner = await address(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`);
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: owner.id,
      status,
      kind: extra.kind ?? "REAL",
      locale: extra.locale ?? "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: true,
      tshirtSize: "NONE",
      firstName: name,
      lastName: "Exemplu",
      waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? new Date() : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date(Date.now() + 2 * DAY) : null,
      offerCreatedAt: status === "WAITLIST_OFFERED" ? new Date() : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
    })
    .returning();
  return row;
}

// Each send as an organizer who typed the number of recipients the page showed (`confirmed`).
const send = async (overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
  sendParticipantMessage(db, actor, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), signLink: true, ...WORDS, ...overrides }), new Date());

/** The participants' own rows of the organizers' message — never the club's copy, which has no participant. */
const ownRows = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
const flagOf = (row: { payloadJson: unknown }) => (row.payloadJson as { signLink?: unknown }).signLink;
const sendAudits = () => db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"));

async function refusalOf(attempt: Promise<unknown>) {
  try {
    await attempt;
    return undefined;
  } catch (caught) {
    if (isDomainError(caught)) return caught.code;
    throw caught;
  }
}

/** The organizers' message to one registration, rendered as the outbox would send it at `now`. */
async function emailTo(registrationId: string, now = new Date()) {
  const row = (await ownRows()).filter((candidate) => candidate.registrationId === registrationId).at(-1);
  if (!row) throw new Error("no organizer's message for this registration");
  return renderOutboxMessage(row, db, now);
}

/** The declaration link's secret, out of a message — in the registrant's own language's path. */
const SIGN_LINK = /\/(?:inregistrari\/declaratie|registrations\/declare)\/([A-Za-z0-9_-]+)/;
const secretOf = (text: string) => SIGN_LINK.exec(text)?.[1];
const BUTTON = 'data-email-part="sign-declaration"';
const tokensOf = (registrationId: string) => db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, registrationId));

describe("§947 the send: the flag rides on the rows of registrations that owe the declaration alone", () => {
  it("flags exactly those rows — a test row too — and the audit row counts them, real and test apart", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const bogdan = await person("Bogdan", "CONFIRMED");
    const carmen = await person("Carmen", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const probe = await person("Probe", "PENDING_DECLARATION", { kind: "TEST" });
    const byId = (list: Registration[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    const before = byId(await db.select().from(registrations));
    const sendId = randomUUID();
    expect(await send({ sendId })).toEqual({ kind: "queued", real: 4, test: 1 });
    // The send writes messages and its audit row: no registration's state, place, hold or deadline moved, and no link exists yet.
    expect(byId(await db.select().from(registrations))).toEqual(before);
    expect(await db.select().from(emailActionTokens)).toEqual([]);

    const rows = await ownRows();
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => flagOf(row) === true).map((row) => row.registrationId).sort()).toEqual([ana.id, probe.id].sort());
    // A flag beside the words, never a link or a secret: the link is minted when the email leaves.
    for (const row of rows.filter((one) => flagOf(one) === true)) expect(row.payloadJson).toEqual({ ...WORDS, signLink: true });
    // Everybody else's row is the words alone — an open offer's too: its own email carries its link and its deadline.
    for (const id of [bogdan.id, carmen.id, dan.id]) expect(rows.find((row) => row.registrationId === id)?.payloadJson).toEqual(WORDS);

    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 4, test: 1, subject: WORDS.subject, signLink: true, withSignLink: 1, withSignLinkTest: 1 });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("@example.test");
  });

  it("without the tick — the default: no flag on any row, nothing about it in the audit row, and no button in anybody's email", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const sendId = randomUUID();
    // The form posts nothing for an unticked box: the input carries no `signLink` at all.
    expect(await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId, ...WORDS }), new Date())).toEqual({ kind: "queued", real: 1, test: 0 });
    for (const row of await ownRows()) expect(row.payloadJson).toEqual(WORDS);
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 1, test: 0, subject: WORDS.subject });
    const email = await emailTo(ana.id);
    expect(email.html).not.toContain(BUTTON);
    expect(secretOf(email.text)).toBeUndefined();
    // The one token the message minted is the manage link behind «Nu mai pot ajunge», as always.
    expect((await tokensOf(ana.id)).map((token) => token.purpose)).toEqual(["MANAGE_REGISTRATION"]);
  });

  it("rides beside the two other ticks, each flag on its own rows", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const bogdan = await person("Bogdan", "CONFIRMED");
    await send({ askReconfirm: true, sendQr: true });
    const payloadOf = async (id: string) => (await ownRows()).find((row) => row.registrationId === id)?.payloadJson as Record<string, unknown>;
    // Owing the declaration: asked and carrying the link, no QR. Confirmed: asked and carrying the QR, no link.
    expect(await payloadOf(ana.id)).toEqual({ ...WORDS, askReconfirm: true, signLink: true });
    expect(await payloadOf(bogdan.id)).toEqual({ ...WORDS, askReconfirm: true, sendQr: true });
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toMatchObject({ askReconfirm: true, asked: 2, sendQr: true, withQr: 1, signLink: true, withSignLink: 1, withSignLinkTest: 0 });
    // In one email: «Semnează declarația» above «Vin», «Vin» above «Nu mai pot ajunge».
    const email = await emailTo(ana.id);
    expect(email.html.indexOf(BUTTON)).toBeGreaterThan(-1);
    expect(email.html.indexOf(BUTTON)).toBeLessThan(email.html.indexOf('data-email-part="reconfirm"'));
    expect(email.html.indexOf('data-email-part="reconfirm"')).toBeLessThan(email.html.indexOf('data-email-part="cannot-come"'));
  });

  it("BR-REQ-060-01: the Organizer and up send and preview it with the tick; every other role is refused and nothing is queued", async () => {
    await person("Ana", "PENDING_DECLARATION");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await send({}, await staff(role))).kind, role).toBe("queued");
    const queued = (await ownRows()).length;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role);
      expect(await refusalOf(send({}, actor)), role).toBe("FORBIDDEN");
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId, locale: "ro", ...WORDS, signLink: true })), role).toBe("FORBIDDEN");
    }
    expect((await ownRows()).length).toBe(queued);
  });
});

describe("§947 the email of somebody who owes the declaration: their own link to it, under the organizers' words", () => {
  it("draws «Semnează declarația» on a declaration link minted for that email — single use, hashed at rest, alive until the start", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const bogdan = await person("Bogdan", "PENDING_DECLARATION", { locale: "en" });
    await send();

    const email = await emailTo(ana.id);
    expect(email.html.split(BUTTON).length - 1).toBe(2);
    expect(email.html).toContain(">Semnează declarația</a>");
    expect(email.html).toContain("Încă nu ai semnat declarația pe proprie răspundere: înscrierea ta este completă doar după ce o semnezi.");
    // Under the organizers' own words, above «Nu mai pot ajunge».
    expect(email.html.indexOf(BUTTON)).toBeGreaterThan(email.html.indexOf("Masa de ridicare se deschide la 8:00."));
    expect(email.html.indexOf(BUTTON)).toBeLessThan(email.html.indexOf('data-email-part="cannot-come"'));
    // The link is the declaration's own page, in the registrant's language, on this site's address.
    const secret = secretOf(email.text);
    expect(secret).toBeDefined();
    expect(email.text).toContain(`Semnează declarația: ${env.APP_BASE_URL}/ro/inregistrari/declaratie/${secret}`);
    // It opens Ana's declaration and nobody else's — and a read spends nothing (§12.8).
    const context = await readActionTokenContext(db, { secret: secret!, purpose: "COMPLETE_DECLARATION", now: new Date() });
    expect(context).toMatchObject({ ok: true, token: { registrationId: ana.id, participantId: ana.participantId, purpose: "COMPLETE_DECLARATION" } });
    const tokens = await tokensOf(ana.id);
    expect(tokens.map((token) => token.purpose).sort()).toEqual(["COMPLETE_DECLARATION", "MANAGE_REGISTRATION"]);
    const declaration = tokens.find((token) => token.purpose === "COMPLETE_DECLARATION")!;
    // Hashed at rest: the row holds a SHA-256, never the secret in the email (§12.8, §14.5).
    expect(declaration.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(declaration.tokenHash).not.toBe(secret);
    expect(declaration.usedAt).toBeNull();
    // Alive until the start, as the declaration request's own link is (§160).
    expect(declaration.expiresAt.getTime()).toBe(startsAt.getTime());
    // Nothing about the registration moved: the link signs nothing by existing.
    const [after] = await db.select().from(registrations).where(eq(registrations.id, ana.id));
    expect(after).toEqual(ana);

    // An English registration: English first, the English page, its own link.
    const other = await emailTo(bogdan.id);
    const otherSecret = secretOf(other.text);
    expect(other.text).toContain(`Sign the declaration: ${env.APP_BASE_URL}/en/registrations/declare/${otherSecret}`);
    expect(otherSecret).not.toBe(secret);
    expect(other.html.indexOf(">Sign the declaration</a>")).toBeLessThan(other.html.indexOf(">Semnează declarația</a>"));
  });

  it("replaces the registration's earlier declaration link, so one button works: the newest email's", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const earlier = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "COMPLETE_DECLARATION", expiresAt: startsAt, now: new Date() });
    await send();
    const secret = secretOf((await emailTo(ana.id)).text)!;
    expect(await readActionTokenContext(db, { secret, purpose: "COMPLETE_DECLARATION", now: new Date() })).toMatchObject({ ok: true });
    expect(await readActionTokenContext(db, { secret: earlier.secret, purpose: "COMPLETE_DECLARATION", now: new Date() })).toMatchObject({ ok: false });
    const [old] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.id, earlier.token.id));
    expect(old.invalidatedAt).not.toBeNull();
    // Marked as replaced by the new one, so its page says a newer email has the link (§619).
    expect(old.supersededByTokenId).not.toBeNull();
  });

  it("asks the state again as the email leaves: signed, cancelled or lapsed since, the words alone and no link minted", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const bogdan = await person("Bogdan", "PENDING_DECLARATION");
    const carmen = await person("Carmen", "PENDING_DECLARATION");
    await send();
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: new Date(), holdExpiresAt: null }).where(eq(registrations.id, ana.id));
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "PARTICIPANT", holdExpiresAt: null }).where(eq(registrations.id, bogdan.id));
    await db.update(registrations).set({ status: "EXPIRED", expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED", holdExpiresAt: null }).where(eq(registrations.id, carmen.id));
    for (const row of [ana, bogdan, carmen]) {
      const email = await emailTo(row.id);
      expect(email.html, row.registeredName).not.toContain(BUTTON);
      expect(secretOf(email.text), row.registeredName).toBeUndefined();
      expect((await tokensOf(row.id)).filter((token) => token.purpose === "COMPLETE_DECLARATION"), row.registeredName).toEqual([]);
    }
  });

  it("draws nothing for the confirmed, the waiting and an open offer, whatever the tick — and nothing after the start", async () => {
    const bogdan = await person("Bogdan", "CONFIRMED");
    const carmen = await person("Carmen", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const ana = await person("Ana", "PENDING_DECLARATION");
    await send();
    for (const row of [bogdan, carmen, dan]) {
      const email = await emailTo(row.id);
      expect(email.html, row.registeredName).not.toContain(BUTTON);
      expect(secretOf(email.text), row.registeredName).toBeUndefined();
    }
    // A row that drains after the start: nobody signs online then, and «Nu mai pot ajunge» is gone too.
    const late = await emailTo(ana.id, new Date(startsAt.getTime() + 60_000));
    expect(late.html).not.toContain(BUTTON);
    expect(secretOf(late.text)).toBeUndefined();
    expect(await tokensOf(ana.id)).toEqual([]);
  });

  it("never in the club's one copy of the send (§320): no flag, no button, nobody's link", async () => {
    await updateClubNotices(db, await staff("ADMIN"), { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    await person("Ana", "PENDING_DECLARATION");
    await send();
    const copies = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"))).filter((row) => row.participantId === null);
    expect(copies).toHaveLength(1);
    expect(flagOf(copies[0])).toBeUndefined();
    const copy = await renderOutboxMessage(copies[0], db, new Date());
    expect(copy.html).not.toContain(BUTTON);
    expect(secretOf(copy.text)).toBeUndefined();
    expect(copy.text).not.toContain("Semnează declarația");
  });
});

describe("§947 the screens: the preview, «Mesaje trimise» and the words kept after a trial", () => {
  it("previews the button on an inert example link when the box is ticked, and never mints a token", async () => {
    const ticked = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, signLink: true });
    expect(ticked.html).toContain(BUTTON);
    expect(ticked.html).toContain(`${env.APP_BASE_URL}/ro/EXAMPLE#declaration`);
    const plain = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(plain.html).not.toContain(BUTTON);
    expect(await db.select().from(emailActionTokens)).toEqual([]);
    // The action reads the tick as `true` alone.
    const viaAction = await previewParticipantMessageAction({ eventId, language: "en", subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en, signLink: true });
    expect(viaAction?.html).toContain(">Sign the declaration</a>");
    const unticked = await previewParticipantMessageAction({ eventId, language: "en", subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en, signLink: "1" });
    expect(unticked?.html).not.toContain(BUTTON);
  });

  it("says on «Mesaje trimise» that the send was ticked, and for how many — test registrations left out", async () => {
    await person("Ana", "PENDING_DECLARATION");
    await person("Probe", "PENDING_DECLARATION", { kind: "TEST" });
    await person("Bogdan", "CONFIRMED");
    await send();
    await send({ signLink: false });
    const [second, first] = await listParticipantMessages(db, eventId);
    expect(first).toMatchObject({ signLink: true, withSignLink: 1 });
    expect(second).toMatchObject({ signLink: false, withSignLink: 0 });
  });

  it("posts the tick from the form, and a send to the people ticked hands it back with the words", async () => {
    const ana = await person("Ana", "PENDING_DECLARATION");
    const form = new FormData();
    const sendId = randomUUID();
    for (const [name, value] of Object.entries({
      uiLocale: "ro",
      eventId,
      sendId,
      audience: "CHOSEN",
      confirmCount: "1",
      subjectRo: WORDS.subject.ro,
      subjectEn: WORDS.subject.en,
      bodyRo: WORDS.body.ro,
      bodyEn: WORDS.body.en,
      signLink: "1",
    })) {
      form.set(name, value);
    }
    form.append("registrationIds", ana.id);
    const landed = await sendParticipantMessageAction(null, form).catch((caught: unknown) => caught as { redirectTo?: string });
    expect(landed).toMatchObject({ redirectTo: expect.stringMatching(new RegExp(`sent=1&test=0&kept=${sendId}#admin-alert$`)) });
    expect(flagOf((await ownRows())[0])).toBe(true);
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: true });
  });
});
