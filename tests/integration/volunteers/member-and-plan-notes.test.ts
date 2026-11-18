import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerNotes } from "@/db/schema/event-volunteer-notes";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { canManageVolunteers, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { CLUB_NAME, CLUB_SHORT_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { type PlanRace, planVolunteer, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — the owner, 2026-11-18, three days before the race: «vreau la voluntari și să văd bifa
 * "membru BVR" și să văd în plan și comentariile mele». Read from a real database, in Romanian and in English:
 *
 * - the «Voluntari» list has a column «Membru {club}», `{club}` the club's short name from its identity: a tick named for a screen
 *   reader on the rows whose person answered «Fac parte din grupul {club}», nothing on the others (no line on a phone's card), a
 *   «?» that says it is the person's own claim, hideable under «Coloane»; and «Doar membrii {club}» leaves the ticked alone;
 * - `readVolunteerPlan` carries each person's race-day decision with the person and their live notes, newest first, read in one
 *   query for the event whatever the number of people — and only for a role the notes' own gate allows;
 * - «Planul voluntarilor» draws them under every person — at a point, under «Fără punct», in the table's people cell —: the
 *   decision in a quiet line that prints, the notes one line each with their day, never on paper.
 *
 * The made-up people here are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", notesGate: true }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  getFormatter: async () => createFormatter({ locale: state.locale, timeZone: "Europe/Bucharest" }),
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
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string>; hash?: string };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}${href.hash ? `#${href.hash}` : ""}`;
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
// The notes' own gate, as it is — or, for one test, narrower than the plan's: what a reader the notes leave out would see.
vi.mock("@/modules/volunteers/volunteer-notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/volunteers/volunteer-notes")>();
  return { ...actual, mayReadVolunteerNotes: (role: StaffRole) => state.notesGate && actual.mayReadVolunteerNotes(role) };
});

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { readVolunteerPlan } = await import("@/modules/volunteers/plan");
const { listVolunteerNotesForPlan, mayReadVolunteerNotes } = await import("@/modules/volunteers/volunteer-notes");

const NOW = new Date("2026-11-18T10:00:00.000Z");
const DECISION = "vine la 8:00 la start";
const RESERVE = "rezervă, la telefon";
/** A note longer than a line shows: cut at 280 characters with «…». */
const LONG = `${"Are mașină și poate duce apa la cabană ".repeat(8)}sfârșit`;

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

/** One note on a person, written by an Administrator at `at`; deleted when asked. */
async function note(volunteerId: string, body: string, at: string, deleted = false): Promise<void> {
  const when = new Date(at);
  await db.insert(eventVolunteerNotes).values({ volunteerId, authorStaffUserId: staff.ADMIN!.id, body: deleted ? "" : body, createdAt: when, updatedAt: when, deletedAt: deleted ? when : null });
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.notesGate = true;
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  // Ana and Zoe at the junction, Dan at the water, Ion at the bridge, Radu at no point, Eva cancelled; Mara is another event's.
  race = await seedPlanRace(db, NOW);
  const { ana, radu, eva, mara, dan } = race.people;
  // Ana and Dan answered «Fac parte din grupul …» on the form; the others did not.
  for (const id of [ana, dan]) await db.update(eventVolunteers).set({ clubMember: true }).where(eq(eventVolunteers.id, id));
  await db.update(eventVolunteers).set({ raceDayDecision: DECISION }).where(eq(eventVolunteers.id, ana));
  await db.update(eventVolunteers).set({ raceDayDecision: RESERVE }).where(eq(eventVolunteers.id, radu));
  await db.update(eventVolunteers).set({ raceDayDecision: "nu mai vine" }).where(eq(eventVolunteers.id, eva));
  // Ana: two live notes and a deleted one; Radu: one long note; Eva (cancelled) and Mara (another event) each a note never on this plan.
  await note(ana, "Are mașină,\npoate duce apa.", "2026-11-16T08:30:00.000Z");
  await note(ana, "Sună-o vineri", "2026-11-17T15:45:00.000Z");
  await note(ana, "", "2026-11-17T16:00:00.000Z", true);
  await note(radu, LONG, "2026-11-15T09:00:00.000Z");
  await note(eva, "Anulat de ea", "2026-11-16T09:00:00.000Z");
  await note(mara, "Alt eveniment", "2026-11-16T09:00:00.000Z");
});

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; essential?: boolean; primary?: boolean; omitEmptyOnPhone?: boolean; render: (row: unknown) => ReactNode };

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

/** A page as the server streams it, Suspense settled; React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const listTree = async (query: Record<string, string>, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) });
};
const planPage = async (query: Record<string, string> = {}, keepStyles = false) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id: race.raceId }), searchParams: Promise.resolve(query) }), keepStyles);

/** The list's table as the page hands it over: its columns, its rows, and one column drawn for one row. */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string; name: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { columns, rows, cell };
}

/** As the markup carries an apostrophe, a quotation mark and an ampersand. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
/** The words a person reads in a part of the page. */
const wordsOf = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The whole element that opens at `start`, by counting its own tag's openings and closings. */
function elementAt(page: string, start: number): string {
  const tag = /^<([a-z0-9]+)/.exec(page.slice(start))![1];
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(page); match; match = pattern.exec(page)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return page.slice(start, match.index + match[0].length);
  }
  return page.slice(start);
}
/** Every whole element of a part that carries a test id, in the order drawn. */
const elementsWith = (part: string, testid: string) =>
  [...part.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((match) => elementAt(part, match.index ?? 0));
/** The opening tag of the first element of a part that carries a test id. */
const tagOf = (part: string, testid: string) => new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`).exec(part)?.[0] ?? "";
/** Every Emotion rule a streamed page carries, joined, and what a tag's classes say under `@media print`. */
const rulesOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
const classesIn = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
const printOf = (page: string, tag: string) =>
  classesIn(tag)
    .flatMap((name) => [...rulesOf(page).matchAll(new RegExp(`@media print\\{\\.${name}\\{([^}]*)\\}`, "g"))].map((match) => match[1]))
    .join(";");

const day = (at: string, locale: "ro" | "en") => formatDay(new Date(at), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

/** A person's own block on the plan: the element that holds their name's link, up to the person's `li`. */
function personBlocks(page: string, testid: "plan-person" | "plan-unplaced-person" | "plan-table-person", id: string): string[] {
  return elementsWith(page, testid).filter((block) => block.includes(`/admin/volunteers/${id}"`) || block.includes(`data-person="${id}"`));
}

describe("§NNN «Membru {club}» on the «Voluntari» list", () => {
  it("is a hideable column headed by the club's short name, with its «?», after «Oraș»", async () => {
    for (const locale of ["ro", "en"] as const) {
      const words = (locale === "ro" ? ro : en).Admin.volunteers.screen;
      const { columns } = tableOf(await listTree({ eventId: race.raceId }, locale));
      const member = columns.find((column) => column.key === "member")!;
      expect(member.label, locale).toBe(words.columnMember.replace("{club}", CLUB_SHORT_NAME));
      expect(member.label).toBe(locale === "ro" ? `Membru ${CLUB_SHORT_NAME}` : `${CLUB_SHORT_NAME} member`);
      // The «?» quotes the form's own sentence, with the club's name as the form says it, and says it is checked against nothing.
      expect(member.hint).toBe(words.memberHint.replace("{club}", CLUB_NAME));
      expect(member.hint).toMatch(locale === "ro" ? /neverificată/ : /checked against nothing/);
      // Hideable under «Coloane» (neither essential nor the row's headline), and no line on a phone's card for a person who said no.
      expect(member.essential).toBeFalsy();
      expect(member.primary).toBeFalsy();
      expect(member.omitEmptyOnPhone).toBe(true);
      const keys = columns.map((column) => column.key);
      expect(keys.indexOf("member")).toBe(keys.indexOf("city") + 1);
    }
  });

  it("ticks whoever answered yes, its words for a screen reader, and draws nothing for the others", async () => {
    for (const locale of ["ro", "en"] as const) {
      const yes = (locale === "ro" ? ro : en).Admin.volunteers.screen.memberYes.replace("{club}", CLUB_SHORT_NAME);
      const tree = await listTree({ eventId: race.raceId }, locale);
      const { cell } = tableOf(tree);
      const { ana, dan, ion, zoe, radu } = race.people;
      for (const id of [ion, zoe, radu]) expect(cell("member", id), id).toBeNull();
      for (const id of [ana, dan]) {
        const tick = elements(cell("member", id)).find((element) => element.props["data-testid"] === "volunteer-member")!;
        expect(tick.props.role).toBe("img");
        expect(tick.props["aria-label"]).toBe(yes);
        expect(tick.props.title).toBe(yes);
        expect(tick.props.children).toBe("✓");
      }
      // Drawn: the table's cell and the phone's card, for Ana and Dan alone.
      const page = await html(tree);
      const ticks = [...page.matchAll(/<span[^>]*data-testid="volunteer-member"[^>]*>([^<]*)<\/span>/g)];
      expect(ticks).toHaveLength(4);
      for (const [tag, glyph] of ticks) {
        expect(glyph).toBe("✓");
        expect(tag).toContain(`aria-label="${escaped(yes)}"`);
        expect(tag).toContain('role="img"');
      }
    }
  });

  it("«Doar membrii {club}» leaves the ticked alone, and offers its tick in the filters", async () => {
    const all = tableOf(await listTree({ eventId: race.raceId }));
    expect(all.rows.map((row) => row.name).sort()).toEqual(["Ana Pop", "Dan Ene", "Eva Stan", "Ion Lupu", "Radu Liber", "Zoe Manea"]);
    const members = await listTree({ eventId: race.raceId, member: "1" });
    expect(tableOf(members).rows.map((row) => row.name).sort()).toEqual(["Ana Pop", "Dan Ene"]);
    // Anything else in the address is no filter.
    expect(tableOf(await listTree({ eventId: race.raceId, member: "yes" })).rows).toHaveLength(6);

    const page = await html(members);
    const filter = elementsWith(page, "volunteers-filter-member")[0];
    expect(wordsOf(filter)).toContain(escaped(ro.Admin.volunteers.screen.memberOnly.replace("{club}", CLUB_SHORT_NAME)));
    const box = /<input[^>]*name="member"[^>]*>/.exec(filter)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toContain('value="1"');
    expect(box).toContain('checked=""');
    // The strip still counts the whole scope: its figures are blind to this filter, as to the kit's.
    expect(page).toContain(escaped(ro.Admin.volunteers.screen.summaryTotal.replace("{count}", "6")));
  });
});

describe("§NNN the plan's read carries the organizers' words", () => {
  it("gives each person the decision and the live notes, newest first — never a deleted note, a cancelled person's or another event's", async () => {
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    const everybody = [...plan.points.flatMap(({ people }) => people), ...plan.unplaced];
    const byName = new Map(everybody.map((person) => [person.name, person]));
    expect(byName.get("Ana Pop")?.raceDayDecision).toBe(DECISION);
    expect(byName.get("Ana Pop")?.notes.map((one) => one.body)).toEqual(["Sună-o vineri", "Are mașină,\npoate duce apa."]);
    expect(byName.get("Radu Liber")?.raceDayDecision).toBe(RESERVE);
    expect(byName.get("Radu Liber")?.notes.map((one) => one.body)).toEqual([LONG]);
    for (const name of ["Dan Ene", "Ion Lupu", "Zoe Manea"]) {
      expect(byName.get(name)?.raceDayDecision, name).toBeNull();
      expect(byName.get(name)?.notes, name).toEqual([]);
    }
    // No author on the plan: the words, the moment and the id alone.
    expect(Object.keys(byName.get("Ana Pop")!.notes[0]).sort()).toEqual(["body", "createdAt", "id"]);

    const notes = await listVolunteerNotesForPlan(db, staff.ADMIN!, race.raceId);
    expect([...notes.keys()].sort()).toEqual([race.people.ana, race.people.radu].sort());
    expect(await listVolunteerNotesForPlan(db, staff.ADMIN!, "not-an-id")).toEqual(new Map());
  });

  it("reads the notes in one query for the event, however many people have them", async () => {
    const select = vi.spyOn(db, "select");
    try {
      await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
      const few = select.mock.calls.length;
      // Three more people, each with notes and a decision: the same number of queries.
      for (const name of ["Ilie Unu", "Ilie Doi", "Ilie Trei"]) {
        const id = await planVolunteer(db, { eventId: race.raceId, name, checkpointId: race.points.bridge }, NOW);
        await db.update(eventVolunteers).set({ raceDayDecision: "vine" }).where(eq(eventVolunteers.id, id));
        await note(id, "prima", "2026-11-16T08:00:00.000Z");
        await note(id, "a doua", "2026-11-17T08:00:00.000Z");
      }
      select.mockClear();
      const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
      expect(select.mock.calls.length).toBe(few);
      expect(plan.points.flatMap(({ people }) => people).filter((person) => person.name.startsWith("Ilie")).map((person) => person.notes.length)).toEqual([2, 2, 2]);
    } finally {
      select.mockRestore();
    }
  });

  it("reads the notes only through their own gate: every role it refuses is FORBIDDEN, and a reader it left out gets the decision alone", async () => {
    for (const role of STAFF_ROLES) {
      expect(mayReadVolunteerNotes(role), role).toBe(canManageVolunteers(role));
      if (canManageVolunteers(role)) await expect(listVolunteerNotesForPlan(db, staff[role]!, race.raceId), role).resolves.toBeInstanceOf(Map);
      else await expect(listVolunteerNotesForPlan(db, staff[role]!, race.raceId), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Should the notes' gate ever be narrower than the plan's: the plan is read, the decision with it, the notes empty.
    state.notesGate = false;
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    const ana = plan.points.flatMap(({ people }) => people).find((person) => person.id === race.people.ana)!;
    expect(ana.raceDayDecision).toBe(DECISION);
    expect(ana.notes).toEqual([]);
    const page = await planPage({ view: "points" });
    expect(page).toContain(escaped(ro.Admin.volunteers.plan.decision.replace("{decision}", DECISION)));
    expect(page).not.toContain('data-testid="plan-person-notes"');
    expect(page).not.toContain("Sună-o vineri");
  });
});

describe("§NNN «Planul voluntarilor» draws the decision and the notes under each person", () => {
  it("at a point and under «Fără punct» («Pe puncte»), and in the table's people cell («Tabel»), in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const decided = (decision: string) => escaped(words.decision.replace("{decision}", decision));
      const cut = `${[...LONG].slice(0, 280).join("").trimEnd()}…`;
      const anaNotes = [
        ["Sună-o vineri", day("2026-11-17T15:45:00.000Z", locale)],
        ["Are mașină, poate duce apa.", day("2026-11-16T08:30:00.000Z", locale)],
      ];
      const raduNotes = [[cut, day("2026-11-15T09:00:00.000Z", locale)]];
      const notesIn = (block: string) =>
        elementsWith(block, "plan-person-note").map((one) => [wordsOf(elementsWith(one, "plan-person-note-words")[0]), wordsOf(elementsWith(one, "plan-person-note-date")[0])]);

      const points = await planPage({ view: "points" });
      // Ana, at the junction: the decision, then her two live notes newest first, each its words and its day.
      const [ana] = personBlocks(points, "plan-person", race.people.ana);
      expect(wordsOf(elementsWith(ana, "plan-person-decision")[0]), locale).toBe(wordsOf(decided(DECISION)));
      expect(notesIn(ana)).toEqual(anaNotes.map(([text, when]) => [wordsOf(escaped(text)), wordsOf(escaped(when))]));
      expect(tagOf(ana, "plan-person-notes")).toContain(`aria-label="${escaped(words.notes)}"`);
      // The decision comes before the notes, both after the person's own line.
      expect(ana.indexOf('data-testid="plan-person-decision"')).toBeLessThan(ana.indexOf('data-testid="plan-person-notes"'));
      expect(ana.indexOf('data-testid="plan-person-name"')).toBeLessThan(ana.indexOf('data-testid="plan-person-decision"'));
      // Radu, under «Fără punct»: his decision and his long note, cut on one line.
      const [radu] = personBlocks(points, "plan-unplaced-person", race.people.radu);
      expect(wordsOf(elementsWith(radu, "plan-person-decision")[0])).toBe(wordsOf(decided(RESERVE)));
      expect(notesIn(radu)).toEqual(raduNotes.map(([text, when]) => [wordsOf(escaped(text)), wordsOf(escaped(when))]));
      // Dan and Zoe have neither: nothing is drawn for them.
      for (const id of [race.people.dan, race.people.zoe]) {
        const [block] = personBlocks(points, "plan-person", id);
        expect(block).not.toContain('data-testid="plan-person-decision"');
        expect(block).not.toContain('data-testid="plan-person-notes"');
      }
      // Never a cancelled person's words, nor another event's.
      expect(points).not.toContain("nu mai vine");
      expect(points).not.toContain("Anulat de ea");
      expect(points).not.toContain("Alt eveniment");

      // «Tabel»: under Ana's name and telephone in the people cell — the wide table and the phone's block alike.
      const table = await planPage();
      const anaRows = elementsWith(table, "plan-table-person").filter((block) => block.includes(">Ana Pop<"));
      expect(anaRows.length).toBeGreaterThanOrEqual(1);
      for (const row of anaRows) {
        expect(wordsOf(elementsWith(row, "plan-person-decision")[0])).toBe(wordsOf(decided(DECISION)));
        expect(notesIn(row)).toEqual(anaNotes.map(([text, when]) => [wordsOf(escaped(text)), wordsOf(escaped(when))]));
        expect(row.indexOf('data-testid="plan-table-person-name"')).toBeLessThan(row.indexOf('data-testid="plan-person-decision"'));
      }
      const zoeRows = elementsWith(table, "plan-table-person").filter((block) => block.includes(">Zoe Manea<"));
      for (const row of zoeRows) expect(row).not.toContain("plan-person-");
    }
  });

  it("prints the decision, which is the day's plan, and never the notes, in either view", async () => {
    for (const query of [{}, { view: "points" }] as Array<Record<string, string>>) {
      const page = await planPage(query, true);
      const decision = tagOf(page, "plan-person-decision");
      const notes = tagOf(page, "plan-person-notes");
      expect(decision, JSON.stringify(query)).not.toBe("");
      expect(notes).not.toBe("");
      expect(printOf(page, notes)).toContain("display:none");
      expect(printOf(page, decision)).not.toContain("display:none");
    }
  });
});
