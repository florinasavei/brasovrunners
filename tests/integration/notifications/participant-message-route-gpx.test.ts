import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EventLinkKind } from "@/modules/events/domain/links";
import { type RouteGpx, routeGpxFileName } from "@/modules/events/domain/route-gpx";
import { AUDIENCE_STATUSES, CHOSEN_AUDIENCE, CHOSEN_FIELD, CONFIRM_COUNT_FIELD } from "@/modules/notifications/domain/organizer-message";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §NNN — «Atașează traseul (GPX)» on «Trimite un mesaj participanților» (the owner, 2026-11-19, two days before the race:
 * «vreau să pot pune în mail și traseul cursei GPX»; BR-REQ-080-01, BR-REQ-080-02, BR-REQ-060-01) — the twin of §958's
 * «Include programul evenimentului».
 *
 * One tick, off by default, for an event whose page offers a GPX (the file of «Traseul», §718). Ticked, the send puts a
 * flag — never the file — on **every** outbox row it queues, whatever the registration's state, a test row too, and on
 * the club's one copy, and names the tick in its audit row; for an event with no GPX a posted tick flags nothing. When
 * each email leaves, the renderer reads the event's GPX from the store as it is then and attaches it under the file's
 * own name, typed `application/gpx+xml`, with one line under the organizers' words — each half in its own language — and
 * the link to the same file the event page's «Descarcă traseul (GPX)» opens. No GPX left by then: no line, no file. A
 * store that gives no file: the email still leaves, with the link alone. A club copy carries no file (§320) and keeps the
 * link. The preview draws the line. All people and every track here are made up; the store is the test environment's
 * own in-memory one (`media/storage.ts`, `fake`).
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
const { createOutboxRenderer, renderOutboxMessage } = await import("@/modules/notifications/render");
const { processOutboxBatch } = await import("@/modules/notifications/outbox");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { sendParticipantMessageAction, previewParticipantMessageAction } = await import("@/app/[locale]/admin/events/[id]/mesaje/actions");
const { getStorage } = await import("@/modules/media/storage");
const { storeRouteGpx } = await import("@/modules/content/events/route-gpx");
const { default: EventRoute } = await import("@/modules/events/ui/EventRoute");
type RouteMapWords = import("@/modules/events/ui/EventRoute").RouteMapWords;

const WORDS = {
  subject: { ro: "Ultimele detalii pentru {eventTitle}", en: "The last details for {eventTitle}" },
  body: { ro: "Bună, {participantName}!\n\nNe vedem sâmbătă la start.", en: "Hi {participantName}!\n\nSee you on Saturday at the start." },
};

/** The line each half says, as the templates write it: the file said attached, or the link alone. */
const LINE = {
  ro: { attached: "Traseul e atașat acestui email, ca fișier GPX. Îl poți descărca și de aici:", linkOnly: "Traseul, ca fișier GPX, îl descarci de aici:" },
  en: { attached: "The route is attached to this email as a GPX file. You can also download it here:", linkOnly: "Download the route as a GPX file here:" },
};

/** A made-up track, as a watch exports one, and the one the club uploads instead after the press. */
const TRACK = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test"><trk><name>Crosul Tâmpei</name><trkseg><trkpt lat="45.6380" lon="25.5890"/><trkpt lat="45.6390" lon="25.5900"/></trkseg></trk></gpx>`);
const NEW_TRACK = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test"><trk><name>Varianta prin pădure</name><trkseg><trkpt lat="45.6400" lon="25.5910"/></trkseg></trk></gpx>`);

/** The race day's timed rows (§117), for the one test that ticks «Include programul evenimentului» too. */
const ROWS = [
  { startsAt: "2099-11-21T06:30:00.000Z", endsAt: "2099-11-21T07:30:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Sala Sporturilor" },
  { startsAt: "2099-11-21T08:00:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: null },
];

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let organizer: StaffUser;
let gpx: RouteGpx;
let serial = 0;

const upload = (bytes: Buffer, name: string) => storeRouteGpx(getStorage(), { bytes, name, environment: "test", now: new Date() });

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  organizer = await staff("MODERATOR");
  // The club's file, uploaded through the editor's own path (§718), into this environment's store.
  gpx = await upload(TRACK, "Traseu Tâmpa 2026.gpx");
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
      routeGpx: gpx,
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: `crosul-${eventId.slice(0, 8)}` },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: `tampa-cross-${eventId.slice(0, 8)}` },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
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
  sendParticipantMessage(db, actor, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), includeRouteGpx: true, ...WORDS, ...overrides }), new Date());

/** The participants' own rows of the organizers' message — never the club's copy, which has no participant. */
const ownRows = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
const clubCopies = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNull(emailOutbox.participantId)));
const flagOf = (row: { payloadJson: unknown }) => (row.payloadJson as { includeRouteGpx?: unknown }).includeRouteGpx;
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

const setGpx = (routeGpx: RouteGpx | null) => db.update(events).set({ routeGpx }).where(eq(events.id, eventId));

/** Every line of the route's kind in a message, whole: one a half. */
const lines = (html: string) => [...html.matchAll(/<p data-email-part="route-gpx"[^>]*>[^]*?<\/p>/g)].map((match) => match[0]);
const hrefOf = (part: string) => /href="([^"]+)"/.exec(part)?.[1];
/** A message without them — what is left must be the message of a send that did not tick (the card joins its parts with a line break). */
const withoutLines = (html: string) => html.replace(/<p data-email-part="route-gpx"[^>]*>[^]*?<\/p>\n/g, "");
/** A message with the one thing two renders of it differ by — the manage link's secret, minted at each render — settled. */
const settled = (text: string) => text.replace(/(\/(?:inregistrari\/gestionare|registrations\/manage)\/)[A-Za-z0-9_-]+/g, "$1TOKEN");
/** The address a file of this key is at — what the event page's link and the email's must both be. */
const linkOf = (key: string) => getStorage().publicUrl(key);

/** The event page's own «Descarcă traseul (GPX)» for a stored GPX (`EventRoute`, §718): the address it opens. */
function pageDownloadHref(routeGpx: unknown): string | undefined {
  const html = renderToStaticMarkup(
    withClientWords(
      createElement(EventRoute, {
        descriptionJson: null,
        links: null,
        routeUrl: null,
        routeGpx,
        locale: "ro",
        heading: ro.Event.routeSection,
        openRouteLabel: ro.Event.openRoute,
        kindLabels: ro.Event.links.kinds as Record<EventLinkKind, string>,
        mapWords: ro.Event.routeMaps as RouteMapWords,
      }),
    ),
  );
  const tag = /<a[^>]*data-testid="route-gpx-download"[^>]*>/.exec(html)?.[0] ?? "";
  return /href="([^"]+)"/.exec(tag)?.[1];
}

describe("§NNN the send: the flag rides on every row and on the club's copy, never the file", () => {
  it("flags every row of «Toți cei înscriși» — every state, a test row too — and the club's copy, and the audit row names the tick", async () => {
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    const people = await everybody();
    const sendId = randomUUID();
    expect(await send({ sendId })).toEqual({ kind: "queued", real: 5, test: 1 });

    const rows = await ownRows();
    expect(rows.map((row) => row.registrationId).sort()).toEqual(Object.values(people).map((row) => row.id).sort());
    // A flag beside the words, and nothing of the file: its bytes are read from the store when each email leaves.
    for (const row of rows) expect(row.payloadJson, row.registrationId ?? "").toEqual({ ...WORDS, includeRouteGpx: true });
    expect([...new Set(Object.values(people).map((row) => row.status))].sort()).toEqual([...AUDIENCE_STATUSES.ALL_ACTIVE].sort());
    // The club's one copy carries the flag too: it says the route's link, which names nobody.
    const [copy] = await clubCopies();
    expect(copy.payloadJson).toEqual({ ...WORDS, includeRouteGpx: true, clubCopy: true, eventId, recipients: 5 });

    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject, includeRouteGpx: true });
    // Nothing of the file, its name or its address in the outbox or in the trail.
    const stored = JSON.stringify([...rows, copy].map((row) => row.payloadJson)) + JSON.stringify(audit.metadataJson);
    for (const needle of ["<gpx", "Crosul Tâmpei", gpx.key, routeGpxFileName(gpx.key), TRACK.toString("base64").slice(0, 24)]) expect(stored, needle).not.toContain(needle);
  });

  it("flags every row of each of the three groups", async () => {
    const people = await everybody();
    const sends: Array<[string, string[]]> = [
      ["CONFIRMED", [people.ana.id, people.bogdan.id]],
      ["WAITLIST", [people.carmen.id, people.dan.id, people.probe.id]],
      ["PENDING_DECLARATION", [people.elena.id]],
    ];
    for (const [audience, expected] of sends) {
      const sendId = randomUUID();
      expect((await send({ audience, sendId })).kind, audience).toBe("queued");
      const rows = (await ownRows()).filter((row) => row.idempotencyKey.includes(sendId));
      expect(rows.map((row) => row.registrationId).sort(), audience).toEqual([...expected].sort());
      for (const row of rows) expect(row.payloadJson, audience).toEqual({ ...WORDS, includeRouteGpx: true });
    }
  });

  it("without the tick — the default: no flag on any row or the copy, nothing in the audit row, and no line or file in anybody's email", async () => {
    const people = await everybody();
    const sendId = randomUUID();
    expect(await sendParticipantMessage(db, organizer, await confirmed(db, { eventId, audience: "ALL_ACTIVE", sendId, ...WORDS }), new Date())).toEqual({ kind: "queued", real: 5, test: 1 });
    const unticked = randomUUID();
    await send({ sendId: unticked, includeRouteGpx: false });
    for (const row of await ownRows()) expect(row.payloadJson).toEqual(WORDS);
    const audits = (await sendAudits()).map((entry) => entry.metadataJson as Record<string, unknown>);
    for (const id of [sendId, unticked]) expect(audits.find((entry) => entry.sendId === id)).toEqual({ sendId: id, audience: "ALL_ACTIVE", recipients: 5, test: 1, subject: WORDS.subject });
    for (const row of Object.values(people)) {
      const email = await emailTo(row.id, sendId);
      expect(lines(email.html), row.registeredName).toHaveLength(0);
      expect(email.attachments, row.registeredName).toBeUndefined();
      expect(email.text, row.registeredName).not.toContain("GPX");
    }
  });

  it("an event with no GPX: a posted tick is ignored — no flag, nothing in the audit row — and so is one for a file removed since the page was drawn", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await setGpx(null);
    const sendId = randomUUID();
    expect((await send({ sendId })).kind).toBe("queued");
    const [row] = await ownRows();
    expect(row.payloadJson).toEqual(WORDS);
    expect(flagOf(row)).toBeUndefined();
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toEqual({ sendId, audience: "ALL_ACTIVE", recipients: 1, test: 0, subject: WORDS.subject });
    const email = await emailTo(ana.id);
    expect(lines(email.html)).toHaveLength(0);
    expect(email.attachments).toBeUndefined();
  });

  it("rides beside the other ticks: the QR and the declaration link on their own rows, the route and the programme on all of them", async () => {
    const people = await everybody();
    await send({ sendQr: true, signLink: true, includeProgramme: true });
    const payloadOf = async (id: string) => (await ownRows()).find((row) => row.registrationId === id)?.payloadJson as Record<string, unknown>;
    expect(await payloadOf(people.ana.id)).toEqual({ ...WORDS, sendQr: true, includeProgramme: true, includeRouteGpx: true });
    expect(await payloadOf(people.elena.id)).toEqual({ ...WORDS, signLink: true, includeProgramme: true, includeRouteGpx: true });
    expect(await payloadOf(people.carmen.id)).toEqual({ ...WORDS, includeProgramme: true, includeRouteGpx: true });
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toMatchObject({ sendQr: true, signLink: true, includeProgramme: true, includeRouteGpx: true });
  });

  it("BR-REQ-060-01: the Organizer and up send and preview it with the tick; every other role is refused and nothing is queued", async () => {
    await person("Ana", "CONFIRMED");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await send({}, await staff(role))).kind, role).toBe("queued");
    const queued = (await ownRows()).length;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role);
      expect(await refusalOf(send({}, actor)), role).toBe("FORBIDDEN");
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId, locale: "ro", ...WORDS, includeRouteGpx: true })), role).toBe("FORBIDDEN");
    }
    expect((await ownRows()).length).toBe(queued);
  });
});

describe("§NNN the email as it leaves: the file attached, and the line with its link under the organizers' words", () => {
  it("attaches the event's GPX — its own name, `application/gpx+xml`, the bytes as uploaded — for every state of registration", async () => {
    const people = await everybody();
    await send();
    for (const row of Object.values(people)) {
      const email = await emailTo(row.id);
      const who = `${row.registeredName} (${row.status}, ${row.locale})`;
      expect(email.attachments, who).toHaveLength(1);
      const [file] = email.attachments ?? [];
      expect(file.filename, who).toBe("traseu-tampa-2026.gpx");
      expect(file.filename, who).toBe(routeGpxFileName(gpx.key));
      expect(file.contentType, who).toBe("application/gpx+xml");
      expect(Buffer.compare(file.data, TRACK), who).toBe(0);
    }
  });

  it("says it in one line a half, each in its own language, with the link to the very file the event page's «Descarcă traseul (GPX)» opens", async () => {
    const people = await everybody();
    await send();
    const url = linkOf(gpx.key);
    // The page's own address for the file — from the environment, never a host typed in the code (`AGENTS.md` §8).
    expect(pageDownloadHref(gpx)).toBe(url);
    expect(url.startsWith(`${env.APP_BASE_URL}/`)).toBe(true);
    expect(url.endsWith(`/${gpx.key}`)).toBe(true);
    for (const row of Object.values(people)) {
      const email = await emailTo(row.id);
      const who = `${row.registeredName} (${row.locale})`;
      const found = lines(email.html);
      expect(found, who).toHaveLength(2);
      const [first, second] = row.locale === "ro" ? [LINE.ro, LINE.en] : [LINE.en, LINE.ro];
      expect(found[0], who).toContain(first.attached);
      expect(found[1], who).toContain(second.attached);
      for (const part of found) {
        expect(hrefOf(part), who).toBe(url);
        // The file's own name is what the link says.
        expect(part, who).toContain(`>${routeGpxFileName(gpx.key)}</a>`);
      }
      // The plain-text half writes the address out, after each half's sentence.
      expect(email.text, who).toContain(`${LINE.ro.attached} ${url}`);
      expect(email.text, who).toContain(`${LINE.en.attached} ${url}`);
      expect(email.text, who).not.toContain(LINE.ro.linkOnly);
    }
  });

  it("stands after the organizers' words and the number and code lines, above the programme and the event's button", async () => {
    const ana = await person("Ana", "CONFIRMED", { bib: 7 });
    await db.update(events).set({ scheduleItems: ROWS }).where(eq(events.id, eventId));
    await send({ sendQr: true, includeProgramme: true });
    const email = await emailTo(ana.id);
    const at = (needle: string) => email.html.indexOf(needle);
    const line = at('data-email-part="route-gpx"');
    expect(at("Ne vedem sâmbătă la start.")).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(at("Ne vedem sâmbătă la start."));
    expect(line).toBeGreaterThan(at('data-email-part="highlight"'));
    expect(line).toBeLessThan(at('data-email-part="event-facts"'));
    expect(line).toBeLessThan(at(">Vezi pagina evenimentului</a>"));
    // The second half the same: its own words, then its own line.
    expect(email.html.lastIndexOf('data-email-part="route-gpx"')).toBeGreaterThan(at("See you on Saturday at the start."));
    const [romanian] = email.text.split("\n— — —\n");
    expect(romanian.indexOf(LINE.ro.attached)).toBeGreaterThan(romanian.indexOf("Ne vedem sâmbătă la start."));
    expect(romanian.indexOf(LINE.ro.attached)).toBeLessThan(romanian.indexOf("Program: "));
    // Still one file, beside nothing else.
    expect(email.attachments?.map((file) => file.filename)).toEqual([routeGpxFileName(gpx.key)]);
  });

  it("reads the file as the message leaves: a GPX replaced after the press is the one that leaves, under its own name and link", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send();
    expect(Buffer.compare((await emailTo(ana.id)).attachments?.[0]?.data ?? Buffer.alloc(0), TRACK)).toBe(0);
    // The club uploads another track after the press, before the email leaves.
    const replaced = await upload(NEW_TRACK, "Varianta prin pădure.gpx");
    await setGpx(replaced);
    const email = await emailTo(ana.id);
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments?.[0]?.filename).toBe("varianta-prin-padure.gpx");
    expect(Buffer.compare(email.attachments?.[0]?.data ?? Buffer.alloc(0), NEW_TRACK)).toBe(0);
    for (const part of lines(email.html)) expect(hrefOf(part)).toBe(linkOf(replaced.key));
    expect(email.html).not.toContain(gpx.key);
    // The row's payload is what the press wrote: the flag, never the file.
    for (const row of await ownRows()) expect(row.payloadJson).toEqual({ ...WORDS, includeRouteGpx: true });
  });

  it("with no GPX left as it leaves, the message is exactly the message of a send without the tick: no line and no file", async () => {
    const people = await everybody();
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, includeRouteGpx: false });
    await setGpx(null);
    for (const row of Object.values(people)) {
      const withTick = await emailTo(row.id, ticked);
      const without = await emailTo(row.id, plain);
      expect(lines(withTick.html), row.registeredName).toHaveLength(0);
      expect(withTick.attachments, row.registeredName).toBeUndefined();
      expect(withTick.subject, row.registeredName).toBe(without.subject);
      expect(settled(withTick.html), row.registeredName).toBe(settled(without.html));
      expect(settled(withTick.text), row.registeredName).toBe(settled(without.text));
    }
  });

  it("changes nothing else of the message: with its lines taken out and no file, the ticked email is the unticked one", async () => {
    const people = await everybody();
    const ticked = randomUUID();
    const plain = randomUUID();
    await send({ sendId: ticked });
    await send({ sendId: plain, includeRouteGpx: false });
    for (const row of Object.values(people)) {
      const withTick = await emailTo(row.id, ticked);
      const without = await emailTo(row.id, plain);
      expect(withTick.subject, row.registeredName).toBe(without.subject);
      expect(withoutLines(settled(withTick.html)), row.registeredName).toBe(settled(without.html));
      const text = settled(withTick.text)
        .split("\n")
        .filter((textLine) => !textLine.startsWith(LINE.ro.attached) && !textLine.startsWith(LINE.en.attached))
        .join("\n");
      expect(text.replace(/\n{3,}/g, "\n\n"), row.registeredName).toBe(settled(without.text).replace(/\n{3,}/g, "\n\n"));
    }
  });

  it("a store that gives no file costs the file, never the email: the line with the link alone, no attachment, a warning in the log", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED", { locale: "en" });
    await send();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const linkOnly = (email: OutgoingEmail) => {
      expect(email.attachments).toBeUndefined();
      const found = lines(email.html);
      expect(found).toHaveLength(2);
      for (const part of found) expect(hrefOf(part)).toBe(linkOf(gpx.key));
      expect(email.html).toContain(LINE.ro.linkOnly);
      expect(email.html).toContain(LINE.en.linkOnly);
      expect(email.html).not.toContain(LINE.ro.attached);
      expect(email.text).toContain(`${LINE.ro.linkOnly} ${linkOf(gpx.key)}`);
      expect(email.text).toContain(`${LINE.en.linkOnly} ${linkOf(gpx.key)}`);
    };
    // The store throws — a bucket having a bad minute.
    const get = vi.spyOn(getStorage(), "get").mockRejectedValue(new Error("the bucket is having a bad minute"));
    linkOnly(await emailTo(ana.id));
    get.mockRestore();
    // The object is gone from the store.
    await getStorage().delete(gpx.key);
    linkOnly(await emailTo(bogdan.id));
    const [row] = (await ownRows()).filter((own) => own.registrationId === bogdan.id);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("route's GPX could not be read"), { id: row.id });

    // …and through the outbox itself: every message of the send leaves, each without the file.
    const sent: OutgoingEmail[] = [];
    const sender = { send: async (message: OutgoingEmail) => (sent.push(message), { outcome: "sent" as const, providerMessageId: `test-${sent.length}` }) };
    await processOutboxBatch(db, { sender: sender as never, render: createOutboxRenderer(), now: new Date(), batchSize: 50 });
    expect(sent.map((message) => message.to).sort()).toEqual(["ana@example.test", "bogdan@example.test"]);
    for (const message of sent) linkOnly(message);
    const statuses = (await ownRows()).map((own) => own.status);
    expect(statuses).toEqual(["SENT", "SENT"]);
  });

  it("through the outbox, every message carries the file, and a batch reads it from the store once", async () => {
    const people = await everybody();
    await send();
    const get = vi.spyOn(getStorage(), "get");
    const sent: OutgoingEmail[] = [];
    const sender = { send: async (message: OutgoingEmail) => (sent.push(message), { outcome: "sent" as const, providerMessageId: `test-${sent.length}` }) };
    await processOutboxBatch(db, { sender: sender as never, render: createOutboxRenderer(), now: new Date(), batchSize: 50 });
    expect(sent).toHaveLength(Object.keys(people).length);
    for (const message of sent) {
      expect(message.attachments?.map((file) => [file.filename, file.contentType]), message.to).toEqual([[routeGpxFileName(gpx.key), "application/gpx+xml"]]);
      expect(Buffer.compare(message.attachments?.[0]?.data ?? Buffer.alloc(0), TRACK), message.to).toBe(0);
    }
    expect(get.mock.calls.filter(([key]) => key === gpx.key)).toHaveLength(1);
    for (const row of await ownRows()) expect(row.status).toBe("SENT");
  });
});

describe("§NNN the club's copy, and every other message", () => {
  it("the club's one copy carries no file — the store is not even asked — and its line gives the link alone", async () => {
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    await person("Ana", "CONFIRMED", { bib: 7 });
    await send();
    const [copy] = await clubCopies();
    const get = vi.spyOn(getStorage(), "get");
    const rendered = await renderOutboxMessage(copy, db, new Date());
    expect(rendered.subject.startsWith("[Copie club] ")).toBe(true);
    expect(rendered.attachments).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
    const found = lines(rendered.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(LINE.ro.linkOnly);
    expect(found[1]).toContain(LINE.en.linkOnly);
    for (const part of found) expect(hrefOf(part)).toBe(linkOf(gpx.key));
    expect(rendered.html).not.toContain(LINE.ro.attached);
    expect(rendered.text).toContain(`${LINE.ro.linkOnly} ${linkOf(gpx.key)}`);
    // …and still nobody's own message: no button of a participant's.
    expect(rendered.html).not.toContain('data-email-part="cannot-come"');
  });

  it("a flag forged onto another message type draws nothing and attaches nothing: that message is the one without it", async () => {
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
      const forged = await handMade(messageType, { ...payload, includeRouteGpx: true }, `${messageType}:forged`);
      const plain = await handMade(messageType, payload, `${messageType}:plain`);
      expect(lines(forged.html), messageType).toHaveLength(0);
      expect(forged.attachments?.some((file) => file.contentType === "application/gpx+xml") ?? false, messageType).toBe(false);
      expect(settled(forged.html), messageType).toBe(settled(plain.html));
      expect(settled(forged.text), messageType).toBe(settled(plain.text));
    }
  });

  it("only a literal `true` on the organizers' own row attaches it: a hand-made row with anything else reads the words alone", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const owner = (await db.select().from(registrations).where(eq(registrations.id, ana.id)))[0];
    for (const [index, value] of ["true", 1, "1", null, { on: true }].entries()) {
      const [row] = await db
        .insert(emailOutbox)
        .values({ participantId: owner.participantId, registrationId: ana.id, messageType: "ORGANIZER_MESSAGE", locale: "ro", recipientEmail: "ana@example.test", payloadJson: { ...WORDS, includeRouteGpx: value }, idempotencyKey: `hand-made:organizer:${index}` })
        .returning();
      const rendered = await renderOutboxMessage(row, db, new Date());
      expect(lines(rendered.html), JSON.stringify(value)).toHaveLength(0);
      expect(rendered.attachments, JSON.stringify(value)).toBeUndefined();
      expect(rendered.text, JSON.stringify(value)).toContain("Ne vedem sâmbătă la start.");
    }
  });
});

describe("§NNN the preview on the form", () => {
  it("draws the line with the file said attached and its link, in the tab's language first — and nothing without the tick; nothing is read, queued or attached", async () => {
    await person("Ana", "CONFIRMED", { bib: 7 });
    const get = vi.spyOn(getStorage(), "get");
    const off = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(lines(off.html)).toHaveLength(0);
    expect(await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeRouteGpx: false })).toEqual(off);

    const on = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeRouteGpx: true });
    const found = lines(on.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(LINE.ro.attached);
    expect(found[1]).toContain(LINE.en.attached);
    for (const part of found) expect(hrefOf(part)).toBe(linkOf(gpx.key));
    expect(on.html.indexOf('data-email-part="route-gpx"')).toBeGreaterThan(on.html.indexOf("Ne vedem sâmbătă la start."));
    expect(on.html.indexOf('data-email-part="route-gpx"')).toBeLessThan(on.html.indexOf(">Vezi pagina evenimentului</a>"));
    expect(on.subject).toBe(off.subject);
    expect(withoutLines(on.html)).toBe(off.html);

    const english = lines((await previewParticipantMessage(db, organizer, { eventId, locale: "en", ...WORDS, includeRouteGpx: true })).html);
    expect(english[0]).toContain(LINE.en.attached);
    expect(english[1]).toContain(LINE.ro.attached);

    // The preview reads no file and queues nothing.
    expect(get).not.toHaveBeenCalled();
    expect(await ownRows()).toEqual([]);
    expect(await sendAudits()).toEqual([]);
  });

  it("with the tick and no GPX, the preview is the unticked one", async () => {
    await setGpx(null);
    const off = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, includeRouteGpx: true })).toEqual(off);
  });

  it("through the action: the line only for a literal true from the network", async () => {
    state.actor = organizer;
    const words = { eventId, language: "ro", subjectRo: WORDS.subject.ro, subjectEn: WORDS.subject.en, bodyRo: WORDS.body.ro, bodyEn: WORDS.body.en };
    expect(lines((await previewParticipantMessageAction({ ...words, includeRouteGpx: true }))?.html ?? "")).toHaveLength(2);
    for (const value of [undefined, false, "true", "1", 1]) {
      expect(lines((await previewParticipantMessageAction({ ...words, includeRouteGpx: value }))?.html ?? "x"), String(value)).toHaveLength(0);
    }
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
    expect(await press(form({ includeRouteGpx: "1" }))).toMatchObject({ redirect: expect.stringMatching(/sent=1&test=0#admin-alert$/) });
    expect((await ownRows()).map((row) => [row.registrationId, flagOf(row)])).toEqual([[ana.id, true]]);
    for (const fields of [{}, { includeRouteGpx: "true" }, { includeRouteGpx: "on" }] as Record<string, string>[]) {
      const posted = form(fields);
      await press(posted);
      const [row] = (await ownRows()).filter((one) => one.idempotencyKey.includes(String(posted.get("sendId"))));
      expect(flagOf(row), JSON.stringify(fields)).toBeUndefined();
    }
    // A posted `1` for an event without a GPX flags nobody either.
    await setGpx(null);
    const forged = form({ includeRouteGpx: "1" });
    await press(forged);
    const [row] = (await ownRows()).filter((one) => one.idempotencyKey.includes(String(forged.get("sendId"))));
    expect(flagOf(row)).toBeUndefined();
    const audits = (await sendAudits()).map((audit) => (audit.metadataJson as { includeRouteGpx?: unknown }).includeRouteGpx);
    expect(audits.filter((value) => value === true)).toHaveLength(1);
  });

  it("«Doar anumiți participanți»: the tick goes through for the people ticked, and comes back with the words after the trial", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "PENDING_DECLARATION");
    const carmen = await person("Carmen", "WAITLISTED");
    state.actor = organizer;
    const posted = form({ audience: CHOSEN_AUDIENCE, [CONFIRM_COUNT_FIELD]: "2", includeRouteGpx: "1" }, [ana.id, bogdan.id]);
    const sendId = String(posted.get("sendId"));
    expect(await press(posted)).toMatchObject({ redirect: expect.stringMatching(new RegExp(`sent=2&test=0&kept=${sendId}#admin-alert$`)) });
    const rows = await ownRows();
    expect(rows.map((row) => row.registrationId).sort()).toEqual([ana.id, bogdan.id].sort());
    for (const row of rows) expect(row.payloadJson).toEqual({ ...WORDS, includeRouteGpx: true });
    expect(rows.some((row) => row.registrationId === carmen.id)).toBe(false);
    // The trial's file is attached to the trial's emails, as to any send's.
    expect((await emailTo(ana.id)).attachments?.map((file) => file.filename)).toEqual([routeGpxFileName(gpx.key)]);
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: false, includeRouteGpx: true });

    // A trial without it hands back no such key.
    const plain = form({ audience: CHOSEN_AUDIENCE, [CONFIRM_COUNT_FIELD]: "1" }, [carmen.id]);
    await press(plain);
    const kept = await readKeptMessage(db, eventId, String(plain.get("sendId")));
    expect(kept).toEqual({ ...WORDS, askReconfirm: false, sendQr: false, signLink: false });
    expect(kept && "includeRouteGpx" in kept).toBe(false);
  });

  it("keeps the tick with the other boxes when the send is refused (§315), and queues nothing", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = organizer;
    const refused = await press(form({ includeRouteGpx: "1", bodyEn: "" }));
    expect(refused).toMatchObject({ returned: { error: "VALIDATION_ERROR", fields: ["bodyEn"], values: { includeRouteGpx: ["1"], subjectRo: [WORDS.subject.ro] } } });
    expect(await ownRows()).toEqual([]);
  });

  it("refuses a role that may not write to participants, tick or not (BR-REQ-060-01)", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = await staff("DEV");
    expect(await press(form({ includeRouteGpx: "1" }))).toMatchObject({ returned: { error: "FORBIDDEN" } });
    expect(await previewParticipantMessageAction({ eventId, language: "ro", subjectRo: "a", subjectEn: "b", bodyRo: "c", bodyEn: "d", includeRouteGpx: true })).toBeNull();
    expect(await ownRows()).toEqual([]);
  });
});
