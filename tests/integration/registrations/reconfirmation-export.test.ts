import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { columnLetter, rawCells, readSheet, startListRows } from "../../helpers/xlsx";
import { statementsOf } from "../../helpers/statements";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending the decision «Cere reconfirmarea»; BR-REQ-071-01) — the owner, 2026-11-20: «vezi că în excel export nu am
 * dacă a re-confirmat un alergător, că avem această opțiune». From a real database and through the export route itself:
 * «Reconfirmare» right after «Status» in both files, the list filter's own answer in the reader's words — «A reconfirmat»,
 * «A anulat după cerere», «N-a răspuns», empty for a registration no send asked — with «Reconfirmat», the moment of «Vin»,
 * beside it; read in one grouped query whatever the number of rows; and always the answer the list's filter `reconfirm`
 * would keep the row under. Made-up people only.
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
  requireStaffCapability: async () => state.actor,
}));

const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");
const { listReconfirmAnswers, listRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let serial = 0;

// 18 November 2026, Brașov on winter time (UTC+2): the asks, the answers and the cancellations of one week.
const T0 = new Date("2026-11-18T08:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

/** The words the file says, in each language: the catalogue's, as the route reads them. */
const WORDS = {
  ro: { header: ro.Admin.reconfirm.answerColumn, moment: ro.Admin.reconfirm.column, yes: ro.Admin.reconfirm.answerYes, cancelled: ro.Admin.reconfirm.answerCancelled, none: ro.Admin.reconfirm.answerNone },
  en: { header: en.Admin.reconfirm.answerColumn, moment: en.Admin.reconfirm.column, yes: en.Admin.reconfirm.answerYes, cancelled: en.Admin.reconfirm.answerCancelled, none: en.Admin.reconfirm.answerNone },
} as const;

async function createRace(): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T06:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-reconfirmarii-${serial}-ro`, title: "Crosul Reconfirmării" },
    { eventId: event.id, locale: "en", slug: `crosul-reconfirmarii-${serial}-en`, title: "Crosul Reconfirmării" },
  ]);
  return event.id;
}

async function register(eventId: string, name: string, status: RegistrationStatus, extra: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `alergator${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: T0,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      submittedAt: minutes(-600),
      ...extra,
    })
    .returning({ id: registrations.id });
  return created.id;
}

/** One send's ask of a registration, answered «Vin» at `reconfirmedAt` or not. */
async function ask(eventId: string, registrationId: string, sendId: string, askedAt: Date, reconfirmedAt: Date | null = null) {
  await db.insert(registrationReconfirmations).values({ registrationId, eventId, sendId, askedAt, reconfirmedAt });
}

/**
 * Every kind of row the column can meet: who said «Vin» (asked once, and asked by two sends with only the first answered),
 * who cancelled after the ask, who stayed silent, who was never asked — and the asked rows the filter keeps under none of the
 * three: an expired one, an offer made since the ask that did not answer, one cancelled before it was asked.
 */
async function seedRace(eventId: string) {
  const first = randomUUID();
  const second = randomUUID();
  const ids = {
    said: await register(eventId, "Ana Vin", "CONFIRMED"),
    twice: await register(eventId, "Bogdan Dublu", "CONFIRMED"),
    cancelled: await register(eventId, "Cora Anulat", "CANCELLED", { cancelledAt: minutes(90), cancellationSource: "PARTICIPANT" }),
    silent: await register(eventId, "Dan Tăcut", "PENDING_DECLARATION"),
    never: await register(eventId, "Elena Neîntrebată", "CONFIRMED"),
    expired: await register(eventId, "Florin Expirat", "EXPIRED", { expiredAt: minutes(100), expiryReason: "DECLARATION_HOLD_LAPSED" }),
    offered: await register(eventId, "Gina Ofertă", "WAITLIST_OFFERED", { offerCreatedAt: minutes(80), holdExpiresAt: minutes(80 + 48 * 60) }),
    before: await register(eventId, "Horia Înainte", "CANCELLED", { cancelledAt: minutes(-30), cancellationSource: "ADMIN" }),
  };
  await ask(eventId, ids.said, first, minutes(0), minutes(45));
  await ask(eventId, ids.twice, first, minutes(0), minutes(30));
  await ask(eventId, ids.twice, second, minutes(60));
  await ask(eventId, ids.cancelled, first, minutes(0));
  await ask(eventId, ids.silent, first, minutes(0));
  await ask(eventId, ids.silent, second, minutes(60));
  await ask(eventId, ids.expired, first, minutes(0));
  await ask(eventId, ids.offered, first, minutes(0));
  await ask(eventId, ids.before, second, minutes(60));
  return ids;
}

/** What each seeded row's cell says, by the list filter's own answer. */
const EXPECTED = { said: "yes", twice: "yes", cancelled: "cancelled", silent: "none", never: null, expired: null, offered: null, before: null } as const;

const url = (query: string) => `https://example.test/api/admin/registrations/export?${query}`;
const xlsxOf = async (query: string) => Buffer.from(await (await exportRegistrations(new Request(url(`${query}&format=xlsx`)))).arrayBuffer());
const csvOf = async (query: string) => (await exportRegistrations(new Request(url(query)))).text();

/** The CSV as rows of cells: no seeded name, answer or moment holds a comma or a quote, so a split reads it. */
const csvRows = (text: string) => text.split("\r\n").map((line) => line.split(","));

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  serial += 1;
  [admin] = await db.insert(staffUsers).values({ email: `admin-${serial}@example.invalid`, displayName: "Administrator", role: "ADMIN" }).returning();
  state.actor = admin;
});

describe("§NNN «Reconfirmare» beside «Status» in the registrations' Excel and CSV", () => {
  it.each(["ro", "en"] as const)("says each row's answer in the reader's words, right after «Status», in the spreadsheet (%s)", async (locale) => {
    const eventId = await createRace();
    await seedRace(eventId);
    const words = WORDS[locale];
    const buffer = await xlsxOf(`eventId=${eventId}&lang=${locale}`);
    const rows = startListRows(readSheet(buffer).rows);
    const header = rows[0] as string[];
    // Status, the answer, the moment: together near the front, headed in the reader's language.
    const status = header.indexOf("Status");
    expect(header.slice(status, status + 3)).toEqual(["Status", words.header, words.moment]);
    expect(header.filter((cell) => cell === words.moment)).toHaveLength(1);
    const byName = (name: string) => rows.find((line) => line?.[header.indexOf("Name")] === name) ?? [];
    const names = { said: "Ana Vin", twice: "Bogdan Dublu", cancelled: "Cora Anulat", silent: "Dan Tăcut", never: "Elena Neîntrebată", expired: "Florin Expirat", offered: "Gina Ofertă", before: "Horia Înainte" } as const;
    for (const key of Object.keys(names) as (keyof typeof names)[]) {
      const answer = EXPECTED[key];
      expect(byName(names[key])[status + 1] ?? "", key).toBe(answer ? words[answer] : "");
    }
    // «Reconfirmat»: a date on the club's clock for whoever pressed «Vin» — the latest of their answers — empty for the others.
    const cells = rawCells(buffer);
    const momentOf = (name: string) => cells.get(`${columnLetter(status + 2)}${rows.indexOf(byName(name)) + 1}`);
    expect(momentOf(names.said)?.value).toBeDefined();
    expect(momentOf(names.said)?.type).toBeUndefined();
    expect(Number(momentOf(names.said)?.value)).toBeGreaterThan(Number(momentOf(names.twice)?.value));
    for (const name of [names.silent, names.never, names.offered]) expect(momentOf(name)?.value, name).toBeUndefined();
  });

  it.each(["ro", "en"] as const)("says the same in the CSV, the moment as an ISO instant (%s)", async (locale) => {
    const eventId = await createRace();
    await seedRace(eventId);
    const words = WORDS[locale];
    const [header, ...lines] = csvRows(await csvOf(`eventId=${eventId}&lang=${locale}`));
    const status = header.indexOf("Status");
    expect(header.slice(status, status + 3)).toEqual(["Status", words.header, words.moment]);
    // «Reconfirmat» left the end of the file: «Partener» then «Note interne» close it, as before it came.
    expect(header.slice(-2)).toEqual([locale === "ro" ? ro.Admin.partner.column : en.Admin.partner.column, locale === "ro" ? ro.Admin.registrations.notes.title : en.Admin.registrations.notes.title]);
    const lineOf = (name: string) => lines.find((cells) => cells[header.indexOf("Name")] === name) ?? [];
    const answerOf = (name: string) => lineOf(name)[status + 1];
    expect(answerOf("Ana Vin")).toBe(words.yes);
    expect(answerOf("Bogdan Dublu")).toBe(words.yes);
    expect(answerOf("Cora Anulat")).toBe(words.cancelled);
    expect(answerOf("Dan Tăcut")).toBe(words.none);
    for (const name of ["Elena Neîntrebată", "Florin Expirat", "Gina Ofertă", "Horia Înainte"]) expect(answerOf(name), name).toBe("");
    expect(lineOf("Ana Vin")[status + 2]).toBe(minutes(45).toISOString());
    // Asked by two sends, answered after the first: the moment of that answer, and «A reconfirmat» all the same.
    expect(lineOf("Bogdan Dublu")[status + 2]).toBe(minutes(30).toISOString());
    expect(lineOf("Dan Tăcut")[status + 2]).toBe("");
  });

  it("writes in each row exactly the answer under which the list's filter keeps it, and nothing for a row no filter keeps", async () => {
    const eventId = await createRace();
    const ids = await seedRace(eventId);
    const answers = await listReconfirmAnswers(db, Object.values(ids));
    for (const filter of ["yes", "cancelled", "none"] as const) {
      const kept = (await listRegistrationsForAdmin(db, { eventId, reconfirm: filter, excludeTest: true })).map((row) => row.id).sort();
      const said = [...answers].filter(([, answer]) => answer === filter).map(([id]) => id).sort();
      expect(said, filter).toEqual(kept);
    }
    expect(Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, answers.get(id) ?? null]))).toEqual(EXPECTED);
  });

  it("carries the list's filter to the file: «reconfirm=none» is the silent rows, each saying so", async () => {
    const eventId = await createRace();
    await seedRace(eventId);
    const [header, ...lines] = csvRows(await csvOf(`eventId=${eventId}&reconfirm=none`));
    const records = lines.filter((cells) => cells.length > 1);
    expect(records.map((cells) => cells[header.indexOf("Name")])).toEqual(["Dan Tăcut"]);
    expect(records[0][header.indexOf("Status") + 1]).toBe(WORDS.ro.none);
    const yes = startListRows(readSheet(await xlsxOf(`eventId=${eventId}&reconfirm=yes`)).rows);
    const sheetHeader = yes[0] as string[];
    expect(yes.slice(1).map((line) => [line?.[sheetHeader.indexOf("Name")], line?.[sheetHeader.indexOf("Status") + 1]]).sort()).toEqual([
      ["Ana Vin", WORDS.ro.yes],
      ["Bogdan Dublu", WORDS.ro.yes],
    ]);
  });

  it("reads the answers in one grouped query, the same statements for a file of three rows as for one of thirty", async () => {
    const small = await createRace();
    for (let at = 0; at < 3; at += 1) await ask(small, await register(small, `Mic ${at}`, "CONFIRMED"), randomUUID(), minutes(0), at === 0 ? minutes(5) : null);
    const large = await createRace();
    for (let at = 0; at < 30; at += 1) await ask(large, await register(large, `Mare ${at}`, "CONFIRMED"), randomUUID(), minutes(0), at % 3 === 0 ? minutes(5) : null);
    for (const format of ["csv", "xlsx"] as const) {
      // Once first, so whatever a reader keeps for the process is kept before either file is counted.
      await exportRegistrations(new Request(url(`eventId=${small}&format=${format}`)));
      const few = await statementsOf(db, () => exportRegistrations(new Request(url(`eventId=${small}&format=${format}`))));
      const many = await statementsOf(db, () => exportRegistrations(new Request(url(`eventId=${large}&format=${format}`))));
      expect(many.length, format).toBe(few.length);
      const grouped = many.filter((statement) => statement.includes('"registration_reconfirmations"') && /group by/i.test(statement));
      expect(grouped, format).toHaveLength(1);
      expect(grouped[0]).toMatch(/bool_or/);
    }
  });

  it("changes nothing else: the audit row still names who, which event, the format and the count — never an answer", async () => {
    const eventId = await createRace();
    await seedRace(eventId);
    await csvOf(`eventId=${eventId}`);
    await xlsxOf(`eventId=${eventId}`);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.exported"));
    expect(trail).toHaveLength(2);
    for (const row of trail) {
      expect(row.actorStaffUserId).toBe(admin.id);
      expect(Object.keys(row.metadataJson as Record<string, unknown>).sort()).toEqual(["eventId", "format", "rowCount", "withNotes"]);
      expect(JSON.stringify(row.metadataJson)).not.toMatch(/reconfirm|Vin/i);
    }
  });
});
