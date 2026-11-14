import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { REGISTRATION_NOTE_MAX, registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { canKeepRegistrationNotes, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * Internal notes on a registration (§777) — the screens and the two presses, read from a real database.
 *
 * - the registration's page draws «Note interne» for the Organizer and above, folded with the count in its
 *   closed line («3 note» / «nicio notă»), and never for the Tehnic role or the volunteer, who do not get the
 *   page at all; the delete press is drawn only on a note the reader may delete;
 * - the list marks a row that has notes with the sticky note and the count, and only a row that has;
 * - «Salvează nota» and «Șterge» come back to the card, open; a refusal returns the form with the words still in
 *   its box; and the actions refuse every role that may not keep notes (the service refuses them again).
 *
 * The pages are Server Components, so they are called and their element trees walked.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params?: { id?: string } } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace("[id]", href.params?.id ?? "")}`,
  Link: () => null,
}));
// The door as the real one answers: the predicate is asked of the actor, and a refusal is FORBIDDEN.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  // «Adaugă pe lista de așteptare» (§872): the list page and the queue panel import it; not under test here.
  addToWaitlistAction: vi.fn(),
  // «Mută pe lista oficială» / «Oferă-i un loc acum» on the internal list (§888): imported by the list page.
  moveReserveEntryAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  // «Adaugă o notă» on a row (the dialog's press): the list page hands it to the row's control; tested in `note-from-list-action.test.ts`.
  addRegistrationNoteFromListAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: NotesCard } = await import("@/modules/registrations/ui/NotesCard");
const { default: NotesMark } = await import("@/modules/registrations/ui/NotesMark");
const { default: TipSpan } = await import("@/shared/ui/TipSpan");
const { default: Panel } = await import("@/shared/ui/Panel");
const { default: RowNoteDialog } = await import("@/shared/ui/RowNoteDialog");
const listActions = await import("@/app/[locale]/admin/registrations/actions");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { addRegistrationNote } = await import("@/modules/registrations/notes");
const { opensByItself } = await import("@/shared/ui/fold");
const noteActions = await import("@/app/[locale]/admin/registrations/[id]/note-actions");

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

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      featured: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: StaffRole, name = `Colleague ${role}`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${name.toLowerCase().replaceAll(" ", ".")}@dev.test`, displayName: name, role }).returning();
  return user;
}

const detailPage = (id: string, searchParams: Record<string, string> = {}) =>
  RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve(searchParams) } as never);

const listPage = (searchParams: Record<string, string>) =>
  AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);

/** The card as the page hands it over, and what it draws — `NotesCard` is an async Server Component, so it is called. */
async function cardOf(tree: ReactNode) {
  const [card] = elements(tree).filter((element) => element.type === NotesCard);
  return card ? { props: card.props as Parameters<typeof NotesCard>[0], drawn: await NotesCard(card.props as Parameters<typeof NotesCard>[0]) } : null;
}

/** The name column of the list's table, drawn for one row. */
async function nameCellOf(tree: ReactNode, registrationId: string) {
  const table = elements(tree).find((element) => element.type === AdminTable);
  const columns = table?.props.columns as Array<{ key: string; render: (row: unknown) => ReactNode }>;
  const row = (table?.props.rows as Array<{ id: string }>).find((candidate) => candidate.id === registrationId);
  return columns.find((column) => column.key === "name")!.render(row);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("«Note interne» on the registration's page", () => {
  it("is a named, folded card whose closed line counts the notes — nicio notă, 1 notă, 3 note, 20 de note", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR", "Ioana Organizer");
    state.actor = organizer;
    const id = await register(race.id);

    const aside = async () => {
      const card = await cardOf(await detailPage(id));
      const [panel] = elements(card!.drawn).filter((element) => element.type === Panel);
      expect(panel.props).toMatchObject({ glyph: "internalNotes", collapsible: true, title: state.locale === "ro" ? "Note interne" : "Internal notes", id: "note-interne" });
      return panel.props.aside;
    };
    expect(await aside()).toBe("nicio notă");
    await addRegistrationNote(db, organizer, id, "una", new Date("2026-10-15T10:00:00.000Z"));
    expect(await aside()).toBe("1 notă");
    for (const n of [2, 3]) await addRegistrationNote(db, organizer, id, `nota ${n}`, new Date(`2026-10-15T10:0${n}:00.000Z`));
    expect(await aside()).toBe("3 note");
    for (let n = 4; n <= 20; n += 1) await addRegistrationNote(db, organizer, id, `nota ${n}`, new Date(`2026-10-15T11:${String(n).padStart(2, "0")}:00.000Z`));
    expect(await aside()).toBe("20 de note");

    state.locale = "en";
    expect(await aside()).toBe("20 notes");
  });

  it("stands FIRST on the page, before every other card, for every role that may keep notes — and is not drawn for the others", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      const all = elements(await detailPage(id));
      const first = all.findIndex((element) => element.type === NotesCard);
      expect(first, role).toBeGreaterThanOrEqual(0);
      // No other card (a `Panel`, or the page's «Ce îi spui») stands above it.
      const above = all.slice(0, first).filter((element) => element.type === Panel || element.props["data-testid"] === "resend-form");
      expect(above.map((element) => String(element.props["data-testid"] ?? element.props.title)), role).toEqual([]);
    }
  });

  it("opens by itself exactly when it holds a note: closed on «nicio notă», open with one — through the fold's own reason", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const id = await register(race.id);
    const openWhen = async () => {
      const [panel] = elements((await cardOf(await detailPage(id)))!.drawn).filter((element) => element.type === Panel);
      return panel.props.openWhen as { saved?: boolean; holds?: boolean };
    };
    expect(await openWhen()).toEqual({ saved: false, holds: false });
    expect(opensByItself(await openWhen())).toBe(false);
    await addRegistrationNote(db, organizer, id, "una", new Date("2026-10-15T10:00:00.000Z"));
    expect(await openWhen()).toEqual({ saved: false, holds: true });
    expect(opensByItself(await openWhen())).toBe(true);
    // The card still opens after its own save or delete, with or without a note left, and for the fragment (the shell's).
    const { deleteRegistrationNote } = await import("@/modules/registrations/notes");
    const [only] = await db.select().from(registrationNotes);
    await deleteRegistrationNote(db, organizer, only.id, new Date("2026-10-15T10:05:00.000Z"));
    const afterDelete = (await cardOf(await detailPage(id, { saved: "noteDeleted" })))!;
    const [panel] = elements(afterDelete.drawn).filter((element) => element.type === Panel);
    expect(panel.props.openWhen).toEqual({ saved: true, holds: false });
    expect(panel.props.id).toBe("note-interne");
  });

  it("lists the notes newest first with the author and when, and carries the help line", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR", "Ioana Organizer");
    const admin = await staff("ADMIN", "Andrei Admin");
    const id = await register(race.id);
    await addRegistrationNote(db, state.actor as StaffUser, id, "prima notă", new Date("2026-10-15T10:00:00.000Z"));
    await addRegistrationNote(db, admin, id, "a doua notă", new Date("2026-10-15T12:30:00.000Z"));

    const { drawn } = (await cardOf(await detailPage(id)))!;
    expect(byTestId(drawn, "note-body").map((element) => element.props.children)).toEqual(["a doua notă", "prima notă"]);
    const by = byTestId(drawn, "note-by").map((element) => String(element.props.children));
    expect(by[0]).toContain("Andrei Admin");
    expect(by[1]).toContain("Ioana Organizer");
    expect(byTestId(drawn, "notes-help")[0].props.children).toBe("Doar organizatorii și administratorii văd notele. Nu scrie date medicale sau alte date sensibile.");
    expect(byTestId(drawn, "notes-empty")).toHaveLength(0);
  });

  it("says so when there is none, and draws the add form — a box with the limit, «Salvează nota», the page's own action", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const { props, drawn } = (await cardOf(await detailPage(await register(race.id))))!;
    expect(byTestId(drawn, "notes-empty")).toHaveLength(1);
    expect(byTestId(drawn, "note")).toHaveLength(0);

    const [form] = byTestId(drawn, "note-add-form");
    expect(form.type).toBe(ActionForm);
    expect(form.props.action).toBe(noteActions.addRegistrationNoteAction);
    expect(props.addAction).toBe(noteActions.addRegistrationNoteAction);
    const box = elements(form).find((element) => element.props.name === "body")!;
    expect(box.props).toMatchObject({ multiline: true, required: true, label: "Adaugă o notă", helperText: `Cel mult ${REGISTRATION_NOTE_MAX} de caractere.` });
    expect((box.props.slotProps as { htmlInput: { maxLength: number } }).htmlInput.maxLength).toBe(REGISTRATION_NOTE_MAX);
    // The save button: a glyph before the words.
    const save = elements(form).find((element) => element.props.type === "submit")!;
    expect(save.props).toMatchObject({ icon: "save", children: "Salvează nota" });
  });

  it("draws «Șterge» only on a note the reader may delete — their own, or every one for an Administrator", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR", "Ioana Organizer");
    const colleague = await staff("MODERATOR", "Mihai Organizer");
    const admin = await staff("ADMIN", "Andrei Admin");
    const id = await register(race.id);
    await addRegistrationNote(db, organizer, id, "a mea", new Date("2026-10-15T10:00:00.000Z"));
    await addRegistrationNote(db, colleague, id, "a colegului", new Date("2026-10-15T11:00:00.000Z"));

    state.actor = organizer;
    const asOrganizer = (await cardOf(await detailPage(id)))!.drawn;
    expect(byTestId(asOrganizer, "note-delete-form")).toHaveLength(1);
    const [own] = byTestId(asOrganizer, "note-delete-form");
    expect(own.props.action).toBe(noteActions.deleteRegistrationNoteAction);
    const noteIds = elements(own).filter((element) => element.props.name === "noteId").map((element) => element.props.value);
    expect(noteIds).toHaveLength(1);
    const delButton = elements(own).find((element) => element.props.type === "submit")!;
    expect(delButton.props).toMatchObject({ icon: "delete", children: "Șterge" });
    // The question before the press says what is lost and what stays.
    expect((own.props.confirm as { destructive: boolean }).destructive).toBe(true);

    state.actor = admin;
    expect(byTestId((await cardOf(await detailPage(id)))!.drawn, "note-delete-form")).toHaveLength(2);
  });

  it("opens by itself after a note was saved or deleted, and is closed on a plain arrival", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const id = await register(race.id);
    const openedAfter = async (search: Record<string, string>) => (await cardOf(await detailPage(id, search)))!.props.opened;
    expect(await openedAfter({})).toBe(false);
    expect(await openedAfter({ saved: "noteAdded" })).toBe(true);
    expect(await openedAfter({ saved: "noteDeleted" })).toBe(true);
    expect(await openedAfter({ saved: "answersCorrected" })).toBe(false);
  });

  it("is drawn for the Administrator and the Superadministrator too, and the page is a 404 for the roles that may not keep notes", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      expect(await cardOf(await detailPage(id)), role).not.toBeNull();
    }
    // The Tehnic role and the volunteer never reach the registration's page; the card needs the page.
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER"] as const) {
      expect(canKeepRegistrationNotes(role)).toBe(false);
      state.actor = await staff(role, `Tester ${role}`);
      await expect(detailPage(id), role).rejects.toThrow("NOT_FOUND");
    }
  });
});

describe("the list's marker", () => {
  it("marks only the rows that have notes — the sticky note, the count in the row's words, a link to the card", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const withNotes = await register(race.id);
    const without = await register(race.id);
    await addRegistrationNote(db, organizer, withNotes, "una", new Date("2026-10-15T10:00:00.000Z"));
    await addRegistrationNote(db, organizer, withNotes, "doua", new Date("2026-10-15T10:01:00.000Z"));

    const tree = await listPage({ eventId: race.id });
    const marked = elements(await nameCellOf(tree, withNotes)).filter((element) => element.type === NotesMark);
    expect(marked).toHaveLength(1);
    expect(marked[0].props).toMatchObject({ label: "2 note", href: `/ro/admin/registrations/${withNotes}#note-interne` });
    expect(elements(await nameCellOf(tree, without)).filter((element) => element.type === NotesMark)).toHaveLength(0);
  });

  it("says the notes' own words in the marker's tooltip — newest first, each with its day and hour, the older ones counted (§943)", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const id = await register(race.id);
    const without = await register(race.id);
    for (const [minute, words] of [["00", "prima"], ["01", "a doua"], ["02", "a treia"], ["03", "a patra\ncu două rânduri"]] as const) {
      await addRegistrationNote(db, organizer, id, words, new Date(`2026-10-15T10:${minute}:00.000Z`));
    }
    const tree = await listPage({ eventId: race.id });
    const tips = elements(await nameCellOf(tree, id)).filter((element) => element.type === TipSpan);
    expect(tips).toHaveLength(1);
    // The marker stays the link to the card; the tooltip is around it.
    const marker = elements(tips[0].props.children as ReactNode).filter((element) => element.type === NotesMark);
    expect(marker).toHaveLength(1);
    expect(marker[0].props).toMatchObject({ label: "4 note", href: `/ro/admin/registrations/${id}#note-interne` });
    const said = (tips[0].props.title as string).split("\n\n");
    // The three newest, then how many are older — in the count's own words.
    expect(said).toHaveLength(4);
    expect(said[0]).toBe("Joi, 15 oct. 2026, 13:03: a patra\ncu două rânduri");
    expect(said[1]).toMatch(/13:02: a treia$/);
    expect(said[2]).toMatch(/13:01: a doua$/);
    expect(said[3]).toBe("… și încă 1 notă");
    // Nobody's name: who wrote a note is the card's to say.
    expect(tips[0].props.title).not.toContain(organizer.displayName);
    // A row without notes has no marker and no tooltip.
    expect(elements(await nameCellOf(tree, without)).filter((element) => element.type === TipSpan)).toHaveLength(0);
  });

  it("counts only live notes: a deleted one leaves the marker", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const id = await register(race.id);
    const { id: noteId } = await addRegistrationNote(db, organizer, id, "una", new Date("2026-10-15T10:00:00.000Z"));
    const { deleteRegistrationNote } = await import("@/modules/registrations/notes");
    await deleteRegistrationNote(db, organizer, noteId, new Date("2026-10-15T10:05:00.000Z"));
    expect(elements(await nameCellOf(await listPage({ eventId: race.id }), id)).filter((element) => element.type === NotesMark)).toHaveLength(0);
  });

  it("draws the marker for the Administrator too", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = await staff("ADMIN");
    const id = await register(race.id);
    await addRegistrationNote(db, organizer, id, "una", new Date("2026-10-15T10:00:00.000Z"));
    expect(elements(await nameCellOf(await listPage({ eventId: race.id }), id)).filter((element) => element.type === NotesMark)).toHaveLength(1);
  });
});

describe("the list's «Adaugă o notă» — the row's control", () => {
  const controlsOf = async (tree: ReactNode, id: string) => elements(await nameCellOf(tree, id)).filter((element) => element.type === RowNoteDialog);

  it("is drawn on every row for a role that may keep notes — beside the marker when the row has notes, alone when it has none", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const withNotes = await register(race.id);
    const without = await register(race.id);
    await addRegistrationNote(db, organizer, withNotes, "una", new Date("2026-10-15T10:00:00.000Z"));
    const tree = await listPage({ eventId: race.id });

    const [alone] = await controlsOf(tree, without);
    expect(elements(await nameCellOf(tree, without)).filter((element) => element.type === NotesMark)).toHaveLength(0);
    const [beside] = await controlsOf(tree, withNotes);
    expect(elements(await nameCellOf(tree, withNotes)).filter((element) => element.type === NotesMark)).toHaveLength(1);
    expect(alone).toBeDefined();
    expect(beside).toBeDefined();
  });

  it("carries the words, the action, the hidden fields and the fallback link — the person named in the accessible name and the title", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const id = await register(race.id);
    const [control] = await controlsOf(await listPage({ eventId: race.id, sort: "name", dir: "asc" }), id);
    const props = control.props as Parameters<typeof RowNoteDialog>[0];
    expect(props.action).toBe(listActions.addRegistrationNoteFromListAction);
    expect(props).toMatchObject({
      label: "Adaugă o notă",
      ariaLabel: expect.stringContaining("Runner"),
      title: expect.stringContaining("Runner"),
      help: "Doar organizatorii și administratorii văd notele. Nu scrie date medicale sau alte date sensibile.",
      boxName: "body",
      boxLabel: "Adaugă o notă",
      limitText: `Cel mult ${REGISTRATION_NOTE_MAX} de caractere.`,
      max: REGISTRATION_NOTE_MAX,
      saveLabel: "Salvează nota",
      fallbackHref: `/ro/admin/registrations/${id}#note-interne`,
      settledKey: "0:",
    });
    expect(props.cancelLabel).toBeTruthy();
    // The hidden fields: the row, the language and the list's own query (filters, sort, page) — never a word of a note.
    expect(props.fields).toMatchObject({ uiLocale: "ro", registrationId: id });
    const query = new URLSearchParams(props.fields.listQuery);
    expect(query.get("eventId")).toBe(race.id);
    expect(query.get("sort")).toBe("name");
    // Only strings and a Server Action cross to the client: no element, no component.
    for (const [name, value] of Object.entries(props)) {
      if (name === "action") continue;
      expect(isValidElement(value), name).toBe(false);
      expect(typeof value === "function", name).toBe(false);
    }
    // The key is the row's note count plus the return's own `saved` flag: a return that carries `saved` changes it,
    // so the dialog closes after any successful save, not only when the count moves.
    const saved = await controlsOf(await listPage({ eventId: race.id, saved: "noteSaved" }), id);
    expect((saved[0].props as Parameters<typeof RowNoteDialog>[0]).settledKey).toBe("0:noteSaved");
    // Only the four sentences the dialog can meet travel with the row, not the whole catalogue.
    expect(Object.keys(props.messages.errors).sort()).toEqual(["FORBIDDEN", "NOTE_EMPTY", "NOTE_TOO_LONG", "NOT_FOUND"]);
  });

  it("is drawn for the Administrator and the Superadministrator too", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      expect(await controlsOf(await listPage({ eventId: race.id }), id), role).toHaveLength(1);
    }
  });

  it("is absent for a role that may not keep notes — the list itself is the Organizer's and above, and the press refuses the rest", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);
    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id });
    const table = elements(tree).find((element) => element.type === AdminTable)!;
    expect((table.props.rows as unknown[]).length).toBeGreaterThan(0);
    // The same column drawn for a role that may not keep notes holds no control (a stand-in actor: the cell asks the role).
    const columns = table.props.columns as Array<{ key: string; render: (row: unknown) => ReactNode }>;
    expect(columns.find((column) => column.key === "name")).toBeDefined();
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER"] as const) {
      expect(canKeepRegistrationNotes(role)).toBe(false);
      state.actor = await staff(role, `Tester ${role}`);
      // Today the list is refused to these roles altogether (the same role set reads it and keeps notes); if the
      // list is ever opened to more roles, the same loop guards that the control is still not drawn.
      let refusal: unknown;
      let drawn: ReactNode = null;
      try {
        drawn = await nameCellOf(await listPage({ eventId: race.id }), id);
      } catch (error) {
        refusal = error;
      }
      // The refusal is the page's own not-found; any other error fails the test.
      if (refusal !== undefined) expect((refusal as Error).message, role).toBe("NOT_FOUND");
      else expect(elements(drawn).filter((element) => element.type === RowNoteDialog), role).toHaveLength(0);
    }
  });

  it("reads the notes of the page in ONE grouped count — no query per row", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    for (let n = 0; n < 5; n += 1) await addRegistrationNote(db, organizer, await register(race.id), `nota ${n}`, new Date("2026-10-15T10:00:00.000Z"));
    const reads: string[] = [];
    const real = db.select.bind(db);
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      const query = (real as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
      const from = query.from.bind(query);
      query.from = ((table: unknown) => {
        if (table === registrationNotes) reads.push("notes");
        return from(table);
      }) as never;
      return query as never;
    }) as never);
    try {
      await listPage({ eventId: race.id });
    } finally {
      spy.mockRestore();
    }
    expect(reads).toEqual(["notes"]);
  });
});

describe("«Salvează nota» and «Șterge» — the two presses", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };
  /** The redirect an action ends with, as Next throws it. */
  async function redirectedTo(press: Promise<unknown>): Promise<string> {
    try {
      await press;
    } catch (error) {
      const digest = (error as { digest?: string }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
      throw error;
    }
    throw new Error("expected a redirect");
  }

  it("saves a note, records who and when, and comes back to the card, open", async () => {
    const race = await createRace("Crosul");
    const organizer = await staff("MODERATOR");
    state.actor = organizer;
    const id = await register(race.id);
    const to = await redirectedTo(noteActions.addRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, body: "  cere tricou S  " })));
    expect(to).toBe(`/ro/admin/registrations/${id}?saved=noteAdded#note-interne`);
    const [row] = await db.select().from(registrationNotes);
    expect(row).toMatchObject({ registrationId: id, body: "cere tricou S", authorStaffUserId: organizer.id });
    const [trail] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"));
    expect(trail).toMatchObject({ actorStaffUserId: organizer.id, entityId: id, metadataJson: {} });
    // Nothing typed goes in the address.
    expect(to).not.toContain("tricou");
  });

  it("answers an empty or too long note with the form's own state, the words still in the box", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const id = await register(race.id);
    const empty = await noteActions.addRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, body: "   " }));
    expect(empty).toMatchObject({ error: "NOTE_EMPTY", fields: ["body"] });
    const long = "x".repeat(REGISTRATION_NOTE_MAX + 1);
    const tooLong = await noteActions.addRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, body: long }));
    expect(tooLong).toMatchObject({ error: "NOTE_TOO_LONG", fields: ["body"], values: { body: [long] } });
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
    // Every code the press can answer has its sentence in both languages.
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.errors.NOTE_EMPTY).toBeTruthy();
      expect(catalogue.Admin.errors.NOTE_TOO_LONG).toBeTruthy();
    }
  });

  it("refuses the roles that may not keep notes — the Tehnic role, the volunteer, the Redactor — and writes nothing", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      state.actor = await staff(role, `Tester ${role}`);
      expect(await noteActions.addRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, body: "intrus" })), role).toMatchObject({ error: "FORBIDDEN" });
    }
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
  });

  it("deletes the reader's own note, refuses a colleague's to an Organizer, and lets an Administrator delete it", async () => {
    const race = await createRace("Crosul");
    const author = await staff("MODERATOR", "Ioana Organizer");
    const colleague = await staff("MODERATOR", "Mihai Organizer");
    const admin = await staff("ADMIN", "Andrei Admin");
    const tehnic = await staff("DEV", "Tudor Tehnic");
    const id = await register(race.id);
    const { id: noteId } = await addRegistrationNote(db, author, id, "a mea", new Date("2026-10-15T10:00:00.000Z"));
    const press = () => noteActions.deleteRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, noteId }));

    state.actor = colleague;
    expect(await press()).toMatchObject({ error: "FORBIDDEN" });
    state.actor = tehnic;
    expect(await press()).toMatchObject({ error: "FORBIDDEN" });
    expect((await db.select().from(registrationNotes))[0].body).toBe("a mea");

    state.actor = author;
    expect(await redirectedTo(press())).toBe(`/ro/admin/registrations/${id}?saved=noteDeleted#note-interne`);
    expect((await db.select().from(registrationNotes))[0]).toMatchObject({ body: "" });

    const { id: second } = await addRegistrationNote(db, author, id, "încă una", new Date("2026-10-15T11:00:00.000Z"));
    state.actor = admin;
    expect(await redirectedTo(noteActions.deleteRegistrationNoteAction(null, form({ uiLocale: "ro", registrationId: id, noteId: second })))).toContain("saved=noteDeleted");
    // A note already gone is NOT_FOUND, the card's own state.
    expect(await press()).toMatchObject({ error: "NOT_FOUND" });
  });
});
