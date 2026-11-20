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
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §983, BR-REQ-050-02, BR-REQ-060-01 — «Prezent» on the organizers' screens (the owner, 2026-11-18, three days before the race: «La
 * voluntari trebuie să trec prezent/absent ca să pot face tombola doar pentru cei prezenți»), read from a real database:
 *
 * - the «Voluntari» list has the column «Prezent» right before «Are kit», with its «?», on every row whatever the scope: the house's
 *   one-press tick in a plain form posting the state it wants, named with the person, coming back to this page of the list;
 * - the strip says «Prezenți: N» and «Absenți: K» beside «Cu kit» — always, a nought too — over «Înscris» and «Confirmat», each a pill
 *   that filters the list to exactly its people through `present=yes|no` and clears when pressed again; the filters' form carries it;
 * - with one event chosen that holds a raffle, the toolbar has «Lista pentru tombolă» and its present-only twin;
 * - the person's page has the same tick beside «Are kit» and, when ticked, the chip «Prezent»;
 * - `setVolunteerPresentAction` asks the capability itself, saves through the service, comes back with the toast, and answers every
 *   other role, an ended session and another event's person with the refusal's code, writing nothing;
 * - every role that may not work the volunteers gets a 404 for both pages. Both languages.
 *
 * What the verb writes and leaves alone is `present.test.ts`; the file, `raffle-list.test.ts`. The made-up people here are nobody.
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
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const actions = await import("@/app/[locale]/admin/volunteers/actions");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: ChipLink } = await import("@/shared/ui/ChipLink");
const { default: TickButton } = await import("@/shared/ui/TickButton");
const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
const { exportPersonData, viewPersonData } = await import("@/modules/registrations/person-data");

type Props = Record<string, unknown> & { children?: ReactNode };
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
/** A hidden box of a form, by its name: its value. */
const fieldOf = (nodes: ReactElement<Props>[], name: string) => nodes.find((element) => element.type === "input" && element.props.name === name)?.props.value;

const NOW = new Date("2026-11-18T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let guideId: string;
const people = { ana: "", dan: "", eva: "", ion: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function volunteer(over: { eventId: string; name: string; state?: "REGISTERED" | "CONFIRMED" | "CANCELLED"; given?: string[]; present?: boolean; volunteerNumber?: number; hasKit?: boolean }): Promise<string> {
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
      present: over.present ?? false,
      hasKit: over.hasKit ?? false,
      volunteerNumber: over.volunteerNumber ?? null,
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
  // Ana came; Dan (offered) and Ion (confirmed, with a kit) did not; Eva was ticked and cancelled since — neither present nor missing.
  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", given: [guideId], present: true, volunteerNumber: 1 });
  people.dan = await volunteer({ eventId: raceId, name: "Dan Ene", state: "REGISTERED" });
  people.eva = await volunteer({ eventId: raceId, name: "Eva Stan", state: "CANCELLED", present: true });
  people.ion = await volunteer({ eventId: raceId, name: "Ion Lupu", given: [guideId], hasKit: true });
  people.mara = await volunteer({ eventId: runId, name: "Mara Dinu", present: true });
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

/** The list's table as the page hands it over: its columns, its rows, and one column drawn for one row. */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string; name: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { columns, rows, cell, names: rows.map((row) => row.name).sort() };
}
/** The strip's pills: the words each says, where each leads, and whether it is the filter in force. */
const pillsOf = (tree: ReactNode) =>
  elements(tree)
    .filter((element) => element.type === ChipLink)
    .map((element) => ({ label: element.props.label as string, href: element.props.href as string, active: element.props.active === true }));
const pillOf = (tree: ReactNode, label: string) => pillsOf(tree).find((pill) => pill.label === label);
/** The «Prezent» forms on a rendered page — `AdminTable` draws each row twice, the table and the phone cards — for one person. */
const presentFormsOf = (page: string, id: string) => [...page.matchAll(/<form[^>]*data-testid="volunteer-present-form"[\s\S]*?<\/form>/g)].map((match) => match[0]).filter((one) => one.includes(`value="${id}"`));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, returnTo: "/ro/admin/volunteers", ...fields })) data.set(key, value);
  return data;
}
/** A press: it always redirects — the address it came back to, and what the flash says it did. */
async function press(fields: Record<string, string>): Promise<{ to: string; toast: ReturnType<typeof decodeFlash> }> {
  state.redirected.length = 0;
  state.cookies.length = 0;
  await expect(actions.setVolunteerPresentAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  expect(state.redirected).toHaveLength(1);
  return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
}
const presentOf = async (id: string) => (await db.select({ present: eventVolunteers.present }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].present;

describe("§NNN the V number on the «Voluntari» list", () => {
  it("is a chip «Nr. V001» beside the name of a person who has one, in both languages, and none for a person who has not", async () => {
    state.actor = staff.MODERATOR;
    // Ana holds V001; Dan (offered) and Ion (confirmed before any number was drawn) hold none — so every chip drawn is hers (the
    // table draws a row twice, the wide table and the phone's card).
    const page = await listPage({ eventId: raceId });
    const chips = page.match(/data-testid="volunteer-list-number"/g) ?? [];
    expect(chips.length).toBeGreaterThan(0);
    expect(page.match(/>Nr\. V001</g)?.length).toBe(chips.length);
    expect(page).not.toMatch(/Nr\. V00[2-9]/);
    expect(await listPage({ eventId: raceId }, "en")).toContain(">No. V001<");
  });
});

describe("§983 «Prezent» on the «Voluntari» list — the column", () => {
  it("stands right before «Are kit», under the catalogue's heading with its «?», on every row whatever the scope — for the Organizer and an Administrator — and neither sorts nor leaves at a width", async () => {
    for (const [locale, catalogue, role] of [
      ["ro", ro, "MODERATOR"],
      ["en", en, "MODERATOR"],
      ["ro", ro, "ADMIN"],
      ["en", en, "SUPERADMIN"],
    ] as const) {
      state.actor = staff[role];
      for (const query of [{}, { eventId: raceId }, { eventId: "all" }] as Array<Record<string, string>>) {
        const { columns, rows } = tableOf(await listTree(query, locale));
        const keys = columns.map((column) => column.key);
        expect(keys.indexOf("present"), `${role} ${locale} ${JSON.stringify(query)}`).toBe(keys.indexOf("kit") - 1);
        const column = columns.find((candidate) => candidate.key === "present")!;
        expect(column.label).toBe(catalogue.Admin.volunteers.presence.column);
        expect(column.hint).toBe(catalogue.Admin.volunteers.presence.hint);
        expect(column.sortable).toBeFalsy();
        expect(column.hideBelow).toBeUndefined();
        expect(column.omitEmptyOnPhone).toBeFalsy();
        // Every row draws its tick, a cancelled person's too — as «Are kit».
        for (const row of rows) expect(byTestId(column.render(row), "volunteer-present-form"), row.name).toHaveLength(1);
      }
    }
    expect(ro.Admin.volunteers.presence.column).toBe("Prezent");
    expect(en.Admin.volunteers.presence.column).toBe("Present");
  });

  it("is the house's one-press tick: a plain form posting the other state, named with the person, coming back to this page of the list", async () => {
    const { cell } = tableOf(await listTree({ eventId: raceId, sort: "name", dir: "asc", state: "CONFIRMED" }));
    const ticked = elements(cell("present", people.ana));
    const [formOf] = byTestId(cell("present", people.ana), "volunteer-present-form");
    expect(formOf.props.action).toBe(actions.setVolunteerPresentAction);
    expect(fieldOf(ticked, "volunteerId")).toBe(people.ana);
    // Ana is present: the press clears it. The form posts the state it wants, never a toggle.
    expect(fieldOf(ticked, "present")).toBe("0");
    expect(fieldOf(ticked, "uiLocale")).toBe("ro");
    expect(fieldOf(ticked, "eventId")).toBe(raceId);
    const back = new URL(String(fieldOf(ticked, "returnTo")), "https://example.test");
    expect(back.pathname).toBe("/ro/admin/volunteers");
    expect([back.searchParams.get("eventId"), back.searchParams.get("sort"), back.searchParams.get("state")]).toEqual([raceId, "name", "CONFIRMED"]);
    const tick = ticked.find((element) => element.type === TickButton)!;
    expect(tick.props).toMatchObject({ checked: true, "aria-label": "Prezent: Ana Pop", "data-testid": "volunteer-present-tick", children: "Prezent" });

    // Ion is absent: the press ticks him.
    const unticked = elements(cell("present", people.ion));
    expect(fieldOf(unticked, "present")).toBe("1");
    expect(unticked.find((element) => element.type === TickButton)!.props).toMatchObject({ checked: false, "aria-label": "Prezent: Ion Lupu" });
  });

  it("is rendered as a real checkbox with scripts off, in the table and on the phone's card, in Romanian and in English", async () => {
    const page = await listPage({ eventId: raceId });
    const ana = presentFormsOf(page, people.ana);
    expect(ana).toHaveLength(2);
    for (const one of ana) {
      expect(one).toMatch(/name="present" value="0"/);
      expect(one).toMatch(/role="checkbox"/);
      expect(one).toMatch(/aria-checked="true"/);
      expect(one).toContain('aria-label="Prezent: Ana Pop"');
      expect(one).toMatch(/type="submit"/);
    }
    const ion = presentFormsOf(page, people.ion);
    expect(ion).toHaveLength(2);
    for (const one of ion) {
      expect(one).toMatch(/name="present" value="1"/);
      expect(one).toMatch(/aria-checked="false"/);
    }
    const english = await listPage({ eventId: raceId }, "en");
    for (const one of presentFormsOf(english, people.ana)) expect(one).toContain('aria-label="Present: Ana Pop"');
    expect(english).not.toContain('aria-label="Prezent: Ana Pop"');
  });
});

describe("§983 «Prezenți» and «Absenți» on the strip — the figures and the filters", () => {
  it("counts the ticked and the unticked among «Înscris» and «Confirmat» beside «Cu kit» — a cancelled person is neither — each a pill to its people", async () => {
    const tree = await listTree({ eventId: raceId });
    const labels = pillsOf(tree).map((pill) => pill.label);
    // Ana came; Dan and Ion did not; Eva is cancelled. Mara is the other event's.
    expect(labels.indexOf("Prezenți: 1")).toBe(labels.indexOf("Cu kit: 1") + 1);
    expect(labels.indexOf("Absenți: 2")).toBe(labels.indexOf("Prezenți: 1") + 1);
    const present = new URL(pillOf(tree, "Prezenți: 1")!.href, "https://example.test");
    const absent = new URL(pillOf(tree, "Absenți: 2")!.href, "https://example.test");
    expect([present.pathname, present.searchParams.get("present"), present.searchParams.get("eventId")]).toEqual(["/ro/admin/volunteers", "yes", raceId]);
    expect([absent.pathname, absent.searchParams.get("present"), absent.searchParams.get("eventId")]).toEqual(["/ro/admin/volunteers", "no", raceId]);
    expect(pillOf(tree, "Prezenți: 1")!.active).toBe(false);
    expect(pillOf(tree, "Absenți: 2")!.active).toBe(false);

    // Each pill shows exactly the people its figure counts.
    expect(tableOf(await listTree({ eventId: raceId, present: "yes" })).names).toEqual(["Ana Pop"]);
    expect(tableOf(await listTree({ eventId: raceId, present: "no" })).names).toEqual(["Dan Ene", "Ion Lupu"]);
  });

  it("is always said, a nought too, and in English", async () => {
    await db.update(eventVolunteers).set({ present: false }).where(eq(eventVolunteers.eventId, raceId));
    const nobody = await listTree({ eventId: raceId });
    expect(pillOf(nobody, "Prezenți: 0")).toBeDefined();
    expect(pillOf(nobody, "Absenți: 3")).toBeDefined();
    await db.update(eventVolunteers).set({ present: true }).where(eq(eventVolunteers.eventId, raceId));
    expect(pillOf(await listTree({ eventId: raceId }), "Absenți: 0")).toBeDefined();
    const english = pillsOf(await listTree({ eventId: raceId }, "en")).map((pill) => pill.label);
    expect(english).toEqual(expect.arrayContaining(["Present: 3", "Absent: 0"]));
  });

  it("marks the pill in force and clears it on a second press, keeping the scope — and the other pills clear it as they clear the kit's", async () => {
    const filtered = await listTree({ eventId: raceId, present: "no" });
    const absent = pillOf(filtered, "Absenți: 2")!;
    expect(absent.active).toBe(true);
    const cleared = new URL(absent.href, "https://example.test");
    expect([cleared.searchParams.get("present"), cleared.searchParams.get("eventId")]).toEqual([null, raceId]);
    // The other half sets its own value; «Cu kit» and a state's pill each set theirs and clear the presence, as they clear each other.
    expect(new URL(pillOf(filtered, "Prezenți: 1")!.href, "https://example.test").searchParams.get("present")).toBe("yes");
    expect(new URL(pillOf(filtered, "Cu kit: 1")!.href, "https://example.test").searchParams.get("present")).toBeNull();
    // «Voluntari: N» is the filter in force only with no pill-filter at all.
    const total = pillsOf(filtered).find((pill) => pill.label.startsWith("Voluntari:"))!;
    expect(total.active).toBe(false);
    expect(pillsOf(await listTree({ eventId: raceId })).find((pill) => pill.label.startsWith("Voluntari:"))!.active).toBe(true);
  });

  it("filters through the address alone: «yes» and «no», combined with the other filters, and anything else is no filter", async () => {
    expect(tableOf(await listTree({ eventId: raceId, present: "no", state: "CONFIRMED" })).names).toEqual(["Ion Lupu"]);
    expect(tableOf(await listTree({ eventId: raceId, present: "no", kit: "no" })).names).toEqual(["Dan Ene"]);
    expect(tableOf(await listTree({ eventId: raceId, present: "yes", kit: "yes" })).names).toEqual([]);
    // A cancelled person is in neither half, even asked for by the state.
    expect(tableOf(await listTree({ eventId: raceId, present: "yes", state: "CANCELLED" })).names).toEqual([]);
    for (const junk of ["1", "true", "YES", "da", ""]) {
      expect(tableOf(await listTree({ eventId: raceId, present: junk })).names, junk).toEqual(["Ana Pop", "Dan Ene", "Eva Stan", "Ion Lupu"]);
    }
    // Across every event: the other event's present person too.
    expect(tableOf(await listTree({ eventId: "all", present: "yes" })).names).toEqual(["Ana Pop", "Mara Dinu"]);
  });

  it("is a select of the filters' form too, so a search typed after a pill keeps it — and the filters' panel says it is in use", async () => {
    const tree = await listTree({ eventId: raceId, present: "no" });
    const [select] = byTestId(tree, "volunteers-filter-present");
    expect(select.props).toMatchObject({ name: "present", defaultValue: "no", label: "Prezență" });
    const options = elements(select.props.children).filter((element) => element.props.value !== undefined).map((element) => [element.props.value, element.props.children]);
    expect(options).toEqual([
      ["", "Toți, prezenți sau absenți"],
      ["yes", "Prezenți"],
      ["no", "Absenți"],
    ]);
    expect(byTestId(await listTree({ eventId: raceId, present: "junk" }), "volunteers-filter-present")[0].props.defaultValue).toBe("");
    const page = await listPage({ eventId: raceId, present: "no" });
    expect(page).toContain(ro.Admin.volunteers.screen.filtersInUse);
  });
});

describe("§983 the raffle's two files on the «Voluntari» list's toolbar", () => {
  it("are drawn for one event chosen that holds a raffle — the whole file and the present-only one — for the Organizer and an Administrator", async () => {
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, raceId));
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      const tree = await listTree({ eventId: raceId });
      const [whole] = byTestId(tree, "volunteers-raffle-list");
      const [present] = byTestId(tree, "volunteers-raffle-present");
      expect(whole.props.href, role).toBe(`/api/admin/events/${raceId}/raffle?lang=ro`);
      expect(present.props.href, role).toBe(`/api/admin/events/${raceId}/raffle?present=1&lang=ro`);
      expect([whole.props.children, present.props.children], role).toEqual(["Lista pentru tombolă (CSV)", "Lista pentru tombolă — doar prezenții (CSV)"]);
      expect(present.props["aria-label"], role).toBe(ro.Admin.registrations.raffle.presentButtonLabel);
      // Label in name: each accessible name starts with the words the button shows, «(CSV)» included.
      for (const button of [whole, present]) expect(String(button.props["aria-label"]).startsWith(`${button.props.children}:`), role).toBe(true);
    }
    const english = await listTree({ eventId: raceId }, "en");
    expect(byTestId(english, "volunteers-raffle-present")[0].props).toMatchObject({ href: `/api/admin/events/${raceId}/raffle?present=1&lang=en`, children: "Raffle list — present only (CSV)" });
  });

  it("§NNN has «Descarcă pentru random.org» and its present-only twin beside them, with their «?»", async () => {
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, raceId));
    state.actor = staff.MODERATOR;
    const tree = await listTree({ eventId: raceId });
    const [text] = byTestId(tree, "volunteers-raffle-random-org");
    const [present] = byTestId(tree, "volunteers-raffle-random-org-present");
    expect(text.props).toMatchObject({ href: `/api/admin/events/${raceId}/raffle?format=random-org&lang=ro`, children: "Descarcă pentru random.org" });
    expect(present.props).toMatchObject({ href: `/api/admin/events/${raceId}/raffle?format=random-org&present=1&lang=ro`, children: "Descarcă pentru random.org — doar prezenții" });
    for (const button of [text, present]) expect(String(button.props["aria-label"]).startsWith(`${button.props.children}:`)).toBe(true);
    expect(elements(tree).find((element) => element.props.testId === "volunteers-raffle-random-org-help")?.props.text).toBe(ro.Admin.registrations.raffle.randomOrgHelp);
    // None for an event that holds no raffle.
    await db.update(events).set({ hasRaffle: false }).where(eq(events.id, raceId));
    expect(byTestId(await listTree({ eventId: raceId }), "volunteers-raffle-random-org")).toEqual([]);
  });

  it("are drawn neither for an event that holds no raffle nor across every event", async () => {
    for (const query of [{ eventId: raceId }, { eventId: "all" }, { eventId: runId }]) {
      const tree = await listTree(query);
      expect(byTestId(tree, "volunteers-raffle-list"), JSON.stringify(query)).toEqual([]);
      expect(byTestId(tree, "volunteers-raffle-present"), JSON.stringify(query)).toEqual([]);
    }
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, raceId));
    expect(byTestId(await listTree({ eventId: "all" }), "volunteers-raffle-present")).toEqual([]);
  });
});

describe("§983 «Prezent» on the person's page", () => {
  it("is the same one-press tick beside «Are kit» — the list's action, this page as its way back — and the chip «Prezent» when ticked", async () => {
    const tree = await personTree(people.ana);
    const all = elements(tree);
    const [formOf] = byTestId(tree, "volunteer-page-present-form");
    expect(formOf.props.action).toBe(actions.setVolunteerPresentAction);
    const inside = elements(formOf);
    expect(fieldOf(inside, "volunteerId")).toBe(people.ana);
    expect(fieldOf(inside, "present")).toBe("0");
    expect(fieldOf(inside, "returnTo")).toBe(`/ro/admin/volunteers/${people.ana}`);
    expect(inside.find((element) => element.type === TickButton)!.props).toMatchObject({ checked: true, "data-testid": "volunteer-page-present-tick", children: "Prezent" });
    // Beside the kit's, before it, as the list's columns stand.
    const at = (id: string) => all.findIndex((element) => element.props["data-testid"] === id);
    expect(at("volunteer-page-present-form")).toBeGreaterThan(at("volunteer-state"));
    expect(at("volunteer-page-present-form")).toBeLessThan(at("volunteer-page-kit-form"));

    const page = await personPage(people.ana);
    expect(page).toMatch(/<form[^>]*data-testid="volunteer-page-present-form"[\s\S]*?aria-checked="true"[\s\S]*?<\/form>/);
    expect(page.match(/data-testid="volunteer-present"/g)).toHaveLength(1);
    expect(/<div\b[^>]*data-testid="volunteer-present"[\s\S]*?<\/div>/.exec(page)?.[0]).toContain(">Prezent<");
  });

  it("draws the tick empty and no chip for a person absent, and speaks English", async () => {
    const page = await personPage(people.ion);
    expect(page).toMatch(/<form[^>]*data-testid="volunteer-page-present-form"[\s\S]*?name="present" value="1"[\s\S]*?aria-checked="false"[\s\S]*?<\/form>/);
    expect(page).not.toContain('data-testid="volunteer-present"');
    const english = await personPage(people.ana, "en");
    expect(english).toMatch(/data-testid="volunteer-page-present-tick"[^>]*>[\s\S]*?Present</);
    expect(/<div\b[^>]*data-testid="volunteer-present"[\s\S]*?<\/div>/.exec(english)?.[0]).toContain(">Present<");
  });

  it("is a 404 — both pages — for a role that may not work the volunteers", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(listTree(), role).rejects.toThrow("NOT_FOUND");
      await expect(personTree(people.ana), role).rejects.toThrow("NOT_FOUND");
    }
  });
});

describe("§983 setVolunteerPresentAction — the press", () => {
  it("ticks from the list's row and comes back to the SAME list address — filters, sort and page — with the toast", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&present=no&sort=name&dir=asc&page=2`;
    expect(await press({ volunteerId: people.ion, present: "1", returnTo: back })).toEqual({ to: back, toast: { kind: "success", key: "volunteerPresentOn" } });
    expect(await presentOf(people.ion)).toBe(true);
    expect(await press({ volunteerId: people.ion, present: "0", returnTo: back })).toEqual({ to: back, toast: { kind: "success", key: "volunteerPresentOff" } });
    expect(await presentOf(people.ion)).toBe(false);
    // The same state again: nothing to change, said so.
    expect(await press({ volunteerId: people.ion, present: "0", returnTo: back })).toEqual({ to: back, toast: { kind: "info", key: "volunteerUnchanged" } });
    // From the person's page, back to it; a cancelled person's tick is pressed like anybody's.
    const page = `/ro/admin/volunteers/${people.eva}`;
    expect(await press({ volunteerId: people.eva, present: "0", returnTo: page })).toEqual({ to: page, toast: { kind: "success", key: "volunteerPresentOff" } });
    // Anything but «1» is «absent»: a forged value never ticks.
    expect((await press({ volunteerId: people.dan, present: "true" })).toast).toEqual({ kind: "info", key: "volunteerUnchanged" });
    expect(await presentOf(people.dan)).toBe(false);
  });

  it("has words in both catalogues for every toast it flashes", () => {
    for (const catalogue of [ro, en]) {
      const toasts = catalogue.Feedback.toast as Record<string, unknown>;
      for (const code of ["volunteerPresentOn", "volunteerPresentOff", "volunteerUnchanged"]) expect(typeof toasts[code], code).toBe("string");
    }
    expect(ro.Feedback.toast.volunteerPresentOn).toBe("Bifat: prezent.");
    expect(ro.Feedback.toast.volunteerPresentOff).toBe("Debifat: absent.");
    expect(en.Feedback.toast.volunteerPresentOn).not.toBe(en.Feedback.toast.volunteerPresentOff);
  });

  it("asks the capability itself — `canManageVolunteers` — and comes back with the refusal's code for every other role and an ended session, writing nothing (BR-REQ-060-01)", async () => {
    await press({ volunteerId: people.dan, present: "1" });
    expect(state.asked.at(-1)).toBe(canManageVolunteers);
    expect(await presentOf(people.dan)).toBe(true);
    const trailBefore = (await db.select().from(auditLogs)).length;

    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      state.asked.length = 0;
      expect((await press({ volunteerId: people.ion, present: "1" })).to, role).toBe("/ro/admin/volunteers?volunteerError=FORBIDDEN");
      expect(state.asked, role).toEqual([canManageVolunteers]);
    }
    state.actor = undefined;
    expect((await press({ volunteerId: people.ion, present: "1" })).to).toBe("/ro/admin/volunteers?volunteerError=UNAUTHENTICATED");
    expect(await presentOf(people.ion)).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(trailBefore);

    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      await db.update(eventVolunteers).set({ present: false }).where(eq(eventVolunteers.id, people.ion));
      expect((await press({ volunteerId: people.ion, present: "1" })).toast, role).toMatchObject({ key: "volunteerPresentOn" });
    }
  });

  it("answers NOT_FOUND for another event's person and an id that is none, and follows a forged `returnTo` nowhere but the event's own card", async () => {
    expect((await press({ volunteerId: people.mara, present: "0" })).to).toBe("/ro/admin/volunteers?volunteerError=NOT_FOUND");
    expect(await presentOf(people.mara)).toBe(true);
    expect((await press({ volunteerId: "nobody", present: "1" })).to).toBe("/ro/admin/volunteers?volunteerError=NOT_FOUND");
    const card = `/ro/admin/events/${raceId}#box-volunteers`;
    for (const forged of ["https://example.test/x", "//example.test/x", "/ro/admin/registrations", "javascript:alert(1)"]) {
      expect((await press({ volunteerId: people.ion, present: "1", returnTo: forged })).to, forged).toBe(card);
    }
    // A refusal's code never rides on a save.
    expect((await press({ volunteerId: people.ion, present: "0", returnTo: `/ro/admin/volunteers?eventId=${raceId}&volunteerError=FORBIDDEN` })).to).toBe(`/ro/admin/volunteers?eventId=${raceId}`);
  });

  it("emails nobody, whatever it presses", async () => {
    await press({ volunteerId: people.ana, present: "0" });
    await press({ volunteerId: people.ion, present: "1" });
    await press({ volunteerId: people.dan, present: "1" });
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });
});

describe("§983 «Prezent» among what is kept about a person (art. 15 GDPR)", () => {
  it("is in «Toate datele unei persoane» — the offer's own row, on the page and in the file", async () => {
    const before = await viewPersonData(db, staff.ADMIN!, "ion.lupu@example.test", NOW);
    expect(before.volunteerOffers.map((offer) => offer.present)).toEqual([false]);
    await press({ volunteerId: people.ion, present: "1" });
    const after = await viewPersonData(db, staff.ADMIN!, "ion.lupu@example.test", NOW);
    expect(after.volunteerOffers.map((offer) => offer.present)).toEqual([true]);
    const file = await exportPersonData(db, staff.ADMIN!, "ion.lupu@example.test", NOW);
    expect(JSON.parse(JSON.stringify(file)).volunteerOffers[0].present).toBe(true);
    // Absent is a value of the row too: in the file as `false`.
    expect(JSON.parse(JSON.stringify(await exportPersonData(db, staff.ADMIN!, "dan.ene@example.test", NOW))).volunteerOffers[0].present).toBe(false);

    // The line the page draws for the offer, in both languages; nothing for an offer whose person was not there.
    state.locale = "ro";
    expect(await html(await VolunteerAnswers({ offer: after.volunteerOffers[0] }))).toContain(" · Prezent");
    state.locale = "en";
    expect(await html(await VolunteerAnswers({ offer: after.volunteerOffers[0] }))).toContain(" · Present");
    expect(await html(await VolunteerAnswers({ offer: before.volunteerOffers[0] }))).not.toMatch(/Present|Prezent/);
  });
});
