import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { VOLUNTEER_DECISION_MAX } from "@/modules/volunteers/domain/volunteer";
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { unzip } from "../../helpers/xlsx";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Decizie ziua cursei» on the organizers' screens (the owner, 2026-11-16, working the
 * «Voluntari» list on a phone: «si la voluntar trebuie sa am si decizie pt ziua cursei»), read from a real database:
 *
 * - the «Voluntari» list has the column right after «Note interne», under the catalogue's heading with its «?»: the words in the
 *   «Mesaj» cell's own style, and the press — «Scrie decizia» with none, «Modifică decizia» with one — that opens the row's dialog
 *   (`RowNoteDialog`, the notes' own control with other words; only strings cross to it) and, with no script, is a link to the
 *   person's page; in Romanian and in English, for a row with a decision and for one without;
 * - `setVolunteerDecisionAction` asks the capability itself, saves through the service, comes back to the SAME list address with
 *   the toast (saved, cleared, nothing to change), answers a refusal with the form's own state, and follows a forged `returnTo`
 *   nowhere but the event's own «Voluntari» card;
 * - the person's page has the card «Decizie pentru ziua cursei» in the organizers' part, with the same form; the event card's
 *   row reads the line; «Toate datele unei persoane» carries it (art. 15 GDPR); the volunteers' files do not.
 *
 * What the verb writes and leaves alone is `race-day-decision.test.ts`. The made-up people here are nobody.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  cookies: [] as Array<[string, string]>,
  asked: [] as unknown[],
}));

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
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
// The jar keeps what an action writes: the flash is how a press that redirects says what it did.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screens ask of it: the locale's prefix, the params filled in, a query appended.
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
// The door as the real one answers: the predicate is asked of the actor, a refusal is FORBIDDEN — and what was asked is kept.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    state.asked.push(capability);
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const actions = await import("@/app/[locale]/admin/volunteers/actions");
const { GET: eventFile } = await import("@/app/api/admin/events/[id]/volunteers/route");
const { GET: everyEventFile } = await import("@/app/api/admin/volunteers/export/route");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
const { default: VolunteerDecisionCard, DECISION_ANCHOR } = await import("@/modules/volunteers/ui/VolunteerDecisionCard");
const { default: VolunteerPerson } = await import("@/modules/volunteers/ui/VolunteerPerson");
const { default: NotesCard } = await import("@/modules/registrations/ui/NotesCard");
const { default: RowNoteDialog } = await import("@/shared/ui/RowNoteDialog");
const { findVolunteerForAdmin } = await import("@/modules/volunteers/admin-list");
const { volunteerPersonContextOf } = await import("@/modules/volunteers/person-context");
const { exportPersonData, viewPersonData } = await import("@/modules/registrations/person-data");

type Props = Record<string, unknown> & { children?: ReactNode };
type DialogProps = Parameters<typeof RowNoteDialog>[0];
type Column = { key: string; label: string; hint?: string; sortable?: boolean; omitEmptyOnPhone?: boolean; hideBelow?: string; render: (row: unknown) => ReactNode };

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
const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id);

const NOW = new Date("2026-11-16T10:00:00.000Z");
const DECISION = "vine la 8:00 la start";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let guideId: string;
const people = { ana: "", dan: "", eva: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function volunteer(over: { eventId: string; name: string; state?: "REGISTERED" | "CONFIRMED" | "CANCELLED"; given?: string[]; raceDayDecision?: string; message?: string }): Promise<string> {
  const email = `${over.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: over.eventId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      phone: "+40700000001",
      source: "PUBLIC",
      state: over.state ?? "CONFIRMED",
      roleId: over.given?.[0] ?? null,
      raceDayDecision: over.raceDayDecision ?? null,
      message: over.message ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  if (over.given?.length) {
    await db.insert(eventVolunteerRoleChoices).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
    await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  }
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  state.cookies.length = 0;
  state.asked.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  const [race, run] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW },
      { type: "RACE", startsAt: new Date("2099-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  runId = run.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
    { eventId: runId, locale: "ro", slug: `altul-${runId.slice(0, 8)}`, title: "Alt cros" },
    { eventId: runId, locale: "en", slug: `other-${runId.slice(0, 8)}`, title: "Another cross" },
  ]);
  const [guide] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0 }).returning({ id: eventVolunteerRoles.id });
  guideId = guide.id;
  // Ana has a decision and a message of her own; Dan has neither; Eva is cancelled, and decided so.
  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", given: [guideId], raceDayDecision: DECISION, message: "Pot veni de la 7." });
  people.dan = await volunteer({ eventId: raceId, name: "Dan Ene", state: "REGISTERED" });
  people.eva = await volunteer({ eventId: raceId, name: "Eva Stan", state: "CANCELLED", raceDayDecision: "nu mai vine" });
  people.mara = await volunteer({ eventId: runId, name: "Mara Dinu" });
});

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const listTree = async (query: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) });
};
const listPage = async (query: Record<string, string> = {}, locale: "ro" | "en" = "ro") => html(await listTree(query, locale));
const personTree = async (id: string, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteerPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve({}) });
};
const personPage = async (id: string, locale: "ro" | "en" = "ro") => html(await personTree(id, locale));

/** The list's table as the page hands it over: its columns, and one column drawn for one row. */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { columns, rows, cell };
}
const dialogOf = (cell: ReactNode) => elements(cell).filter((element) => element.type === RowNoteDialog).map((element) => element.props as unknown as DialogProps);

/** The presses of «Decizie ziua cursei» on a rendered page — `AdminTable` draws each row twice, the table and the phone cards — for one person. */
const pressesOf = (page: string, id: string) => [...page.matchAll(/<a\b[^>]*data-testid="decision-open"[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]).filter((one) => one.includes(`/admin/volunteers/${id}#`));
const textsOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((match) => match[1]);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, returnTo: "/ro/admin/volunteers", ...fields })) data.set(key, value);
  return data;
}
/** A press that saves: it redirects, and the flash says what it did. */
async function saved(fields: Record<string, string>): Promise<{ to: string; toast: ReturnType<typeof decodeFlash> }> {
  state.redirected.length = 0;
  state.cookies.length = 0;
  await expect(actions.setVolunteerDecisionAction(null, form(fields))).rejects.toThrow("NEXT_REDIRECT");
  expect(state.redirected).toHaveLength(1);
  return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
}
/** A press the server refuses: no redirect, the form's own state. */
async function refusal(fields: Record<string, string>) {
  state.redirected.length = 0;
  const outcome = await actions.setVolunteerDecisionAction(null, form(fields));
  expect(state.redirected).toEqual([]);
  return outcome;
}
const decisionOf = async (id: string) => (await db.select({ raceDayDecision: eventVolunteers.raceDayDecision }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].raceDayDecision;

describe("§NNN «Decizie ziua cursei» on the «Voluntari» list — the column", () => {
  it("stands right after «Note interne», under the catalogue's heading with its «?»; it does not sort, and a phone's card keeps its line on every row", async () => {
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const { columns } = tableOf(await listTree({}, locale));
      const keys = columns.map((column) => column.key);
      expect(keys.indexOf("decision"), locale).toBe(keys.indexOf("notes") + 1);
      expect(keys.indexOf("notes"), locale).toBe(keys.indexOf("message") + 1);
      const column = columns.find((candidate) => candidate.key === "decision")!;
      expect(column.label).toBe(catalogue.Admin.volunteers.decision.column);
      expect(column.hint).toBe(catalogue.Admin.volunteers.decision.hint);
      expect(column.sortable).toBeFalsy();
      // The press lives in the cell: the line stays on a phone's card for a row with no decision too, and at every width.
      expect(column.omitEmptyOnPhone).toBeFalsy();
      expect(column.hideBelow).toBeUndefined();
    }
    expect(ro.Admin.volunteers.decision.column).toBe("Decizie ziua cursei");
    expect(en.Admin.volunteers.decision.column).toBe("Race-day decision");
    expect(ro.Admin.volunteers.decision.label).toBe("Decizie pentru ziua cursei");
  });

  it("draws the words in the «Mesaj» cell's own style, for a row with a decision, and nothing but the press for a row without", async () => {
    const { cell } = tableOf(await listTree());
    const [words] = byTestId(cell("decision", people.ana), "volunteer-decision");
    expect(words.props.children).toBe(DECISION);
    // The very object the person's own message is drawn with: one style, so the two columns never drift apart.
    const [message] = byTestId(cell("message", people.ana), "volunteer-message");
    expect(words.props.sx).toBe(message.props.sx);
    expect(words.props.sx).toMatchObject({ whiteSpace: "pre-line", overflowWrap: "break-word" });

    expect(byTestId(cell("decision", people.dan), "volunteer-decision")).toEqual([]);
    expect(dialogOf(cell("decision", people.dan))).toHaveLength(1);
    // A cancelled person's decision is read and changed like anybody's.
    expect(byTestId(cell("decision", people.eva), "volunteer-decision")[0].props.children).toBe("nu mai vine");
    expect(dialogOf(cell("decision", people.eva))).toHaveLength(1);
  });

  it("hands the row's dialog its words, the action and the list's own return address — strings only cross into the island", async () => {
    const { cell } = tableOf(await listTree({ eventId: raceId, sort: "name", dir: "asc", state: "CONFIRMED" }));
    const [props] = dialogOf(cell("decision", people.ana));
    expect(props.action).toBe(actions.setVolunteerDecisionAction);
    expect(props).toMatchObject({
      label: "Modifică decizia",
      ariaLabel: "Modifică decizia: Ana Pop",
      title: "Decizie pentru ziua cursei: Ana Pop",
      help: ro.Admin.volunteers.decision.help,
      boxName: "decision",
      boxLabel: "Decizie pentru ziua cursei",
      limitText: "Cel mult 300 de caractere. Un rând nou se salvează ca spațiu.",
      max: VOLUNTEER_DECISION_MAX,
      saveLabel: "Salvează",
      // The box opens on the line as it stands, and may be saved empty — which clears it.
      defaultValue: DECISION,
      optional: true,
      icon: "edit",
      fallbackHref: `/ro/admin/volunteers/${people.ana}#${DECISION_ANCHOR}`,
      testId: "decision-open",
      dialogTestId: "decision-dialog",
    });
    expect(props.fields).toMatchObject({ uiLocale: "ro", eventId: raceId, volunteerId: people.ana });
    // The way back is this very page of the list — the event, the filter, the sort — and a path the action's return accepts.
    const back = new URL(props.fields.returnTo, "https://example.test");
    expect(back.pathname).toBe("/ro/admin/volunteers");
    expect([back.searchParams.get("eventId"), back.searchParams.get("sort"), back.searchParams.get("dir"), back.searchParams.get("state")]).toEqual([raceId, "name", "asc", "CONFIRMED"]);
    // The dialog closes on every page drawn after a save: the line itself and the page's own instant.
    expect(props.settledKey).toMatch(new RegExp(`^${DECISION}:\\d+$`));

    // Nothing but strings, numbers and flags crosses the boundary: no element, no icon, no function but the Server Action.
    for (const [name, value] of Object.entries(props)) {
      if (name === "action") continue;
      expect(isValidElement(value), name).toBe(false);
      expect(typeof value === "function", name).toBe(false);
      if (typeof value === "object" && value !== null) {
        for (const inner of Object.values(name === "messages" ? { ...(value as DialogProps["messages"]).errors, ...(value as DialogProps["messages"]).fields } : value)) expect(typeof inner, name).toBe("string");
      }
    }
    // The refusals it can meet, and the box's own name for the summary's link.
    expect(Object.keys(props.messages.errors).sort()).toEqual(["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"]);
    expect(props.messages.fields).toEqual({ decision: "Decizie pentru ziua cursei" });

    // A row with none: the other words, the plus, an empty box.
    const [empty] = dialogOf(tableOf(await listTree()).cell("decision", people.dan));
    expect(empty).toMatchObject({ label: "Scrie decizia", ariaLabel: "Scrie decizia: Dan Ene", title: "Decizie pentru ziua cursei: Dan Ene", defaultValue: "", optional: true, icon: "add" });
    expect(empty.settledKey).toMatch(/^:\d+$/);
  });

  it("is rendered in Romanian: the heading and its hint, the words of a row with a decision, the press of each row a link that works with no script", async () => {
    const page = await listPage();
    expect(page).toContain("Decizie ziua cursei");
    expect(page).toContain(ro.Admin.volunteers.decision.hint);

    // With a decision: the words, and «Modifică decizia» — in the table and in the phone's card alike.
    expect(textsOf(page, "volunteer-decision").filter((words) => words === DECISION)).toHaveLength(2);
    const ana = pressesOf(page, people.ana);
    expect(ana).toHaveLength(2);
    for (const one of ana) {
      expect(one).toContain(`href="/ro/admin/volunteers/${people.ana}#decizie-ziua-cursei"`);
      expect(one).toContain('aria-label="Modifică decizia: Ana Pop"');
      expect(one).toContain('aria-haspopup="dialog"');
      expect(one).toContain("Modifică decizia</span>");
      expect(one).not.toContain("Scrie decizia");
      // The pencil of a line that is changed.
      expect(one).toContain('data-testid="EditIcon"');
    }
    // Without one: no words of theirs anywhere, and «Scrie decizia».
    const dan = pressesOf(page, people.dan);
    expect(dan).toHaveLength(2);
    for (const one of dan) {
      expect(one).toContain(`href="/ro/admin/volunteers/${people.dan}#decizie-ziua-cursei"`);
      expect(one).toContain('aria-label="Scrie decizia: Dan Ene"');
      expect(one).toContain("Scrie decizia</span>");
      // The plus of a line still to write.
      expect(one).toContain('data-testid="AddIcon"');
    }
    // Three people of the race, each drawn twice: Ana's and Eva's words, never a cell for Dan; no dialog is open on a page as drawn.
    expect(textsOf(page, "volunteer-decision").sort()).toEqual(["nu mai vine", "nu mai vine", DECISION, DECISION]);
    expect(page).not.toContain('data-testid="decision-dialog"');
    // The other event's person is not on this list.
    expect(pressesOf(page, people.mara)).toEqual([]);
  });

  it("is rendered in English, for a row with a decision and for a row without", async () => {
    const page = await listPage({}, "en");
    expect(page).toContain("Race-day decision");
    expect(page).toContain(en.Admin.volunteers.decision.hint);
    expect(textsOf(page, "volunteer-decision").filter((words) => words === DECISION)).toHaveLength(2);
    for (const one of pressesOf(page, people.ana)) {
      expect(one).toContain(`href="/en/admin/volunteers/${people.ana}#decizie-ziua-cursei"`);
      expect(one).toContain('aria-label="Change the decision: Ana Pop"');
      expect(one).toContain("Change the decision</span>");
    }
    expect(pressesOf(page, people.ana)).toHaveLength(2);
    for (const one of pressesOf(page, people.dan)) {
      expect(one).toContain('aria-label="Write the decision: Dan Ene"');
      expect(one).toContain("Write the decision</span>");
    }
    expect(pressesOf(page, people.dan)).toHaveLength(2);
    expect(page).not.toMatch(/Scrie decizia|Modifică decizia|Decizie ziua cursei/);
  });

  it("is a 404 for a role that may not work the volunteers: there is no list to read a decision from", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(listTree(), role).rejects.toThrow("NOT_FOUND");
      await expect(personTree(people.ana), role).rejects.toThrow("NOT_FOUND");
    }
  });
});

describe("§NNN setVolunteerDecisionAction — the press", () => {
  it("saves from the row's dialog and comes back to the SAME list address — filters, sort and page — with the toast, the words in neither", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&state=REGISTERED&sort=name&dir=asc&page=2`;
    const press = await saved({ volunteerId: people.dan, decision: "  rezervă\nla start ", returnTo: back });
    expect(press.to).toBe(back);
    expect(press.toast).toEqual({ kind: "success", key: "volunteerDecisionSaved" });
    expect(await decisionOf(people.dan)).toBe("rezervă la start");
    // Nothing typed travels in the address or in the flash.
    expect(JSON.stringify([state.redirected, state.cookies])).not.toMatch(/rezerv/);

    // The page the press comes back to draws the new line, and its dialog would open on it.
    const { cell } = tableOf(await listTree({ eventId: raceId }));
    expect(byTestId(cell("decision", people.dan), "volunteer-decision")[0].props.children).toBe("rezervă la start");
    expect(dialogOf(cell("decision", people.dan))[0]).toMatchObject({ label: "Modifică decizia", defaultValue: "rezervă la start", icon: "edit" });
  });

  it("clears the decision for an empty box, and says nothing changed for the same words — each with its own toast", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}`;
    expect(await saved({ volunteerId: people.ana, decision: DECISION, returnTo: back })).toEqual({ to: back, toast: { kind: "info", key: "volunteerUnchanged" } });
    expect(await saved({ volunteerId: people.ana, decision: "", returnTo: back })).toEqual({ to: back, toast: { kind: "success", key: "volunteerDecisionCleared" } });
    expect(await decisionOf(people.ana)).toBeNull();
    expect(await saved({ volunteerId: people.ana, decision: "  ", returnTo: back })).toEqual({ to: back, toast: { kind: "info", key: "volunteerUnchanged" } });
    // A cancelled person's decision is saved like anybody's.
    expect((await saved({ volunteerId: people.eva, decision: "vine totuși, la 9:00", returnTo: back })).toast).toEqual({ kind: "success", key: "volunteerDecisionSaved" });
    expect(await decisionOf(people.eva)).toBe("vine totuși, la 9:00");
  });

  it("has words in both catalogues for every toast it flashes and every refusal it answers", () => {
    for (const catalogue of [ro, en]) {
      const toasts = catalogue.Feedback.toast as Record<string, unknown>;
      for (const code of ["volunteerDecisionSaved", "volunteerDecisionCleared", "volunteerUnchanged"]) expect(typeof toasts[code], code).toBe("string");
      const errors = catalogue.Admin.errors as Record<string, unknown>;
      for (const code of ["VALIDATION_ERROR", "NOT_FOUND", "FORBIDDEN"]) expect(typeof errors[code], code).toBe("string");
    }
    expect(ro.Feedback.toast.volunteerDecisionSaved).toContain("salvată");
    expect(ro.Feedback.toast.volunteerDecisionCleared).toContain("ștearsă");
    expect(ro.Feedback.toast.volunteerDecisionSaved).not.toBe(ro.Feedback.toast.volunteerDecisionCleared);
    expect(en.Feedback.toast.volunteerDecisionSaved).not.toBe(en.Feedback.toast.volunteerDecisionCleared);
  });

  it("answers a line too long with the form's own state — the box named, the words still in it — and writes nothing", async () => {
    const long = "x".repeat(VOLUNTEER_DECISION_MAX + 1);
    expect(await refusal({ volunteerId: people.ana, decision: long })).toMatchObject({ error: "VALIDATION_ERROR", fields: ["decision"], values: { decision: [long], volunteerId: [people.ana] } });
    expect(await decisionOf(people.ana)).toBe(DECISION);
    // A form that never posted the box is refused on the box too, rather than read as «clear it».
    const bare = new FormData();
    for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, volunteerId: people.ana, returnTo: "/ro/admin/volunteers" })) bare.set(key, value);
    expect(await actions.setVolunteerDecisionAction(null, bare)).toMatchObject({ error: "VALIDATION_ERROR", fields: ["decision"] });
    expect(await decisionOf(people.ana)).toBe(DECISION);
    expect(state.redirected).toEqual([]);
  });

  it("answers NOT_FOUND for another event's person, a person deleted meanwhile and an id that is none", async () => {
    // Mara is the other event's: posted as the race's, she is not there.
    expect(await refusal({ volunteerId: people.mara, decision: "rezervă" })).toMatchObject({ error: "NOT_FOUND" });
    expect(await decisionOf(people.mara)).toBeNull();
    expect(await refusal({ volunteerId: "11111111-1111-4111-8111-111111111111", decision: "rezervă" })).toMatchObject({ error: "NOT_FOUND" });
    expect(await refusal({ volunteerId: "nobody", decision: "rezervă" })).toMatchObject({ error: "NOT_FOUND" });
    expect(await refusal({ volunteerId: people.ana, eventId: "not-an-event", decision: "rezervă" })).toMatchObject({ error: "NOT_FOUND" });
    await db.delete(eventVolunteers).where(eq(eventVolunteers.id, people.dan));
    expect(await refusal({ volunteerId: people.dan, decision: "rezervă" })).toMatchObject({ error: "NOT_FOUND", values: { decision: ["rezervă"] } });
  });

  it("asks the capability itself — `canManageVolunteers` — and refuses every other role at the door, writing nothing (BR-REQ-060-01)", async () => {
    await saved({ volunteerId: people.dan, decision: "rezervă" });
    expect(state.asked.at(-1)).toBe(canManageVolunteers);
    const trailBefore = (await db.select().from(auditLogs)).length;

    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      state.asked.length = 0;
      expect(await refusal({ volunteerId: people.ana, decision: "intrus" }), role).toMatchObject({ error: "FORBIDDEN", values: { decision: ["intrus"] } });
      expect(await refusal({ volunteerId: people.ana, decision: "" }), role).toMatchObject({ error: "FORBIDDEN" });
      expect(state.asked, role).toEqual([canManageVolunteers, canManageVolunteers]);
    }
    expect(await decisionOf(people.ana)).toBe(DECISION);
    expect(await db.select().from(auditLogs)).toHaveLength(trailBefore);

    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect((await saved({ volunteerId: people.ana, decision: `decis de ${role}` })).toast, role).toMatchObject({ key: "volunteerDecisionSaved" });
    }
  });

  it("follows a forged `returnTo` nowhere but the event's own «Voluntari» card, and the person's page when that is where the form was", async () => {
    const card = `/ro/admin/events/${raceId}#box-volunteers`;
    for (const forged of ["https://example.test/x", "//example.test/x", "/ro/admin/registrations", "/ro/admin/volunteers/../../x", "javascript:alert(1)", `/ro/admin/volunteers/${people.ana}#x`]) {
      expect((await saved({ volunteerId: people.ana, decision: `altă decizie ${forged.length}`, returnTo: forged })).to, forged).toBe(card);
    }
    // The person's own page is a path of the «Voluntari» screen: the card's form comes back to it.
    const page = `/ro/admin/volunteers/${people.ana}`;
    expect((await saved({ volunteerId: people.ana, decision: "vine la 7:30", returnTo: page })).to).toBe(page);
    // In English too, and a refusal's code never rides on a save.
    expect((await saved({ volunteerId: people.ana, decision: "comes at 7:30", uiLocale: "en", returnTo: `/en/admin/volunteers?eventId=${raceId}&volunteerError=FORBIDDEN` })).to).toBe(`/en/admin/volunteers?eventId=${raceId}`);
  });

  it("emails nobody, whatever it saves", async () => {
    await saved({ volunteerId: people.ana, decision: "rezervă" });
    await saved({ volunteerId: people.ana, decision: "" });
    await saved({ volunteerId: people.eva, decision: "vine" });
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });
});

describe("§NNN «Decizie pentru ziua cursei» on the person's page", () => {
  it("stands in the organizers' part — after «Note interne», before the person's own block — handed the list's own action and this page as its way back", async () => {
    const all = elements(await personTree(people.ana));
    const notes = all.findIndex((element) => element.type === NotesCard);
    const card = all.findIndex((element) => element.type === VolunteerDecisionCard);
    const block = all.findIndex((element) => element.type === VolunteerPerson);
    expect(notes).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(notes);
    expect(card).toBeLessThan(block);
    const props = all[card].props as unknown as Parameters<typeof VolunteerDecisionCard>[0];
    expect(props.action).toBe(actions.setVolunteerDecisionAction);
    expect(props.returnTo).toBe(`/ro/admin/volunteers/${people.ana}`);
    expect(props.locale).toBe("ro");
    expect(props.person).toMatchObject({ id: people.ana, eventId: raceId, raceDayDecision: DECISION });
  });

  it("is rendered as an open card with the same form: the box on the line as it stands, the limit said, «Salvează», the hidden fields of the press", async () => {
    const page = await personPage(people.ana);
    const card = /<section\b[^>]*data-testid="volunteer-decision-card"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
    expect(card).toContain('id="decizie-ziua-cursei"');
    expect(card).toMatch(/<h3\b[^>]*>(?:<svg[\s\S]*?<\/svg>)?Decizie pentru ziua cursei<\/h3>/);
    expect(card).toContain(ro.Admin.volunteers.decision.help);
    // Never a fold: the list's press lands here with no script, and the form must be standing.
    expect(card).not.toContain("<details");
    expect(card).not.toContain("<summary");

    const box = /<textarea\b[^>]*\bname="decision"[^>]*>([^<]*)<\/textarea>/.exec(card);
    expect(box?.[1]).toBe(DECISION);
    expect(box?.[0]).toContain('maxLength="300"');
    expect(box?.[0]).not.toMatch(/\brequired\b/);
    expect(card).toContain("Cel mult 300 de caractere. Un rând nou se salvează ca spațiu.");
    for (const [name, value] of [["uiLocale", "ro"], ["eventId", raceId], ["volunteerId", people.ana], ["returnTo", `/ro/admin/volunteers/${people.ana}`]]) {
      expect(card).toContain(`<input type="hidden" name="${name}" value="${value}"/>`);
    }
    expect(card).toMatch(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?Salvează<\/button>/);

    // In the organizers' part: under their notes, above the person's block, and no line of it among the person's own answers.
    expect(page.indexOf('id="note-interne"')).toBeGreaterThan(0);
    expect(page.indexOf('id="note-interne"')).toBeLessThan(page.indexOf('data-testid="volunteer-decision-card"'));
    expect(page.indexOf('data-testid="volunteer-decision-card"')).toBeLessThan(page.indexOf('data-testid="volunteer-row"'));
    const block = page.slice(page.indexOf('data-testid="volunteer-row"'));
    expect(block).not.toContain(DECISION);
    expect(block).not.toContain('data-testid="volunteer-decision"');
  });

  it("opens on an empty box for a person with no decision, and is drawn in English", async () => {
    const empty = await personPage(people.dan);
    const card = /<section\b[^>]*data-testid="volunteer-decision-card"[\s\S]*?<\/section>/.exec(empty)?.[0] ?? "";
    expect(/<textarea\b[^>]*\bname="decision"[^>]*>([^<]*)<\/textarea>/.exec(card)?.[1]).toBe("");

    const english = await personPage(people.ana, "en");
    const englishCard = /<section\b[^>]*data-testid="volunteer-decision-card"[\s\S]*?<\/section>/.exec(english)?.[0] ?? "";
    expect(englishCard).toMatch(/<h3\b[^>]*>(?:<svg[\s\S]*?<\/svg>)?Decision for race day<\/h3>/);
    expect(englishCard).toContain(en.Admin.volunteers.decision.help);
    expect(englishCard).toContain("At most 300 characters. A new line is saved as a space.");
    expect(englishCard).toContain(`name="returnTo" value="/en/admin/volunteers/${people.ana}"`);
    expect(/<textarea\b[^>]*\bname="decision"[^>]*>([^<]*)<\/textarea>/.exec(englishCard)?.[1]).toBe(DECISION);
  });

  it("is read in the event card's row of the person, and not twice on the person's own page", async () => {
    const person = (await findVolunteerForAdmin(db, people.ana, "ro"))!;
    const context = await volunteerPersonContextOf(db, person.event, "ro", NOW, "");
    const row = await html(await VolunteerPerson({ person, context: { ...context, returnTo: undefined } }));
    expect(row).toMatch(/data-testid="volunteer-decision"[^>]*><span[^>]*>Decizie pentru ziua cursei: <\/span>vine la 8:00 la start</);
    // On the page of their own, the card above the block says it: the block does not repeat it.
    expect(await html(await VolunteerPerson({ person, context, as: "section" }))).not.toContain('data-testid="volunteer-decision"');
    // Nothing for a person with no decision.
    const dan = (await findVolunteerForAdmin(db, people.dan, "ro"))!;
    expect(await html(await VolunteerPerson({ person: dan, context: { ...context, returnTo: undefined } }))).not.toContain('data-testid="volunteer-decision"');
  });
});

describe("§NNN the race-day decision among what is kept about a person, and out of the volunteers' files", () => {
  it("is in «Toate datele unei persoane» — the offer's own row, on the page and in the file (art. 15 GDPR)", async () => {
    const before = await viewPersonData(db, staff.ADMIN!, "dan.ene@example.test", NOW);
    expect(before.volunteerOffers.map((offer) => offer.raceDayDecision)).toEqual([null]);
    await saved({ volunteerId: people.dan, decision: "rezervă la start" });
    const after = await viewPersonData(db, staff.ADMIN!, "dan.ene@example.test", NOW);
    expect(after.volunteerOffers.map((offer) => offer.raceDayDecision)).toEqual(["rezervă la start"]);
    const file = await exportPersonData(db, staff.ADMIN!, "dan.ene@example.test", NOW);
    expect(JSON.parse(JSON.stringify(file)).volunteerOffers[0].raceDayDecision).toBe("rezervă la start");

    // The line the page draws for the offer, in both languages; nothing for an offer with no decision.
    state.locale = "ro";
    expect(await html(await VolunteerAnswers({ offer: after.volunteerOffers[0] }))).toContain(" · Decizie pentru ziua cursei: rezervă la start");
    state.locale = "en";
    expect(await html(await VolunteerAnswers({ offer: after.volunteerOffers[0] }))).toContain(" · Decision for race day: rezervă la start");
    expect(await html(await VolunteerAnswers({ offer: before.volunteerOffers[0] }))).not.toMatch(/Decision for race day|Decizie pentru ziua cursei/);
  });

  it("is in neither of the volunteers' files: the event's CSV and spreadsheet and every event's spreadsheet keep their columns", async () => {
    const context = { params: Promise.resolve({ id: raceId }) };
    for (const lang of ["ro", "en"]) {
      const csv = await (await eventFile(new Request(`http://localhost/api/admin/events/${raceId}/volunteers?lang=${lang}`), context)).text();
      expect(csv).toContain("Ana Pop");
      expect(csv).not.toMatch(/vine la 8:00|nu mai vine|Decizie|[Dd]ecision/);
      const sheet = Buffer.from(await (await eventFile(new Request(`http://localhost/api/admin/events/${raceId}/volunteers?format=xlsx&lang=${lang}`), context)).arrayBuffer());
      const everything = [...unzip(sheet).values()].join("\n");
      expect(everything).toContain("Ana Pop");
      expect(everything).not.toMatch(/vine la 8:00|nu mai vine|Decizie|[Dd]ecision/);
      const all = Buffer.from(await (await everyEventFile(new Request(`http://localhost/api/admin/volunteers/export?lang=${lang}`))).arrayBuffer());
      const allOfIt = [...unzip(all).values()].join("\n");
      expect(allOfIt).toContain("Ana Pop");
      expect(allOfIt).not.toMatch(/vine la 8:00|nu mai vine|Decizie|[Dd]ecision/);
    }
  });
});
