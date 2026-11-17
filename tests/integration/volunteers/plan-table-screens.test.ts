import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { changePlanPoint } from "@/modules/volunteers/plan-points";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { elementWith, type PlanRace, planPointsOf, planSummaryOf, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §974, BR-REQ-050-02, BR-REQ-041-01, BR-REQ-060-01 — «Punctele, pe scurt», the view «Tabel» of «Planul voluntarilor» (the
 * owner, 2026-11-17, four days before the race: «aș vrea să văd punctele ca și tabel, mai ales pe traseu»), rendered from a
 * real database, in Romanian and in English:
 *
 * - the section is the page's default view: right under the title, the intro and the two views' links — after «Tipărește
 *   planul», before the picture, «Adaugă un punct», the email and «Fără punct», and with none of the points' folds — under a
 *   level-3 heading with the house's list glyph, and holds the house's table (`AdminTable`) with six columns: «Nr.»,
 *   «Punct», «Km», «Coordonate», «Voluntari», «Câți»;
 * - the route's points first, by kilometre and so by number — a point of the plan's own between the editor's —, then the
 *   start–finish points as the page lists them; a point's name, in bold, links to that point on «Pe puncte», open
 *   (`?view=points&open=<id>#point-<id>`); the kilometre as the point's line writes it, or «start–finish»; the coordinates
 *   with «Deschide pe hartă», or «—»; the people the point has, in its order, each with a `tel:` link of digits, «niciunul»
 *   where nobody stands; how many;
 * - under it, the people placed and the points with nobody, each a counted phrase (`countForm`);
 * - one page, no page sizes; on a phone a block a point, headed by its name, with no «Nr.» at the start–finish;
 * - on paper the table is printed whole as a table, its map links left off, its names and telephones as text; every link
 *   is a thumb's 44 pixels (BR-REQ-041-01 criterion 6);
 * - a plan with no point has no table, and the page is the 404 it was for whoever may not work the volunteers.
 *
 * The points themselves are `plan.test.ts` and `plan-points-screens.test.ts`, the two views and their folds
 * `plan-views-screens.test.ts`; the table on a phone and on a desktop in a browser is `tests/e2e/volunteer-plan-mail.spec.ts`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");

const NOW = new Date("2026-11-17T10:00:00.000Z");
const PIATA = "45.64271, 25.58871";
const PIATA_MAP = "https://www.google.com/maps/search/?api=1&amp;query=45.64271%2C25.58871";

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

/**
 * The race as the tests below read it: the editor's three points; a point of the plan's own on the route at 3.4 km, added
 * after them and with nobody, so the route's order is the kilometre's and not the order typed; and two start–finish points,
 * «Kituri și numere» (with coordinates, Radu at it) and then «Linia de start» (nobody).
 */
async function fullPlan() {
  const spring = await ownPoint("route", "Izvor", "3,4", PIATA);
  const kits = await ownPoint("startFinish", "Kituri și numere", "", PIATA);
  const start = await ownPoint("startFinish", "Linia de start");
  await place(race.people.radu, kits);
  return { spring, kits, start };
}

/** A page as the server streams it, Suspense settled; React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (id = race.raceId, keepStyles = false, query: Record<string, string> = {}) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) }), keepStyles);

/** As the markup carries an apostrophe and a quotation mark. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
/** A part of the page without its tags: the words a person reads. */
const wordsOf = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** «Punctele, pe scurt», whole: from its section's opening tag to the picture's section, which the page draws next. */
const sectionOf = (page: string) => page.slice(page.indexOf('data-testid="plan-table-section"'), page.indexOf('data-testid="plan-picture-section"'));
/** The wide table of a part, and what comes after it in the section: the phone's blocks and the line under the table. */
const wideOf = (part: string) => part.slice(part.indexOf("<table"), part.indexOf("</table>"));
const afterTableOf = (part: string) => part.slice(part.indexOf("</table>"));
/** The wide table's rows, each as its cells' markup. */
const rowsOf = (wide: string) => [...wide.matchAll(/<tr[^>]*data-row-separator="[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]));
/** The texts of every element of a part that carries a test id, in the order drawn. */
const textsOf = (part: string, testid: string) => [...part.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((match) => match[1]);
/** The opening tags of every element of a part that carries a test id. */
const tagsOf = (part: string, testid: string) => [...part.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((match) => match[0]);
/** Every Emotion rule a streamed page carries, joined: what a class of its markup means. */
const rulesOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
/** The Emotion classes of an opening tag. */
const classesIn = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
/** What a class says under `@media print`, joined. */
const printOf = (page: string, names: readonly string[]) =>
  names.flatMap((name) => [...rulesOf(page).matchAll(new RegExp(`@media print\\{\\.${name}\\{([^}]*)\\}`, "g"))].map((match) => match[1])).join(";");
/** Whether a class sets a 44-pixel height on screen. */
const tallClass = (page: string, names: readonly string[]) => names.some((name) => new RegExp(`\\.${name}\\{[^}]*min-height:44px`).test(rulesOf(page)));

describe("§974 «Punctele, pe scurt»: the plan's points as one table, the view «Tabel» of «Planul voluntarilor»", () => {
  it("stands under the title, the intro and the views, before the picture, the builder and the email, under its heading and the house's list glyph, with six columns", async () => {
    await fullPlan();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage();
      const at = (needle: string) => page.indexOf(needle);

      // Its place: after the intro, the views and «Tipărește planul», before the picture, the builder, the email and «Fără punct».
      expect(at('data-testid="plan-table-section"'), locale).toBeGreaterThan(at(escaped(words.help)));
      expect(at('data-testid="plan-table-section"')).toBeGreaterThan(at('data-testid="plan-views"'));
      expect(at('data-testid="plan-table-section"')).toBeGreaterThan(at(escaped(words.print)));
      expect(at('data-testid="plan-table-section"')).toBeLessThan(at('data-testid="plan-picture-section"'));
      expect(at('data-testid="plan-picture-section"')).toBeLessThan(at('data-testid="plan-points-section"'));
      expect(at('data-testid="plan-points-section"')).toBeLessThan(at('data-testid="plan-mail-section"'));
      expect(at('data-testid="plan-mail-section"')).toBeLessThan(at('data-testid="plan-unplaced"'));
      // The default view: the table, and none of the points' folds, which are «Pe puncte».
      expect(page).not.toContain('id="plan-list"');
      expect(page).not.toContain('data-testid="plan-point"');

      const section = sectionOf(page);
      // A section with its own address, named by its heading: a level 3, as the page's other sections, with the list's glyph.
      expect(section).toMatch(/^data-testid="plan-table-section"/);
      expect(page).toMatch(/<section[^>]*id="plan-table"[^>]*aria-labelledby="plan-table-heading"[^>]*data-testid="plan-table-section"/);
      const heading = /<h3[^>]*id="plan-table-heading"[^>]*>([\s\S]*?)<\/h3>/.exec(section)?.[1] ?? "";
      expect(wordsOf(heading)).toBe(escaped(words.table.title));
      expect(heading).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="ListAltIcon"/);
      expect(/<h3[^>]*id="plan-table-heading"[^>]*>/.exec(section)?.[0]).toContain("MuiTypography-h3");

      // The house's table, named for a reader who does not see the heading, and its six columns in their order.
      const wide = wideOf(section);
      expect(wide).toMatch(/^<table[^>]*data-table-id="volunteer-plan"/);
      expect(wide).toContain(`>${escaped(words.table.title)}</caption>`);
      expect([...wide.matchAll(/<span data-column-heading="">([^<]*)<\/span>/g)].map((match) => match[1])).toEqual(
        [words.table.columns.number, words.table.columns.point, words.table.columns.km, words.table.columns.coordinates, words.table.columns.people, words.table.columns.count].map(escaped),
      );
      expect(Object.values(words.table.columns)).toEqual(locale === "ro" ? ["Nr.", "Punct", "Km", "Coordonate", "Voluntari", "Câți"] : ["No.", "Point", "Km", "Coordinates", "Volunteers", "How many"]);
    }
  });

  it("lists the route by kilometre, then the start–finish, each point with its number, its name to its card, its kilometre, where it is, its people and how many", async () => {
    const { spring, kits, start } = await fullPlan();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage();
      const section = sectionOf(page);
      const rows = rowsOf(wideOf(section));
      const openMap = escaped(words.points.openMap);

      // One row a point, in the order the owner reads the day: the route by kilometre — the plan's own «Izvor», typed last,
      // second at 3.4 km and numbered so — then the start–finish as the page lists it, with no number.
      expect(rows.map((cells) => cells.map(wordsOf)), locale).toEqual(
        locale === "ro"
          ? [
              ["1", "Intersecția Stejeriș", "1,2", "—", "Ana Pop +40 700 000 011 Zoe Manea", "2"],
              ["2", "Izvor", "3,4", `${PIATA} ${openMap}`, "niciunul", "0"],
              ["3", "Apă la cabană", "5,5", "—", "Dan Ene +40 700 000 022", "1"],
              ["4", "Podul de lemn", "7,25", "—", "Ion Lupu +40 700 000 033", "1"],
              ["", "Kituri și numere", "start–finish", `${PIATA} ${openMap}`, "Radu Liber +40 700 000 044", "1"],
              ["", "Linia de start", "start–finish", "—", "niciunul", "0"],
            ]
          : [
              ["1", "Stejeriș junction", "1.2", "—", "Ana Pop +40 700 000 011 Zoe Manea", "2"],
              ["2", "Izvor", "3.4", `${PIATA} ${openMap}`, "nobody", "0"],
              ["3", "Water at the hut", "5.5", "—", "Dan Ene +40 700 000 022", "1"],
              ["4", "The wooden bridge", "7.25", "—", "Ion Lupu +40 700 000 033", "1"],
              ["", "Kituri și numere", "start–finish", `${PIATA} ${openMap}`, "Radu Liber +40 700 000 044", "1"],
              ["", "Linia de start", "start–finish", "—", "nobody", "0"],
            ],
      );
      // «niciunul» is the catalogue's word; «start–finish» the plan's own, the «Voluntari» list's.
      expect(textsOf(wideOf(section), "plan-table-nobody")).toEqual([words.table.nobody, words.table.nobody]);
      expect(textsOf(wideOf(section), "plan-table-km").slice(4)).toEqual([words.columnStartFinish, words.columnStartFinish]);

      // Each name is a link to that point on «Pe puncte», open — the fold that carries that id is on that view.
      const order = [race.points.junction, spring, race.points.water, race.points.bridge, kits, start];
      const links = tagsOf(wideOf(section), "plan-table-point");
      expect(links.map((tag) => /href="([^"]*)"/.exec(tag)?.[1])).toEqual(order.map((id) => `/${locale}/admin/events/${race.raceId}/plan-voluntari?view=points&amp;open=${id}#point-${id}`));
      const points = await planPage(race.raceId, false, { view: "points" });
      for (const id of order) expect(points).toMatch(new RegExp(`<details[^>]*id="point-${id}"[^>]*data-testid="plan-point"`));

      // Where a point is: the numbers, and the card's own link to the map — Google Maps' address, a new tab, named by the point.
      const maps = tagsOf(wideOf(section), "plan-table-map");
      expect(maps).toHaveLength(2);
      for (const [tag, name] of [
        [maps[0], "Izvor"],
        [maps[1], "Kituri și numere"],
      ] as const) {
        expect(tag).toContain(`href="${PIATA_MAP}"`);
        expect(tag).toContain('target="_blank"');
        expect(tag).toContain('rel="noopener noreferrer"');
        expect(tag).toContain(`aria-label="${openMap}: ${name}"`);
      }

      // The people the cards have, in the cards' order, each with the number the card dials: digits and the plus alone. Zoe,
      // typed with no telephone, has none; Eva, cancelled, and Mara, another event's, are on no row.
      expect(textsOf(wideOf(section), "plan-table-person-name")).toEqual(["Ana Pop", "Zoe Manea", "Dan Ene", "Ion Lupu", "Radu Liber"]);
      expect(tagsOf(wideOf(section), "plan-table-phone").map((tag) => /href="([^"]*)"/.exec(tag)?.[1])).toEqual([
        "tel:+40700000011",
        "tel:+40700000022",
        "tel:+40700000033",
        "tel:+40700000044",
      ]);
      expect(section).not.toContain("Eva Stan");
      expect(section).not.toContain("Mara Dinu");
      for (const id of order) {
        const point = elementWith(points, `id="point-${id}"`);
        const row = rows[order.indexOf(id)];
        expect(textsOf(row[4], "plan-table-person-name"), id).toEqual([...point.matchAll(/data-testid="plan-person-name"[^>]*><a[^>]*>([^<]*)</g)].map((match) => match[1]));
      }
      expect(planPointsOf(points)).toHaveLength(order.length);

      // Under the table, its total: five people placed — Ana, Zoe, Dan, Ion, Radu — and two points with nobody.
      expect(afterTableOf(section)).toContain(locale === "ro" ? ">5 voluntari puși, 2 puncte fără nimeni<" : ">5 volunteers placed, 2 points with nobody<");
      // The summary over the points on «Pe puncte» says the same people, split by where they stand.
      expect(planSummaryOf(points)).toBe(
        locale === "ro"
          ? "1 voluntar la start–finish · 4 voluntari pe traseu · 0 voluntari fără punct · 2 puncte fără nimeni"
          : "1 volunteer at the start–finish · 4 volunteers on the route · 0 volunteers at no point · 2 points with nobody",
      );
    }
  });

  it("is one page — no page sizes, no pager — and on a phone a block a point, headed by its name, with no number at the start–finish", async () => {
    await fullPlan();
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const list = (locale === "ro" ? ro : en).Admin.list;
      const section = sectionOf(await planPage());
      expect(section).not.toContain(escaped(list.perPage));
      expect(section).not.toContain("perPage=");
      expect(section).not.toContain(escaped(list.next));

      // The blocks: the same points in the same order, each headed by its name's link; «Nr.» a line on a route point only.
      const blocks = afterTableOf(section);
      expect(textsOf(blocks, "plan-table-point")).toEqual(textsOf(wideOf(section), "plan-table-point"));
      expect(textsOf(blocks, "plan-table-number")).toEqual(["1", "2", "3", "4"]);
      expect(textsOf(blocks, "plan-table-km")).toEqual(textsOf(wideOf(section), "plan-table-km"));
      expect(textsOf(blocks, "plan-table-count")).toEqual(["2", "0", "1", "1", "1", "0"]);
    }
  });

  it("names a count of one in each language, as the house counts", async () => {
    // The other race: one point, Mara at it.
    for (const [locale, total] of [
      ["ro", "1 voluntar pus, 0 puncte fără nimeni"],
      ["en", "1 volunteer placed, 0 points with nobody"],
    ] as const) {
      state.locale = locale;
      const section = sectionOf(await planPage(race.otherId));
      expect(rowsOf(wideOf(section)).map((cells) => cells.map(wordsOf))).toEqual([
        ["1", locale === "ro" ? "Punctul altui eveniment" : "Another event's point", "3", "—", "Mara Dinu +40 700 000 066", "1"].map((cell) => escaped(cell)),
      ]);
      expect(afterTableOf(section)).toContain(`>${total}<`);
    }
    // The few and the twenty, by the house's rule: three forms in Romanian, two in English, never an ICU plural.
    for (const catalogue of [ro, en]) {
      const placed = catalogue.Admin.volunteers.plan.table.placed;
      expect(Object.keys(placed)).toEqual(["one", "few", "other"]);
      expect(JSON.stringify(catalogue.Admin.volunteers.plan.table)).not.toMatch(/plural|select,/);
    }
    expect(ro.Admin.volunteers.plan.table.placed.other).toBe("{count} de voluntari puși");
    expect(ro.Admin.volunteers.plan.table.total).toBe("{placed}, {empty}");
  });

  it("prints as a table, whole, its map links off the paper and its names and telephones as text — every link a thumb's", async () => {
    await fullPlan();
    // The rules from the page as streamed; its structure from the same markup with Emotion's `<style>` tags taken out.
    const page = await planPage(race.raceId, true);
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    const section = sectionOf(plain);

    // The section is on the paper: its heading and its table.
    const sectionTag = /<section[^>]*data-testid="plan-table-section"[^>]*>/.exec(plain)![0];
    expect(printOf(page, classesIn(sectionTag))).not.toMatch(/display:none/);
    // The wide frame is printed whatever the sheet's width — after the screen's own rule, which hides it under `md` — and the
    // phone's blocks never.
    const frame = classesIn(/<div class="[^"]*"><table[^>]*data-table-id="volunteer-plan"/.exec(plain)![0]);
    expect(printOf(page, frame)).toMatch(/display:block/);
    const rules = rulesOf(page);
    expect(rules.indexOf(`@media print{.${frame[0]}{display:block`)).toBeGreaterThan(rules.indexOf(`.${frame[0]}{display:none`));
    const blocks = classesIn(/<ul class="[^"]*MuiStack-root[^"]*"[^>]*>/.exec(afterTableOf(section))![0]);
    expect(printOf(page, blocks)).toMatch(/display:none/);

    // The map's link stays off the paper; the numbers print.
    for (const tag of tagsOf(section, "plan-table-map")) expect(printOf(page, classesIn(tag))).toMatch(/display:none/);
    expect(tagsOf(section, "plan-table-coordinates")[0]).toBe('<span data-testid="plan-table-coordinates">');
    // A name and a telephone print as text: no height, no link's colour, no underline.
    for (const testid of ["plan-table-point", "plan-table-phone"]) {
      const names = classesIn(tagsOf(section, testid)[0]);
      expect(printOf(page, names), testid).toMatch(/min-height:0;[^}]*color:inherit;[^}]*text-decoration:none/);
      // 44 pixels tall on a screen (BR-REQ-041-01 criterion 6), the map's link too.
      expect(tallClass(page, names), testid).toBe(true);
    }
    expect(tallClass(page, classesIn(tagsOf(section, "plan-table-map")[0]))).toBe(true);
  });

  it("draws no table for a plan with no point, and the page stays the 404 it was for whoever may not work the volunteers", async () => {
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.otherId));
    const bare = await planPage(race.otherId);
    expect(bare).not.toContain('data-testid="plan-table-section"');
    // The list's own empty state says how to add a point.
    expect(bare).toContain('data-testid="plan-no-points"');

    // Whoever works the volunteers reads the table…
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(await planPage(), role).toContain('data-testid="plan-table-section"');
    }
    // …and the Tehnic role, the Redactor, a desk Volunteer and a member get the page that does not exist, as before.
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(planPage(), role).rejects.toThrow("NOT_FOUND");
    }
  });
});
