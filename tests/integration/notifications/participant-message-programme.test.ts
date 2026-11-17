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
import { AUDIENCE_STATUSES, CHOSEN_AUDIENCE, CHOSEN_FIELD, CONFIRM_COUNT_FIELD } from "@/modules/notifications/domain/organizer-message";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §NNN — «Include programul evenimentului» on «Trimite un mesaj participanților» (the owner, 2026-11-17, four days before
 * the race, writing the race week's message: «Vreau încă o bifă in acel eveniment de "include program"»; BR-REQ-080-01,
 * BR-REQ-080-02, BR-REQ-060-01).
 *
 * One tick, off by default. Ticked, the send puts a flag — never the programme — on **every** outbox row it queues,
 * whatever the registration's state, a test row too, and on the club's one copy, and names the tick in its audit row.
 * The renderer reads the event's timed rows when each email leaves and draws them under the organizers' words as one
 * block with the row «Program», each half in its own language: a row changed after the press leaves as it now stands,
 * an event left with no timed row sends the message of a send without the tick, and a row's place is not said while the
 * event's place is to be announced (§328). Nothing else of the message moves — the facts line, the links, the buttons —
 * and no other message type draws it, whatever its payload holds. The preview draws the same block from the rows as they
 * are now. All people here are made up.
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

const { sendParticipantMessage, previewParticipantMessage, readKeptMessage } = await import("@/modules/notifications/participant-messages");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { sendParticipantMessageAction, previewParticipantMessageAction } = await import("@/app/[locale]/admin/events/[id]/mesaje/actions");

const WORDS = {
  subject: { ro: "Ultimele detalii pentru {eventTitle}", en: "The last details for {eventTitle}" },
  body: { ro: "Bună, {participantName}!\n\nNe vedem sâmbătă la start.", en: "Hi {participantName}!\n\nSee you on Saturday at the start." },
};

/**
 * The race day's programme as the event row stores it (§117), on a day the calendar is far from: Saturday, 21 November
 * 2099, on the event's clock (Europe/Bucharest, UTC+2 then) — kits from 08:30 to 09:30 in a hall, the start at 10:00.
 */
const ROWS = [
  { startsAt: "2099-11-21T06:30:00.000Z", endsAt: "2099-11-21T07:30:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Sala Sporturilor" },
  { startsAt: "2099-11-21T08:00:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: null },
];
const RO_LINES = ["08:30–09:30 — Ridicarea kiturilor (Sala Sporturilor)", "10:00 — Startul"];
const EN_LINES = ["08:30–09:30 — Kit pickup (Sala Sporturilor)", "10:00 — The start"];
const RO_BLOCK_TEXT = `Program: ${RO_LINES[0]}\n  ${RO_LINES[1]}`;
const EN_BLOCK_TEXT = `Programme: ${EN_LINES[0]}\n  ${EN_LINES[1]}`;

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
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
      scheduleItems: ROWS,
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

type Extra = { kind?: "REAL" | "TEST"; locale?: "ro" | "en"; bib?: number | null };

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
      bibNumber: extra.bib ?? null,
      waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? new Date() : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date(Date.now() + 2 * DAY) : null,
      offerCreatedAt: status === "WAITLIST_OFFERED" ? new Date() : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      checkinCode: status === "CONFIRMED" ? newCheckinCode() : null,
    })
    .returning();
  return row;
}

/** One registration in each state a message can reach, and a test one: everybody a send to «Toți cei înscriși» writes to. */
async function everybody() {
  return {
    ana: await person("Ana", "CONFIRMED", { bib: 7 }),
    bogdan: await person("Bogdan", "CONFIRMED", { locale: "en" }),
    carmen: await person("Carmen", "WAITLISTED"),
    dan: await person("Dan", "WAITLIST_OFFERED", { locale: "en" }),
    elena: await person("Elena", "PENDING_DECLARATION"),
    probe: await person("Probe", "WAITLISTED", { kind: "TEST" }),
  };
}

// Each send as an organizer who typed the number of recipients the page showed (`confirmed`), the box ticked.
const send = async (overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
  sendParticipantMessage(db, actor, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), includeProgramme: true, ...WORDS, ...overrides }), new Date());

/** The participants' own rows of the organizers' message — never the club's copy, which has no participant. */
const ownRows = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
const clubCopies = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNull(emailOutbox.participantId)));
const flagOf = (row: { payloadJson: unknown }) => (row.payloadJson as { includeProgramme?: unknown }).includeProgramme;
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

const setRows = (scheduleItems: unknown) => db.update(events).set({ scheduleItems: scheduleItems as never }).where(eq(events.id, eventId));

/** Every block of the facts block's kind in a message, whole. */
const blocks = (html: string) => [...html.matchAll(/<div data-email-part="event-facts"[^]*?<\/div>/g)].map((match) => match[0]);
/** A message without them — what is left must be the message of a send that did not tick. */
const htmlWithoutBlocks = (html: string) => html.replace(/<div data-email-part="event-facts"[^]*?<\/div>\n/g, "");
const textWithoutBlocks = (text: string) => text.replace(/\n\nProgram(?:me)?: [^\n]*(?:\n {2}[^\n]*)*/g, "");
/** A message with the one thing two renders of it differ by — the manage link's secret, minted at each render — settled. */
const settled = (text: string) => text.replace(/(\/(?:inregistrari\/gestionare|registrations\/manage)\/)[A-Za-z0-9_-]+/g, "$1TOKEN");
const QR_ROUTE = `${env.APP_BASE_URL}/api/registrations/qr/`;

describe("§NNN the send: the flag rides on every row, whatever the registration's state", () => {
  it("flags every row of «Toți cei înscriși» — confirmed, waiting, offered, owing the declaration, a test row — and the audit row names the tick", async () => {
    const people = await everybody();
    const byId = (list: Registration[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    const before = byId(await db.select().from(registrations));
    const sendId = randomUUID();
    expect(await send({ sendId })).toEqual({ kind: "queued", real: 5, test: 1 });
    // The send writes messages and its audit row: no registration's state, place, hold or deadline moved.
    expect(byId(await db.select().from(registrations))).toEqual(before);

    const rows = await ownRows();
    expect(rows.map((row) => row.registrationId).sort()).toEqual(Object.values(people).map((row) => row.id).sort());
    // A flag beside the words, and nothing of the programme: its rows are read off the event when the email leaves.
    for (const row of rows) expect(row.payloadJson, row.registrationId ?? "").toEqual({ ...WORDS, includeProgramme: true });
    // Every state `ALL_ACTIVE` holds was written to, and each of them flagged.
    expect([...new Set(Object.values(people).map((row) => row.status))].sort()).toEqual([...AUDIENCE_STATUSES.ALL_ACTIVE].sort());

    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject, includeProgramme: true });
    // Never who, and never the programme itself.
    const trail = JSON.stringify(audit.metadataJson);
    expect(trail).not.toContain("@example.test");
    expect(trail).not.toContain("Ridicarea kiturilor");
  });

  it("flags every row of each of the three groups, and of the people ticked", async () => {
    const people = await everybody();
    const sends: Array<[string, Partial<Parameters<typeof sendParticipantMessage>[2]>, string[]]> = [
      ["CONFIRMED", { audience: "CONFIRMED" }, [people.ana.id, people.bogdan.id]],
      ["WAITLIST", { audience: "WAITLIST" }, [people.carmen.id, people.dan.id, people.probe.id]],
      ["PENDING_DECLARATION", { audience: "PENDING_DECLARATION" }, [people.elena.id]],
      [CHOSEN_AUDIENCE, { audience: CHOSEN_AUDIENCE, registrationIds: [people.bogdan.id, people.dan.id, people.elena.id] }, [people.bogdan.id, people.dan.id, people.elena.id]],
    ];
    for (const [audience, input, expected] of sends) {
      const sendId = randomUUID();
      expect((await send({ ...input, sendId })).kind, audience).toBe("queued");
      const rows = (await ownRows()).filter((row) => row.idempotencyKey.includes(sendId));
      expect(rows.map((row) => row.registrationId).sort(), audience).toEqual([...expected].sort());
      for (const row of rows) expect(row.payloadJson, audience).toEqual({ ...WORDS, includeProgramme: true });
      const audit = (await sendAudits()).map((entry) => entry.metadataJson as Record<string, unknown>).find((entry) => entry.sendId === sendId);
      expect(audit, audience).toMatchObject({ audience, includeProgramme: true });
    }
  });

  it("without the tick — the default: no flag on any row, nothing about it in the audit row, and no block in anybody's email", async () => {
    const people = await everybody();
    const sendId = randomUUID();
    // The form posts nothing for an unticked box: the input carries no `includeProgramme` at all.
    expect(await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId, ...WORDS }), new Date())).toEqual({ kind: "queued", real: 5, test: 1 });
    // …and a `false` is the same as nothing.
    const unticked = randomUUID();
    await send({ sendId: unticked, includeProgramme: false });
    for (const row of await ownRows()) expect(row.payloadJson).toEqual(WORDS);
    const audits = (await sendAudits()).map((entry) => entry.metadataJson as Record<string, unknown>);
    expect(audits.find((entry) => entry.sendId === sendId)).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject });
    expect(audits.find((entry) => entry.sendId === unticked)).toEqual({ sendId: unticked, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject });
    for (const row of Object.values(people)) {
      const email = await emailTo(row.id, sendId);
      expect(blocks(email.html), row.registeredName).toHaveLength(0);
      expect(email.text, row.registeredName).not.toContain("Ridicarea kiturilor");
      expect(email.text, row.registeredName).not.toContain("Kit pickup");
    }
  });

  it("rides beside the other three ticks: each of those on its own rows, the programme on all of them, and «Trimite acum» marks them alike", async () => {
    const people = await everybody();
    await send({ askReconfirm: true, sendQr: true, signLink: true, delivery: "now" });
    const payloadOf = async (id: string) => (await ownRows()).find((row) => row.registrationId === id)?.payloadJson as Record<string, unknown>;
    // Confirmed: asked, the QR and the programme. Waiting: asked and the programme. An offer: the programme alone. Owing: asked, the link and the programme.
    expect(await payloadOf(people.ana.id)).toMatchObject({ ...WORDS, askReconfirm: true, sendQr: true, includeProgramme: true });
    expect(await payloadOf(people.carmen.id)).toMatchObject({ ...WORDS, askReconfirm: true, includeProgramme: true });
    expect(await payloadOf(people.elena.id)).toMatchObject({ ...WORDS, askReconfirm: true, signLink: true, includeProgramme: true });
    const offered = await payloadOf(people.dan.id);
    expect(offered).toMatchObject({ ...WORDS, includeProgramme: true });
    for (const flag of ["askReconfirm", "sendQr", "signLink"]) expect(offered[flag], flag).toBeUndefined();
    expect((await payloadOf(people.carmen.id)).sendQr).toBeUndefined();
    // The press's mark is one key on every row, whatever flags the row carries.
    const marks = (payload: Record<string, unknown>) => Object.keys(payload).filter((key) => !["subject", "body", "askReconfirm", "sendQr", "signLink", "includeProgramme"].includes(key));
    expect(marks(await payloadOf(people.ana.id))).toHaveLength(1);
    expect(marks(await payloadOf(people.ana.id))).toEqual(marks(offered));
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toMatchObject({ askReconfirm: true, sendQr: true, withQr: 2, signLink: true, withSignLink: 1, includeProgramme: true, delivery: "now" });
  });

  it("BR-REQ-060-01: the Organizer and up send and preview it with the tick; every other role is refused and nothing is queued", async () => {
    await person("Ana", "CONFIRMED");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await send({}, await staff(role))).kind, role).toBe("queued");
    const queued = (await ownRows()).length;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role);
      expect(await refusalOf(send({}, actor)), role).toBe("FORBIDDEN");
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId, locale: "ro", ...WORDS, includeProgramme: true })), role).toBe("FORBIDDEN");
    }
    expect((await ownRows()).length).toBe(queued);
  });
});

describe("§NNN the email as it leaves: the event's programme, under the organizers' words", () => {
  it("draws one block a half with the row «Program», each half in its own language, in the HTML and in the text — for every state of registration", async () => {
    const people = await everybody();
    await send();
    for (const row of Object.values(people)) {
      const email = await emailTo(row.id);
      const found = blocks(email.html);
      const who = `${row.registeredName} (${row.status}, ${row.locale})`;
      expect(found, who).toHaveLength(2);
      // The registrant's language first, the other language's own labels second — never the same words twice.
      const [first, second] = row.locale === "ro" ? [RO_LINES, EN_LINES] : [EN_LINES, RO_LINES];
      const [firstLabel, secondLabel] = row.locale === "ro" ? ["Program", "Programme"] : ["Programme", "Program"];
      expect(found[0], who).toContain(`<strong>${firstLabel}</strong><br>${first.join("<br>")}`);
      expect(found[1], who).toContain(`<strong>${secondLabel}</strong><br>${second.join("<br>")}`);
      // The row «Program» alone: none of the facts block's other questions, and no link.
      for (const block of found) expect(block, who).not.toMatch(/Când|When|Unde|Where|Traseu|Route|Cost|Linkuri|Links|<a /);
      const [firstHalf, secondHalf] = email.text.split("\n— — —\n");
      const [romanian, english] = row.locale === "ro" ? [firstHalf, secondHalf] : [secondHalf, firstHalf];
      expect(romanian, who).toContain(`\n\n${RO_BLOCK_TEXT}\n`);
      expect(english, who).toContain(`\n\n${EN_BLOCK_TEXT}\n`);
      expect(romanian, who).not.toContain("Kit pickup");
      expect(english, who).not.toContain("Ridicarea kiturilor");
    }
  });

  it("stands after the organizers' words and above the event's button and «Nu mai pot ajunge»", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    await send();
    const email = await emailTo(ana.id);
    const words = email.html.indexOf("Ne vedem sâmbătă la start.");
    const block = email.html.indexOf('data-email-part="event-facts"');
    expect(words).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(words);
    expect(email.html.indexOf(">Vezi pagina evenimentului</a>")).toBeGreaterThan(block);
    expect(email.html.indexOf('data-email-part="cannot-come"')).toBeGreaterThan(block);
    // The second half the same: its own words, then its own block.
    expect(email.html.lastIndexOf('data-email-part="event-facts"')).toBeGreaterThan(email.html.indexOf("See you on Saturday at the start."));
    const [romanian] = email.text.split("\n— — —\n");
    expect(romanian.indexOf(RO_BLOCK_TEXT)).toBeGreaterThan(romanian.indexOf("Ne vedem sâmbătă la start."));
    expect(romanian.indexOf(RO_BLOCK_TEXT)).toBeLessThan(romanian.indexOf("Vezi pagina evenimentului: "));
    // Nothing is attached, and nothing of the programme needed a link or a secret of its own.
    expect(email.attachments).toBeUndefined();
    const tokens = await db.select().from(emailActionTokens);
    expect(tokens.map((token) => [token.registrationId, token.purpose])).toEqual([[ana.id, "MANAGE_REGISTRATION"]]);
  });

  it("with «Trimite și numărul de concurs și codul QR» too: under the number and the desk code, the QR picture under it", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    await send({ sendQr: true });
    const email = await emailTo(ana.id);
    const band = email.html.indexOf('data-email-part="highlight"');
    const block = email.html.indexOf('data-email-part="event-facts"');
    const picture = email.html.indexOf(`<img src="${QR_ROUTE}${ana.checkinCode}.png"`);
    expect(band).toBeGreaterThan(email.html.indexOf("Ne vedem sâmbătă la start."));
    expect(block).toBeGreaterThan(band);
    expect(picture).toBeGreaterThan(block);
    expect(blocks(email.html)).toHaveLength(2);
    const [romanian] = email.text.split("\n— — —\n");
    expect(romanian.indexOf(RO_BLOCK_TEXT)).toBeGreaterThan(romanian.indexOf(`spune codul ${ana.checkinCode}.`));
  });

  it("reads the rows as the message leaves: a row changed after the press is the one that leaves", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send();
    // As pressed: the programme of that minute.
    expect((await emailTo(ana.id)).text).toContain(RO_BLOCK_TEXT);
    // The organizers move the kits half an hour earlier, to another hall, and add the awards — after the press, before the email leaves.
    await setRows([
      { startsAt: "2099-11-21T06:00:00.000Z", endsAt: "2099-11-21T07:00:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Cortul de la start" },
      ROWS[1],
      { startsAt: "2099-11-21T10:30:00.000Z", endsAt: null, label: { ro: "Premierea", en: "Awards" }, place: null },
    ]);
    const email = await emailTo(ana.id);
    const [romanian, english] = email.text.split("\n— — —\n");
    expect(romanian).toContain("Program: 08:00–09:00 — Ridicarea kiturilor (Cortul de la start)\n  10:00 — Startul\n  12:30 — Premierea");
    expect(english).toContain("Programme: 08:00–09:00 — Kit pickup (Cortul de la start)\n  10:00 — The start\n  12:30 — Awards");
    // Nothing of what the programme said at the press is left in the message.
    expect(email.text).not.toContain("08:30–09:30");
    expect(email.text).not.toContain("Sala Sporturilor");
    expect(email.html).not.toContain("Sala Sporturilor");
    expect(blocks(email.html)[0]).toContain("08:00–09:00 — Ridicarea kiturilor (Cortul de la start)<br>10:00 — Startul<br>12:30 — Premierea");
    // The row's payload is what the press wrote: the flag, never the rows.
    for (const row of await ownRows()) expect(row.payloadJson).toEqual({ ...WORDS, includeProgramme: true });
  });

  it("with no timed row left as it leaves, the message is exactly the message of a send without the tick — a free-text programme alone draws nothing", async () => {
    const people = await everybody();
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, includeProgramme: false });
    const same = async (when: string) => {
      for (const row of Object.values(people)) {
        const withTick = await emailTo(row.id, ticked);
        const without = await emailTo(row.id, plain);
        expect(blocks(withTick.html), `${when}: ${row.registeredName}`).toHaveLength(0);
        expect(withTick.subject, `${when}: ${row.registeredName}`).toBe(without.subject);
        expect(settled(withTick.html), `${when}: ${row.registeredName}`).toBe(settled(without.html));
        expect(settled(withTick.text), `${when}: ${row.registeredName}`).toBe(settled(without.text));
      }
    };
    // The rows are removed after the press.
    await setRows(null);
    await same("no rows");
    await setRows([]);
    await same("an empty list");
    // The programme written as free text on the page (`schedule_json`) is not timed rows: the message draws none of it.
    const freeText = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Kiturile se ridică de la ora 8." }] }] };
    await db.update(eventTranslations).set({ scheduleJson: freeText }).where(eq(eventTranslations.eventId, eventId));
    await setRows(null);
    await same("free text alone");
    expect((await emailTo(people.ana.id, ticked)).text).not.toContain("Kiturile se ridică de la ora 8.");
  });

  it("changes nothing else of the message: with its blocks taken out, the ticked email is the unticked one — the facts line, every link, the buttons", async () => {
    const people = await everybody();
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, includeProgramme: false });
    for (const row of Object.values(people)) {
      const withTick = await emailTo(row.id, ticked);
      const without = await emailTo(row.id, plain);
      const who = `${row.registeredName} (${row.status})`;
      expect(blocks(withTick.html), who).toHaveLength(2);
      expect(withTick.subject, who).toBe(without.subject);
      expect(htmlWithoutBlocks(settled(withTick.html)), who).toBe(settled(without.html));
      expect(textWithoutBlocks(settled(withTick.text)), who).toBe(settled(without.text));
      // The facts line of §81 is still there — the full block, which would replace it, is not drawn.
      expect(withTick.html, who).toContain("Parcul Tractorul");
      // The links list is whole: the page's own programme link — which the full block would have taken out — and the rest.
      const [first] = withTick.text.split("\n— — —\n");
      expect(first, who).toMatch(row.locale === "ro" ? /^Programul evenimentului: \S+#schedule$/m : /^The event's programme: \S+#schedule$/m);
      expect(first, who).toMatch(row.locale === "ro" ? /^Pagina evenimentului: \S+$/m : /^The event's page: \S+$/m);
      expect(first, who).toMatch(row.locale === "ro" ? /^Scrie-ne: \S+$/m : /^Write to us: \S+$/m);
    }
  });

  it("says no row's place while the event's place is to be announced (§328), in the block as in the rest of the message", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send();
    expect((await emailTo(ana.id)).text).toContain("Ridicarea kiturilor (Sala Sporturilor)");
    await db.update(events).set({ locationToBeAnnounced: true }).where(eq(events.id, eventId));
    const email = await emailTo(ana.id);
    // The hour and the label stay; the hall is nowhere in the message.
    expect(email.text).toContain("Program: 08:30–09:30 — Ridicarea kiturilor\n  10:00 — Startul");
    expect(email.text).toContain("Programme: 08:30–09:30 — Kit pickup\n  10:00 — The start");
    for (const body of [email.html, email.text]) {
      expect(body).not.toContain("Sala Sporturilor");
      expect(body).not.toContain("Parcul Tractorul");
    }
    expect(blocks(email.html)).toHaveLength(2);
  });
});

describe("§NNN the club's copy, and every other message", () => {
  it("the club's one copy of the send carries the flag and draws the block; without the tick it carries neither", async () => {
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    await person("Ana", "CONFIRMED", { bib: 7 });
    await person("Carmen", "WAITLISTED");
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, includeProgramme: false });
    const copies = await clubCopies();
    expect(copies.map((copy) => copy.recipientEmail)).toEqual(["arhiva@club.test", "arhiva@club.test"]);
    const copy = copies.find((row) => row.idempotencyKey.includes(ticked))!;
    const plainCopy = copies.find((row) => row.idempotencyKey.includes(plain))!;
    expect(copy.payloadJson).toEqual({ ...WORDS, includeProgramme: true, clubCopy: true, eventId, recipients: 2 });
    expect(plainCopy.payloadJson).toEqual({ ...WORDS, clubCopy: true, eventId, recipients: 2 });

    const rendered = await renderOutboxMessage(copy, db, new Date());
    expect(rendered.subject.startsWith("[Copie club] ")).toBe(true);
    const found = blocks(rendered.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
    expect(found[1]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    expect(rendered.text).toContain(RO_BLOCK_TEXT);
    expect(rendered.text).toContain(EN_BLOCK_TEXT);
    // The words are kept, above it; and the copy is still nobody's own message: no button of a participant's.
    expect(rendered.html.indexOf("Ne vedem sâmbătă la start.")).toBeLessThan(rendered.html.indexOf('data-email-part="event-facts"'));
    expect(rendered.html).not.toContain('data-email-part="cannot-come"');
    // The unticked send's copy: the message as it always was, and the ticked copy is that message plus its blocks.
    const plainRendered = await renderOutboxMessage(plainCopy, db, new Date());
    expect(blocks(plainRendered.html)).toHaveLength(0);
    expect(htmlWithoutBlocks(rendered.html)).toBe(plainRendered.html);
    expect(textWithoutBlocks(rendered.text)).toBe(plainRendered.text);
  });

  it("a flag forged onto another message type draws nothing: that message is byte for byte the one without it", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    const owner = (await db.select().from(registrations).where(eq(registrations.id, ana.id)))[0];
    const handMade = async (messageType: "EVENT_UPDATE_NOTICE" | "EVENT_THANKS" | "EVENT_CANCELLED" | "WAITLIST_JOINED", payload: Record<string, unknown>, key: string) => {
      const [row] = await db
        .insert(emailOutbox)
        .values({ participantId: owner.participantId, registrationId: ana.id, messageType, locale: "ro", recipientEmail: "ana@example.test", payloadJson: payload, idempotencyKey: `hand-made:${key}` })
        .returning();
      return renderOutboxMessage(row, db, new Date());
    };
    const cases: Array<["EVENT_UPDATE_NOTICE" | "EVENT_THANKS" | "EVENT_CANCELLED" | "WAITLIST_JOINED", Record<string, unknown>]> = [
      ["EVENT_UPDATE_NOTICE", { changes: ["place"] }],
      ["EVENT_THANKS", {}],
      ["EVENT_CANCELLED", { reason: { ro: "Furtună.", en: "A storm." } }],
      ["WAITLIST_JOINED", {}],
    ];
    for (const [messageType, payload] of cases) {
      const forged = await handMade(messageType, { ...payload, includeProgramme: true }, `${messageType}:forged`);
      const plain = await handMade(messageType, payload, `${messageType}:plain`);
      expect(blocks(forged.html), messageType).toHaveLength(0);
      expect(forged.text, messageType).not.toContain("Ridicarea kiturilor");
      expect(settled(forged.html), messageType).toBe(settled(plain.html));
      expect(settled(forged.text), messageType).toBe(settled(plain.text));
    }
  });

  it("only a literal `true` on the organizers' own row draws it: a hand-made row with anything else reads the words alone", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const owner = (await db.select().from(registrations).where(eq(registrations.id, ana.id)))[0];
    for (const [index, value] of ["true", 1, "1", null, { on: true }].entries()) {
      const [row] = await db
        .insert(emailOutbox)
        .values({ participantId: owner.participantId, registrationId: ana.id, messageType: "ORGANIZER_MESSAGE", locale: "ro", recipientEmail: "ana@example.test", payloadJson: { ...WORDS, includeProgramme: value }, idempotencyKey: `hand-made:organizer:${index}` })
        .returning();
      const rendered = await renderOutboxMessage(row, db, new Date());
      expect(blocks(rendered.html), JSON.stringify(value)).toHaveLength(0);
      expect(rendered.text, JSON.stringify(value)).toContain("Ne vedem sâmbătă la start.");
    }
  });
});

describe("§NNN the preview on the form", () => {
  it("draws the block with the tick, in the tab's language first, from the rows as they are now — and nothing of it without; nothing is queued or minted", async () => {
    await person("Ana", "CONFIRMED", { bib: 7 });
    const off = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(blocks(off.html)).toHaveLength(0);
    expect(off.html).not.toContain("Ridicarea kiturilor");
    // Unticked is the preview as it was: a `false` builds the very same one.
    expect(await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: false })).toEqual(off);

    const on = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: true });
    const found = blocks(on.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
    expect(found[1]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    for (const block of found) expect(block).not.toMatch(/Când|When|Unde|Where|Traseu|Route|Cost|Linkuri|Links|<a /);
    // Under the words, above the button; the subject and the unknown-field list are untouched by the tick, and so is the rest.
    expect(on.html.indexOf('data-email-part="event-facts"')).toBeGreaterThan(on.html.indexOf("Ne vedem sâmbătă la start."));
    expect(on.html.indexOf('data-email-part="event-facts"')).toBeLessThan(on.html.indexOf(">Vezi pagina evenimentului</a>"));
    expect(on.subject).toBe(off.subject);
    expect(on.unknown).toEqual([]);
    expect(htmlWithoutBlocks(on.html)).toBe(off.html);

    // An English registrant's copy: English first.
    const english = await previewParticipantMessage(db, organizer, { eventId, locale: "en", ...WORDS, includeProgramme: true });
    const inEnglish = blocks(english.html);
    expect(inEnglish).toHaveLength(2);
    expect(inEnglish[0]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    expect(inEnglish[1]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);

    // With the other ticks: under the example runner's number and code, above her QR and «Vin».
    const all = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: true, sendQr: true, askReconfirm: true });
    const block = all.html.indexOf('data-email-part="event-facts"');
    expect(block).toBeGreaterThan(all.html.indexOf('data-email-part="highlight"'));
    expect(block).toBeLessThan(all.html.indexOf(`<img src="${QR_ROUTE}`));
    expect(block).toBeLessThan(all.html.indexOf('data-email-part="reconfirm"'));

    // The rows as they are now: a programme changed since the page was drawn is the one the next preview shows.
    await setRows([{ ...ROWS[0], label: { ro: "Ridicarea numerelor", en: "Number pickup" }, place: null }]);
    const changed = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: true });
    expect(blocks(changed.html)[0]).toContain("<strong>Program</strong><br>08:30–09:30 — Ridicarea numerelor</p>");
    expect(changed.html).not.toContain("Sala Sporturilor");

    // A preview queues nothing, mints nothing and audits nothing.
    expect(await ownRows()).toEqual([]);
    expect(await db.select().from(emailActionTokens)).toEqual([]);
    expect(await sendAudits()).toEqual([]);
  });

  it("with the tick and no timed row, the preview is the unticked one; and no row's place while the event's place is to be announced", async () => {
    await db.update(events).set({ locationToBeAnnounced: true }).where(eq(events.id, eventId));
    const withheld = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: true });
    expect(blocks(withheld.html)[0]).toContain("<strong>Program</strong><br>08:30–09:30 — Ridicarea kiturilor<br>10:00 — Startul");
    expect(withheld.html).not.toContain("Sala Sporturilor");

    await setRows(null);
    const off = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeProgramme: true })).toEqual(off);
  });

  it("through the action: the block only for a literal true from the network", async () => {
    state.actor = organizer;
    const words = { eventId, language: "ro", subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en };
    expect(blocks((await previewParticipantMessageAction({ ...words, includeProgramme: true }))?.html ?? "")).toHaveLength(2);
    for (const value of [undefined, false, "true", "1", 1]) {
      expect(blocks((await previewParticipantMessageAction({ ...words, includeProgramme: value }))?.html ?? "x"), String(value)).toHaveLength(0);
    }
    // In the tab's language: the English tab reads English first.
    const english = await previewParticipantMessageAction({ ...words, language: "en", includeProgramme: true });
    expect(blocks(english?.html ?? "")[0]).toContain("<strong>Programme</strong>");
  });
});

describe("§NNN the form's tick reaches the send", () => {
  function form(fields: Record<string, string>, ticked: readonly string[] = []): FormData {
    const posted = new FormData();
    posted.set("uiLocale", "ro");
    posted.set("eventId", eventId);
    posted.set("sendId", randomUUID());
    posted.set("audience", "ALL_ACTIVE");
    // «Scrie la câți trimiți»: each press here writes to the one runner seeded unless the test types another number.
    posted.set(CONFIRM_COUNT_FIELD, "1");
    posted.set("subjectRo", WORDS.subject.ro);
    posted.set("subjectEn", WORDS.subject.en);
    posted.set("bodyRo", WORDS.body.ro);
    posted.set("bodyEn", WORDS.body.en);
    for (const id of ticked) posted.append(CHOSEN_FIELD, id);
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

  it("a ticked box posts `1` and flags the row; a form without it, or with anything else, flags nobody", async () => {
    const ana = await person("Ana", "WAITLISTED");
    state.actor = organizer;
    expect(await press(form({ includeProgramme: "1" }))).toMatchObject({ redirect: expect.stringMatching(/sent=1&test=0#admin-alert$/) });
    expect((await ownRows()).map((row) => [row.registrationId, flagOf(row)])).toEqual([[ana.id, true]]);
    // An unticked or a disabled box posts nothing; a value the form never posts is no either.
    const others: Record<string, string>[] = [{}, { includeProgramme: "true" }, { includeProgramme: "on" }];
    for (const fields of others) {
      const posted = form(fields);
      await press(posted);
      const [row] = (await ownRows()).filter((one) => one.idempotencyKey.includes(String(posted.get("sendId"))));
      expect(flagOf(row), JSON.stringify(fields)).toBeUndefined();
    }
    const audits = (await sendAudits()).map((audit) => (audit.metadataJson as { includeProgramme?: unknown }).includeProgramme);
    expect(audits.filter((value) => value === true)).toHaveLength(1);
  });

  it("«Doar anumiți participanți»: the same form passes the tick through for the people ticked, and the page it returns to is handed it back with the words", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "PENDING_DECLARATION");
    const carmen = await person("Carmen", "WAITLISTED");
    state.actor = organizer;
    const posted = form({ audience: CHOSEN_AUDIENCE, [CONFIRM_COUNT_FIELD]: "2", includeProgramme: "1" }, [ana.id, bogdan.id]);
    const sendId = String(posted.get("sendId"));
    expect(await press(posted)).toMatchObject({ redirect: expect.stringMatching(new RegExp(`sent=2&test=0&kept=${sendId}#admin-alert$`)) });
    // The ticked, and only they — each row flagged whatever its state.
    const rows = await ownRows();
    expect(rows.map((row) => row.registrationId).sort()).toEqual([ana.id, bogdan.id].sort());
    for (const row of rows) expect(row.payloadJson).toEqual({ ...WORDS, includeProgramme: true });
    expect(rows.some((row) => row.registrationId === carmen.id)).toBe(false);
    // A trial is followed by the same message to everybody: the tick comes back with the words and the other ticks (§945).
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: false, includeProgramme: true });

    // A trial that did not tick it hands back no such key: the box is off, as on every new message.
    const plain = form({ audience: CHOSEN_AUDIENCE, [CONFIRM_COUNT_FIELD]: "1" }, [carmen.id]);
    await press(plain);
    const kept = await readKeptMessage(db, eventId, String(plain.get("sendId")));
    expect(kept).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: false });
    expect(kept && "includeProgramme" in kept).toBe(false);
    // …and what is not a literal `true` in a hand-made audit row is no tick.
    const [audit] = (await sendAudits()).filter((entry) => (entry.metadataJson as { sendId?: string }).sendId === sendId);
    await db.update(auditLogs).set({ metadataJson: { ...(audit.metadataJson as Record<string, unknown>), includeProgramme: "yes" } }).where(eq(auditLogs.id, audit.id));
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: false });
  });

  it("keeps the tick with the other boxes when the send is refused (§315), and queues nothing", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = organizer;
    const refused = await press(form({ includeProgramme: "1", bodyEn: "" }));
    expect(refused).toMatchObject({ returned: { error: "VALIDATION_ERROR", fields: ["bodyEn"], values: { includeProgramme: ["1"], subjectRo: [WORDS.subject.ro] } } });
    expect(await ownRows()).toEqual([]);
  });

  it("refuses a role that may not write to participants, tick or not (BR-REQ-060-01)", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = await staff("DEV");
    expect(await press(form({ includeProgramme: "1" }))).toMatchObject({ returned: { error: "FORBIDDEN" } });
    expect(await previewParticipantMessageAction({ eventId, language: "ro", subjectRo: "a", subjectEn: "b", bodyRo: "c", bodyEn: "d", includeProgramme: true })).toBeNull();
    expect(await ownRows()).toEqual([]);
  });
});
