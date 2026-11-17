import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Emailuri» on the registrations list (the owner, 2026-11-17: «Vreau sa vad mai clar ce mailuri a primit
 * fiecare om»), from a real database; the page is a Server Component, so it is called and the table it hands
 * `AdminTable` is read — its columns, and the cells the column draws for the page's own rows:
 *
 * - an Administrator and a Superadministrator read a column «Emailuri» right after «Unde a ajuns», with its «?»: each
 *   registration's three newest emails, one to a line — «the email's name · when · what became of it» — then «și încă N
 *   emailuri», a link to the registration's own «Emailuri» (`#emailuri`), and «niciun email» for one with none; drawn
 *   in the table and in the phone's cards alike; the club's copy and archive neither counted nor drawn; a test
 *   registration's row like any other;
 * - the page reads them once, for the page's rows together;
 * - an Organizer, who reads this list too (§289), has no such column — «Până când» stands right after the step, as
 *   before (§651) — and the reader is not called for them (BR-REQ-060-01, §915);
 * - in Romanian and in English.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", reads: [] as unknown[][] }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screen asks of it: the locale's prefix and the params filled in.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => {
      if (typeof href === "string") return `/${locale}${href}`;
      let pathname = href.pathname;
      for (const [key, value] of Object.entries(href.params ?? {})) pathname = pathname.replace(`[${key}]`, value);
      return `/${locale}${pathname}`;
    },
    Link: () => null,
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    setRequestLocale: () => {},
    getLocale: async () => state.locale,
    getTranslations: async (arg: string | { locale: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = typeof arg === "string" ? state.locale : (arg.locale as "ro" | "en");
      return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
    },
  };
});
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));
// The real reader, with every call to it noted: whether the page asked, how often, and about whom.
vi.mock("@/modules/notifications/email-summaries", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/notifications/email-summaries")>();
  return {
    ...real,
    readEmailSummaries: (...args: Parameters<typeof real.readEmailSummaries>) => {
      state.reads.push(args);
      return real.readEmailSummaries(...args);
    },
  };
});

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");

// 12:00 in Brașov on Thursday 1 October 2026 (UTC+3).
const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (iso: string) => new Date(iso);
/** Words the outbox holds that the list must never show: a payload's, the provider's, a last answer. */
const PAYLOAD_WORDS = "Cuvintele emailului, niciodată în listă";
const PROVIDER_WORDS = "smtp.receiver said something private";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let maria: string;
let ion: string;
let nimeni: string;
let proba: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

let serial = 0;
async function register(name: string, over: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: raceId,
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
      confirmedAt: NOW,
      ...over,
    })
    .returning({ id: registrations.id });
  return row.id;
}

type Row = typeof emailOutbox.$inferInsert;

/** One outbox row as the worker leaves it: sent after one try unless a status says otherwise. */
function mail(key: string, registrationId: string, fields: Partial<Row>): Row {
  const status = fields.status ?? "SENT";
  return {
    registrationId,
    messageType: "REGISTRATION_CONFIRMED",
    locale: "ro",
    recipientEmail: "cineva@example.org",
    payloadJson: { note: PAYLOAD_WORDS },
    idempotencyKey: key,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    createdAt: at("2026-10-01T08:00:00.000Z"),
    sentAt: status === "SENT" || status === "BOUNCED" ? at("2026-10-01T08:00:30.000Z") : null,
    transport: status === "SENT" ? "mailgun" : null,
    recipientCount: status === "SENT" ? 1 : null,
    ...fields,
  };
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.reads.length = 0;
  for (const [role, name] of [
    ["ADMIN", "Ana Admin"],
    ["SUPERADMIN", "Sorin Super"],
    ["MODERATOR", "Oana Organizator"],
  ] as const) {
    const [account] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: name, role }).returning();
    staff[role] = account;
  }
  state.actor = staff.ADMIN;
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 150, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z"), featured: true })
    .returning();
  raceId = race.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: raceId, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  maria = await register("Maria Pop", { bibNumber: 1 });
  ion = await register("Ion Ionescu", { bibNumber: 2 });
  nimeni = await register("Nimeni Netrimis", { bibNumber: 3 });
  // A test registration is a row like any other on this list (§30): its emails are its own.
  proba = await register("Proba Test", { kind: "TEST", bibNumber: 4 });

  await db.insert(emailOutbox).values([
    // Maria — six of her own, oldest first: refused by her mailbox, the address confirmed, the confirmation with the
    // club's copy of it, the declaration's archive (the club's), the reminder waiting, a number's email failed for
    // good, and the declaration's email queued a minute ago.
    mail("k:joined", maria, { messageType: "WAITLIST_JOINED", status: "BOUNCED", createdAt: at("2026-09-27T07:00:00.000Z"), sentAt: at("2026-09-27T07:00:30.000Z"), rejectedAt: at("2026-09-27T07:05:00.000Z"), rejectionCause: "mailbox-full", providerDetail: PROVIDER_WORDS, lastError: PROVIDER_WORDS }),
    mail("k:verify", maria, { messageType: "VERIFY_REGISTRATION_EMAIL", createdAt: at("2026-09-28T07:00:00.000Z"), sentAt: at("2026-09-28T07:00:20.000Z"), deliveredAt: at("2026-09-28T07:00:40.000Z") }),
    mail("k:archive", maria, { messageType: "DECLARATION_ARCHIVE", recipientEmail: "arhiva@club.test", createdAt: at("2026-10-01T08:59:30.000Z"), sentAt: at("2026-10-01T08:59:40.000Z") }),
    mail("k:confirm", maria, { createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:00.000Z") }),
    mail("k:confirm:club-copy:copii@club.test", maria, { recipientEmail: "copii@club.test", payloadJson: { clubCopy: true, note: PAYLOAD_WORDS }, createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:05.000Z") }),
    mail("k:reminder", maria, { messageType: "EVENT_REMINDER", status: "PENDING", attemptCount: 3, nextAttemptAt: at("2026-10-01T09:30:00.000Z"), lastError: "421 try again later", createdAt: at("2026-10-01T06:00:00.000Z") }),
    mail("k:bib", maria, { messageType: "BIB_ASSIGNED", status: "FAILED", attemptCount: 20, lastError: "550 mailbox unavailable", createdAt: at("2026-10-01T07:00:00.000Z") }),
    mail("k:declaration", maria, { messageType: "COMPLETE_DECLARATION", status: "PENDING", createdAt: at("2026-10-01T08:59:00.000Z") }),
    // Ion — his one, delivered.
    mail("k:ion", ion, { createdAt: at("2026-10-01T08:30:00.000Z"), sentAt: at("2026-10-01T08:31:00.000Z"), deliveredAt: at("2026-10-01T08:31:20.000Z") }),
    // The test registration — one, kept by the environment.
    mail("k:proba", proba, { createdAt: at("2026-10-01T08:10:00.000Z"), sentAt: at("2026-10-01T08:10:30.000Z"), recipientCount: 0 }),
    // Nimeni — nothing.
  ]);
});

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; hideBelow?: string; omitEmptyOnPhone?: boolean; primary?: boolean; render: (row: unknown) => ReactNode };
type ListRow = { id: string; registeredName: string };

/** Every element under `node`, depth first. */
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

/** The list as the page hands it to `AdminTable`: its columns and its rows. */
async function listOf(locale: "ro" | "en" = "ro", params: Record<string, string> = {}) {
  state.locale = locale;
  const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId, ...params }) } as never);
  const table = elements(tree).find((element) => element.type === AdminTable);
  if (!table) throw new Error("the page drew no table");
  return { table, columns: table.props.columns as Column[], rows: table.props.rows as ListRow[] };
}

const markupOf = (node: ReactNode) => renderToStaticMarkup(node as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const plain = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** The lines a cell's markup holds, as a person reads them. */
const linesOf = (markup: string) => [...markup.matchAll(/data-testid="email-summary-line"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => plain(match[1]));
/** The page's short form of a moment, in the middle of a line. */
const when = (iso: string, locale: "ro" | "en" = "ro") => formatDay(new Date(iso), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "continues" });

describe("§NNN «Emailuri» on the registrations list, for the Administrator", () => {
  it("stands right after «Unde a ajuns», under the catalogue's heading with its «?», in the table and on a phone's card — it neither sorts nor leaves at a width", async () => {
    const { columns } = await listOf();
    const keys = columns.map((column) => column.key);
    expect(keys.indexOf("emails")).toBe(keys.indexOf("journey") + 1);
    // «Până când» follows it: the deadline of the step still stands with the step, the step's emails between them.
    expect(keys.indexOf("untilWhen")).toBe(keys.indexOf("emails") + 1);
    const column = columns.find((candidate) => candidate.key === "emails") as Column;
    expect(column.label).toBe("Emailuri");
    expect(column.hint).toBe(ro.Admin.emails.summary.hint);
    expect(column.sortable).toBeFalsy();
    expect(column.hideBelow).toBeUndefined();
    expect(column.omitEmptyOnPhone).toBeFalsy();
    const english = (await listOf("en")).columns.find((candidate) => candidate.key === "emails");
    expect(english?.label).toBe("Emails");
    expect(english?.hint).toBe(en.Admin.emails.summary.hint);
  });

  it("says each registration's three newest emails as «name · when · what became of it», then «și încă N emailuri» — in Romanian", async () => {
    const { columns, rows } = await listOf();
    const column = columns.find((candidate) => candidate.key === "emails") as Column;
    const cellOf = (id: string) => markupOf(column.render(rows.find((row) => row.id === id)));

    const hers = cellOf(maria);
    expect(linesOf(hers)).toEqual([
      `Semnează declarația · ${when("2026-10-01T08:59:00.000Z")} · așteaptă`,
      `Numărul de concurs dat de mână · ${when("2026-10-01T07:00:00.000Z")} · eșuat`,
      `Reminderul dinaintea startului · ${when("2026-10-01T06:00:00.000Z")} · așteaptă`,
    ]);
    // On the club's clock, in the list's own short form: Thursday 1 October, 11:59 in Brașov.
    expect(linesOf(hers)[0]).toBe("Semnează declarația · joi, 1 oct. 2026, 11:59 · așteaptă");
    // Six of her own: three more behind the link to her registration's «Emailuri», named for her. The archive — the
    // newest row of all — and the club's copy are the club's: not her first line, not in her count.
    expect(hers).toContain('data-total="6"');
    const more = /<a[^>]*data-testid="email-summary-more"[^>]*>([^<]*)<\/a>/.exec(hers);
    expect(more?.[1]).toBe("și încă 3 emailuri");
    expect(more?.[0]).toContain(`href="/ro/admin/registrations/${maria}#emailuri"`);
    expect(more?.[0]).toContain('aria-label="și încă 3 emailuri: Maria Pop"');
    expect(hers).not.toContain("Copia pentru arhiva clubului");

    // Ion: one, delivered — its moment is when it left; no link, there is nothing more.
    const his = cellOf(ion);
    expect(linesOf(his)).toEqual([`Înscriere confirmată (cu QR și număr) · ${when("2026-10-01T08:31:00.000Z")} · livrat`]);
    expect(his).not.toContain("email-summary-more");

    // Nobody emailed this one: the cell says so, in grey — an answer, not an empty cell.
    const none = cellOf(nimeni);
    expect(plain(none)).toBe("niciun email");
    expect(none).toContain('data-testid="email-summary-none"');

    // A test registration's row is a row like any other (§30): its own email, kept by the environment.
    expect(linesOf(cellOf(proba))).toEqual([`Înscriere confirmată (cu QR și număr) · ${when("2026-10-01T08:10:30.000Z")} · n-a ajuns la nimeni (QA)`]);

    // Nothing of an email's words, the provider's, a last answer or an address of the outbox — and no raw key.
    for (const cell of [hers, his, none, cellOf(proba)]) {
      for (const never of [PAYLOAD_WORDS, PROVIDER_WORDS, "550 mailbox unavailable", "421 try again later", "cineva@example.org", "arhiva@club.test", "copii@club.test"]) expect(cell, never).not.toContain(never);
      expect(cell).not.toMatch(/emails\.(summary|history|types)\./);
    }
    // The outcome is a word on the line and a mark beside it: never the colour alone.
    expect(hers).toMatch(/data-outcome="failed"[\s\S]*?data-testid="email-summary-outcome"[^>]*>eșuat</);
  });

  it("says the same in English", async () => {
    const { columns, rows } = await listOf("en");
    const column = columns.find((candidate) => candidate.key === "emails") as Column;
    const cellOf = (id: string) => markupOf(column.render(rows.find((row) => row.id === id)));
    expect(linesOf(cellOf(maria))).toEqual([
      `Sign the declaration · ${when("2026-10-01T08:59:00.000Z", "en")} · waiting`,
      `A race number given by hand · ${when("2026-10-01T07:00:00.000Z", "en")} · failed`,
      `The reminder before the start · ${when("2026-10-01T06:00:00.000Z", "en")} · waiting`,
    ]);
    expect(linesOf(cellOf(maria))[0]).toBe("Sign the declaration · Thu, 1 Oct 2026, 11:59 · waiting");
    const more = /<a[^>]*data-testid="email-summary-more"[^>]*>([^<]*)<\/a>/.exec(cellOf(maria));
    expect(more?.[1]).toBe("and 3 more emails");
    expect(more?.[0]).toContain(`href="/en/admin/registrations/${maria}#emailuri"`);
    expect(more?.[0]).toContain('aria-label="and 3 more emails: Maria Pop"');
    expect(linesOf(cellOf(ion))).toEqual([`Registration confirmed (with QR and number) · ${when("2026-10-01T08:31:00.000Z", "en")} · delivered`]);
    expect(plain(cellOf(nimeni))).toBe("no emails");
    expect(linesOf(cellOf(proba))[0]).toMatch(/ · reached nobody \(QA\)$/);
    expect(cellOf(maria)).not.toMatch(/emails\.(summary|history|types)\./);
  });

  it("is drawn in the table and in the phone's cards alike, «niciun email» on a card too", async () => {
    const { table, columns } = await listOf();
    // The page's own «Emailuri» column and rows, in the house's table, beside a name: the table draws every column in
    // both of its layouts — a wide table, and a card a row below it.
    const name: Column = { key: "name", label: "Nume", primary: true, render: (row) => (row as ListRow).registeredName };
    const emails = columns.find((candidate) => candidate.key === "emails") as Column;
    const intl = { locale: "ro", timeZone: "Europe/Bucharest", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>;
    const drawn = createElement(AdminTable, { ...(table.props as unknown as ComponentProps<typeof AdminTable>), columns: [name, emails], rowActions: undefined, leadRows: [] } as never);
    const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, drawn), { onError: () => {} });
    await stream.allReady;
    const page = (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
    // Four rows: Maria's three lines, Ion's one, the test row's one — each once in a `<td>` and once in a card's `<li>`.
    expect(linesOf(page)).toHaveLength(2 * (3 + 1 + 1));
    expect(page.match(/data-testid="email-summary-none"/g)).toHaveLength(2);
    expect(page.match(/data-testid="email-summary-more"/g)).toHaveLength(2);
    const [wide, cards] = [page.slice(0, page.indexOf("<ul")), page.slice(page.indexOf("<ul"))];
    for (const half of [wide, cards]) {
      expect(half).toContain(">niciun email<");
      expect(half).toContain(">și încă 3 emailuri<");
      expect(half).toContain("Semnează declarația");
    }
    // The heading, and its «?» above the cards, where there is no heading.
    expect(wide).toContain("Emailuri");
    expect(cards.length).toBeGreaterThan(0);
    expect(page).toContain(ro.Admin.emails.summary.hint);
  });

  it("draws «și încă N» as a link a thumb reaches — 44 pixels tall above its words — and only over the person's own three lines", async () => {
    const { default: EmailSummaryCell } = await import("@/modules/notifications/ui/EmailSummary");
    const { INLINE_TAP_TARGET } = await import("@/shared/ui/tap-target");
    const { createTranslator } = await import("next-intl");
    const t = createTranslator({ locale: "ro", messages: ro, namespace: "Admin" }) as never;
    const line = (id: string) => ({ id, messageType: "EVENT_REMINDER" as const, at: NOW, outcome: "sent" as const });
    const href = `/ro/admin/registrations/${maria}#emailuri`;
    const drawn = (total: number, lines: number) =>
      elements(EmailSummaryCell({ summary: { total, lines: Array.from({ length: lines }, (_, index) => line(`line-${index}`)) }, href, personName: "Maria Pop", locale: "ro", t }));
    const link = drawn(5, 3).find((element) => element.props["data-testid"] === "email-summary-more");
    // The house's in-sentence target (BR-REQ-041-01 criterion 6): 44 tall, its reach above the words, the line no taller.
    expect(link?.props.sx).toEqual(INLINE_TAP_TARGET);
    expect(INLINE_TAP_TARGET.paddingTop).toBe("calc(44px - 1.4em)");
    expect(link?.props.href).toBe(href);
    // Its reach lies over the three lines that stand above it whenever it is drawn — with three emails or fewer there is no link.
    expect(drawn(5, 3).filter((element) => element.props["data-testid"] === "email-summary-line")).toHaveLength(3);
    for (const [total, lines] of [[3, 3], [2, 2], [1, 1]] as const) expect(drawn(total, lines).some((element) => element.props["data-testid"] === "email-summary-more"), String(total)).toBe(false);
    // A row the reader was not asked about draws nothing at all — never a false «niciun email».
    expect(EmailSummaryCell({ summary: undefined, href, personName: "Maria Pop", locale: "ro", t })).toBeNull();

    // It reads at 320 pixels: the floor is the wide table's alone — a phone's card keeps its own width — every line may wrap
    // (nothing is held on one line, a word too long breaks), and a line is plain text of the body's small size, never a chip.
    // An email that wraps reads as one block: six pixels between two emails, not the two that ran a card's lines together.
    const [cell, ...inside] = drawn(5, 3);
    expect(cell.props.sx).toMatchObject({ gap: 0.75, minWidth: { xs: 0, md: "16rem" }, maxWidth: { md: "28rem" }, overflowWrap: "break-word" });
    for (const element of [cell, ...inside]) expect((element.props.sx as { whiteSpace?: string } | undefined)?.whiteSpace, String(element.props["data-testid"])).toBeUndefined();
    const lines = inside.filter((element) => element.props["data-testid"] === "email-summary-line");
    for (const one of lines) expect(one.props.variant).toBe("body2");
    const { default: Chip } = await import("@mui/material/Chip");
    const { default: StatusChip } = await import("@/shared/ui/StatusChip");
    expect(inside.filter((element) => element.type === Chip || element.type === StatusChip)).toEqual([]);
  });

  it("reads the emails once for the page's rows together, and for the Superadministrator too", async () => {
    state.reads.length = 0;
    const { rows } = await listOf();
    expect(state.reads).toHaveLength(1);
    const [, actor, subject] = state.reads[0] as [unknown, StaffUser, { registrationIds: string[] }];
    expect(actor).toBe(staff.ADMIN);
    expect(subject.registrationIds).toEqual(rows.map((row) => row.id));
    expect([...subject.registrationIds].sort()).toEqual([maria, ion, nimeni, proba].sort());

    state.actor = staff.SUPERADMIN;
    state.reads.length = 0;
    expect((await listOf()).columns.map((column) => column.key)).toContain("emails");
    expect(state.reads).toHaveLength(1);
  });

  it("links «și încă N» to an anchor that is there: the registration's own «Emailuri» card", () => {
    // The page that the link opens (its rendered card is held by `email-rejected-screens.test.ts`): the «Emailuri» card's id.
    const source = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/registrations/[id]/page.tsx"), "utf8");
    expect(source).toMatch(/title=\{tr\("registrations\.emails\.title"\)\}[\s\S]{0,400}?id="emailuri"\s+data-testid="emails-section"/);
  });
});

describe("BR-REQ-060-01 «Emailuri» on the registrations list is not the Organizer's (§NNN)", () => {
  it("draws the list exactly as before for an Organizer — no column, «Până când» right after the step — and never calls the reader", async () => {
    const asAdministrator = (await listOf()).columns.map((column) => column.key);
    state.actor = staff.MODERATOR;
    state.reads.length = 0;
    const { columns, rows } = await listOf();
    const keys = columns.map((column) => column.key);
    expect(rows.map((row) => row.registeredName).sort()).toEqual(["Ion Ionescu", "Maria Pop", "Nimeni Netrimis", "Proba Test"]);
    expect(keys).not.toContain("emails");
    // Every other column, in the same order: the Organizer's list is the Administrator's without this one.
    expect(keys).toEqual(asAdministrator.filter((key) => key !== "emails"));
    expect(keys.indexOf("untilWhen")).toBe(keys.indexOf("journey") + 1);
    for (const column of columns) expect(column.hint ?? "", column.key).not.toBe(ro.Admin.emails.summary.hint);
    // Nothing was read for them: the reader was not called, in either language.
    expect(state.reads).toEqual([]);
    expect((await listOf("en")).columns.map((column) => column.key)).not.toContain("emails");
    expect(state.reads).toEqual([]);
  });
});
