import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §960 — «Emailuri» on the «Voluntari» list (the owner, 2026-11-17, the morning after the volunteers were emailed
 * their points: «Vreau sa vad mai clar ce mailuri a primit fiecare om»), from a real database, the page drawn as the
 * server streams it:
 *
 * - an Administrator and a Superadministrator read a column «Emailuri» right after «Stare», with its «?»: each
 *   person's three newest emails, one to a line — «the email's name · when · what became of it», the name the
 *   catalogue's, the moment on the club's clock, the outcome in the fold's own words — then «și încă N emailuri», a
 *   link to the person's own «Emailuri» (`#emailuri`), and «niciun email» for a person with none; in the table and in
 *   the phone's cards alike; the club's own rows about the person neither counted nor drawn;
 * - the page reads them once, for the page's rows together;
 * - an Organizer, who reads the list for the roles, has no such column, and the reader is not called for them
 *   (BR-REQ-060-01: the emails are the Administrators', as the person's fold is, §915);
 * - in Romanian and in English.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", reads: [] as unknown[][] }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screen asks of it: the locale's prefix, the params filled in, a query appended.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf(state.locale, href), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
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

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");

/** Words the outbox holds that the list must never show: a payload's, the provider's, a last answer. (The rows below are of October 2026, on the club's clock at UTC+3.) */
const PAYLOAD_WORDS = "Cuvintele emailului, niciodată în listă";
const PROVIDER_WORDS = "smtp.receiver said something private";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
const people: Record<"ana" | "stefan" | "dana" | "mihai", string> = { ana: "", stefan: "", dana: "", mihai: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

async function volunteer(name: string, roleId: string, createdAt: Date): Promise<string> {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: raceId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "0700000000", source: "PUBLIC", state: "REGISTERED", roleId, createdAt, updatedAt: createdAt })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleChoices).values({ volunteerId: row.id, roleId });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}

type Row = typeof emailOutbox.$inferInsert;
const at = (iso: string) => new Date(iso);

/** One outbox row about a volunteer, as the worker leaves it: sent after one try unless a status says otherwise. */
function mail(key: string, volunteerId: string, fields: Partial<Row>): Row {
  const status = fields.status ?? "SENT";
  return {
    messageType: "VOLUNTEER_POINT",
    locale: "ro",
    recipientEmail: "cineva@example.test",
    payloadJson: { volunteerId, note: PAYLOAD_WORDS },
    idempotencyKey: key,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    createdAt: at("2026-10-20T08:00:00.000Z"),
    sentAt: status === "SENT" || status === "BOUNCED" ? at("2026-10-20T08:00:30.000Z") : null,
    transport: status === "SENT" ? "mailgun" : null,
    recipientCount: status === "SENT" ? 1 : null,
    ...fields,
  };
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.reads.length = 0;
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.SUPERADMIN = await person("SUPERADMIN", "Sorin Super");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  state.actor = staff.ADMIN;
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") })
    .returning({ id: events.id });
  raceId = race.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 6, position: 0 }).returning({ id: eventVolunteerRoles.id });
  people.ana = await volunteer("Ana Pop", water.id, new Date("2026-10-01T10:00:00.000Z"));
  people.stefan = await volunteer("Ștefan Tănase", water.id, new Date("2026-10-02T10:00:00.000Z"));
  people.dana = await volunteer("Dana Ionescu", water.id, new Date("2026-10-03T10:00:00.000Z"));
  people.mihai = await volunteer("Mihai Fără", water.id, new Date("2026-10-04T10:00:00.000Z"));

  await db.insert(emailOutbox).values([
    // Ana — five of her own, oldest first: «am primit» delivered, the agreement refused by her mailbox, the role delivered,
    // her point sent last evening with no word of a delivery yet, and her point again this morning, still waiting.
    mail("k:ana:received", people.ana, { messageType: "VOLUNTEER_RECEIVED", createdAt: at("2026-10-01T10:00:00.000Z"), sentAt: at("2026-10-01T10:00:30.000Z"), deliveredAt: at("2026-10-01T10:00:50.000Z") }),
    mail("k:ana:agreement", people.ana, { messageType: "VOLUNTEER_AGREEMENT_REQUEST", status: "BOUNCED", createdAt: at("2026-10-02T10:00:00.000Z"), sentAt: at("2026-10-02T10:00:30.000Z"), rejectedAt: at("2026-10-02T10:02:00.000Z"), rejectionCause: "mailbox-full", providerDetail: PROVIDER_WORDS, lastError: PROVIDER_WORDS }),
    mail("k:ana:role", people.ana, { messageType: "VOLUNTEER_ROLE_ASSIGNED", createdAt: at("2026-10-19T07:00:00.000Z"), sentAt: at("2026-10-19T07:05:00.000Z"), deliveredAt: at("2026-10-19T07:05:20.000Z") }),
    mail("k:ana:point", people.ana, { createdAt: at("2026-10-20T18:04:00.000Z"), sentAt: at("2026-10-20T18:04:30.000Z"), transport: "gmail" }),
    mail("k:ana:point:again", people.ana, { status: "PENDING", createdAt: at("2026-10-21T09:30:00.000Z") }),
    // The club's own rows about her — the colleagues' notice (the newest of all) and a copy of her role: never hers.
    mail("k:ana:notice", people.ana, { messageType: "VOLUNTEER_CLUB_NOTICE", recipientEmail: "organizatori@club.test", createdAt: at("2026-10-21T09:40:00.000Z"), sentAt: at("2026-10-21T09:40:30.000Z") }),
    mail("k:ana:role:club-copy:copii@club.test", people.ana, { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "copii@club.test", payloadJson: { volunteerId: people.ana, clubCopy: true }, createdAt: at("2026-10-19T07:00:00.000Z"), sentAt: at("2026-10-19T07:05:05.000Z") }),
    // Ștefan — exactly three: a point that failed for good, one QA kept for itself, and his role, delivered.
    mail("k:stefan:role", people.stefan, { messageType: "VOLUNTEER_ROLE_ASSIGNED", createdAt: at("2026-10-18T07:00:00.000Z"), sentAt: at("2026-10-18T07:01:00.000Z"), deliveredAt: at("2026-10-18T07:01:20.000Z") }),
    mail("k:stefan:kept", people.stefan, { createdAt: at("2026-10-19T08:00:00.000Z"), sentAt: at("2026-10-19T08:00:30.000Z"), recipientCount: 0 }),
    mail("k:stefan:failed", people.stefan, { status: "FAILED", attemptCount: 20, lastError: "550 mailbox unavailable", createdAt: at("2026-10-20T08:00:00.000Z") }),
    // Dana — one, «am primit», delivered.
    mail("k:dana:received", people.dana, { messageType: "VOLUNTEER_RECEIVED", createdAt: at("2026-10-03T10:00:00.000Z"), sentAt: at("2026-10-03T10:00:30.000Z"), deliveredAt: at("2026-10-03T10:00:50.000Z") }),
    // Mihai — nothing.
  ]);
});

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; hideBelow?: string; omitEmptyOnPhone?: boolean; render: (row: unknown) => ReactNode };

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

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

/** The list of the race, chosen by its id: whatever day the suite runs on, the scope is this event's four people. */
const listTree = async (params: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId, ...params }) });
};
const listPage = async (params: Record<string, string> = {}, locale: "ro" | "en" = "ro") => html(await listTree(params, locale));
const columnsOf = (tree: ReactNode) => (elements(tree).find((element) => element.type === AdminTable)?.props.columns ?? []) as Column[];

const plain = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** Every «Emailuri» line the page draws, as a person reads it, in the page's order (the table first, then the phone's cards). */
const linesOf = (page: string) => [...page.matchAll(/data-testid="email-summary-line"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => plain(match[1]));
/** The page's short form of a moment, in the middle of a line. */
const when = (iso: string, locale: "ro" | "en" = "ro") => formatDay(new Date(iso), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "continues" });

describe("§960 «Emailuri» on the «Voluntari» list, for the Administrator", () => {
  it("stands right after «Stare», under the catalogue's heading with its «?», in the table and on a phone's card — it neither sorts nor leaves at a width", async () => {
    const columns = columnsOf(await listTree());
    const keys = columns.map((column) => column.key);
    expect(keys.indexOf("emails")).toBe(keys.indexOf("state") + 1);
    const column = columns.find((candidate) => candidate.key === "emails") as Column;
    expect(column.label).toBe("Emailuri");
    expect(column.hint).toBe(ro.Admin.emails.summary.hint);
    expect(column.sortable).toBeFalsy();
    // Every width of the wide table, and a line on every phone card — «niciun email» is an answer, never left out.
    expect(column.hideBelow).toBeUndefined();
    expect(column.omitEmptyOnPhone).toBeFalsy();
    const english = columnsOf(await listTree({}, "en")).find((candidate) => candidate.key === "emails");
    expect(english?.label).toBe("Emails");
    expect(english?.hint).toBe(en.Admin.emails.summary.hint);
  });

  it("says each person's three newest emails as «name · when · what became of it», then «și încă N emailuri» — in Romanian", async () => {
    const page = await listPage({ sort: "name", dir: "asc" });
    // The owner's own example, as he reads it: the email by its name in «Emailuri», never the type's token.
    expect(page).toContain("Punctul tău de voluntar");
    expect(page).not.toContain("VOLUNTEER_POINT · ");
    const lines = linesOf(page);
    const ana = [
      `Punctul tău de voluntar · ${when("2026-10-21T09:30:00.000Z")} · așteaptă`,
      `Punctul tău de voluntar · ${when("2026-10-20T18:04:30.000Z")} · a plecat`,
      `Rolul tău de voluntar · ${when("2026-10-19T07:05:00.000Z")} · livrat`,
    ];
    const dana = [`Ți-am primit oferta de voluntar · ${when("2026-10-03T10:00:30.000Z")} · livrat`];
    const stefan = [
      `Punctul tău de voluntar · ${when("2026-10-20T08:00:00.000Z")} · eșuat`,
      `Punctul tău de voluntar · ${when("2026-10-19T08:00:30.000Z")} · n-a ajuns la nimeni (QA)`,
      `Rolul tău de voluntar · ${when("2026-10-18T07:01:00.000Z")} · livrat`,
    ];
    // By name: Ana, Dana, Mihai (none), Ștefan — once in the table, once in the phone's cards.
    expect(lines).toEqual([...ana, ...dana, ...stefan, ...ana, ...dana, ...stefan]);
    // The moment is on the club's clock, in the list's own short form: Wednesday 21 October, 12:30 in Brașov.
    expect(ana[0]).toBe("Punctul tău de voluntar · mie., 21 oct. 2026, 12:30 · așteaptă");

    // Ana has two more, older: a link to her own «Emailuri», named for her; Ștefan has exactly three and Dana one: no link.
    const more = [...page.matchAll(/<a[^>]*data-testid="email-summary-more"[^>]*>([^<]*)<\/a>/g)];
    expect(more.map((match) => match[1])).toEqual(["și încă 2 emailuri", "și încă 2 emailuri"]);
    for (const [link] of more) {
      expect(link).toContain(`href="/ro/admin/volunteers/${people.ana}#emailuri"`);
      expect(link).toContain('aria-label="și încă 2 emailuri: Ana Pop"');
    }
    // Her count is her own five: the colleagues' notice and the club's copy of her role are the club's.
    expect(page.match(/data-testid="email-summary" data-total="5"/g)).toHaveLength(2);
    expect(page).not.toContain("Voluntar nou · ");

    // Mihai got nothing, and the list says so — in the table and on his card.
    expect([...page.matchAll(/data-testid="email-summary-none"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["niciun email", "niciun email"]);
  });

  it("says the outcome in a word, never by its colour alone, and nothing of the email's words, the provider's or an address of the outbox", async () => {
    const page = await listPage();
    // Each outcome is a word in the line and a mark on it; the six the fold knows, five of them on this page.
    const outcomes = [...page.matchAll(/data-testid="email-summary-line"[^>]*data-outcome="(\w+)"[\s\S]*?data-testid="email-summary-outcome"[^>]*>([^<]*)</g)].map((match) => `${match[1]}=${match[2]}`);
    expect([...new Set(outcomes)].sort()).toEqual(["captured=n-a ajuns la nimeni (QA)", "delivered=livrat", "failed=eșuat", "sent=a plecat", "waiting=așteaptă"]);
    for (const never of [PAYLOAD_WORDS, PROVIDER_WORDS, "550 mailbox unavailable", "cineva@example.test", "organizatori@club.test", "copii@club.test"]) expect(page, never).not.toContain(never);
    // No message key drawn raw, no chip a line tall inside a cell.
    expect(page).not.toMatch(/emails\.(summary|history|types)\./);
    const cells = [...page.matchAll(/data-testid="email-summary"[\s\S]*?(?=data-testid="email-summary"|<\/td>|$)/g)].map((match) => match[0]);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("says the same in English", async () => {
    const page = await listPage({ sort: "name", dir: "asc" }, "en");
    const lines = linesOf(page);
    expect(lines.slice(0, 3)).toEqual([
      `Your volunteer point · ${when("2026-10-21T09:30:00.000Z", "en")} · waiting`,
      `Your volunteer point · ${when("2026-10-20T18:04:30.000Z", "en")} · left`,
      `Your volunteer role · ${when("2026-10-19T07:05:00.000Z", "en")} · delivered`,
    ]);
    expect(lines[0]).toBe("Your volunteer point · Wed, 21 Oct 2026, 12:30 · waiting");
    expect(lines).toContain(`Your volunteer point · ${when("2026-10-20T08:00:00.000Z", "en")} · failed`);
    expect(lines).toContain(`Your volunteer point · ${when("2026-10-19T08:00:30.000Z", "en")} · reached nobody (QA)`);
    const more = [...page.matchAll(/<a[^>]*data-testid="email-summary-more"[^>]*>([^<]*)<\/a>/g)];
    expect(more.map((match) => match[1])).toEqual(["and 2 more emails", "and 2 more emails"]);
    expect(more[0][0]).toContain(`href="/en/admin/volunteers/${people.ana}#emailuri"`);
    expect(more[0][0]).toContain('aria-label="and 2 more emails: Ana Pop"');
    expect([...page.matchAll(/data-testid="email-summary-none"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["no emails", "no emails"]);
    expect(page).toContain(en.Admin.emails.summary.hint.replace(/'/g, "&#x27;"));
    expect(page).not.toMatch(/emails\.(summary|history|types)\./);
  });

  it("counts «și încă» in the counted noun's own form: one, a few, twenty", async () => {
    // Dana: one email now. Three more make four — «și încă 1 email»; twenty-two more make twenty-three — «și încă 20 de emailuri».
    const extra = (count: number, from: number) =>
      Array.from({ length: count }, (_, index) => mail(`k:dana:extra:${from + index}`, people.dana, { createdAt: new Date(at("2026-10-10T08:00:00.000Z").getTime() + (from + index) * 60_000), sentAt: at("2026-10-12T08:00:00.000Z") }));
    await db.insert(emailOutbox).values(extra(3, 0));
    const one = await listPage({ q: "Dana" });
    expect(one).toContain(">și încă 1 email<");
    expect((await listPage({ q: "Dana" }, "en"))).toContain(">and 1 more email<");
    await db.insert(emailOutbox).values(extra(19, 3));
    const twenty = await listPage({ q: "Dana" });
    expect(twenty).toContain(">și încă 20 de emailuri<");
    expect((await listPage({ q: "Dana" }, "en"))).toContain(">and 20 more emails<");
  });

  it("reads the emails once for the page's rows together, and for the Superadministrator too", async () => {
    state.reads.length = 0;
    const tree = await listTree();
    expect(state.reads).toHaveLength(1);
    const [, actor, subject] = state.reads[0] as [unknown, StaffUser, { volunteerIds: string[] }];
    expect(actor).toBe(staff.ADMIN);
    const rows = elements(tree).find((element) => element.type === AdminTable)?.props.rows as Array<{ id: string }>;
    expect(subject.volunteerIds).toEqual(rows.map((row) => row.id));
    expect([...subject.volunteerIds].sort()).toEqual(Object.values(people).sort());

    state.actor = staff.SUPERADMIN;
    state.reads.length = 0;
    expect(columnsOf(await listTree()).map((column) => column.key)).toContain("emails");
    expect(state.reads).toHaveLength(1);
  });

  it("links «și încă N» to an anchor that is there: the volunteer's own «Emailuri», a fold with that id", async () => {
    const page = await html(await AdminVolunteerPage({ params: Promise.resolve({ locale: "ro", id: people.ana }), searchParams: Promise.resolve({}) }));
    expect(page).toMatch(/<details[^>]*id="emailuri"[^>]*data-testid="volunteer-emails"|<details[^>]*data-testid="volunteer-emails"[^>]*id="emailuri"/);
    // Where every email stands: her five, the two the list does not draw among them.
    expect(page.match(/data-testid="email-history-row"/g)).toHaveLength(5);
  });
});

describe("BR-REQ-060-01 «Emailuri» on the «Voluntari» list is not the Organizer's (§960)", () => {
  it("draws the list exactly as before for an Organizer — no column, no line, no «niciun email» — and never calls the reader", async () => {
    const asAdministrator = columnsOf(await listTree()).map((column) => column.key);
    state.actor = staff.MODERATOR;
    state.reads.length = 0;
    const tree = await listTree();
    const keys = columnsOf(tree).map((column) => column.key);
    expect(keys).not.toContain("emails");
    // Every other column, in the same order: the Organizer's list is the Administrator's without this one.
    expect(keys).toEqual(asAdministrator.filter((key) => key !== "emails"));
    const page = await html(tree as ReactElement);
    expect(page).toContain("Ana Pop");
    // (The add form's help says «nu primește niciun email» of an address left empty: the cell's own words are the whole of a tag.)
    for (const never of ['data-testid="email-summary', ">niciun email<", ">și încă ", ro.Admin.emails.summary.hint, "Punctul tău de voluntar · "]) expect(page, never).not.toContain(never);
    // Nothing was read for them: the reader was not called, here or while the page was drawn.
    expect(state.reads).toEqual([]);
    expect(await listPage({}, "en")).not.toContain(en.Admin.emails.summary.hint.replace(/'/g, "&#x27;"));
    expect(state.reads).toEqual([]);
  });
});
