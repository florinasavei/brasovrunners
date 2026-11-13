import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerNotes, VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Note interne» for volunteers — the screens and the presses, read from a real database (BR-REQ-050-02, BR-REQ-060-01):
 *
 * - the volunteer's page draws the registrations' card FIRST, right after its heading block and before the person's block, open
 *   exactly when the volunteer has a live note (closed on «nicio notă»), after its own save or delete and for `#note-interne`;
 *   «Șterge» is drawn on the notes the reader may delete, and a carried note with no author reads «autor necunoscut»;
 * - the «Voluntari» list marks a row that has notes from ONE grouped count, and every row carries «Adaugă o notă» (the row's
 *   control, `RowNoteDialog`) in both copies `AdminTable` draws; the event card's rows carry the marker too;
 * - the presses ask the role, then the service: a refusal comes back as the form's own state with the words still in the box,
 *   a save returns to the volunteer's page with the card open, or to the SAME list address through the list's validated return.
 *
 * The pages are Server Components, so they are called and their element trees walked. The made-up people here are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", redirected: [] as string[] }));

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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
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
// The door as the real one answers: the predicate is asked of the actor, and a refusal is FORBIDDEN.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: NotesCard } = await import("@/modules/registrations/ui/NotesCard");
const { default: NotesMark } = await import("@/modules/registrations/ui/NotesMark");
const { default: VolunteerPerson } = await import("@/modules/volunteers/ui/VolunteerPerson");
const { default: Panel } = await import("@/shared/ui/Panel");
const { default: RowNoteDialog } = await import("@/shared/ui/RowNoteDialog");
const { default: TipSpan } = await import("@/shared/ui/TipSpan");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { opensByItself } = await import("@/shared/ui/fold");
const { addVolunteerNote, deleteVolunteerNote } = await import("@/modules/volunteers/volunteer-notes");
const { findVolunteerForAdmin } = await import("@/modules/volunteers/admin-list");
const { volunteerPersonContextOf } = await import("@/modules/volunteers/person-context");
const noteActions = await import("@/app/[locale]/admin/volunteers/[id]/note-actions");

type Props = Record<string, unknown> & { children?: ReactNode };

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

const NOW = new Date("2026-11-11T10:00:00.000Z");
let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let waterId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

let serial = 0;
async function staff(role: StaffRole, name = `Coleg ${role} ${++serial}`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${name.toLowerCase().replaceAll(" ", ".")}@dev.test`, displayName: name, role }).returning();
  return user;
}

async function volunteer(name: string): Promise<string> {
  serial += 1;
  const email = `voluntar${serial}@example.org`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: raceId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC", roleId: waterId, createdAt: NOW, updatedAt: NOW })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleChoices).values({ volunteerId: row.id, roleId: waterId });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: waterId });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  state.actor = await staff("MODERATOR", "Ioana Organizatoare");
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning({ id: events.id });
  raceId = race.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 }).returning({ id: eventVolunteerRoles.id });
  waterId = water.id;
});

const personPage = (id: string, searchParams: Record<string, string> = {}) =>
  AdminVolunteerPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve(searchParams) } as never);
const listPage = (searchParams: Record<string, string> = {}) => AdminVolunteersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);

/** The card as the page hands it over, and what it draws — `NotesCard` is an async Server Component, so it is called. */
async function cardOf(tree: ReactNode) {
  const [card] = elements(tree).filter((element) => element.type === NotesCard);
  return card ? { props: card.props as Parameters<typeof NotesCard>[0], drawn: await NotesCard(card.props as Parameters<typeof NotesCard>[0]) } : null;
}
const panelOf = (drawn: ReactNode) => elements(drawn).find((element) => element.type === Panel)!;

/** The list's table, and its name column drawn for one row — as the table and as the phone card alike (`AdminTable` draws it twice). */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Array<{ key: string; render: (row: unknown) => ReactNode }>;
  const rows = table.props.rows as Array<{ id: string }>;
  return { table, nameCell: (id: string) => columns.find((column) => column.key === "name")!.render(rows.find((row) => row.id === id)) };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
async function redirectedBy(press: Promise<unknown>): Promise<string> {
  await expect(press).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected.at(-1)!;
}

describe("«Note interne» on the volunteer's page", () => {
  it("stands FIRST after the heading block — the back link, the alert, the name, the event's line — and before the person's block", async () => {
    const id = await volunteer("Ana Pop");
    const all = elements(await personPage(id));
    const card = all.findIndex((element) => element.type === NotesCard);
    const block = all.findIndex((element) => element.type === VolunteerPerson);
    expect(card).toBeGreaterThan(0);
    expect(card).toBeLessThan(block);
    // Every card of the page (a `Panel`, the «Emailuri» fold) and the person's block come after it; the heading block before.
    expect(all.slice(0, card).filter((element) => element.type === Panel || element.type === VolunteerPerson)).toEqual([]);
    expect(all.findIndex((element) => element.props["data-testid"] === "volunteer-event-line")).toBeLessThan(card);
    expect(all.findIndex((element) => element.props.id === "admin-alert")).toBeLessThan(card);
    // Its props: the volunteer's hidden field, the table's limit, the page's own presses.
    const { props } = (await cardOf(await personPage(id)))!;
    expect(props).toMatchObject({ owner: { field: "volunteerId", id }, max: VOLUNTEER_NOTE_MAX, authorGone: "autor necunoscut" });
    expect(props.addAction).toBe(noteActions.addVolunteerNoteAction);
    expect(props.deleteAction).toBe(noteActions.deleteVolunteerNoteAction);
  });

  it("is open exactly when the volunteer has a live note — closed on «nicio notă» — after its own save or delete, and for `#note-interne`", async () => {
    const id = await volunteer("Ana Pop");
    const organizer = state.actor as StaffUser;
    const fold = async (search: Record<string, string> = {}) => panelOf((await cardOf(await personPage(id, search)))!.drawn).props;
    expect(await fold()).toMatchObject({ id: "note-interne", glyph: "internalNotes", collapsible: true, title: "Note interne", aside: "nicio notă", openWhen: { saved: false, holds: false } });
    expect(opensByItself((await fold()).openWhen as never)).toBe(false);
    const { id: noteId } = await addVolunteerNote(db, organizer, id, "vine doar dimineața", NOW);
    expect(await fold()).toMatchObject({ aside: "1 notă", openWhen: { saved: false, holds: true } });
    expect(opensByItself((await fold()).openWhen as never)).toBe(true);
    await deleteVolunteerNote(db, organizer, noteId, NOW);
    expect(await fold({ saved: "noteDeleted" })).toMatchObject({ aside: "nicio notă", openWhen: { saved: true, holds: false } });
    expect((await fold({ saved: "noteAdded" })).openWhen).toMatchObject({ saved: true });
    expect((await fold({ saved: "volunteerSaved" })).openWhen).toMatchObject({ saved: false });
  });

  it("lists the notes newest first with the author and when, «autor necunoscut» for a carried note with nobody to name, «Șterge» where the reader may", async () => {
    const id = await volunteer("Ana Pop");
    const organizer = state.actor as StaffUser;
    const colleague = await staff("MODERATOR", "Mihai Organizator");
    await db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "linia veche", createdAt: new Date("2026-10-01T10:00:00.000Z") });
    await addVolunteerNote(db, colleague, id, "a colegului", new Date("2026-11-01T10:00:00.000Z"));
    await addVolunteerNote(db, organizer, id, "a mea", NOW);

    const { drawn } = (await cardOf(await personPage(id)))!;
    expect(byTestId(drawn, "note-body").map((element) => element.props.children)).toEqual(["a mea", "a colegului", "linia veche"]);
    const by = byTestId(drawn, "note-by").map((element) => String(element.props.children));
    expect(by[0]).toContain("Ioana Organizatoare");
    expect(by[1]).toContain("Mihai Organizator");
    expect(by[2]).toContain("autor necunoscut");
    expect(by.join(" ")).not.toContain("cont șters");
    // The Organizer deletes their own note only; the question first, destructive.
    const deletes = byTestId(drawn, "note-delete-form");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].props.action).toBe(noteActions.deleteVolunteerNoteAction);
    expect((deletes[0].props.confirm as { destructive: boolean; title: string }).destructive).toBe(true);
    expect(elements(deletes[0]).find((element) => element.props.name === "volunteerId")?.props.value).toBe(id);
    // The Administrator, every one.
    state.actor = await staff("ADMIN");
    expect(byTestId((await cardOf(await personPage(id)))!.drawn, "note-delete-form")).toHaveLength(3);

    // The add form: the box with the volunteers' limit and the page's own press.
    const [add] = byTestId(drawn, "note-add-form");
    expect(add.type).toBe(ActionForm);
    expect(add.props.action).toBe(noteActions.addVolunteerNoteAction);
    const box = elements(add).find((element) => element.props.name === "body")!;
    expect(box.props).toMatchObject({ multiline: true, required: true, helperText: `Cel mult ${VOLUNTEER_NOTE_MAX} de caractere.` });
    expect((box.props.slotProps as { htmlInput: { maxLength: number } }).htmlInput.maxLength).toBe(VOLUNTEER_NOTE_MAX);
  });

  it("draws no «Notă: …» in the person's block, and «Modifică» carries no note box — only «Adaugă un voluntar de mână» has one", async () => {
    const id = await volunteer("Ana Pop");
    await db.update(eventVolunteers).set({ note: "Linia veche" }).where(eq(eventVolunteers.id, id));
    const person = (await findVolunteerForAdmin(db, id, "ro"))!;
    const context = await volunteerPersonContextOf(db, person.event, "ro", NOW, `/ro/admin/volunteers/${id}`);
    const block = await VolunteerPerson({ person, context, as: "section" });
    const drawn = JSON.stringify(elements(block).map((element) => element.props.children).filter((child) => typeof child === "string"));
    expect(drawn).not.toContain("Linia veche");
    expect(drawn).not.toMatch(/Notă:/);
    const { VolunteerPersonFields } = await import("@/modules/volunteers/ui/VolunteerPerson");
    const edit = await VolunteerPersonFields({ person, context });
    expect(elements(edit).filter((element) => element.props.name === "note")).toEqual([]);
    const add = await VolunteerPersonFields({ person: null, context });
    const [box] = elements(add).filter((element) => element.props.name === "note");
    expect(box.props).toMatchObject({ label: "Nota ta (doar organizatorii)", multiline: true });
    expect((box.props.slotProps as { htmlInput: { maxLength: number } }).htmlInput.maxLength).toBe(VOLUNTEER_NOTE_MAX);
  });

  it("is a 404 for every role that may not manage volunteers: the card needs the page, and the service refuses again", async () => {
    const id = await volunteer("Ana Pop");
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      expect(canManageVolunteers(role)).toBe(false);
      state.actor = await staff(role);
      await expect(personPage(id), role).rejects.toThrow("NOT_FOUND");
    }
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      expect(await cardOf(await personPage(id)), role).not.toBeNull();
    }
  });
});

describe("the «Voluntari» list — the marker and «Adaugă o notă»", () => {
  it("marks only the rows that have notes, from ONE grouped read — no query per row", async () => {
    const organizer = state.actor as StaffUser;
    const ana = await volunteer("Ana Pop");
    const dan = await volunteer("Dan Ionescu");
    for (const name of ["Ion", "Maria", "Radu"]) await addVolunteerNote(db, organizer, await volunteer(name), "o notă", NOW);
    await addVolunteerNote(db, organizer, ana, "una", NOW);
    await addVolunteerNote(db, organizer, ana, "două", NOW);

    let reads = 0;
    const real = db.select.bind(db);
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      const query = (real as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
      const from = query.from.bind(query);
      query.from = ((table: unknown) => {
        if (table === eventVolunteerNotes) reads += 1;
        return from(table);
      }) as never;
      return query as never;
    }) as never);
    let tree: ReactNode;
    try {
      tree = await listPage({ eventId: raceId });
    } finally {
      spy.mockRestore();
    }
    expect(reads).toBe(1);

    const { nameCell } = tableOf(tree);
    const [marker] = elements(nameCell(ana)).filter((element) => element.type === NotesMark);
    expect(marker.props).toMatchObject({ label: "2 note", ariaLabel: "Note interne la Ana Pop: 2 note", href: `/ro/admin/volunteers/${ana}#note-interne` });
    expect(elements(nameCell(dan)).filter((element) => element.type === NotesMark)).toHaveLength(0);
  });

  it("says the notes' own words in the marker's tooltip — newest first, each with its day and hour, the older ones counted, no author (§NNN)", async () => {
    const organizer = state.actor as StaffUser;
    const ana = await volunteer("Ana Pop");
    const dan = await volunteer("Dan Ionescu");
    for (const [minute, words] of [["00", "prima"], ["01", "a doua"], ["02", "a treia"], ["03", "vine doar dimineața\nare mașină"]] as const) {
      await addVolunteerNote(db, organizer, ana, words, new Date(`2026-11-11T10:${minute}:00.000Z`));
    }
    // A deleted note is in no tooltip, and not in the count.
    const gone = await addVolunteerNote(db, organizer, ana, "ștearsă", new Date("2026-11-11T10:04:00.000Z"));
    await deleteVolunteerNote(db, organizer, gone.id, new Date("2026-11-11T10:05:00.000Z"));

    const { nameCell } = tableOf(await listPage({ eventId: raceId }));
    const tips = elements(nameCell(ana)).filter((element) => element.type === TipSpan);
    expect(tips).toHaveLength(1);
    // The marker stays the link to the person's card; the tooltip is around it.
    const marker = elements(tips[0].props.children as ReactNode).filter((element) => element.type === NotesMark);
    expect(marker).toHaveLength(1);
    expect(marker[0].props).toMatchObject({ label: "4 note", href: `/ro/admin/volunteers/${ana}#note-interne` });
    const said = (tips[0].props.title as string).split("\n\n");
    // The three newest, then how many are older — in the count's own words.
    expect(said).toHaveLength(4);
    expect(said[0]).toBe("Mie., 11 nov. 2026, 12:03: vine doar dimineața\nare mașină");
    expect(said[1]).toMatch(/12:02: a treia$/);
    expect(said[2]).toMatch(/12:01: a doua$/);
    expect(said[3]).toBe("… și încă 1 notă");
    expect(tips[0].props.title).not.toContain("ștearsă");
    // Nobody's name: who wrote a note is the card's to say.
    expect(tips[0].props.title).not.toContain(organizer.displayName);
    // A row without notes has no marker and no tooltip.
    expect(elements(nameCell(dan)).filter((element) => element.type === TipSpan || element.type === NotesMark)).toHaveLength(0);
  });

  it("carries «Adaugă o notă» on every row — the words, the action, the hidden fields with the list's own return, the fallback link — strings only", async () => {
    const ana = await volunteer("Ana Pop");
    const tree = await listPage({ eventId: raceId, sort: "name", dir: "asc" });
    const { table, nameCell } = tableOf(tree);
    const [control] = elements(nameCell(ana)).filter((element) => element.type === RowNoteDialog);
    const props = control.props as Parameters<typeof RowNoteDialog>[0];
    expect(props.action).toBe(noteActions.addVolunteerNoteFromListAction);
    expect(props).toMatchObject({
      label: "Adaugă o notă",
      ariaLabel: "Adaugă o notă la Ana Pop",
      title: "Notă internă pentru Ana Pop",
      help: "Doar organizatorii și administratorii văd notele. Nu scrie date medicale sau alte date sensibile.",
      boxName: "body",
      limitText: `Cel mult ${VOLUNTEER_NOTE_MAX} de caractere.`,
      max: VOLUNTEER_NOTE_MAX,
      saveLabel: "Salvează nota",
      fallbackHref: `/ro/admin/volunteers/${ana}#note-interne`,
      settledKey: "0",
    });
    expect(props.fields).toMatchObject({ uiLocale: "ro", eventId: raceId, volunteerId: ana });
    // The way back is this very page of the list — the filters, the sort — and the path a `returnTo` of this screen must be.
    expect(props.fields.returnTo).toMatch(/^\/ro\/admin\/volunteers\?/);
    const back = new URL(props.fields.returnTo, "https://example.test");
    expect([back.searchParams.get("eventId"), back.searchParams.get("sort"), back.searchParams.get("dir")]).toEqual([raceId, "name", "asc"]);
    for (const [name, value] of Object.entries(props)) {
      if (name === "action") continue;
      expect(isValidElement(value), name).toBe(false);
      expect(typeof value === "function", name).toBe(false);
    }
    expect(Object.keys(props.messages.errors).sort()).toEqual(["FORBIDDEN", "NOTE_EMPTY", "NOTE_TOO_LONG", "NOT_FOUND"]);
    // The name column is drawn in the table and in the phone cards alike: one render, used by both copies.
    expect((table.props.columns as Array<{ key: string; primary?: boolean }>).find((column) => column.key === "name")?.primary).toBe(true);
  });

  it("puts the marker on the event card's rows too, from the card's one grouped read — the count, the words in its tooltip (§NNN), a link to the person's page", async () => {
    const ana = await volunteer("Ana Pop");
    await addVolunteerNote(db, state.actor as StaffUser, ana, "una", NOW);
    const person = (await findVolunteerForAdmin(db, ana, "ro"))!;
    const context = await volunteerPersonContextOf(db, person.event, "ro", NOW, "");
    const rowNotes = new Map([[ana, [{ createdAt: NOW, body: "una" }]]]);
    const row = await VolunteerPerson({ person, context: { ...context, returnTo: undefined, rowNotes } });
    const [tip] = elements(row).filter((element) => element.type === TipSpan);
    expect(tip.props.title).toBe("Mie., 11 nov. 2026, 12:00: una");
    const [marker] = elements(tip.props.children as ReactNode).filter((element) => element.type === NotesMark);
    expect(marker.props).toMatchObject({ label: "1 notă", href: `/ro/admin/volunteers/${ana}#note-interne` });
    // Four notes: the three newest in the tooltip, the fourth counted; the marker counts them all.
    const many = new Map([[ana, ["patru", "trei", "două", "una"].map((body, index) => ({ createdAt: new Date(NOW.getTime() - index * 60_000), body }))]]);
    const crowded = await VolunteerPerson({ person, context: { ...context, returnTo: undefined, rowNotes: many } });
    const [crowdedTip] = elements(crowded).filter((element) => element.type === TipSpan);
    expect((crowdedTip.props.title as string).split("\n\n")).toEqual([
      "Mie., 11 nov. 2026, 12:00: patru",
      "Mie., 11 nov. 2026, 11:59: trei",
      "Mie., 11 nov. 2026, 11:58: două",
      "… și încă 1 notă",
    ]);
    expect(elements(crowdedTip.props.children as ReactNode).find((element) => element.type === NotesMark)?.props.label).toBe("4 note");
    // Without the notes (the person's own page, which draws the card), no marker and no tooltip.
    expect(elements(await VolunteerPerson({ person, context, as: "section" })).filter((element) => element.type === NotesMark || element.type === TipSpan)).toEqual([]);
  });
});

describe("the presses — the role, then the service", () => {
  it("«Salvează nota» on the page saves, records who and when, and comes back to the card, open; nothing typed in the address", async () => {
    const id = await volunteer("Ana Pop");
    const to = await redirectedBy(noteActions.addVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, body: "  are mașină  " })));
    expect(to).toBe(`/ro/admin/volunteers/${id}?saved=noteAdded#note-interne`);
    expect(await db.select().from(eventVolunteerNotes)).toMatchObject([{ volunteerId: id, body: "are mașină", authorStaffUserId: (state.actor as StaffUser).id }]);
    const [trail] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_added"));
    expect(trail).toMatchObject({ entityType: "event", entityId: raceId, metadataJson: { volunteerId: id } });
    expect(to).not.toContain("mașină");
  });

  it("answers an empty or too long note with the form's own state, the words still in the box", async () => {
    const id = await volunteer("Ana Pop");
    expect(await noteActions.addVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, body: "   " }))).toMatchObject({ error: "NOTE_EMPTY", fields: ["body"] });
    const long = "x".repeat(VOLUNTEER_NOTE_MAX + 1);
    expect(await noteActions.addVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, body: long }))).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["body"], values: { body: [long] } });
    expect(await noteActions.addVolunteerNoteFromListAction(null, form({ uiLocale: "ro", eventId: raceId, volunteerId: id, body: long, returnTo: "/ro/admin/volunteers" }))).toMatchObject({
      error: "NOTE_TOO_LONG",
      values: { body: [long] },
    });
    expect(await db.select().from(eventVolunteerNotes)).toHaveLength(0);
    expect(state.redirected).toEqual([]);
  });

  it("refuses every role that may not manage volunteers, at the door and again in the service, writing nothing", async () => {
    const id = await volunteer("Ana Pop");
    const { id: noteId } = await addVolunteerNote(db, state.actor as StaffUser, id, "a mea", NOW);
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      state.actor = await staff(role);
      expect(await noteActions.addVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, body: "intrus" })), role).toMatchObject({ error: "FORBIDDEN" });
      expect(await noteActions.addVolunteerNoteFromListAction(null, form({ uiLocale: "ro", volunteerId: id, body: "intrus", returnTo: "/ro/admin/volunteers" })), role).toMatchObject({ error: "FORBIDDEN" });
      expect(await noteActions.deleteVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, noteId })), role).toMatchObject({ error: "FORBIDDEN" });
    }
    expect((await db.select().from(eventVolunteerNotes)).map((note) => note.body)).toEqual(["a mea"]);
  });

  it("«Șterge» deletes the reader's own note and returns to the card; refuses a colleague's to an Organizer, keeping it", async () => {
    const id = await volunteer("Ana Pop");
    const author = state.actor as StaffUser;
    const { id: own } = await addVolunteerNote(db, author, id, "a mea", NOW);
    const { id: theirs } = await addVolunteerNote(db, await staff("MODERATOR", "Mihai Organizator"), id, "a colegului", NOW);
    expect(await noteActions.deleteVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, noteId: theirs }))).toMatchObject({ error: "FORBIDDEN" });
    expect(await redirectedBy(noteActions.deleteVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, noteId: own })))).toBe(`/ro/admin/volunteers/${id}?saved=noteDeleted#note-interne`);
    expect((await db.select().from(eventVolunteerNotes).where(eq(eventVolunteerNotes.id, own)))[0]).toMatchObject({ body: "" });
    expect(await noteActions.deleteVolunteerNoteAction(null, form({ uiLocale: "ro", volunteerId: id, noteId: own }))).toMatchObject({ error: "NOT_FOUND" });
  });

  it("«Salvează nota» from the list comes back to the SAME list address; a forged `returnTo` goes nowhere but the event's card", async () => {
    const id = await volunteer("Ana Pop");
    const back = `/ro/admin/volunteers?eventId=${raceId}&sort=name&dir=asc&page=2`;
    expect(await redirectedBy(noteActions.addVolunteerNoteFromListAction(null, form({ uiLocale: "ro", eventId: raceId, volunteerId: id, body: "din listă", returnTo: back })))).toBe(back);
    expect(await redirectedBy(noteActions.addVolunteerNoteFromListAction(null, form({ uiLocale: "ro", eventId: raceId, volunteerId: id, body: "încă una", returnTo: "https://example.test/x" })))).toBe(
      `/ro/admin/events/${raceId}#box-volunteers`,
    );
    expect((await db.select().from(eventVolunteerNotes)).map((note) => note.body).sort()).toEqual(["din listă", "încă una"]);
  });
});
