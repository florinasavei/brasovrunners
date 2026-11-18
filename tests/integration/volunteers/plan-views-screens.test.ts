import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { changePlanPoint } from "@/modules/volunteers/plan-points";
import { sendVolunteerPoints } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { planAddress, planViewOf } from "@/app/[locale]/admin/events/[id]/plan-voluntari/plan-address";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnOpen, elementWith, type PlanRace, planPointBar, planPointsOf, seedPlanRace, wholeElementAt } from "../../helpers/volunteer-plan";

/**
 * §974, BR-REQ-050-02, BR-REQ-041-01, BR-REQ-060-01 — «Planul voluntarilor» in two views and in folds (the owner, 2026-11-17, of
 * the page's long run of cards: «vreau secțiuni colapsabile aici la plan voluntari că nu mai înțeleg nimic: de fapt tabel sau mai
 * multe views»; «și în loc de „modifică punctul” pune doar buton de edit»; «și vreau ca denumirea punctului să fie cu bold și mai
 * vizibilă»), rendered from a real database, in Romanian and in English:
 *
 * - **the views**: two plain links under the intro, «Tabel» and «Pe puncte» (`?view=table|points`), «Tabel» by default, the
 *   current one `aria-current="page"`, drawn on the server with no script; «Tabel» draws «Punctele, pe scurt» and not the
 *   points, «Pe puncte» the points and not the table; both draw the picture, «Adaugă un punct», the email and «Fără punct»;
 * - **the folds**: on «Pe puncte» the groups «Pe traseu» then «La start–finish», closed, each saying how many points and how
 *   many people; each point a fold of its own, closed, its bar the point's name in bold at a level-3 heading's size, its
 *   kilometre or «start–finish» and how many stand there; the picture, «Adaugă un punct» and the email are folds that say on
 *   their closed line what they hold; a point the address names opens with its group, a fold the last press saved in opens;
 * - **the pencil**: «Modifică punctul» is a 44-pixel glyph alone, named and with its tooltip, opening the same form, the
 *   removal still inside it;
 * - **the way back**: every form carries the view it was drawn in, and every press comes back to it — a point's press to
 *   the point, open; a fold's press to the fold, open; a refusal to the alert;
 * - **the paper**: a group and a point print open, the picture prints alone, the views and the builders never print.
 *
 * What each cell of the table says is `plan-table-screens.test.ts`; the people and the forms inside a point, `plan.test.ts`
 * and `plan-points-screens.test.ts`; both views in a browser, on a phone and on a desktop, `tests/e2e/volunteer-plan-mail.spec.ts`.
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
  getFormatter: async () => createFormatter({ locale: state.locale, timeZone: "Europe/Bucharest" }),
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
// The house's typed routing, reduced to what the page asks of it (`plan.test.ts`'s stand-in).
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
// The session's door as the real one answers (`session.ts#requireStaffCapability`): the predicate asked of the actor.
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError } = await import("@/shared/errors/domain-error");
  return {
    DEV_STAFF_COOKIE: "dev-staff",
    requireStaff: async () => state.actor,
    requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
      if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "the door refused");
      return state.actor;
    },
  };
});

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { addPlanPointAction, editPlanPointAction, placeVolunteerAction, removePlanPointAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");

const NOW = new Date("2026-11-17T10:00:00.000Z");
const PIATA = "45.64271, 25.58871";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  // Ana and Zoe at the junction (1.2 km), Dan at the water (5.5), Ion at the bridge (7.25), Radu at no point, Eva cancelled.
  race = await seedPlanRace(db, NOW);
});

/** A point of the plan's own, added by the service; its id. */
async function ownPoint(place: "route" | "startFinish", name: string, km = "", coordinates = ""): Promise<string> {
  return (await changePlanPoint(db, staff.ADMIN!, { kind: "add", eventId: race.raceId, place, name, km, coordinates }, NOW)).id;
}
const place = (id: string, checkpointId: string) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, NOW);
/** The race with its start–finish: «Kituri și numere» with Radu at it and where it is, and «Linia de start» with nobody. */
async function withStartFinish() {
  const kits = await ownPoint("startFinish", "Kituri și numere", "", PIATA);
  const start = await ownPoint("startFinish", "Linia de start");
  await place(race.people.radu, kits);
  return { kits, start };
}

/** A page as the server streams it, Suspense settled; React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, id = race.raceId, keepStyles = false) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) }), keepStyles);

const planPath = (locale = "ro") => `/${locale}/admin/events/${race.raceId}/plan-voluntari`;
/** As the markup carries an apostrophe, a quotation mark and an ampersand. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
/** A part of the page without its tags: the words a person reads. */
const wordsOf = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The opening tag of the first element that carries `attribute`. */
const tagOf = (part: string, attribute: string) => new RegExp(`<[a-z0-9]+[^>]*${attribute}[^>]*>`).exec(part)?.[0] ?? "";
/** The text of the first element that carries the test id. */
const textOf = (part: string, testid: string) => new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`).exec(part)?.[1] ?? null;
/** A fold's own bar, its `<summary>`, whole. */
const barOf = (fold: string) => /^<details[^>]*>(<summary[\s\S]*?<\/summary>)/.exec(fold)?.[1] ?? "";
/** Every Emotion rule a streamed page carries, joined: what a class of its markup means. */
const rulesOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
/** The Emotion classes of an opening tag. */
const classesIn = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
/** What a class's rules say under `@media print`, joined — the rules of its descendants and its parts too. */
const printOf = (page: string, names: readonly string[]) =>
  names
    .flatMap((name) => [...rulesOf(page).matchAll(/@media print\{([^{}]*\{[^}]*\})+/g)].flatMap((block) => [...block[0].matchAll(new RegExp(`\\.${name}([^{]*)\\{([^}]*)\\}`, "g"))].map((rule) => `${rule[1]}{${rule[2]}}`)))
    .join(";");
/** What a class's own rules say on the screen (outside `@media`), with the selector's tail: `>summary{…}`, `[open]{…}`. */
const screenOf = (page: string, names: readonly string[]) => names.flatMap((name) => [...rulesOf(page).matchAll(new RegExp(`(?:^|\\})\\.${name}([^{]*)\\{([^}]*)\\}`, "g"))].map((rule) => `${rule[1]}{${rule[2]}}`)).join(";");

/** Every form of a page, each whole. */
const formsOf = (page: string) => [...page.matchAll(/<form\b/g)].map((match) => wholeElementAt(page, match.index));

describe("§974 «Tabel» and «Pe puncte»: two views by a link each", () => {
  it("draws the two links under the intro — plain links, «Tabel» by default and marked, no script — in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const queries: Record<string, string>[] = [{}, { view: "table" }, { view: "points" }, { view: "nothing-else" }];
      for (const query of queries) {
        const page = await planPage(query);
        const current = query.view === "points" ? "points" : "table";
        const views = elementWith(page, 'data-testid="plan-views"');
        // Under the intro, before «Tipărește planul» and before either view.
        expect(page.indexOf('data-testid="plan-views"'), locale).toBeGreaterThan(page.indexOf(escaped(words.helpPoints)));
        expect(page.indexOf('data-testid="plan-views"')).toBeLessThan(page.indexOf(escaped(words.print)));
        // A labelled row of two plain links, each with its glyph, its address the page's with the view in it.
        expect(views).toMatch(new RegExp(`<nav[^>]*aria-label="${escaped(words.views.label)}"`));
        const links = [...views.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({ attributes: match[1], words: wordsOf(match[2]), glyphs: (match[2].match(/<svg/g) ?? []).length }));
        expect(links.map((link) => link.words)).toEqual([words.views.table, words.views.points]);
        expect(links.map((link) => /href="([^"]*)"/.exec(link.attributes)?.[1])).toEqual([`${planPath(locale)}?view=table`, `${planPath(locale)}?view=points`]);
        expect(links.map((link) => link.glyphs)).toEqual([1, 1]);
        // The current one, and only it, says so — «Tabel» for no view and for a view the page does not know.
        expect(links.map((link) => /aria-current="page"/.test(link.attributes))).toEqual([current === "table", current === "points"]);
        // No client code in the row: the scroller's island (`SubNavCurrent`) draws a hidden span, and this row has none.
        expect(views).not.toMatch(/<span hidden/);
      }
    }
    // The view any address or form names, read one way: «Pe puncte» when it says so, «Tabel» otherwise.
    expect([planViewOf("points"), planViewOf("table"), planViewOf(""), planViewOf(undefined), planViewOf("POINTS")]).toEqual(["points", "table", "table", "table", "table"]);
  });

  it("draws «Punctele, pe scurt» and not the points on «Tabel», the points and not the table on «Pe puncte» — and the folds under the plan and «Fără punct» on both", async () => {
    await withStartFinish();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const table = await planPage();
      expect(table).toContain('data-testid="plan-table-section"');
      for (const absent of ['id="plan-list"', 'data-testid="plan-summary"', 'data-testid="plan-group"', 'data-testid="plan-point"', 'data-testid="plan-place-form"', 'data-testid="plan-point-edit"']) {
        expect(table, `${locale}: ${absent}`).not.toContain(absent);
      }
      const points = await planPage({ view: "points" });
      expect(points).not.toContain('data-testid="plan-table-section"');
      expect(points).not.toContain('data-table-id="volunteer-plan"');
      expect(points).toContain('id="plan-list"');
      expect(planPointsOf(points)).toHaveLength(5);
      // «Poze și hărți» first, under the intro and above the views (§NNN); then the view's own plan, the two folds, and the
      // people at no point — on both.
      for (const page of [table, points]) {
        const at = (needle: string) => page.indexOf(needle);
        const plan = at('data-testid="plan-table-section"') >= 0 ? at('data-testid="plan-table-section"') : at('id="plan-list"');
        expect(at('data-testid="plan-maps-section"')).toBeGreaterThan(at('data-testid="plan-help-points"'));
        expect(at('data-testid="plan-views"')).toBeGreaterThan(at('data-testid="plan-maps-section"'));
        expect(plan).toBeGreaterThan(at('data-testid="plan-views"'));
        expect(at('data-testid="plan-points-section"')).toBeGreaterThan(plan);
        expect(at('data-testid="plan-mail-section"')).toBeGreaterThan(at('data-testid="plan-points-section"'));
        expect(at('data-testid="plan-unplaced"')).toBeGreaterThan(at('data-testid="plan-mail-section"'));
      }
    }
  });

  it("names a point of «Tabel» as a link to that point on «Pe puncte», open — and the address opens it there, with its group, and nothing else", async () => {
    const { kits, start } = await withStartFinish();
    const table = await planPage();
    const links = [...table.matchAll(/<a[^>]*data-testid="plan-table-point"[^>]*>/g)].map((match) => /href="([^"]*)"/.exec(match[0])?.[1]);
    // The wide table and the phone's blocks, each point once in each, the route first.
    const expected = [race.points.junction, race.points.water, race.points.bridge, kits, start].map((id) => `${planPath()}?view=points&amp;open=${id}#point-${id}`);
    expect(links).toEqual([...expected, ...expected]);

    // Followed: the water is open, and its group «Pe traseu»; every other point, and «La start–finish», closed.
    const page = await planPage({ view: "points", open: race.points.water });
    const groups = [elementWith(page, 'data-group="route"'), elementWith(page, 'data-group="startFinish"')];
    expect(groups.map(drawnOpen)).toEqual([true, false]);
    expect(planPointsOf(page).map((point) => [/id="point-([^"]*)"/.exec(point)?.[1], drawnOpen(point)])).toEqual([
      [race.points.junction, false],
      [race.points.water, true],
      [race.points.bridge, false],
      [kits, false],
      [start, false],
    ]);
    // A start–finish point opens the other group.
    const atKits = await planPage({ view: "points", open: kits });
    expect([elementWith(atKits, 'data-group="route"'), elementWith(atKits, 'data-group="startFinish"')].map(drawnOpen)).toEqual([false, true]);
    // Another event's point, a malformed id, or «Tabel»: nothing opens.
    const nothingOpens: Record<string, string>[] = [{ view: "points", open: race.points.elsewhere }, { view: "points", open: "not-an-id" }, { view: "points" }];
    for (const query of nothingOpens) {
      const closed = await planPage(query);
      expect([...closed.matchAll(/<details[^>]*\sopen=""/g)].length, JSON.stringify(query)).toBe(0);
    }
    expect(await planPage({ view: "table", open: race.points.water })).not.toContain(`id="point-${race.points.water}"`);
  });
});

describe("§974 «Pe puncte»: the groups and the points as folds", () => {
  it("folds the route first, then the start–finish, each closed and saying how many points and how many people", async () => {
    await withStartFinish();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage({ view: "points" });
      const route = elementWith(page, 'data-group="route"');
      const startFinish = elementWith(page, 'data-group="startFinish"');
      expect(page.indexOf('data-group="route"')).toBeLessThan(page.indexOf('data-group="startFinish"'));
      for (const [fold, title, line, glyph] of [
        [route, words.groups.route, locale === "ro" ? "3 puncte · 4 voluntari" : "3 points · 4 volunteers", "RouteIcon"],
        [startFinish, words.groups.startFinish, locale === "ro" ? "2 puncte · 1 voluntar" : "2 points · 1 volunteer", "FlagIcon"],
      ] as const) {
        expect(drawnOpen(fold), locale).toBe(false);
        // The bar: a level-3 heading with the group's glyph, its name, and on the same line how many points and people.
        const bar = barOf(fold);
        expect(bar).toMatch(new RegExp(`<h3[^>]*><svg[^>]*aria-hidden="true"[^>]*data-testid="${glyph}"`));
        expect(textOf(bar, "plan-group-count")).toBe(line);
        expect(wordsOf(bar)).toBe(`${escaped(title)} ${line}`);
      }
      expect(words.groups.startFinish).toBe(locale === "ro" ? "La start–finish" : "At the start–finish");
      // The route's points numbered in an ordered list, the start–finish's in a list, each labelled by its group.
      expect(route).toMatch(/<ol[^>]*aria-labelledby="plan-group-route"/);
      expect(startFinish).toMatch(/<ul[^>]*aria-labelledby="plan-group-start-finish"/);
    }
    // A group with no point says so inside, closed, and counts none.
    state.locale = "ro";
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.planOnly, true));
    const bare = elementWith(await planPage({ view: "points" }), 'data-group="startFinish"');
    expect(textOf(barOf(bare), "plan-group-count")).toBe("0 puncte · niciun voluntar");
    expect(textOf(bare, "plan-group-none")).toBe(escaped(ro.Admin.volunteers.plan.groups.startFinishNone));
  });

  it("gives each point a closed fold whose bar is its name in bold at a level-3 heading's size, its kilometre or «start–finish», and how many stand there", async () => {
    await withStartFinish();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const page = await planPage({ view: "points" }, race.raceId, true);
      const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
      const points = planPointsOf(plain);
      expect(points.map(planPointBar), locale).toEqual(
        locale === "ro"
          ? [
              { name: "1. Intersecția Stejeriș", line: "1,2 km · 2 voluntari" },
              { name: "2. Apă la cabană", line: "5,5 km · 1 voluntar" },
              { name: "3. Podul de lemn", line: "7,25 km · 1 voluntar" },
              { name: "Kituri și numere", line: "start–finish · 1 voluntar" },
              { name: "Linia de start", line: "start–finish · niciun voluntar" },
            ]
          : [
              { name: "1. Stejeriș junction", line: "1.2 km · 2 volunteers" },
              { name: "2. Water at the hut", line: "5.5 km · 1 volunteer" },
              { name: "3. The wooden bridge", line: "7.25 km · 1 volunteer" },
              { name: "Kituri și numere", line: "start–finish · 1 volunteer" },
              { name: "Linia de start", line: "start–finish · no volunteers" },
            ],
      );
      for (const point of points) {
        // A native fold, closed, its id the point's own; the house's boxed fold (a border, the bar's 44 pixels).
        expect(point).toMatch(/^<details[^>]*id="point-[0-9a-f-]{36}"[^>]*data-testid="plan-point"/);
        expect(drawnOpen(point)).toBe(false);
        const fold = classesIn(tagOf(point, 'data-testid="plan-point"'));
        expect(screenOf(page, fold)).toMatch(/^\{border:1px solid/);
        expect(screenOf(page, fold)).toMatch(/>summary\{[^}]*min-height:44px/);
        // The bar: an h4 under its group's h3, at the size of a level-3 heading, with the point's glyph; the name in bold.
        const bar = barOf(point);
        const heading = tagOf(bar, 'data-testid="plan-point-title"');
        expect(heading).toMatch(/^<h4/);
        expect(screenOf(page, classesIn(heading))).toContain("font-size:1rem");
        expect(bar).toMatch(/<h4[^>]*><svg[^>]*aria-hidden="true"[^>]*data-testid="PinDropIcon"/);
        expect(screenOf(page, classesIn(tagOf(bar, 'data-testid="plan-point-name"')))).toContain("font-weight:700");
        // Nothing to press in the bar but the bar itself: the pencil is inside.
        expect(bar).not.toMatch(/<(a|button|input)\b/);
      }
      // Open, what the point held as a card: where it is, its people with their telephones and «Scoate», the pencil, «Pune aici».
      const junction = points[0];
      for (const inside of ['data-testid="plan-person-phone"', 'data-testid="plan-take-off"', 'data-testid="plan-point-edit"']) expect(junction, inside).toContain(inside);
      const kits = points[3];
      for (const inside of ['data-testid="plan-point-coordinates"', 'data-testid="plan-point-map"', 'data-testid="plan-person-name"', 'data-testid="plan-point-edit"']) expect(kits, inside).toContain(inside);
    }
    // Somebody at no point: «Pune aici» inside every point's fold.
    await place(race.people.radu, "");
    expect(planPointsOf(await planPage({ view: "points" })).map((point) => point.includes('data-testid="plan-place-form"'))).toEqual([true, true, true, true, true]);
  });

  it("names the point in bold in the table too, and the counted words of the bars in three forms in Romanian, never an ICU plural", async () => {
    await withStartFinish();
    const page = await planPage({}, race.raceId, true);
    for (const link of [...page.matchAll(/<a[^>]*data-testid="plan-table-point"[^>]*>/g)]) expect(screenOf(page, classesIn(link[0]))).toContain("font-weight:700");
    for (const catalogue of [ro, en]) {
      const plan = catalogue.Admin.volunteers.plan;
      for (const counted of [plan.groups.points, plan.people, plan.mail.toTell, plan.maps.pictures, plan.maps.links]) expect(Object.keys(counted)).toEqual(["one", "few", "other"]);
      expect(JSON.stringify([plan.views, plan.groups, plan.people, plan.peopleNone, plan.pointKm, plan.mail.toTell, plan.maps, plan.unplaced])).not.toMatch(/plural|select,/);
    }
    expect([ro.Admin.volunteers.plan.groups.points.other, ro.Admin.volunteers.plan.people.other, ro.Admin.volunteers.plan.mail.toTell.other]).toEqual([
      "{count} de puncte",
      "{count} de voluntari",
      "{count} de voluntari de anunțat",
    ]);
    expect([ro.Admin.volunteers.plan.views, en.Admin.volunteers.plan.views]).toEqual([
      { label: "Cum vezi planul", table: "Tabel", points: "Pe puncte" },
      { label: "How you see the plan", table: "Table", points: "By point" },
    ]);
  });
});

describe("§974 «Modifică punctul»: the pencil", () => {
  it("is a 44-pixel glyph alone, named «Modifică punctul: …» and with that tooltip, opening the same form — the removal still inside it", async () => {
    const { kits } = await withStartFinish();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan.points;
      const page = await planPage({ view: "points" }, race.raceId, true);
      const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
      for (const [point, name] of [
        [elementWith(plain, `id="point-${race.points.water}"`), locale === "ro" ? "Apă la cabană" : "Water at the hut"],
        [elementWith(plain, `id="point-${kits}"`), "Kituri și numere"],
      ] as const) {
        const pencil = elementWith(point, 'data-testid="plan-point-edit"');
        // A native fold, closed, its bar the glyph alone: no word drawn, the name said to a reader and in the tooltip.
        expect(pencil).toMatch(/^<details/);
        expect(drawnOpen(pencil)).toBe(false);
        const bar = barOf(pencil);
        const summary = /^<summary[^>]*>/.exec(bar)?.[0] ?? "";
        expect(summary).toContain(`aria-label="${escaped(`${words.edit}: ${name}`)}"`);
        expect(summary).toContain(`title="${escaped(`${words.edit}: ${name}`)}"`);
        expect(wordsOf(bar)).toBe("");
        expect(bar).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="EditIcon"/);
        // A thumb's square, and never on paper.
        const rules = screenOf(page, classesIn(tagOf(point, 'data-testid="plan-point-edit"')));
        expect(rules).toMatch(/>summary\{[^}]*width:44px;height:44px/);
        expect(printOf(page, classesIn(tagOf(point, 'data-testid="plan-point-edit"')))).toContain("display:none");
        // Open: the form it always opened, under the words «Modifică punctul».
        expect(pencil).toContain(`>${escaped(words.edit)}</p>`);
        expect(pencil).toContain('data-testid="plan-point-edit-form"');
        expect(pencil).toContain('data-testid="plan-point-save"');
      }
      // «Șterge punctul» inside the pencil of a point added here, and none on an editor's.
      expect(elementWith(elementWith(plain, `id="point-${kits}"`), 'data-testid="plan-point-edit"')).toContain('data-testid="plan-point-remove-form"');
      expect(elementWith(elementWith(plain, `id="point-${race.points.water}"`), 'data-testid="plan-point-edit"')).not.toContain('data-testid="plan-point-remove-form"');
    }
  });
});

describe("§974 the folds: «Poze și hărți» above the plan (§NNN), «Adaugă un punct» and the email under it, «Fără punct» last", () => {
  it("draws each as a closed fold saying what it holds, in both views and both languages", async () => {
    await withStartFinish();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      for (const view of ["table", "points"]) {
        const page = await planPage({ view });
        const maps = elementWith(page, 'data-testid="plan-maps-section"');
        const unplaced = elementWith(page, 'data-testid="plan-unplaced"');
        const add = elementWith(page, 'data-testid="plan-points-section"');
        const mail = elementWith(page, 'data-testid="plan-mail-section"');
        for (const [fold, id, title, glyph] of [
          [maps, "plan-maps", words.maps.title, "ImageIcon"],
          [add, "plan-points", words.points.addTitle, "AddIcon"],
          [mail, "plan-mail", words.mail.title, "MailIcon"],
          [unplaced, "plan-unplaced", words.unplacedTitle, "VolunteerActivismIcon"],
        ] as const) {
          expect(fold, `${locale} ${view}: ${id}`).toMatch(new RegExp(`^<details[^>]*id="${id}"`));
          expect(drawnOpen(fold)).toBe(false);
          expect(barOf(fold)).toMatch(new RegExp(`<h3[^>]*><svg[^>]*aria-hidden="true"[^>]*data-testid="${glyph}"[^>]*>[\\s\\S]*?</svg>${escaped(title)}`));
        }
        // What each holds, on its closed line: no picture and no link yet; the four still to tell — Ana, Dan, Ion and Radu (Zoe
        // has no address); nobody at no point.
        expect(textOf(barOf(maps), "plan-maps-state")).toBe(`${words.maps.picturesNone} · ${words.maps.linksNone}`);
        expect(textOf(barOf(unplaced), "plan-unplaced-count")).toBe(escaped(words.peopleNone));
        expect(textOf(barOf(mail), "plan-mail-state")).toBe(locale === "ro" ? "4 voluntari de anunțat" : "4 volunteers to tell");
        // Adding holds nothing to say: its bar is its title alone.
        expect(wordsOf(barOf(add))).toBe(escaped(words.points.addTitle));
        // Inside: the add form, the email's numbers and its button.
        expect(add).toContain('data-testid="plan-point-add-form"');
        expect(mail).toContain('data-testid="plan-mail-counts"');
        expect(mail).toContain('data-testid="plan-mail-send"');
      }
    }
    // Everybody told: the closed line says so. Nobody with an address at a point: it says that.
    state.locale = "ro";
    await sendVolunteerPoints(db, staff.ADMIN!, { eventId: race.raceId }, NOW);
    expect(textOf(elementWith(await planPage(), 'data-testid="plan-mail-section"'), "plan-mail-state")).toBe(ro.Admin.volunteers.plan.mail.toTellAllTold);
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.otherId));
    expect(textOf(elementWith(await planPage({}, race.otherId), 'data-testid="plan-mail-section"'), "plan-mail-state")).toBe(ro.Admin.volunteers.plan.mail.toTellNone);
  });

  it("opens the fold the last press saved in, and «Adaugă un punct» by itself on a plan with no point", async () => {
    const open = (page: string) => ["plan-maps-section", "plan-points-section", "plan-mail-section", "plan-unplaced"].filter((testid) => drawnOpen(elementWith(page, `data-testid="${testid}"`)));
    for (const view of ["table", "points"]) {
      expect(open(await planPage({ view, saved: "planMaps" }))).toEqual(["plan-maps-section"]);
      expect(open(await planPage({ view, saved: "planUnplaced" }))).toEqual(["plan-unplaced"]);
      expect(open(await planPage({ view, saved: "planPointAdded" }))).toEqual(["plan-points-section"]);
      expect(open(await planPage({ view, saved: "planPointsSent" }))).toEqual(["plan-mail-section"]);
      expect(open(await planPage({ view, saved: "volunteerPlaced" }))).toEqual([]);
    }
    // A plan with no point: adding one is the page's first work.
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.otherId));
    expect(open(await planPage({}, race.otherId))).toEqual(["plan-points-section"]);
    expect(await planPage({}, race.otherId)).toContain('data-testid="plan-no-points"');
    expect(await planPage({ view: "points" }, race.otherId)).toContain('data-testid="plan-no-points"');
  });
});

describe("§974 the way back: every form carries its view, every press comes back to it", () => {
  it("puts the view each form was drawn in into every form of the page", async () => {
    await withStartFinish();
    await place(race.people.radu, "");
    for (const view of ["table", "points"] as const) {
      const forms = formsOf(await planPage({ view }));
      // «Tabel»: the add, the upload and the email; «Pe puncte» adds each point's «Pune aici», «Scoate», save and removal.
      expect(forms.length, view).toBeGreaterThan(view === "table" ? 1 : 10);
      for (const form of forms) expect(form, view).toContain(`<input type="hidden" name="view" value="${view}"/>`);
    }
  });

  it("brings a point's press back to the point, open, in the view it came from — and a refusal to the alert, in that view", async () => {
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: race.raceId, ...fields })) data.set(key, value);
      return data;
    };
    const pressed = async (press: () => Promise<unknown>) => {
      state.redirected.length = 0;
      await expect(Promise.resolve().then(press)).rejects.toThrow("NEXT_REDIRECT");
      return state.redirected[0];
    };
    const back = (query: string, hash: string) => `${planPath()}?${query}#${hash}`;
    const water = race.points.water;

    // «Pune aici» and «Scoate»: to the point, open.
    expect(await pressed(() => placeVolunteerAction(form({ view: "points", volunteerId: race.people.radu, checkpointId: water, at: water })))).toBe(back(`view=points&open=${water}`, `point-${water}`));
    expect(await pressed(() => placeVolunteerAction(form({ view: "points", volunteerId: race.people.radu, checkpointId: "", at: water })))).toBe(back(`view=points&open=${water}`, `point-${water}`));
    // A form drawn before the views names none: a point's press comes back to «Pe puncte», the one view that draws points.
    expect(await pressed(() => placeVolunteerAction(form({ volunteerId: race.people.radu, checkpointId: water, at: water })))).toBe(back(`view=points&open=${water}`, `point-${water}`));
    // Refused — another event's point — to the alert, the view kept.
    expect(await pressed(() => placeVolunteerAction(form({ view: "points", volunteerId: race.people.ion, checkpointId: race.points.elsewhere, at: water })))).toBe(back(`view=points&open=${water}&planError=NOT_FOUND`, "admin-alert"));

    // «Salvează punctul»: to the point, open; refused, to the alert.
    const spring = await ownPoint("route", "Izvor", "3,4");
    expect(await pressed(() => editPlanPointAction(form({ view: "points", pointId: spring, place: "route", name: "Izvorul rece", km: "3,4", coordinates: "" })))).toBe(back(`view=points&open=${spring}`, `point-${spring}`));
    expect(await pressed(() => editPlanPointAction(form({ view: "points", pointId: spring, place: "route", name: "", km: "3,4", coordinates: "" })))).toBe(back(`view=points&open=${spring}&planError=PLAN_POINT_NAME_MISSING`, "admin-alert"));
    // The refused point is drawn open under the alert, its group too: the pencil is one press away.
    const refused = await planPage({ view: "points", open: spring, planError: "PLAN_POINT_NAME_MISSING" });
    expect(refused).toContain('id="admin-alert"');
    expect(drawnOpen(elementWith(refused, `id="point-${spring}"`))).toBe(true);
    expect(drawnOpen(elementWith(refused, 'data-group="route"'))).toBe(true);
    // «Șterge punctul»: to the plan's list, where the point no longer is.
    expect(await pressed(() => removePlanPointAction(form({ view: "points", pointId: spring })))).toBe(back("view=points", "plan-list"));

    // «Adaugă punctul», a fold of both views: back to its fold, open — and on «Pe puncte» to the new point too, open.
    const added = async (view: string) => {
      const address = await pressed(() => addPlanPointAction(null, form({ view, place: "route", name: `Punct ${view}`, km: "2", coordinates: "" })));
      const [row] = await db.select({ id: eventCheckpoints.id }).from(eventCheckpoints).where(eq(eventCheckpoints.nameRo, `Punct ${view}`));
      return { address, id: row.id };
    };
    const onPoints = await added("points");
    expect(onPoints.address).toBe(back(`view=points&open=${onPoints.id}&saved=planPointAdded`, "plan-points"));
    const onTable = await added("table");
    expect(onTable.address).toBe(back("view=table&saved=planPointAdded", "plan-points"));
    // The address it gives is the one the page reads: the point and its group open, the fold open.
    const page = await planPage({ view: "points", open: onPoints.id, saved: "planPointAdded" });
    expect(drawnOpen(elementWith(page, `id="point-${onPoints.id}"`))).toBe(true);
    expect(drawnOpen(elementWith(page, 'data-group="route"'))).toBe(true);
    expect(drawnOpen(elementWith(page, 'data-testid="plan-points-section"'))).toBe(true);
  });

  it("builds every address of the page one way: the view first, then what it opens or says, then where it lands", () => {
    const path = "/ro/admin/events/x/plan-voluntari";
    expect(planAddress(path, { view: "table" })).toBe(`${path}?view=table`);
    expect(planAddress(path, { view: "points", open: "p", hash: "point-p" })).toBe(`${path}?view=points&open=p#point-p`);
    // «Tabel» opens no point: it draws none.
    expect(planAddress(path, { view: "table", open: "p", savedIn: "planPointAdded", hash: "plan-points" })).toBe(`${path}?view=table&saved=planPointAdded#plan-points`);
    expect(planAddress(path, { view: "points", planError: "NOT_FOUND", hash: "admin-alert" })).toBe(`${path}?view=points&planError=NOT_FOUND#admin-alert`);
    expect(planAddress(path, { view: "points", open: "p", planError: "NOT_FOUND", hash: "admin-alert" })).toBe(`${path}?view=points&open=p&planError=NOT_FOUND#admin-alert`);
    // The helper names no word of the plan and no person: it is no reader of the plan (`plan-never-leaves.test.ts`).
    const source = readFileSync("src/app/[locale]/admin/events/[id]/plan-voluntari/plan-address.ts", "utf8");
    expect(source).not.toMatch(/checkpointId|volunteers\.plan\.|modules\/volunteers/);
  });
});

describe("§974 on paper", () => {
  it("prints the groups and the points open with no arrow, the views and the builders never, and a plan with no picture or link without its fold", async () => {
    await withStartFinish();
    const page = await planPage({ view: "points" }, race.raceId, true);
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    // A group and a point: the body a closed fold hides is shown, the arrow left off.
    for (const attribute of ['data-group="route"', 'data-group="startFinish"', `id="point-${race.points.water}"`]) {
      const print = printOf(page, classesIn(tagOf(plain, attribute)));
      expect(print, attribute).toMatch(/::details-content\{display:block;content-visibility:visible/);
      expect(print, attribute).toMatch(/>summary::before\{display:none/);
      expect(print, attribute).not.toMatch(/^\{display:none|;\{display:none/);
    }
    // Never on paper: the views, the add, the email, and — with no picture — the picture's fold.
    for (const testid of ["plan-views", "plan-points-section", "plan-mail-section", "plan-maps-section"]) {
      expect(printOf(page, classesIn(tagOf(plain, `data-testid="${testid}"`))), testid).toMatch(/(^|;)\{display:none/);
    }
  });
});
