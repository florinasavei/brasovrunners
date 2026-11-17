import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerNotes, VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §964, BR-REQ-050-02, BR-REQ-060-01 — the volunteers' internal notes on the organizers' screens after the owner's two asks of
 * 2026-11-17, on the «Voluntari» list, four days before the race: «la nota internă nu mai afișa și data, și lasă-mă să editez și
 * nota internă». Read from a real database:
 *
 * - the list's column «Note interne» and its marker's tooltip say the newest notes' words alone — no day, no hour, no author —
 *   the older ones counted, in Romanian and in English;
 * - under the words, «Modifică nota» for the row's newest note — drawn for that note's author and for an Administrator, never for
 *   an Organizer on a colleague's newest note — opens the row's dialog on the note's words; only strings cross to it, and with no
 *   script it is a link to the person's notes;
 * - `editVolunteerNoteFromListAction` asks the capability itself, saves through the service, and comes back to the SAME list
 *   address with the toast (changed, or the house's «nothing to change»); a refusal is the form's own state with the words kept;
 * - the person's page has «Modifică» beside «Șterge» on each note the reader may change — a fold holding the note's words — whose
 *   press comes back to the card, open; the day, the hour and the author stay on that page. The registration's card has none.
 *
 * What the verb writes and leaves alone is `volunteer-note-edit.test.ts`. The made-up people here are nobody.
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
const noteActions = await import("@/app/[locale]/admin/volunteers/[id]/note-actions");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: NotesCard } = await import("@/modules/registrations/ui/NotesCard");
const { default: RowNoteDialog } = await import("@/shared/ui/RowNoteDialog");
const { default: TipSpan } = await import("@/shared/ui/TipSpan");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { addVolunteerNote, deleteVolunteerNote } = await import("@/modules/volunteers/volunteer-notes");

type Props = Record<string, unknown> & { children?: ReactNode };
type DialogProps = Parameters<typeof RowNoteDialog>[0];
type Column = { key: string; omitEmptyOnPhone?: boolean; render: (row: unknown) => ReactNode };

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

const NOW = new Date("2026-11-17T08:30:00.000Z");
const at = (minute: number) => new Date(NOW.getTime() + minute * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let colleague: StaffUser;
let raceId: string;
const people = { ana: "", dan: "", eva: "" };
const notes = { anaNewest: "", danNewest: "", danOlder: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function volunteer(name: string): Promise<string> {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: raceId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "+40700000001", source: "PUBLIC", state: "CONFIRMED", createdAt: NOW, updatedAt: NOW })
    .returning({ id: eventVolunteers.id });
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
  [colleague] = await db.insert(staffUsers).values({ email: "alt.organizator@example.test", displayName: "Mihai Organizator", role: "MODERATOR" }).returning();
  state.actor = staff.MODERATOR;
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning({ id: events.id });
  raceId = race.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  people.ana = await volunteer("Ana Pop");
  people.dan = await volunteer("Dan Ene");
  people.eva = await volunteer("Eva Stan");
  // Ana: four notes, all the Organizer's — the newest «Fotograf», as the owner's own list read «Mar., 17 nov. 2026, 10:30: Fotograf».
  for (const [minute, words] of [[0, "sotia lui Stefan"], [1, "are mașină"], [2, "vine doar dimineața\nși pleacă la 12"]] as const) {
    await addVolunteerNote(db, staff.MODERATOR!, people.ana, words, at(minute));
  }
  notes.anaNewest = (await addVolunteerNote(db, staff.MODERATOR!, people.ana, "Fotograf", at(3))).id;
  // Dan: the Organizer's older note, a colleague's newest. Eva: none.
  notes.danOlder = (await addVolunteerNote(db, staff.MODERATOR!, people.dan, "a organizatorului", at(0))).id;
  notes.danNewest = (await addVolunteerNote(db, colleague, people.dan, "a colegului", at(1))).id;
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
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId, ...query }) });
};
const personTree = async (id: string, query: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteerPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve(query) } as never);
};

/** The list's table as the page hands it over: one column drawn for one row. */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { columns, cell };
}
const dialogsOf = (cell: ReactNode) => elements(cell).filter((element) => element.type === RowNoteDialog).map((element) => element.props as unknown as DialogProps);
const editDialogOf = (cell: ReactNode) => dialogsOf(cell).filter((props) => props.testId === "note-edit-open");

/** The card as the person's page hands it over, and what it draws — `NotesCard` is an async Server Component, so it is called. */
async function cardOf(tree: ReactNode) {
  const [card] = elements(tree).filter((element) => element.type === NotesCard);
  const props = card.props as unknown as Parameters<typeof NotesCard>[0];
  return { props, drawn: await NotesCard(props) };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, returnTo: "/ro/admin/volunteers", ...fields })) data.set(key, value);
  return data;
}
/** A press that saves: it redirects, and the flash says what it did. */
async function saved(press: (data: FormData) => Promise<unknown>, fields: Record<string, string>): Promise<{ to: string; toast: ReturnType<typeof decodeFlash> }> {
  state.redirected.length = 0;
  state.cookies.length = 0;
  await expect(press(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  expect(state.redirected).toHaveLength(1);
  return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
}
const fromList = (data: FormData) => actions.editVolunteerNoteFromListAction(null, data);
const fromPage = (data: FormData) => noteActions.editVolunteerNoteAction(null, data);
const bodyOf = async (noteId: string) => (await db.select({ body: eventVolunteerNotes.body }).from(eventVolunteerNotes).where(eq(eventVolunteerNotes.id, noteId)))[0].body;
const edits = async () => db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_edited"));

describe("§964 the «Voluntari» list says the notes' words without their day", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: the column and the marker's tooltip are the newest notes' words alone — no day, no hour, no author — the older ones counted`, async () => {
      const tree = await listTree({}, locale);
      const { columns, cell } = tableOf(tree);
      const said = String(byTestId(cell("notes", people.ana), "volunteer-notes")[0].props.children);
      const more = locale === "ro" ? "… și încă 1 notă" : "… and 1 note more";
      expect(said.split("\n\n")).toEqual(["Fotograf", "vine doar dimineața\nși pleacă la 12", "are mașină", more]);
      // The marker's tooltip, beside the name, says exactly the same.
      const [tip] = elements(cell("name", people.ana)).filter((element) => element.type === TipSpan);
      expect(tip.props.title).toBe(said);
      // No day, no hour — not the moment the person's page prints for each note, not any clock — and nobody's name.
      for (const minute of [0, 1, 2, 3]) {
        const moment = formatDay(at(minute), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
        expect(said).not.toContain(moment);
        expect(said).not.toContain(moment.split(", ").at(-1)!);
      }
      expect(said).not.toMatch(/\d{1,2}:\d{2}|nov\.?\s|2026/);
      expect(said).not.toContain("Coleg MODERATOR");
      // The column keeps its place and its phone rule: a row without notes has an empty cell and no line on a phone's card.
      expect(columns.find((column) => column.key === "notes")?.omitEmptyOnPhone).toBe(true);
      expect(cell("notes", people.eva)).toBeNull();

      // As the page is drawn: the words in both copies of the row (the table and the phone card), and no clock among them.
      const page = await html(tree);
      const cells = [...page.matchAll(/data-testid="volunteer-notes"[^>]*>([^<]*)</g)].map((match) => match[1]);
      expect(cells.filter((text) => text.startsWith("Fotograf"))).toHaveLength(2);
      for (const text of cells) expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    });
  }
});

describe("§964 «Modifică nota» in the row's «Note interne» cell", () => {
  it("is drawn under the words for the newest note's author, opened on that note's words — strings only, a link to the person's notes without a script", async () => {
    const tree = await listTree({ sort: "name", dir: "asc" });
    const { cell } = tableOf(tree);
    const [dialog, ...others] = editDialogOf(cell("notes", people.ana));
    expect(others).toEqual([]);
    expect(dialog.action).toBe(actions.editVolunteerNoteFromListAction);
    expect(dialog).toMatchObject({
      label: "Modifică nota",
      ariaLabel: "Modifică nota despre Ana Pop",
      title: "Modifică nota despre Ana Pop",
      help: ro.Admin.registrations.notes.help,
      boxName: "body",
      boxLabel: "Nota",
      limitText: `Cel mult ${VOLUNTEER_NOTE_MAX} de caractere.`,
      max: VOLUNTEER_NOTE_MAX,
      saveLabel: "Salvează nota",
      defaultValue: "Fotograf",
      icon: "edit",
      testId: "note-edit-open",
      dialogTestId: "note-edit-dialog",
      fallbackHref: `/ro/admin/volunteers/${people.ana}#note-interne`,
    });
    expect(dialog.optional).toBeFalsy();
    expect(dialog.fields).toMatchObject({ uiLocale: "ro", eventId: raceId, noteId: notes.anaNewest });
    // The way back is this very page of the list — its filters and its sort.
    const back = new URL(dialog.fields.returnTo, "https://example.test");
    expect(back.pathname).toBe("/ro/admin/volunteers");
    expect([back.searchParams.get("eventId"), back.searchParams.get("sort"), back.searchParams.get("dir")]).toEqual([raceId, "name", "asc"]);
    // The answers the press can meet, each a sentence — a session that ended among them.
    expect(Object.keys(dialog.messages.errors).sort()).toEqual(["FORBIDDEN", "NOTE_EMPTY", "NOTE_TOO_LONG", "NOT_FOUND", "UNAUTHENTICATED"]);
    for (const [name, value] of Object.entries(dialog)) {
      if (name === "action") continue;
      expect(isValidElement(value), name).toBe(false);
      expect(typeof value === "function", name).toBe(false);
    }
    // Under the words, in the same cell; the row's «Adaugă o notă» stays beside the name.
    const all = elements(cell("notes", people.ana));
    expect(all.findIndex((element) => element.props["data-testid"] === "volunteer-notes")).toBeLessThan(all.findIndex((element) => element.type === RowNoteDialog));
    expect(dialogsOf(cell("name", people.ana)).map((props) => props.action)).toEqual([noteActions.addVolunteerNoteFromListAction]);

    // As the page is drawn, with no script: a link to the person's notes in both copies of the row, its name naming the person.
    const page = await html(tree);
    const presses = [...page.matchAll(/<a\b[^>]*data-testid="note-edit-open"[^>]*>/g)].map((match) => match[0]).filter((press) => press.includes(people.ana));
    expect(presses).toHaveLength(2);
    for (const press of presses) {
      expect(press).toContain(`href="/ro/admin/volunteers/${people.ana}#note-interne"`);
      expect(press).toContain('aria-label="Modifică nota despre Ana Pop"');
    }
  });

  it("is drawn for an Administrator on anybody's newest note, and never for an Organizer on a colleague's — even when an older note is theirs", async () => {
    // The Organizer: their own newest (Ana), and not the colleague's newest (Dan), whose older note is theirs.
    let { cell } = tableOf(await listTree());
    expect(editDialogOf(cell("notes", people.ana))).toHaveLength(1);
    expect(byTestId(cell("notes", people.dan), "volunteer-notes")).toHaveLength(1);
    expect(editDialogOf(cell("notes", people.dan))).toEqual([]);
    // …whose «Adaugă o notă» is still there.
    expect(dialogsOf(cell("name", people.dan)).map((props) => props.action)).toEqual([noteActions.addVolunteerNoteFromListAction]);

    // The colleague: their own newest (Dan), not the Organizer's (Ana).
    state.actor = colleague;
    ({ cell } = tableOf(await listTree()));
    expect(editDialogOf(cell("notes", people.dan))[0]).toMatchObject({ defaultValue: "a colegului", fields: { noteId: notes.danNewest } });
    expect(editDialogOf(cell("notes", people.ana))).toEqual([]);

    // The Administrator and the Superadministrator: every row's newest.
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      ({ cell } = tableOf(await listTree()));
      expect(editDialogOf(cell("notes", people.ana))[0], role).toMatchObject({ fields: { noteId: notes.anaNewest } });
      expect(editDialogOf(cell("notes", people.dan))[0], role).toMatchObject({ fields: { noteId: notes.danNewest } });
    }

    // A row's newest note deleted: the press moves to the note that is now the newest — when the reader may change that one.
    await deleteVolunteerNote(db, colleague, notes.danNewest, at(10));
    state.actor = staff.MODERATOR;
    ({ cell } = tableOf(await listTree()));
    expect(editDialogOf(cell("notes", people.dan))[0]).toMatchObject({ defaultValue: "a organizatorului", fields: { noteId: notes.danOlder } });
  });

  it("speaks English on the English list", async () => {
    const { cell } = tableOf(await listTree({}, "en"));
    expect(editDialogOf(cell("notes", people.ana))[0]).toMatchObject({
      label: "Edit the note",
      ariaLabel: "Edit the note about Ana Pop",
      title: "Edit the note about Ana Pop",
      help: en.Admin.registrations.notes.help,
      boxLabel: "Note",
      saveLabel: "Save the note",
      fallbackHref: `/en/admin/volunteers/${people.ana}#note-interne`,
      fields: { uiLocale: "en" },
    });
  });
});

describe("§964 editVolunteerNoteFromListAction — the press", () => {
  it("changes the note and comes back to the SAME list address — filters, sort and page — with the toast, the words in neither", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&state=CONFIRMED&sort=name&dir=asc&page=2`;
    const press = await saved(fromList, { noteId: notes.anaNewest, body: "  Fotograf,\r\nvine cu aparatul lui ", returnTo: back });
    expect(press).toEqual({ to: back, toast: { kind: "success", key: "noteEdited" } });
    expect(await bodyOf(notes.anaNewest)).toBe("Fotograf,\nvine cu aparatul lui");
    expect(JSON.stringify([state.redirected, state.cookies])).not.toMatch(/Fotograf|aparatul/);

    // The page the press comes back to says the new words, and its dialog would open on them.
    const { cell } = tableOf(await listTree());
    expect(String(byTestId(cell("notes", people.ana), "volunteer-notes")[0].props.children).split("\n\n")[0]).toBe("Fotograf,\nvine cu aparatul lui");
    expect(editDialogOf(cell("notes", people.ana))[0]).toMatchObject({ defaultValue: "Fotograf,\nvine cu aparatul lui" });
  });

  it("says nothing changed for the same words, in the house's sentence, writing nothing", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}`;
    expect(await saved(fromList, { noteId: notes.anaNewest, body: " Fotograf ", returnTo: back })).toEqual({ to: back, toast: { kind: "info", key: "volunteerUnchanged" } });
    expect(await edits()).toEqual([]);
  });

  it("has words in both catalogues for its toasts, its refusals, its press and its dialog — at most 200 characters, the same keys", () => {
    for (const catalogue of [ro, en]) {
      const toasts = catalogue.Feedback.toast as Record<string, unknown>;
      for (const code of ["noteEdited", "volunteerUnchanged"]) expect(typeof toasts[code], code).toBe("string");
      const errors = catalogue.Admin.errors as Record<string, unknown>;
      for (const code of ["NOTE_EMPTY", "NOTE_TOO_LONG", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"]) expect(typeof errors[code], code).toBe("string");
      for (const words of [catalogue.Admin.volunteers.notes.edit, catalogue.Admin.volunteers.notes.editDialog, catalogue.Admin.registrations.notes.edit, catalogue.Admin.volunteers.screen.notesHint]) {
        expect(words.length).toBeLessThanOrEqual(200);
      }
    }
    expect(ro.Feedback.toast.noteEdited).toBe("Nota a fost modificată.");
    expect(en.Feedback.toast.noteEdited).toBe("The note was changed.");
    // The column's «?» no longer promises a day and an hour.
    expect(ro.Admin.volunteers.screen.notesHint).not.toContain("cu ziua și ora");
    expect(en.Admin.volunteers.screen.notesHint).not.toContain("each with its day and time");
  });

  it("answers a refusal with the form's own state — the box named, the words still in it — and writes nothing", async () => {
    const long = "x".repeat(VOLUNTEER_NOTE_MAX + 1);
    state.redirected.length = 0;
    expect(await fromList(form({ noteId: notes.anaNewest, body: "   " }))).toMatchObject({ error: "NOTE_EMPTY", fields: ["body"], values: { body: ["   "] } });
    expect(await fromList(form({ noteId: notes.anaNewest, body: long }))).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["body"], values: { body: [long] } });
    // A note deleted while the dialog was open, and an id that is none.
    await deleteVolunteerNote(db, staff.MODERATOR!, notes.danOlder, at(10));
    expect(await fromList(form({ noteId: notes.danOlder, body: "înviată" }))).toMatchObject({ error: "NOT_FOUND", values: { body: ["înviată"] } });
    expect(await fromList(form({ noteId: "nobody", body: "x" }))).toMatchObject({ error: "NOT_FOUND" });
    expect(state.redirected).toEqual([]);
    expect(await bodyOf(notes.anaNewest)).toBe("Fotograf");
    expect(await edits()).toEqual([]);
  });

  it("asks the capability itself, and the service whose note it is: every other role, a colleague's note and an ended session refused, nothing written (BR-REQ-060-01)", async () => {
    await saved(fromList, { noteId: notes.anaNewest, body: "Fotograf oficial" });
    expect(state.asked.at(-1)).toBe(canManageVolunteers);

    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      state.asked.length = 0;
      expect(await fromList(form({ noteId: notes.anaNewest, body: "intrus" })), role).toMatchObject({ error: "FORBIDDEN", values: { body: ["intrus"] } });
      expect(state.asked, role).toEqual([canManageVolunteers]);
    }
    // An Organizer on a colleague's note, posted by hand: the press is not drawn, and the service refuses all the same.
    state.actor = staff.MODERATOR;
    expect(await fromList(form({ noteId: notes.danNewest, body: "a mea acum" }))).toMatchObject({ error: "FORBIDDEN" });
    // A session that ended while the dialog was open: its own answer, the words still in the box.
    state.actor = undefined;
    expect(await fromList(form({ noteId: notes.anaNewest, body: "după expirare" }))).toMatchObject({ error: "UNAUTHENTICATED", values: { body: ["după expirare"] } });

    expect(await bodyOf(notes.anaNewest)).toBe("Fotograf oficial");
    expect(await bodyOf(notes.danNewest)).toBe("a colegului");
    expect((await edits()).map((row) => row.actorStaffUserId)).toEqual([staff.MODERATOR!.id]);
  });

  it("follows a forged `returnTo` nowhere but the event's own «Voluntari» card, and the person's page when that is where the form was", async () => {
    const card = `/ro/admin/events/${raceId}#box-volunteers`;
    for (const forged of ["https://example.test/x", "//example.test/x", "/ro/admin/registrations", "/ro/admin/volunteers/../../x", "javascript:alert(1)", `/ro/admin/volunteers/${people.ana}#x`]) {
      expect((await saved(fromList, { noteId: notes.anaNewest, body: `altă notă ${forged.length}`, returnTo: forged })).to, forged).toBe(card);
    }
    const page = `/ro/admin/volunteers/${people.ana}`;
    expect((await saved(fromList, { noteId: notes.anaNewest, body: "pe pagina persoanei", returnTo: page })).to).toBe(page);
    // In English too, and a refusal's code never rides on a save.
    expect((await saved(fromList, { noteId: notes.anaNewest, body: "photographer", uiLocale: "en", returnTo: `/en/admin/volunteers?eventId=${raceId}&volunteerError=FORBIDDEN` })).to).toBe(
      `/en/admin/volunteers?eventId=${raceId}`,
    );
  });

  it("emails nobody, whatever it changes", async () => {
    await saved(fromList, { noteId: notes.anaNewest, body: "una" });
    await saved(fromList, { noteId: notes.anaNewest, body: "una" });
    state.actor = staff.ADMIN;
    await saved(fromList, { noteId: notes.danNewest, body: "alta" });
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });
});

describe("§964 «Modifică» on the person's page", () => {
  it("is beside «Șterge» on each note the reader may change — a fold holding the note's words, the box and «Salvează nota» — and nowhere else", async () => {
    const { props, drawn } = await cardOf(await personTree(people.dan));
    expect(props.editAction).toBe(noteActions.editVolunteerNoteAction);
    // The Organizer: their own note, not the colleague's.
    const folds = byTestId(drawn, "note-edit");
    expect(folds).toHaveLength(1);
    const [fold] = folds;
    const [press] = elements(fold).filter((element) => element.type === ActionForm);
    expect(press.props.action).toBe(noteActions.editVolunteerNoteAction);
    const hidden = Object.fromEntries(elements(press).filter((element) => element.type === "input").map((element) => [element.props.name, element.props.value]));
    expect(hidden).toEqual({ uiLocale: "ro", volunteerId: people.dan, noteId: notes.danOlder });
    const box = elements(press).find((element) => element.props.name === "body")!;
    expect(box.props).toMatchObject({ label: "Nota", defaultValue: "a organizatorului", multiline: true, required: true, helperText: `Cel mult ${VOLUNTEER_NOTE_MAX} de caractere.` });
    expect((box.props.slotProps as { htmlInput: { maxLength: number } }).htmlInput.maxLength).toBe(VOLUNTEER_NOTE_MAX);
    const summary = elements(fold).find((element) => element.props["data-testid"] === "note-edit-toggle")!;
    expect(summary.props.component).toBe("summary");
    expect(elements(summary).some((element) => element.props.children === "Modifică" || (Array.isArray(element.props.children) && element.props.children.includes("Modifică")))).toBe(true);

    // In the note's own line, before «Șterge»; the note it changes still says who wrote it and when.
    const [own] = byTestId(drawn, "note").filter((note) => byTestId(note, "note-edit").length > 0);
    const line = elements(own);
    expect(line.findIndex((element) => element.props["data-testid"] === "note-edit")).toBeLessThan(line.findIndex((element) => element.props["data-testid"] === "note-delete-form"));
    expect(String(byTestId(own, "note-by")[0].props.children)).toContain(formatDay(at(0), { locale: "ro", timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }));

    // The Administrator: every note.
    state.actor = staff.ADMIN;
    expect(byTestId((await cardOf(await personTree(people.dan))).drawn, "note-edit")).toHaveLength(2);
    expect(byTestId((await cardOf(await personTree(people.ana))).drawn, "note-edit")).toHaveLength(4);
  });

  it("is a fold that works with no script, drawn in English too, and the registration's card has none", async () => {
    const page = await html((await cardOf(await personTree(people.ana))).drawn);
    expect([...page.matchAll(/<details\b/g)].length).toBeGreaterThanOrEqual(4);
    expect(page).toMatch(/<summary\b[^>]*data-testid="note-edit-toggle"[^>]*>[\s\S]*?Modifică<\/summary>/);
    // Its header wears the pencil before the word, hidden from a screen reader (§521: a glyph on every fold's header).
    const toggle = /<summary\b[^>]*data-testid="note-edit-toggle"[^>]*>([\s\S]*?)<\/summary>/.exec(page)?.[1] ?? "";
    expect(toggle).toMatch(/^<svg\b[^>]*aria-hidden="true"[^>]*data-testid="EditIcon"/);
    expect(toggle).toMatch(/<\/svg>Modifică$/);
    expect(page).toMatch(/<textarea\b[^>]*name="body"[^>]*>Fotograf<\/textarea>/);

    const english = await html((await cardOf(await personTree(people.ana, {}, "en"))).drawn);
    expect(english).toMatch(/<summary\b[^>]*data-testid="note-edit-toggle"[^>]*>[\s\S]*?Edit<\/summary>/);

    // The card without an `editAction` — the registration's page hands none — draws no «Modifică», whatever the rows say.
    state.locale = "ro";
    const row = { id: "00000000-0000-4000-8000-000000000001", body: "nota înscrierii", createdAt: NOW, authorName: "Coleg ADMIN", deletable: true, editable: true };
    const registration = await NotesCard({ locale: "ro", owner: { field: "registrationId", id: row.id }, max: 2000, authorGone: "cont șters", notes: [row], addAction: fromPage as never, deleteAction: fromPage as never, opened: false });
    expect(byTestId(registration, "note-edit")).toEqual([]);
    expect(byTestId(registration, "note-delete-form")).toHaveLength(1);
  });

  it("saves the words and comes back to the card, open — `?saved=noteEdited#note-interne` — with the toast; the same words say nothing changed", async () => {
    const to = `/ro/admin/volunteers/${people.dan}?saved=noteEdited#note-interne`;
    expect(await saved(fromPage, { volunteerId: people.dan, noteId: notes.danOlder, body: "a organizatorului, corectată" })).toEqual({ to, toast: { kind: "success", key: "noteEdited" } });
    expect(await bodyOf(notes.danOlder)).toBe("a organizatorului, corectată");
    expect(await saved(fromPage, { volunteerId: people.dan, noteId: notes.danOlder, body: "a organizatorului, corectată" })).toEqual({ to, toast: { kind: "info", key: "volunteerUnchanged" } });
    expect(await edits()).toHaveLength(1);
    expect(JSON.stringify([state.redirected, state.cookies])).not.toContain("corectată");

    // The card the press comes back to is open on its own press, and says the new words with their author and first moment.
    const { drawn } = await cardOf(await personTree(people.dan, { saved: "noteEdited" }));
    const panel = elements(drawn).find((element) => element.props.id === "note-interne")!;
    expect(panel.props.openWhen).toMatchObject({ saved: true });
    expect(byTestId(drawn, "note-body").map((element) => element.props.children)).toEqual(["a colegului", "a organizatorului, corectată"]);
  });

  it("answers a refusal with the form's own state — a box too long, a colleague's note — writing nothing", async () => {
    const long = "x".repeat(VOLUNTEER_NOTE_MAX + 1);
    state.redirected.length = 0;
    expect(await fromPage(form({ volunteerId: people.dan, noteId: notes.danOlder, body: long }))).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["body"], values: { body: [long] } });
    expect(await fromPage(form({ volunteerId: people.dan, noteId: notes.danNewest, body: "a mea acum" }))).toMatchObject({ error: "FORBIDDEN" });
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await fromPage(form({ volunteerId: people.dan, noteId: notes.danOlder, body: "intrus" })), role).toMatchObject({ error: "FORBIDDEN" });
    }
    expect(state.redirected).toEqual([]);
    expect(await bodyOf(notes.danOlder)).toBe("a organizatorului");
    expect(await bodyOf(notes.danNewest)).toBe("a colegului");
    expect(await edits()).toEqual([]);
  });
});
