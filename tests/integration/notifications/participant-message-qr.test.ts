import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { EMAIL_SAMPLE } from "@/modules/notifications/domain/email-sample";
import { HIGHLIGHT_TEXT_MARK } from "@/modules/notifications/templates";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isCheckinCode, newCheckinCode } from "@/modules/registrations/checkin-code";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §943 — «Trimite și numărul de concurs și codul QR» on «Trimite un mesaj participanților» (the owner, 2026-11-12: «în
 * acel mail de comunicare, trebuie să le și reamintesc oamenilor care e numărul lor de concurs și să le retrimit QR»;
 * BR-REQ-080-01, BR-REQ-080-02, BR-REQ-037-08, BR-REQ-060-01).
 *
 * One tick, off by default. Ticked, the send puts a flag — never a code — on the outbox rows of the registrations
 * confirmed as it queues them, a test row too, and counts them in its audit row; the renderer asks each registration's
 * state again when its email leaves, and only a runner confirmed then, at the registration's own address, reads the
 * confirmation's block under the organizers' words: the number, the desk code, the QR with whose it is. Everybody else —
 * waiting, offered, owing the declaration, cancelled since — gets the message byte for byte as without the tick, and the
 * club's one copy of the send carries no flag, no QR, no code and nobody's number (§320). The preview draws the example
 * runner's block on the sample's inert code, whose picture the route draws as an example (§946); «Mesaje trimise» says
 * the tick was on. All people here are made up.
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

const { sendParticipantMessage, previewParticipantMessage, listParticipantMessages } = await import("@/modules/notifications/participant-messages");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { sendParticipantMessageAction, previewParticipantMessageAction } = await import("@/app/[locale]/admin/events/[id]/mesaje/actions");
const { GET: qrPicture } = await import("@/app/api/registrations/qr/[code]/route");

const WORDS = {
  subject: { ro: "Ne vedem la {eventTitle}", en: "See you at {eventTitle}" },
  body: { ro: "Bună, {participantName}!\n\nMasa de ridicare se deschide la 8:00.", en: "Hi {participantName}!\n\nThe pickup desk opens at 8:00." },
};

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
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
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + 10 * DAY),
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

type Extra = { kind?: "REAL" | "TEST"; email?: string; locale?: "ro" | "en"; bib?: number | null; code?: string | null };

/**
 * A made-up registration at `status`, on its own address unless `email` names a shared one. A confirmed one has a desk
 * code of its own unless `code: null` says it was confirmed before codes existed.
 */
async function person(name: string, status: RegistrationStatus, extra: Extra = {}): Promise<Registration> {
  const owner = await address(extra.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`);
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
      bibNumber: extra.bib ?? null,
      waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? new Date() : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date(Date.now() + 2 * DAY) : null,
      offerCreatedAt: status === "WAITLIST_OFFERED" ? new Date() : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      checkinCode: status === "CONFIRMED" ? (extra.code === undefined ? newCheckinCode() : extra.code) : null,
    })
    .returning();
  return row;
}

// Each send as an organizer who typed the number of recipients the page showed (`confirmed`).
const send = async (overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
  sendParticipantMessage(db, actor, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), sendQr: true, ...WORDS, ...overrides }), new Date());

/** The participants' own rows of the organizers' message — never the club's copy, which has no participant. */
const ownRows = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
const flagOf = (row: { payloadJson: unknown }) => (row.payloadJson as { sendQr?: unknown }).sendQr;
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

/** The organizers' message to one registration, rendered as the outbox would send it now. */
async function emailTo(registrationId: string, sendId?: string) {
  const rows = (await ownRows()).filter((row) => row.registrationId === registrationId);
  const row = sendId ? rows.find((candidate) => candidate.idempotencyKey.includes(sendId)) : rows.at(-1);
  if (!row) throw new Error("no organizer's message for this registration");
  return renderOutboxMessage(row, db, new Date());
}

async function rowOf(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

const qrOf = (code: string) => `${env.APP_BASE_URL}/api/registrations/qr/${code}.png`;
const QR_ROUTE = "/api/registrations/qr/";
/** How often a QR picture is drawn in a message. */
const pictures = (html: string) => html.split(`<img src="${env.APP_BASE_URL}${QR_ROUTE}`).length - 1;
/** Everything of the block's own words, in either language: none of it may reach a message that carries no block. */
const BLOCK_WORDS = /Numărul tău de concurs|Your race number|Codul tău|Your code|codul QR de mai jos|QR code below|Număr de concurs|Race number/;
/** A message with the one thing two renders of it differ by — the manage link's secret, minted at each render — settled. */
const settled = (text: string) => text.replace(/(\/(?:inregistrari\/gestionare|registrations\/manage)\/)[A-Za-z0-9_-]+/g, "$1TOKEN");

describe("§943 the send: the flag rides on the rows of confirmed registrations alone", () => {
  it("flags exactly the rows of registrations confirmed at the send — a test row too — and the audit row counts them, real and test apart", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const bogdan = await person("Bogdan", "CONFIRMED", { locale: "en" });
    const carmen = await person("Carmen", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const elena = await person("Elena", "PENDING_DECLARATION");
    const probe = await person("Probe", "CONFIRMED", { kind: "TEST" });
    const byId = (list: Registration[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    const before = byId(await db.select().from(registrations));
    const sendId = randomUUID();
    expect(await send({ sendId })).toEqual({ kind: "queued", real: 5, test: 1 });
    // The send writes messages and its audit row: no registration's state, place, hold or deadline moved.
    expect(byId(await db.select().from(registrations))).toEqual(before);

    const rows = await ownRows();
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => flagOf(row) === true).map((row) => row.registrationId).sort()).toEqual([ana.id, bogdan.id, probe.id].sort());
    // A flag beside the words, never a code or a number: those are read off the registration when the email leaves.
    for (const row of rows.filter((one) => flagOf(one) === true)) expect(row.payloadJson).toEqual({ ...WORDS, sendQr: true });
    // Everybody else's row is the words alone, as it always was.
    for (const id of [carmen.id, dan.id, elena.id]) expect(rows.find((row) => row.registrationId === id)?.payloadJson).toEqual(WORDS);

    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject, sendQr: true, withQr: 2, withQrTest: 1 });
    // Never who, and never a code.
    const trail = JSON.stringify(audit.metadataJson);
    for (const row of [ana, bogdan, probe]) expect(trail).not.toContain(row.checkinCode);
    expect(trail).not.toContain("@example.test");
  });

  it("flags every row of «Doar confirmații», and none of a group nobody confirmed is in — the audit row saying 0", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const carmen = await person("Carmen", "WAITLISTED");
    await send({ audience: "CONFIRMED" });
    await send({ audience: "WAITLIST" });
    const rows = await ownRows();
    expect(rows.map((row) => [row.registrationId, flagOf(row)]).sort()).toEqual(
      [
        [ana.id, true],
        [carmen.id, undefined],
      ].sort(),
    );
    const audits = (await sendAudits()).map((audit) => audit.metadataJson as Record<string, unknown>);
    expect(audits.find((audit) => audit.audience === "CONFIRMED")).toMatchObject({ sendQr: true, withQr: 1, withQrTest: 0 });
    expect(audits.find((audit) => audit.audience === "WAITLIST")).toMatchObject({ sendQr: true, withQr: 0, withQrTest: 0 });
  });

  it("without the tick — the default: no flag on any row, nothing about it in the audit row, and no QR in a confirmed runner's email", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    await person("Carmen", "WAITLISTED");
    const sendId = randomUUID();
    // The form posts nothing for an unticked box: the input carries no `sendQr` at all.
    expect(await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId, ...WORDS }), new Date())).toEqual({ kind: "queued", real: 2, test: 0 });
    for (const row of await ownRows()) expect(row.payloadJson).toEqual(WORDS);
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 2, test: 0, subject: WORDS.subject });
    const email = await emailTo(ana.id);
    expect(email.html).not.toContain(QR_ROUTE);
    expect(email.html).not.toContain(ana.checkinCode);
    expect(email.text).not.toMatch(BLOCK_WORDS);
    expect(email.html).not.toContain('data-email-part="highlight"');
  });

  it("rides beside «Cere reconfirmarea», each flag on its own rows, and «Trimite acum» marks both kinds alike", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const carmen = await person("Carmen", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    await send({ askReconfirm: true, delivery: "now" });
    const payloadOf = async (id: string) => (await ownRows()).find((row) => row.registrationId === id)?.payloadJson as Record<string, unknown>;
    // Confirmed: asked and carrying the QR. Waiting: asked, no QR. An offer: neither.
    expect(await payloadOf(ana.id)).toMatchObject({ askReconfirm: true, sendQr: true });
    expect(await payloadOf(carmen.id)).toMatchObject({ askReconfirm: true });
    expect((await payloadOf(carmen.id)).sendQr).toBeUndefined();
    expect((await payloadOf(dan.id)).askReconfirm).toBeUndefined();
    expect((await payloadOf(dan.id)).sendQr).toBeUndefined();
    // The press's mark is one key on every row, whatever flags the row carries.
    const marks = (payload: Record<string, unknown>) => Object.keys(payload).filter((key) => !["subject", "body", "askReconfirm", "sendQr"].includes(key));
    expect(marks(await payloadOf(ana.id))).toHaveLength(1);
    expect(marks(await payloadOf(ana.id))).toEqual(marks(await payloadOf(dan.id)));
    // Both in one email: the block above «Vin», «Vin» above «Nu mai pot ajunge».
    const email = await emailTo(ana.id);
    expect(pictures(email.html)).toBe(1);
    expect(email.html.indexOf(qrOf(ana.checkinCode!))).toBeLessThan(email.html.indexOf('data-email-part="reconfirm"'));
    expect(email.html.indexOf('data-email-part="reconfirm"')).toBeLessThan(email.html.indexOf('data-email-part="cannot-come"'));
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toMatchObject({ askReconfirm: true, asked: 2, sendQr: true, withQr: 1, withQrTest: 0, delivery: "now" });
  });

  it("BR-REQ-060-01: the Organizer and up send and preview it with the tick; every other role is refused and nothing is queued", async () => {
    await person("Ana", "CONFIRMED");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await send({}, await staff(role))).kind, role).toBe("queued");
    const queued = (await ownRows()).length;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role);
      expect(await refusalOf(send({}, actor)), role).toBe("FORBIDDEN");
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId, locale: "ro", ...WORDS, sendQr: true })), role).toBe("FORBIDDEN");
    }
    expect((await ownRows()).length).toBe(queued);
  });
});

describe("§943 the email of a confirmed runner: their own number, QR and desk code, under the organizers' words", () => {
  it("draws the confirmation's block once, after the words and before the button, in the registrant's language first", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const bogdan = await person("Bogdan", "CONFIRMED", { locale: "en", bib: 12 });
    await send();

    const email = await emailTo(ana.id);
    const code = ana.checkinCode!;
    expect(pictures(email.html)).toBe(1);
    expect(email.html).toContain(`<img src="${qrOf(code)}" alt="Cod QR ${code} — Ana"`);
    expect(email.html).toContain(`Ana · Număr de concurs: 7 · Codul tău: ${code}`);
    expect(email.html).toContain("Numărul tău de concurs: <strong>7</strong>. Îl primești la masă, în ziua cursei.");
    expect(email.html).toContain(`spune codul <strong>${code}</strong>.`);
    // Under the organizers' own words, above the event's button and «Nu mai pot ajunge».
    const words = email.html.indexOf("Masa de ridicare se deschide la 8:00.");
    const band = email.html.indexOf('data-email-part="highlight"');
    const picture = email.html.indexOf(`<img src="${qrOf(code)}"`);
    expect(words).toBeGreaterThan(-1);
    expect(band).toBeGreaterThan(words);
    expect(picture).toBeGreaterThan(band);
    expect(email.html.indexOf(">Vezi pagina evenimentului</a>")).toBeGreaterThan(picture);
    expect(email.html.indexOf('data-email-part="cannot-come"')).toBeGreaterThan(picture);
    // The plain-text half: the two sentences marked in each language, and the picture's address with whose it is.
    const [romanian, english] = email.text.split("\n— — —\n");
    expect(romanian).toContain(`${HIGHLIGHT_TEXT_MARK}Numărul tău de concurs: 7. Îl primești la masă, în ziua cursei.`);
    expect(romanian).toContain(`${HIGHLIGHT_TEXT_MARK}La ridicarea numărului de concurs arată codul QR de mai jos sau spune codul ${code}.`);
    expect(romanian).toContain(`Ana · Număr de concurs: 7 · Codul tău: ${code}: ${qrOf(code)}`);
    expect(english).toContain(`${HIGHLIGHT_TEXT_MARK}Your race number: 7. You collect it at the desk on race day.`);
    expect(english).toContain(`say the code ${code}.`);
    // Nothing is attached, and the message's other links are as they were.
    expect(email.attachments).toBeUndefined();
    expect(email.text).toMatch(/Nu mai pot ajunge: \S+\/inregistrari\/gestionare\/[A-Za-z0-9_-]+#cancel/);

    // An English registration: English first, its own number and code, the picture once with its English caption.
    const other = await emailTo(bogdan.id);
    expect(pictures(other.html)).toBe(1);
    expect(other.html).toContain(`Bogdan · Race number: 12 · Your code: ${bogdan.checkinCode}`);
    expect(other.text.indexOf("Your race number: 12.")).toBeLessThan(other.text.indexOf("Numărul tău de concurs: 12."));
    // Each their own: neither carries the other's code.
    expect(other.html).not.toContain(code);
    expect(email.html).not.toContain(bogdan.checkinCode);
    // No link or secret of its own: the one token each message minted is the manage link behind «Nu mai pot ajunge», as
    // without the tick, and the QR is the picture of the code the registration already had.
    const tokens = await db.select().from(emailActionTokens);
    expect(tokens.map((token) => [token.registrationId, token.purpose]).sort()).toEqual(
      [
        [ana.id, "MANAGE_REGISTRATION"],
        [bogdan.id, "MANAGE_REGISTRATION"],
      ].sort(),
    );
    expect((await rowOf(ana.id)).checkinCode).toBe(code);
    expect(email.calendar).toBeUndefined();
  });

  it("gives a runner confirmed before codes existed one, as the confirmation does, and says «—» where there is no number", async () => {
    const vechi = await person("Vechi", "CONFIRMED", { code: null });
    await send();
    const email = await emailTo(vechi.id);
    const code = (await rowOf(vechi.id)).checkinCode;
    expect(code).not.toBeNull();
    expect(isCheckinCode(code!)).toBe(true);
    expect(email.html).toContain(qrOf(code!));
    expect(email.html).toContain(`Vechi · Număr de concurs: — · Codul tău: ${code}`);
    expect(email.text).not.toContain("Numărul tău de concurs:");
    expect(email.text).toContain(`spune codul ${code}.`);
    // The same code the next message carries: the first render stored it.
    expect((await emailTo(vechi.id)).html).toContain(qrOf(code!));
  });

  it("writes the number as the event writes it («007»)", async () => {
    await db.update(events).set({ bibDesign: { numberFormat: "pad3" } }).where(eq(events.id, eventId));
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    await send();
    const email = await emailTo(ana.id);
    expect(email.text).toContain("Numărul tău de concurs: 007.");
    expect(email.html).toContain(`Ana · Număr de concurs: 007 · Codul tău: ${ana.checkinCode}`);
  });

  it("is each person's own on a family's one address: two emails, each with its own name, number and code", async () => {
    const ana = await person("Ana", "CONFIRMED", { email: "familia@example.test", bib: 21 });
    const ion = await person("Ion", "CONFIRMED", { email: "familia@example.test", bib: 22 });
    await send();
    const first = await emailTo(ana.id);
    const second = await emailTo(ion.id);
    expect(first.to).toBe(second.to);
    expect(first.html).toContain(`Ana · Număr de concurs: 21 · Codul tău: ${ana.checkinCode}`);
    expect(second.html).toContain(`Ion · Număr de concurs: 22 · Codul tău: ${ion.checkinCode}`);
    expect(first.html).not.toContain(ion.checkinCode);
    expect(second.html).not.toContain(ana.checkinCode);
    expect(pictures(first.html)).toBe(1);
    expect(pictures(second.html)).toBe(1);
  });
});

describe("§943 everybody else gets the message as it was", () => {
  it("a waiting, an offered and a declaration-owing recipient: byte for byte the email of a send without the tick", async () => {
    await person("Ana", "CONFIRMED", { bib: 7 });
    const others = [await person("Carmen", "WAITLISTED"), await person("Dan", "WAITLIST_OFFERED", { locale: "en" }), await person("Elena", "PENDING_DECLARATION")];
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, sendQr: false });
    for (const row of others) {
      const withTick = await emailTo(row.id, ticked);
      const without = await emailTo(row.id, plain);
      expect(withTick.subject, row.registeredName).toBe(without.subject);
      expect(settled(withTick.html), row.registeredName).toBe(settled(without.html));
      expect(settled(withTick.text), row.registeredName).toBe(settled(without.text));
      expect(withTick.html, row.registeredName).not.toContain(QR_ROUTE);
      expect(withTick.text, row.registeredName).not.toMatch(BLOCK_WORDS);
      // Nobody is given a desk code by a message: a code exists only from the confirmation.
      expect((await rowOf(row.id)).checkinCode, row.registeredName).toBeNull();
    }
  });

  it("a runner who cancelled between the send and the render reads the words alone, and so does one whose place lapsed", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const ion = await person("Ion", "CONFIRMED", { bib: 8, code: null });
    const stays = await person("Maria", "CONFIRMED", { bib: 9 });
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, sendQr: false });
    // All three rows carried the flag when the send queued them.
    expect((await ownRows()).filter((row) => row.idempotencyKey.includes(ticked) && flagOf(row) === true)).toHaveLength(3);
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "PARTICIPANT" }).where(eq(registrations.id, ana.id));
    await db.update(registrations).set({ status: "EXPIRED", expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" }).where(eq(registrations.id, ion.id));

    for (const row of [ana, ion]) {
      const gone = await emailTo(row.id, ticked);
      expect(gone.html, row.registeredName).not.toContain(QR_ROUTE);
      expect(gone.text, row.registeredName).not.toMatch(BLOCK_WORDS);
      if (row.checkinCode) expect(gone.html, row.registeredName).not.toContain(row.checkinCode);
      // Exactly the message a send without the tick gives a registration in that state.
      const without = await emailTo(row.id, plain);
      expect(settled(gone.html), row.registeredName).toBe(settled(without.html));
      expect(settled(gone.text), row.registeredName).toBe(settled(without.text));
    }
    // No code is made for a registration that is over.
    expect((await rowOf(ion.id)).checkinCode).toBeNull();
    // The one still confirmed is untouched by the others' leaving.
    expect((await emailTo(stays.id, ticked)).html).toContain(qrOf(stays.checkinCode!));
  });

  it("a registration confirmed only after the send carries no flag: that message has no QR — the confirmation is what gives it", async () => {
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const elena = await person("Elena", "PENDING_DECLARATION");
    await send();
    // Both sign while the send drains.
    for (const row of [dan, elena]) {
      await db
        .update(registrations)
        .set({ status: "CONFIRMED", confirmedAt: new Date(), holdExpiresAt: null, checkinCode: newCheckinCode(), bibNumber: row === dan ? 31 : 32 })
        .where(eq(registrations.id, row.id));
      const email = await emailTo(row.id);
      expect(email.html, row.registeredName).not.toContain(QR_ROUTE);
      expect(email.html, row.registeredName).not.toContain((await rowOf(row.id)).checkinCode);
      expect(email.text, row.registeredName).not.toMatch(/Numărul tău de concurs|Codul tău|codul QR de mai jos/);
    }
  });

  it("the club's copy carries no flag, no QR, no desk code and nobody's number (§320)", async () => {
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const bogdan = await person("Bogdan", "CONFIRMED", { bib: 8 });
    await send({ audience: "CONFIRMED" });
    const copies = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNull(emailOutbox.participantId)));
    expect(copies.map((copy) => copy.recipientEmail)).toEqual(["arhiva@club.test"]);
    const [copy] = copies;
    expect(copy.payloadJson).toEqual({ ...WORDS, clubCopy: true, eventId, recipients: 2 });
    const rendered = await renderOutboxMessage(copy, db, new Date());
    expect(rendered.subject.startsWith("[Copie club] ")).toBe(true);
    for (const body of [rendered.html, rendered.text]) {
      expect(body).not.toContain(QR_ROUTE);
      expect(body).not.toMatch(BLOCK_WORDS);
      for (const row of [ana, bogdan]) expect(body).not.toContain(row.checkinCode);
    }
    // The words themselves are kept.
    expect(rendered.text).toContain("Masa de ridicare se deschide la 8:00.");
  });

  it("whatever a hand-made row carries: never a code on a club copy of one runner's message, nor on a row with no participant", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const [copy, orphan] = await db
      .insert(emailOutbox)
      .values([
        { participantId: null, registrationId: ana.id, messageType: "ORGANIZER_MESSAGE", locale: "ro", recipientEmail: "arhiva@club.test", payloadJson: { ...WORDS, clubCopy: true, sendQr: true }, idempotencyKey: "hand-made:club-copy" },
        { participantId: null, registrationId: ana.id, messageType: "ORGANIZER_MESSAGE", locale: "ro", recipientEmail: "altcineva@example.test", payloadJson: { ...WORDS, sendQr: true }, idempotencyKey: "hand-made:no-participant" },
      ])
      .returning();
    for (const row of [copy, orphan]) {
      const rendered = await renderOutboxMessage(row, db, new Date());
      for (const body of [rendered.html, rendered.text]) {
        expect(body, row.idempotencyKey).not.toContain(QR_ROUTE);
        expect(body, row.idempotencyKey).not.toContain(ana.checkinCode);
        expect(body, row.idempotencyKey).not.toMatch(/Codul tău|Your code|codul QR de mai jos|QR code below/);
      }
    }
    // The flag makes no other message carry it either: an update notice to the same runner, flagged by hand.
    const owner = await rowOf(ana.id);
    const [notice] = await db
      .insert(emailOutbox)
      .values({ participantId: owner.participantId, registrationId: ana.id, messageType: "EVENT_UPDATE_NOTICE", locale: "ro", recipientEmail: "ana@example.test", payloadJson: { changes: ["place"], sendQr: true }, idempotencyKey: "hand-made:update" })
      .returning();
    const update = await renderOutboxMessage(notice, db, new Date());
    expect(update.html).not.toContain(QR_ROUTE);
    expect(update.html).not.toContain(ana.checkinCode);
  });
});

describe("§943 the preview on the form", () => {
  it("draws the example runner's block with the tick — on the sample's inert code — and nothing of it without; nothing is queued or minted", async () => {
    await person("Ana", "CONFIRMED", { bib: 7 });
    const sample = EMAIL_SAMPLE.ro;
    const off = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(off.html).not.toContain(QR_ROUTE);
    expect(off.html).not.toContain('data-email-part="highlight"');
    expect(off.html).not.toMatch(BLOCK_WORDS);
    expect(await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, sendQr: false })).toEqual(off);

    const on = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, sendQr: true });
    expect(pictures(on.html)).toBe(1);
    expect(on.html).toContain(qrOf(sample.checkinCode));
    expect(on.html).toContain(`Numărul tău de concurs: <strong>${sample.bibNumber}</strong>.`);
    expect(on.html).toContain(`spune codul <strong>${sample.checkinCode}</strong>.`);
    expect(on.html).toContain(`${sample.participantName} · Număr de concurs: ${sample.bibNumber} · Codul tău: ${sample.checkinCode}`);
    // Both halves say the sentences; the subject and the unknown-field list are untouched by the tick.
    expect(on.html).toContain(`Your race number: <strong>${sample.bibNumber}</strong>.`);
    expect(on.subject).toBe(off.subject);
    expect(on.unknown).toEqual([]);
    // Under the words, above the button — and above «Vin» when both boxes are ticked.
    const both = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, sendQr: true, askReconfirm: true });
    const picture = both.html.indexOf(qrOf(sample.checkinCode));
    expect(picture).toBeGreaterThan(both.html.indexOf("Masa de ridicare se deschide la 8:00."));
    expect(picture).toBeLessThan(both.html.indexOf(">Vezi pagina evenimentului</a>"));
    expect(picture).toBeLessThan(both.html.indexOf('data-email-part="reconfirm"'));

    // An English registrant's copy: English first, with its English caption.
    const english = await previewParticipantMessage(db, organizer, { eventId, locale: "en", ...WORDS, sendQr: true });
    expect(english.html).toContain(`${EMAIL_SAMPLE.en.participantName} · Race number: ${EMAIL_SAMPLE.en.bibNumber} · Your code: ${EMAIL_SAMPLE.en.checkinCode}`);
    expect(english.html.indexOf("Your race number:")).toBeLessThan(english.html.indexOf("Numărul tău de concurs:"));

    // The sample's code is nobody's: not a code the desk would take, and no registration holds it.
    expect(isCheckinCode(sample.checkinCode)).toBe(false);
    expect(await db.select().from(registrations).where(eq(registrations.checkinCode, sample.checkinCode))).toEqual([]);
    // Its picture's address, exactly as the preview wrote it, is one the route draws (§946): the preview shows a QR.
    const [, pictureName] = on.html.match(/<img src="[^"]*\/api\/registrations\/qr\/([^"]+)"/) ?? [];
    expect(pictureName).toBe(`${sample.checkinCode}.png`);
    const shown = await qrPicture(new Request(`http://localhost${QR_ROUTE}${pictureName}`), { params: Promise.resolve({ code: pictureName }) });
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Type")).toBe("image/png");
    // A preview queues nothing, mints nothing and audits nothing.
    expect(await ownRows()).toEqual([]);
    expect(await db.select().from(emailActionTokens)).toEqual([]);
    expect(await sendAudits()).toEqual([]);
  });
});

describe("§943 «Mesaje trimise» says the tick was on", () => {
  it("names the send that carried them and for how many confirmed, test registrations left out; a send without it says nothing", async () => {
    await person("Ana", "CONFIRMED");
    await person("Bogdan", "CONFIRMED");
    await person("Carmen", "WAITLISTED");
    await person("Probe", "CONFIRMED", { kind: "TEST" });
    const ticked = randomUUID();
    const plain = randomUUID();
    await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: plain, ...WORDS }), new Date(Date.now() - 60_000));
    await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: ticked, sendQr: true, ...WORDS }), new Date());
    const [newest, older] = await listParticipantMessages(db, eventId);
    expect(newest).toMatchObject({ sendId: ticked, sendQr: true, withQr: 2, recipients: 3, test: 1, askReconfirm: false, answers: null });
    expect(older).toMatchObject({ sendId: plain, sendQr: false, withQr: 0, recipients: 3, test: 1 });
  });

  it("reads only what the send's own audit row wrote: a row with no tick, or a count that is not a number, says none", async () => {
    await person("Ana", "CONFIRMED");
    await send();
    const [audit] = await sendAudits();
    await db.update(auditLogs).set({ metadataJson: { ...(audit.metadataJson as Record<string, unknown>), sendQr: "yes", withQr: 5 } }).where(eq(auditLogs.id, audit.id));
    expect((await listParticipantMessages(db, eventId))[0]).toMatchObject({ sendQr: false, withQr: 0 });
    await db.update(auditLogs).set({ metadataJson: { ...(audit.metadataJson as Record<string, unknown>), sendQr: true, withQr: "many" } }).where(eq(auditLogs.id, audit.id));
    expect((await listParticipantMessages(db, eventId))[0]).toMatchObject({ sendQr: true, withQr: 0 });
  });
});

describe("§943 the form's tick reaches the send and the preview", () => {
  function form(fields: Record<string, string>): FormData {
    const posted = new FormData();
    posted.set("uiLocale", "ro");
    posted.set("eventId", eventId);
    posted.set("sendId", randomUUID());
    posted.set("audience", "ALL_ACTIVE");
    // «Scrie la câți trimiți»: each press here writes to the one runner seeded, and the organizer typed so.
    posted.set("confirmCount", "1");
    posted.set("subjectRo", WORDS.subject.ro);
    posted.set("subjectEn", WORDS.subject.en);
    posted.set("bodyRo", WORDS.body.ro);
    posted.set("bodyEn", WORDS.body.en);
    for (const [name, value] of Object.entries(fields)) posted.set(name, value);
    return posted;
  }

  /** Where a press that worked redirects to (the mock above), or what it returned. */
  async function press(posted: FormData): Promise<{ redirect: string } | { returned: unknown }> {
    try {
      return { returned: await sendParticipantMessageAction(null, posted) };
    } catch (error) {
      const to = (error as { redirectTo?: string }).redirectTo;
      if (to) return { redirect: to };
      throw error;
    }
  }

  it("a ticked box posts `1` and flags the confirmed; a form without it, or with anything else, flags nobody", async () => {
    const ana = await person("Ana", "CONFIRMED");
    state.actor = organizer;
    expect(await press(form({ sendQr: "1" }))).toMatchObject({ redirect: expect.stringMatching(/sent=1&test=0#admin-alert$/) });
    expect((await ownRows()).map((row) => [row.registrationId, flagOf(row)])).toEqual([[ana.id, true]]);
    // An unticked box posts nothing; a value the form never posts is no either.
    const others: Record<string, string>[] = [{}, { sendQr: "true" }, { sendQr: "on" }];
    for (const fields of others) {
      const posted = form(fields);
      await press(posted);
      const [row] = (await ownRows()).filter((one) => one.idempotencyKey.includes(String(posted.get("sendId"))));
      expect(flagOf(row), JSON.stringify(fields)).toBeUndefined();
    }
    const audits = (await sendAudits()).map((audit) => (audit.metadataJson as { sendQr?: unknown }).sendQr);
    expect(audits.filter((value) => value === true)).toHaveLength(1);
  });

  it("keeps the tick with the other boxes when the send is refused (§315), and queues nothing", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = organizer;
    const refused = await press(form({ sendQr: "1", bodyEn: "" }));
    expect(refused).toMatchObject({ returned: { error: "VALIDATION_ERROR", fields: ["bodyEn"], values: { sendQr: ["1"], subjectRo: [WORDS.subject.ro] } } });
    expect(await ownRows()).toEqual([]);
  });

  it("refuses a role that may not write to participants, tick or not (BR-REQ-060-01)", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = await staff("DEV");
    expect(await press(form({ sendQr: "1" }))).toMatchObject({ returned: { error: "FORBIDDEN" } });
    expect(await previewParticipantMessageAction({ eventId, language: "ro", subjectRo: "a", subjectEn: "b", bodyRo: "c", bodyEn: "d", sendQr: true })).toBeNull();
    expect(await ownRows()).toEqual([]);
  });

  it("the preview draws the block only for a literal true from the network", async () => {
    state.actor = organizer;
    const words = { eventId, language: "ro", subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en };
    expect((await previewParticipantMessageAction({ ...words, sendQr: true }))?.html).toContain(qrOf(EMAIL_SAMPLE.ro.checkinCode));
    for (const value of [undefined, false, "true", "1", 1]) {
      expect((await previewParticipantMessageAction({ ...words, sendQr: value }))?.html, String(value)).not.toContain(QR_ROUTE);
    }
  });
});
