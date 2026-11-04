import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { EmailHistory } from "@/modules/notifications/email-history";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — a person's «Emailuri»: every outbox row of one registration, or of one volunteer by the payload's
 * `volunteerId`, newest first, with its tries and the next one, when it was queued and by what, what became of it, a
 * FAILED row's sanitized reason and nothing else of the provider, and the club's copies folded under their message —
 * read by the Administrator and the Superadministrator alone (BR-REQ-060-01), in «Emailuri azi»'s own words.
 *
 * Over PGlite: the reader (`email-history.ts#readEmailHistory`) and the fold (`ui/EmailHistory.tsx`) rendered as the
 * server renders it, in Romanian and in English.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator: translator } = await import("next-intl");
  const { catalogueOf: catalogue } = await import("@/i18n/catalogue");
  return {
    getTranslations: async (namespace: string) => translator({ locale: state.locale, messages: catalogue(state.locale), namespace: namespace as "Admin" }),
  };
});

const { EMAIL_HISTORY_LIMIT, foldEmailHistory, readEmailHistory } = await import("@/modules/notifications/email-history");
const { default: EmailHistoryPanel, emailHistorySummary } = await import("@/modules/notifications/ui/EmailHistory");

// 12:00 in Brașov on 1 October 2026 (UTC+3).
const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (iso: string) => new Date(iso);
/** Words a row's payload carries that the fold must never draw. */
const PAYLOAD_WORDS = "Cuvintele mesajului, niciodată pe pagină";
const PROVIDER_WORDS = "smtp.receiver said something private";

let db: TestDatabase;
let close: () => Promise<void>;
const staff = new Map<StaffRole, StaffUser>();
let maria: string;
let ion: string;
let vlad: string;
let vera: string;
const PRESS = { resend: randomUUID(), job: randomUUID(), bib: randomUUID(), role: randomUUID(), guardian: randomUUID() };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

let serial = 0;
async function register(eventId: string, name: string): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: true,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      bibNumber: serial,
      confirmedAt: NOW,
    })
    .returning({ id: registrations.id });
  return row.id;
}

type Row = typeof emailOutbox.$inferInsert;

/** One outbox row as the worker leaves it: sent after one try unless a status says otherwise. */
function row(key: string, fields: Partial<Row>): Row {
  const status = fields.status ?? "SENT";
  return {
    participantId: null,
    registrationId: null,
    messageType: "REGISTRATION_CONFIRMED",
    locale: "ro",
    recipientEmail: "maria.pop@example.org",
    payloadJson: { note: PAYLOAD_WORDS },
    idempotencyKey: key,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    createdAt: at("2026-10-01T08:00:00.000Z"),
    sentAt: status === "SENT" || status === "BOUNCED" ? (fields.sentAt ?? at("2026-10-01T08:00:30.000Z")) : null,
    transport: status === "SENT" ? "mailgun" : null,
    recipientCount: status === "SENT" ? 1 : null,
    ...fields,
  };
}

beforeEach(async () => {
  await resetTables(db);
  staff.clear();
  for (const [role, name] of [
    ["CONTRIBUTOR", "Dan Desk"],
    ["MODERATOR", "Olga Organizatoarea"],
    ["DEV", "Tudor Tehnic"],
    ["ADMIN", "Ana Admin"],
    ["SUPERADMIN", "Sorin Super"],
  ] as const) {
    const [account] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.org`, displayName: name, role }).returning();
    staff.set(role, account);
  }
  const admin = staff.get("ADMIN") as StaffUser;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul de toamnă", slug: "crosul-de-toamna" },
    { eventId: event.id, locale: "en", title: "The autumn cross", slug: "the-autumn-cross" },
  ]);
  maria = await register(event.id, "Maria Pop");
  ion = await register(event.id, "Ion Ionescu");
  const volunteers = await db
    .insert(eventVolunteers)
    .values([
      { eventId: event.id, name: "Vlad Voluntar", email: "vlad@example.org", canonicalEmail: "vlad@example.org", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF", guardianName: "Gina Părinte", guardianEmail: "gina@example.org" },
      { eventId: event.id, name: "Vera Alta", email: "vera@example.org", canonicalEmail: "vera@example.org", canonicalizationVersion: 2, phone: "+40712345679", source: "PUBLIC" },
    ])
    .returning({ id: eventVolunteers.id });
  [vlad, vera] = volunteers.map((volunteer) => volunteer.id);

  await db.insert(emailOutbox).values([
    // Maria's journey: the verification from the site, delivered.
    row("k:verify", { messageType: "VERIFY_REGISTRATION_EMAIL", registrationId: maria, createdAt: at("2026-09-28T07:00:00.000Z"), sentAt: at("2026-09-28T07:00:20.000Z"), deliveredAt: at("2026-09-28T07:00:40.000Z") }),
    // «Retrimite emailul», pressed by the Administrator: three tries, a resend by hand, and the club's copy of it.
    row("k:confirm", { registrationId: maria, attemptCount: 3, isManualResend: true, cause: "registrations.resend", pressId: PRESS.resend, requestedByStaffUserId: admin.id, createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:00.000Z") }),
    row("k:confirm:club-copy:copii@club.test", { registrationId: maria, recipientEmail: "copii@club.test", payloadJson: { clubCopy: true, note: PAYLOAD_WORDS }, cause: "registrations.resend", pressId: PRESS.resend, requestedByStaffUserId: admin.id, createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:05.000Z") }),
    // The declaration's archive, the club's, copying no message of hers.
    row("k:archive", { messageType: "DECLARATION_ARCHIVE", registrationId: maria, recipientEmail: "arhiva@club.test", createdAt: at("2026-09-29T07:00:00.000Z"), sentAt: at("2026-09-29T07:00:30.000Z") }),
    // Refused by her mailbox: the cause in words, never the provider's own.
    row("k:joined", { messageType: "WAITLIST_JOINED", status: "BOUNCED", registrationId: maria, createdAt: at("2026-09-27T07:00:00.000Z"), sentAt: at("2026-09-27T07:00:30.000Z"), rejectedAt: at("2026-09-27T07:05:00.000Z"), rejectionCause: "mailbox-full", providerCode: "552", providerDetail: PROVIDER_WORDS, lastError: PROVIDER_WORDS }),
    // The job's reminder: tried three times, waits for its fourth — its last answer is not a failure, so never drawn.
    row("k:reminder", { messageType: "EVENT_REMINDER", status: "PENDING", registrationId: maria, attemptCount: 3, nextAttemptAt: at("2026-10-01T09:30:00.000Z"), lastError: "421 try again later", cause: "job.registrationMaintenance", pressId: PRESS.job, createdAt: at("2026-10-01T06:00:00.000Z") }),
    // «Salvează nr.»: twenty tries, failed for good — its sanitized reason is drawn.
    row("k:bib", { messageType: "BIB_ASSIGNED", status: "FAILED", registrationId: maria, attemptCount: 20, lastError: "550 mailbox unavailable", cause: "registrations.setBib", pressId: PRESS.bib, requestedByStaffUserId: admin.id, createdAt: at("2026-10-01T07:00:00.000Z") }),
    // Queued a moment ago from the site and never tried.
    row("k:declaration", { messageType: "COMPLETE_DECLARATION", status: "PENDING", registrationId: maria, createdAt: at("2026-10-01T08:59:00.000Z") }),
    // Another person's email: never on Maria's page.
    row("k:ion", { registrationId: ion, recipientEmail: "ion@example.org", createdAt: at("2026-10-01T08:30:00.000Z") }),
    // Vlad's: the role from a press, the parent's link, and the colleagues' notice — the club's.
    row("k:role", { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "vlad@example.org", payloadJson: { volunteerId: vlad, note: PAYLOAD_WORDS }, cause: "volunteers.assign", pressId: PRESS.role, requestedByStaffUserId: admin.id, createdAt: at("2026-09-30T10:00:00.000Z"), sentAt: at("2026-09-30T10:01:00.000Z") }),
    row("k:guardian", { messageType: "VOLUNTEER_GUARDIAN_REQUEST", recipientEmail: "gina@example.org", payloadJson: { volunteerId: vlad }, cause: "volunteers.guardianLink", pressId: PRESS.guardian, requestedByStaffUserId: staff.get("MODERATOR")?.id, createdAt: at("2026-09-30T11:00:00.000Z"), sentAt: at("2026-09-30T11:00:30.000Z") }),
    row("k:vnotice", { messageType: "VOLUNTEER_CLUB_NOTICE", recipientEmail: "olga@example.org", payloadJson: { volunteerId: vlad }, createdAt: at("2026-09-29T10:00:00.000Z"), sentAt: at("2026-09-29T10:00:30.000Z") }),
    // Vera's, never on Vlad's page.
    row("k:vera", { messageType: "VOLUNTEER_RECEIVED", recipientEmail: "vera@example.org", payloadJson: { volunteerId: vera }, createdAt: at("2026-09-30T12:00:00.000Z") }),
  ]);
});

const admin = () => staff.get("ADMIN") as StaffUser;
const idOf = async (key: string) => (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)))[0].id;
const ids = (keys: string[]) => Promise.all(keys.map(idOf));

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "opened";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return code;
    throw error;
  }
}

async function html(history: EmailHistory, locale: "ro" | "en" = "ro"): Promise<string> {
  state.locale = locale;
  const element = await EmailHistoryPanel({ locale, history, now: NOW, title: "person", level: 3 });
  return renderToStaticMarkup(element as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§NNN a registration's emails", () => {
  it("lists the registration's own rows newest first, another person's never, the club's copy under its message and the archive apart", async () => {
    const history = await readEmailHistory(db, admin(), { registrationId: maria }, NOW);
    expect(history.rows.map((line) => line.id)).toEqual(await ids(["k:declaration", "k:bib", "k:reminder", "k:confirm", "k:verify", "k:joined"]));
    expect(history.rows.flatMap((line) => line.copies.map((copy) => copy.id))).not.toContain(await idOf("k:ion"));
    const confirm = history.rows.find((line) => line.messageType === "REGISTRATION_CONFIRMED");
    expect(confirm?.copies.map((copy) => copy.recipientEmail)).toEqual(["copii@club.test"]);
    expect(history.club.map((club) => [club.messageType, club.recipientEmail])).toEqual([["DECLARATION_ARCHIVE", "arhiva@club.test"]]);
    // Her own six, the club's two not counted as hers; nothing past the cap.
    expect(history).toMatchObject({ ownTotal: 6, more: 0 });
  });

  it("keeps the tries, the next try of a waiting row tried before, and a FAILED row's reason — no other row's", async () => {
    const history = await readEmailHistory(db, admin(), { registrationId: maria }, NOW);
    const byType = (type: string) => history.rows.find((line) => line.messageType === type);
    expect(byType("EVENT_REMINDER")).toMatchObject({ attemptCount: 3, nextTryAt: at("2026-10-01T09:30:00.000Z"), lastError: null, cause: "job.registrationMaintenance", by: null });
    expect(byType("BIB_ASSIGNED")).toMatchObject({ attemptCount: 20, lastError: "550 mailbox unavailable", cause: "registrations.setBib", by: "Ana Admin" });
    expect(byType("WAITLIST_JOINED")).toMatchObject({ lastError: null, rejectionCause: "mailbox-full" });
    expect(byType("COMPLETE_DECLARATION")).toMatchObject({ attemptCount: 0, nextTryAt: null, cause: null, by: null });
    expect(byType("REGISTRATION_CONFIRMED")).toMatchObject({ manualResend: true, by: "Ana Admin", cause: "registrations.resend", pressId: PRESS.resend });
    // A waiting row's departure is judged as the queue judges it; a row that left has none.
    expect(byType("EVENT_REMINDER")?.departure).not.toBeNull();
    expect(byType("REGISTRATION_CONFIRMED")?.departure).toBeNull();
  });

  it("draws every row stacked, in «Emailuri azi»'s words, with the tries and who caused it — in Romanian", async () => {
    const page = await html(await readEmailHistory(db, admin(), { registrationId: maria }, NOW));
    expect(page).toContain("Emailuri");
    // The closed line: how many, and the latest.
    expect(page).toContain("6 emailuri · ultimul: „Semnează declarația” — așteaptă");
    expect(page).toContain("încă nu s-a încercat");
    expect(page).toContain(">1 încercare<");
    expect(page).toContain(">3 încercări<");
    expect(page).toContain("3 încercări · următoarea încercare: 12:30");
    expect(page).toContain(">20 de încercări<");
    expect(page).toContain("automat: întreținerea înscrierilor");
    expect(page).toMatch(/Retrimite emailul · de Ana Admin/);
    expect(page).toContain("11:59 · de pe site (persoana însăși)");
    expect(page).toContain(">Retrimis manual<");
    expect(page).toContain("Ultimul răspuns al furnizorului: 550 mailbox unavailable");
    expect(page).toContain("Respins");
    expect(page).toContain("Căsuța e plină");
    expect(page).toContain("Livrat");
    expect(page).toContain(">Eșuat<");
    expect(page).toContain(">Așteaptă<");
    expect(page).toContain('data-testid="email-history-leaves"');
    expect(page).toContain("+ 1 pentru căsuțele clubului");
    expect(page.match(/data-testid="email-history-row"/g)).toHaveLength(6);
    // Never a table, never the payload's words, the provider's own words, a retry's answer or a link.
    expect(page).not.toContain("<table");
    expect(page).not.toContain(PAYLOAD_WORDS);
    expect(page).not.toContain(PROVIDER_WORDS);
    expect(page).not.toContain("421 try again later");
    expect(page).not.toContain("552");
    expect(page).not.toMatch(/href="http/);
    expect(page).not.toMatch(/emails\.(history|today|causes|types)\./);
  });

  it("says the same in English", async () => {
    const page = await html(await readEmailHistory(db, admin(), { registrationId: maria }, NOW), "en");
    expect(page).toContain("6 emails · latest: “");
    expect(page).toContain("not tried yet");
    expect(page).toContain(">1 try<");
    expect(page).toContain("3 tries · next try: 12:30");
    expect(page).toContain(">20 tries<");
    expect(page).toContain("from the site (the person themselves)");
    expect(page).toContain("by Ana Admin");
    expect(page).toContain("+ 1 to the club&#x27;s mailboxes");
    expect(page).not.toMatch(/emails\.(history|today|causes|types)\./);
  });

  it("caps the list and says how many more, older, there are", async () => {
    await db.insert(emailOutbox).values(
      Array.from({ length: EMAIL_HISTORY_LIMIT }, (_, index) =>
        row(`k:many:${index}`, { messageType: "EVENT_UPDATE_NOTICE", registrationId: maria, createdAt: at("2026-10-01T08:40:00.000Z"), sentAt: at("2026-10-01T08:41:00.000Z") }),
      ),
    );
    const history = await readEmailHistory(db, admin(), { registrationId: maria }, NOW);
    expect(history.rows.length + history.club.length + history.rows.reduce((sum, line) => sum + line.copies.length, 0)).toBe(EMAIL_HISTORY_LIMIT);
    // Every row of hers, the club's included, minus the ones drawn.
    expect(history.more).toBe(EMAIL_HISTORY_LIMIT + 8 - EMAIL_HISTORY_LIMIT);
    expect(history.ownTotal).toBe(EMAIL_HISTORY_LIMIT + 6);
    expect(await html(history)).toContain("Și încă 8, mai vechi, neafișate aici.");
  });
});

describe("§NNN a volunteer's emails", () => {
  it("lists the rows whose payload names the volunteer — their own and their parent's link — the colleagues' notice as the club's, never another volunteer's", async () => {
    const history = await readEmailHistory(db, admin(), { volunteerId: vlad }, NOW);
    expect(history.rows.map((line) => line.id)).toEqual(await ids(["k:guardian", "k:role"]));
    expect(history.club.map((club) => club.messageType)).toEqual(["VOLUNTEER_CLUB_NOTICE"]);
    expect(history.ownTotal).toBe(2);
    const page = await html(history);
    expect(page).toMatch(/Dă-i un rol · de Ana Admin/);
    expect(page).toMatch(/Trimite linkul părintelui · de Olga Organizatoarea/);
    expect(page).not.toContain(PAYLOAD_WORDS);
    expect((await readEmailHistory(db, admin(), { volunteerId: vera }, NOW)).rows.map((line) => line.id)).toEqual([await idOf("k:vera")]);
  });

  it("reads nothing for a malformed id and says there is no email", async () => {
    const history = await readEmailHistory(db, admin(), { volunteerId: "not-an-id" }, NOW);
    expect(history).toEqual({ rows: [], club: [], ownTotal: 0, more: 0 });
    const page = await html(history);
    expect(page).toContain("niciun email");
    expect(page).toContain("Niciun email încă.");
  });
});

describe("BR-REQ-060-01 a person's emails are the Administrator's and the Superadministrator's alone", () => {
  it("refuses the desk's volunteer, the Organizer and the Tehnic role with FORBIDDEN, for a registration and for a volunteer", async () => {
    for (const role of ["CONTRIBUTOR", "MODERATOR", "DEV", "MEMBER"] as const) {
      const actor = staff.get(role) ?? { role };
      expect(await codeOf(readEmailHistory(db, actor, { registrationId: maria }, NOW)), role).toBe("FORBIDDEN");
      expect(await codeOf(readEmailHistory(db, actor, { volunteerId: vlad }, NOW)), role).toBe("FORBIDDEN");
    }
  });

  it("reads for the Administrator and the Superadministrator", async () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect((await readEmailHistory(db, staff.get(role) as StaffUser, { registrationId: maria }, NOW)).ownTotal, role).toBe(6);
    }
  });
});

describe("§NNN the fold's closed line", () => {
  it("says the latest that left with its hour, and nothing to say when there is none", async () => {
    const history = await readEmailHistory(db, admin(), { volunteerId: vlad }, NOW);
    state.locale = "ro";
    const { createTranslator } = await import("next-intl");
    const { catalogueOf } = await import("@/i18n/catalogue");
    const t = createTranslator({ locale: "ro", messages: catalogueOf("ro"), namespace: "Admin" });
    expect(emailHistorySummary(history, t as never, "ro", NOW)).toMatch(/^2 emailuri · ultimul: „.+” — a plecat mie\., 30 sept\. 2026, la 14:00$/);
    const empty = foldEmailHistory([], { ownTotal: 0, total: 0 });
    expect(emailHistorySummary(empty, t as never, "ro", NOW)).toBe("niciun email");
  });
});
