import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutboxRow } from "@/modules/notifications/outbox";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { readVolunteerPlan } from "@/modules/volunteers/plan";
import { changePlanPoint, PLAN_POINTS_MAX } from "@/modules/volunteers/plan-points";
import { sendVolunteerPoints, volunteerPointAtSend } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { decodeFlash } from "@/shared/feedback/notice";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnOpen, elementWith, type PlanRace, planPointBar, planPointsOf, planSummaryOf, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §961, BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01 — «Punctele planului» on the page of «Planul voluntarilor», its three
 * Server Actions and the «Voluntari» list's «Punct» column, from a real database:
 *
 * - **the page**, in Romanian and in English: the fold «Adaugă un punct» under the picture's; on «Pe puncte» (§974) the
 *   points in two group folds — «Pe traseu», the numbered points, and «La start–finish», its points with no number and no
 *   kilometre —, each group's own empty line, the one empty state of a plan with no point, and the summary's four numbers;
 *   a point's coordinates with «Deschide pe hartă»; «doar pe plan» on a route point of the plan's own; the pencil of
 *   «Modifică punctul» — every box for a point added here, the coordinates alone for an editor's — and «Șterge punctul»,
 *   which asks first with the point's name and how many people stand there; nothing of the builder on the paper, and every
 *   press a thumb can hit;
 * - **the actions**: each asks the capability at its own door; «Adaugă punctul» answers a refusal as the form's own state —
 *   the box named, what was typed kept — and a press that went through comes back to its fold, open; «Salvează punctul»
 *   comes back to its point, open, and «Șterge punctul» to the list, a refused one to the page's alert with its sentence —
 *   each in the view it was pressed in;
 * - **the «Voluntari» list**: a start–finish point by its name and the quiet word «start–finish», never a number or a
 *   kilometre, a route point as before — and the plan, the list and the email's facts say one point's number one way.
 *
 * The rules of the verbs themselves are `plan-points.test.ts`.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  /** The capabilities the actions asked at their door, by name. */
  asked: [] as string[],
  /** The flash cookies the actions wrote. */
  flashed: [] as string[],
  /** How many times the verbs' service was reached. */
  changed: 0,
  /** A form whose action answered a refusal: the action, and the state it returned — what `useActionState` hands the form. */
  refused: undefined as undefined | { action: unknown; outcome: unknown },
}));

// `useActionState` as the server answers it on a plain POST (§315): the form whose action returned a refusal is rendered
// with that state. Every other form of the page — and every other hook — is React's own.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (action: unknown, initial: unknown, permalink?: string) =>
      state.refused && action === state.refused.action ? [state.refused.outcome, action, false] : actual.useActionState(action as never, initial as never, permalink),
  };
});
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
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (_name: string, value: string) => void state.flashed.push(value), delete: () => {} }),
  headers: async () => new Headers(),
}));
// Spies, so «no public cache tag was expired» is asserted on the mock itself.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screens ask of it (`plan.test.ts`'s stand-in).
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
// The session's door as the real one answers (`session.ts#requireStaffCapability`): the predicate asked of the actor, by name.
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError } = await import("@/shared/errors/domain-error");
  return {
    DEV_STAFF_COOKIE: "dev-staff",
    requireStaff: async () => state.actor,
    requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
      state.asked.push(capability.name);
      if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "the door refused");
      return state.actor;
    },
  };
});
// The verbs' service itself, counted: a press refused at the action's door never reaches it.
vi.mock("@/modules/volunteers/plan-points", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/plan-points")>();
  return {
    ...real,
    changePlanPoint: (...args: Parameters<typeof real.changePlanPoint>) => {
      state.changed += 1;
      return real.changePlanPoint(...args);
    },
  };
});

const { revalidateTag } = await import("next/cache");
const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { addPlanPointAction, editPlanPointAction, removePlanPointAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");

const NOW = new Date("2026-11-16T10:00:00.000Z");
const PIATA = "45.64271, 25.58871";
const PIATA_MAP = "https://www.google.com/maps/search/?api=1&amp;query=45.64271%2C25.58871";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

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
  state.asked.length = 0;
  state.flashed.length = 0;
  state.refused = undefined;
  vi.mocked(revalidateTag).mockClear();
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  // Ana and Zoe at the junction (1.2 km), Dan at the water (5.5), Ion at the bridge (7.25), Radu at no point, Eva cancelled.
  race = await seedPlanRace(db, NOW);
  state.changed = 0;
});

/** A point of the plan's own, added by the service; its id. */
async function ownPoint(place: "route" | "startFinish", name: string, km = "", coordinates = ""): Promise<string> {
  return (await changePlanPoint(db, staff.ADMIN!, { kind: "add", eventId: race.raceId, place, name, km, coordinates }, NOW)).id;
}
const place = (id: string, checkpointId: string) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, NOW);
const rowOf = async (id: string) => (await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.id, id)))[0];
const ownRows = () => db.select().from(eventCheckpoints).where(eq(eventCheckpoints.planOnly, true)).orderBy(asc(eventCheckpoints.position));
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action.startsWith("volunteer_plan."));

/** Every element of a tree a Server Component returned: its own JSX, before any component in it is run. */
function elements(node: unknown, acc: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, acc);
    return acc;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return acc;
  acc.push(node as Element);
  for (const value of Object.values(node.props)) if (Array.isArray(value) || isValidElement(value)) elements(value, acc);
  return acc;
}

const pageTree = (query: Record<string, string> = {}, id = race.raceId) => VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) });
/** A page as the server streams it, Suspense settled, React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, id = race.raceId, keepStyles = false) => html(await pageTree(query, id), keepStyles);
const listPage = async (query: Record<string, string> = {}) => html(await AdminVolunteersPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId: race.raceId, ...query }) }));

/** As the markup carries an apostrophe and a quotation mark. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
/** A part of the page without its tags: the words a person reads. */
const wordsOf = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** One group fold of «Pe puncte» — its bar, its points or its empty line — whole. */
const groupOf = (page: string, group: "startFinish" | "route") => elementWith(page, `data-group="${group}"`);
/** The one point fold of the page that carries this id, whole. */
const pointOf = (page: string, id: string) => elementWith(page, `id="point-${id}"`);
/** A group's title in its bar: the words after its glyph, before the closed line. */
const groupTitleOf = (group: string) => /<h3[^>]*>[\s\S]*?<\/svg>([^<]*)</.exec(group)?.[1] ?? "";
const textOf = (part: string, testid: string) => [...part.matchAll(new RegExp(`data-testid="${testid}"[^>]*>(?:<a[^>]*>)?([^<]*)<`, "g"))].map((match) => match[1]);
/** The opening tag of the first element that carries `attribute`, whichever side of it its other attributes were written. */
const tagOf = (part: string, attribute: string) => new RegExp(`<[a-z0-9]+[^>]*${attribute}[^>]*>`).exec(part)?.[0] ?? "";
/** What a box holds: its `value`, empty when the attribute is not written at all. */
const valueOf = (part: string, testid: string) => / value="([^"]*)"/.exec(tagOf(part, `data-testid="${testid}"`))?.[1] ?? "";
/** The two radios of «Unde e punctul?» in a form: which is chosen. */
const radiosOf = (part: string) => Object.fromEntries([...part.matchAll(/<input type="radio" name="place"( checked="")? value="(route|startFinish)"\/>/g)].map((match) => [match[2], match[1] !== undefined]));
/** The pencil of «Modifică punctul» of a point, whole: its glyph and, inside, the form it opens. */
const foldOf = (pointPart: string) => elementWith(pointPart, 'data-testid="plan-point-edit"');
/** The section «Punctele planului», whole: from its opening tag to the section the page draws after it. */
const builderOf = (page: string) => page.slice(page.indexOf('data-testid="plan-points-section"'), page.indexOf('data-testid="plan-mail-section"'));
/** Every Emotion rule a streamed page carries, joined: what a class of its markup means. */
const rulesOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
/** The Emotion classes of the first element that carries `attribute`. */
function classesOf(page: string, attribute: string): string[] {
  const names = (/class="([^"]*)"/.exec(tagOf(page, attribute))?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
  expect(names.length, `an Emotion class on the element with ${attribute}`).toBeGreaterThan(0);
  return names;
}
/** Whether the element that carries `attribute` is taken off the paper: one of its classes says `display:none` under `@media print`. */
const offPaper = (page: string, attribute: string) => classesOf(page, attribute).some((name) => new RegExp(`@media print\\{\\.${name}\\{[^}]*display:none`).test(rulesOf(page)));
/** Whether it is at least 44 pixels tall. */
const tall = (page: string, attribute: string) => classesOf(page, attribute).some((name) => new RegExp(`\\.${name}\\{[^}]*min-height:44px`).test(rulesOf(page)));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: race.raceId, ...fields })) data.set(key, value);
  return data;
}
/** A Server Action that redirects, pressed: the address it sends the browser to. */
async function pressed(press: () => Promise<unknown>): Promise<string> {
  state.redirected.length = 0;
  await expect(Promise.resolve().then(press)).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}
const toasted = () => state.flashed.map((value) => decodeFlash(value));
const planPath = () => `/ro/admin/events/${race.raceId}/plan-voluntari`;
/** A refused press of a point — the forms here post no view, and a point's press comes back to «Pe puncte» (§974). */
const alertOf = (code: string, point?: string) => `${planPath()}?view=points${point ? `&open=${point}` : ""}&planError=${code}#admin-alert`;
/** «Pe puncte», where the points are drawn (§974). */
const POINTS = { view: "points" } as const;

describe("§961 the plan's page: two groups, the summary, and the plan's own points", () => {
  it("draws an event that has only the editor's points as the route, with the start–finish group saying how to add a point to it", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage(POINTS);

      // The summary's four numbers: nobody at the start–finish, Ana, Dan and Ion on the route (Zoe too: four), Radu at no point.
      expect(planSummaryOf(page), locale).toBe(
        locale === "ro"
          ? "0 voluntari la start–finish · 4 voluntari pe traseu · 1 voluntar fără punct · 0 puncte fără nimeni"
          : "0 volunteers at the start–finish · 4 volunteers on the route · 1 volunteer at no point · 0 points with nobody",
      );

      // «La start–finish»: its heading, and the one quiet line that says how to add a point to it.
      const startFinish = groupOf(page, "startFinish");
      expect(groupTitleOf(startFinish)).toBe(words.groups.startFinish);
      expect(textOf(startFinish, "plan-group-none")).toEqual([escaped(words.groups.startFinishNone)]);
      expect(planPointsOf(startFinish)).toEqual([]);

      // «Pe traseu»: the three points, numbered in the route's order as they always were.
      const route = groupOf(page, "route");
      expect(groupTitleOf(route)).toBe(words.groups.route);
      expect(route).not.toContain('data-testid="plan-group-none"');
      expect(planPointsOf(route).map((part) => planPointBar(part).name)).toEqual(
        locale === "ro" ? ["1. Intersecția Stejeriș", "2. Apă la cabană", "3. Podul de lemn"] : ["1. Stejeriș junction", "2. Water at the hut", "3. The wooden bridge"],
      );
      expect(planPointsOf(route).map((part) => planPointBar(part).line)).toEqual(
        locale === "ro" ? ["1,2 km · 2 voluntari", "5,5 km · 1 voluntar", "7,25 km · 1 voluntar"] : ["1.2 km · 2 volunteers", "5.5 km · 1 volunteer", "7.25 km · 1 volunteer"],
      );

      // An editor's point: public on the event's page, so not «doar pe plan»; no coordinates, so no line and no link.
      const water = pointOf(page, race.points.water);
      expect(tagOf(water, 'data-testid="plan-point"')).toContain('data-place="route"');
      expect(water).not.toContain('data-testid="plan-point-own"');
      expect(water).not.toContain('data-testid="plan-point-where"');
      // Its fold: the coordinates alone, and the sentence that its name and kilometre are the editor's, with a link to the
      // editor's card named by the card's own title — the sentence has said «în editorul evenimentului» once already.
      const fold = foldOf(water);
      expect(fold).toContain(words.points.edit);
      expect(fold).toContain(`name="pointId" value="${race.points.water}"`);
      expect(tagOf(fold, 'data-testid="plan-point-edit-coordinates"')).toContain('name="coordinates"');
      expect(valueOf(fold, "plan-point-edit-coordinates")).toBe("");
      expect(fold).not.toContain('name="name"');
      expect(fold).not.toContain('name="km"');
      expect(fold).not.toContain('name="place"');
      const editors = /<p[^>]*data-testid="plan-point-editors"[\s\S]*?<\/p>/.exec(fold)![0];
      const card = (locale === "ro" ? ro : en).Admin.checkpoints.title;
      expect(wordsOf(editors)).toBe(`${wordsOf(escaped(words.points.editorsOnly))} ${wordsOf(escaped(card))}`);
      expect(editors).toMatch(new RegExp(`<a[^>]*href="/${locale}/admin/events/${race.raceId}#box-checkpoints"[^>]*>${card}</a>`));
      expect(wordsOf(editors).split(escaped(locale === "ro" ? "editorul evenimentului" : "the event's editor"))).toHaveLength(2);
      expect(fold).toContain(words.points.save);
      // «Șterge punctul» is not offered on it: an editor's point is deleted in the editor.
      expect(fold).not.toContain('data-testid="plan-point-remove-form"');
      expect(page).not.toContain(words.points.remove);
    }
  });

  it("says the one empty state of a plan with no point — add them right here, at «Adaugă un punct», or in the event's editor — and draws the builder open", async () => {
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.otherId));
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      for (const view of ["table", "points"]) {
        const page = await planPage({ view }, race.otherId);
        expect(wordsOf(/<div[^>]*data-testid="plan-no-points"[\s\S]*?<\/div>\s*<\/div>/.exec(page)![0])).toBe(wordsOf(escaped(words.noPoints)));
        // No table, no summary and no group: a heading with nothing under it is no plan.
        expect(page).not.toContain('data-testid="plan-table-section"');
        expect(page).not.toContain('data-testid="plan-summary"');
        expect(page).not.toContain('data-testid="plan-group"');
        // The builder is there, open, with its form — the place to start.
        expect(builderOf(page)).toContain(`</svg>${escaped(words.points.addTitle)}</h3>`);
        expect(drawnOpen(elementWith(page, 'data-testid="plan-points-section"'))).toBe(true);
        expect(builderOf(page)).toContain('data-testid="plan-point-add-form"');
        // Mara, whose point is gone, stands at none.
        expect(textOf(page.slice(page.indexOf('data-testid="plan-unplaced"')), "plan-person-name")).toEqual(["Mara Dinu"]);
      }
    }
  });

  it("draws a route point of the plan's own between the editor's — numbered in the one order, «doar pe plan» — without coordinates and with them", async () => {
    const spring = await ownPoint("route", "Izvor", "3,4");
    await place(race.people.radu, spring);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage(POINTS);
      // The route's second point: the editor's water is now the third.
      expect(planPointsOf(groupOf(page, "route")).map(planPointBar)).toEqual(
        locale === "ro"
          ? [
              { name: "1. Intersecția Stejeriș", line: "1,2 km · 2 voluntari" },
              { name: "2. Izvor", line: "3,4 km · 1 voluntar" },
              { name: "3. Apă la cabană", line: "5,5 km · 1 voluntar" },
              { name: "4. Podul de lemn", line: "7,25 km · 1 voluntar" },
            ]
          : [
              { name: "1. Stejeriș junction", line: "1.2 km · 2 volunteers" },
              { name: "2. Izvor", line: "3.4 km · 1 volunteer" },
              { name: "3. Water at the hut", line: "5.5 km · 1 volunteer" },
              { name: "4. The wooden bridge", line: "7.25 km · 1 volunteer" },
            ],
      );
      const point = pointOf(page, spring);
      // The small quiet label: this point is on no public page.
      expect(textOf(point, "plan-point-own")).toEqual([words.points.planOnly]);
      // The editor's points beside it wear none.
      expect(pointOf(page, race.points.junction)).not.toContain('data-testid="plan-point-own"');
      // Without coordinates: no line and no link.
      expect(point).not.toContain('data-testid="plan-point-where"');
      expect(point).not.toContain("google.com");
      // Its people, as at any point; and nobody left to place.
      expect(textOf(point, "plan-person-name")).toEqual(["Radu Liber"]);
      expect(point).not.toContain('data-testid="plan-place-form"');

      // Its fold: every box, filled in — on the route, its name, its kilometre in the page's decimal mark, no coordinates.
      const fold = foldOf(point);
      expect(radiosOf(fold)).toEqual({ route: true, startFinish: false });
      expect(valueOf(fold, "plan-point-edit-name")).toBe("Izvor");
      expect(tagOf(fold, 'data-testid="plan-point-edit-name"')).toMatch(/maxLength="60"|maxlength="60"/);
      expect(valueOf(fold, "plan-point-edit-km")).toBe(locale === "ro" ? "3,4" : "3.4");
      expect(valueOf(fold, "plan-point-edit-coordinates")).toBe("");
      expect(fold).toContain(escaped(words.points.kmHelper));
      expect(fold).toContain(escaped(words.points.coordinatesHelper));
      expect(fold).not.toContain('data-testid="plan-point-editors"');
      // «Șterge punctul», last, in a form of its own that posts the point.
      const remove = /<form[^>]*data-testid="plan-point-remove-form"[\s\S]*?<\/form>/.exec(fold)![0];
      expect(remove).toContain(`name="pointId" value="${spring}"`);
      expect(remove).toContain(words.points.remove);
      expect(fold.indexOf('data-testid="plan-point-save"')).toBeLessThan(fold.indexOf('data-testid="plan-point-remove-form"'));
    }

    // With coordinates: the numbers, and «Deschide pe hartă» — Google Maps' own address, in a new tab.
    await changePlanPoint(db, staff.ADMIN!, { kind: "edit", eventId: race.raceId, id: spring, place: "route", name: "Izvor", km: "3,4", coordinates: PIATA }, NOW);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const point = pointOf(await planPage(POINTS), spring);
      // Points as decimal marks in both languages: it is what a maps application takes back.
      expect(textOf(point, "plan-point-coordinates")).toEqual(["45.64271, 25.58871"]);
      const link = tagOf(point, 'data-testid="plan-point-map"');
      expect(link).toContain(`href="${PIATA_MAP}"`);
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      // Told apart from the other rows' links by the point's name.
      expect(link).toContain(`aria-label="${words.points.openMap}: Izvor"`);
      expect(textOf(point, "plan-point-map")).toEqual([words.points.openMap]);
      // The fold's box holds them as they are written, to be changed or emptied.
      expect(valueOf(foldOf(point), "plan-point-edit-coordinates")).toBe("45.64271, 25.58871");
    }
  });

  it("draws a start–finish point with its people: no number and no kilometre, «Pune aici» and «Scoate» as at any point", async () => {
    const kits = await ownPoint("startFinish", "Kituri și numere", "", PIATA);
    const start = await ownPoint("startFinish", "Linia de start");
    await place(race.people.radu, kits);
    await place(race.people.ana, kits);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage(POINTS);
      expect(planSummaryOf(page), locale).toBe(
        locale === "ro"
          ? "2 voluntari la start–finish · 3 voluntari pe traseu · 0 voluntari fără punct · 1 punct fără nimeni"
          : "2 volunteers at the start–finish · 3 volunteers on the route · 0 volunteers at no point · 1 point with nobody",
      );
      const group = groupOf(page, "startFinish");
      expect(groupTitleOf(group)).toBe(words.groups.startFinish);
      expect(group).not.toContain('data-testid="plan-group-none"');
      // In the order they were added, by their names alone: the organizers' own words, the same in both languages.
      expect(planPointsOf(group).map((part) => planPointBar(part).name)).toEqual(["Kituri și numere", "Linia de start"]);
      // A list, not a numbered one: the route's order is the route's.
      expect(group).toMatch(/<ul[^>]*aria-labelledby="plan-group-start-finish"/);
      expect(groupOf(page, "route")).toMatch(/<ol[^>]*aria-labelledby="plan-group-route"/);

      const point = pointOf(page, kits);
      expect(tagOf(point, 'data-testid="plan-point"')).toContain('data-place="startFinish"');
      // Never a number or a kilometre — and no label: the group says what the point is; the line says «start–finish».
      expect(planPointBar(point)).toEqual({ name: "Kituri și numere", line: locale === "ro" ? "start–finish · 2 voluntari" : "start–finish · 2 volunteers" });
      expect(wordsOf(/<h4[\s\S]*?<\/h4>/.exec(point)![0])).not.toMatch(/\bkm\b|\d\./);
      expect(point).not.toContain('data-testid="plan-point-own"');
      // Where it is.
      expect(textOf(point, "plan-point-coordinates")).toEqual(["45.64271, 25.58871"]);
      expect(tagOf(point, 'data-testid="plan-point-map"')).toContain(`href="${PIATA_MAP}"`);
      // Its people by name, each with «Scoate», posting no point.
      expect(textOf(point, "plan-person-name")).toEqual(["Ana Pop", "Radu Liber"]);
      expect(point).toMatch(new RegExp(`name="volunteerId" value="${race.people.radu}"[\\s\\S]*?name="checkpointId" value=""[\\s\\S]*?name="at" value="${kits}"`));
      expect(textOf(point, "plan-take-off").length + (point.match(/data-testid="plan-take-off"/g) ?? []).length).toBeGreaterThan(1);

      // The other start–finish point has nobody yet.
      const empty = pointOf(page, start);
      expect(textOf(empty, "plan-point-empty")).toEqual([escaped(words.nobodyHere)]);
      expect(empty).not.toContain('data-testid="plan-point-where"');
      // Its fold: «La start–finish» chosen, the name, an empty kilometre — never «0».
      const fold = foldOf(empty);
      expect(radiosOf(fold)).toEqual({ route: false, startFinish: true });
      expect(valueOf(fold, "plan-point-edit-name")).toBe("Linia de start");
      expect(valueOf(fold, "plan-point-edit-km")).toBe("");
    }

    // Somebody at no point: every point of both groups offers «Pune aici», posting itself.
    state.locale = "ro";
    await place(race.people.radu, "");
    const page = await planPage(POINTS);
    for (const id of [kits, start, race.points.junction, race.points.water, race.points.bridge]) {
      const select = pointOf(page, id).match(/<select[\s\S]*?<\/select>/)![0];
      expect([...select.matchAll(/<option value="([0-9a-f-]{36})"/g)].map((match) => match[1]), id).toEqual([race.people.radu]);
      expect(pointOf(page, id)).toMatch(new RegExp(`data-testid="plan-place-form"[\\s\\S]*?name="checkpointId" value="${id}"`));
    }
    // «Fără punct»: the people at no point at all, with the help that says where to put them — a fold since §NNN.
    const unplaced = page.slice(page.indexOf('data-testid="plan-unplaced"'));
    expect(unplaced).toContain(`</svg>${ro.Admin.volunteers.plan.unplacedTitle}<`);
    expect(ro.Admin.volunteers.plan.unplacedTitle).toBe("Fără punct");
    expect(unplaced).toContain(escaped(ro.Admin.volunteers.plan.unplacedHelp));
    expect(textOf(unplaced, "plan-person-name")).toEqual(["Radu Liber"]);
    // The help no longer says such people may be the start's or the kits': those have a place of their own.
    expect(ro.Admin.volunteers.plan.unplacedHelp).not.toMatch(/kituri|start,/i);
    expect(en.Admin.volunteers.plan.unplacedHelp).not.toMatch(/kits|the start,/i);
  });

  it("says under the title the two kinds of points and that the editor's are public too — and, once, where they are added, that the plan's own are seen by the organizers and in the volunteers' email only", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await planPage();
      expect(page).toContain(escaped(words.help));
      expect(textOf(page, "plan-help-points")).toEqual([escaped(words.helpPoints)]);
      // The builder's own help, one paragraph of three sentences' keys.
      expect(textOf(page, "plan-points-help")).toEqual([escaped(`${words.points.help} ${words.points.helpCoordinates} ${words.points.helpPrivate}`)]);
    }
    expect(ro.Admin.volunteers.plan.help).toMatch(/la start–finish sau la un punct de pe traseu/);
    expect(ro.Admin.volunteers.plan.helpPoints).toMatch(/pagina evenimentului și pe numerele de concurs/);
    expect(ro.Admin.volunteers.plan.points.helpPrivate).toMatch(/doar pe plan și în emailul trimis voluntarilor/);
    expect(ro.Admin.volunteers.plan.points.helpPrivate).toMatch(/nu apar pe pagina evenimentului și nici pe numerele de concurs/);
    // Said once on the page: the paragraph under the title no longer repeats what «Punctele planului» says.
    for (const catalogue of [ro, en]) expect(catalogue.Admin.volunteers.plan.helpPoints).not.toMatch(/doar|only/);
    // «start–finish» with an en dash everywhere a person reads it.
    for (const catalogue of [ro, en]) expect(JSON.stringify(catalogue.Admin.volunteers.plan)).not.toMatch(/start-finish/i);
  });

  it("draws «Adaugă un punct» under the plan and above «Trimite fiecăruia punctul lui»: the choice, the name, the kilometre, the coordinates", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan.points;
      const page = await planPage();
      // The fold's place on the page, and its anchor.
      expect(page.indexOf('data-testid="plan-maps-section"')).toBeLessThan(page.indexOf('data-testid="plan-points-section"'));
      expect(page.indexOf('data-testid="plan-points-section"')).toBeLessThan(page.indexOf('data-testid="plan-mail-section"'));
      expect(tagOf(page, 'data-testid="plan-points-section"')).toContain('id="plan-points"');

      // A fold (§974), its bar the words «Adaugă un punct» at a level-3 heading.
      const builder = builderOf(page);
      expect(builder).toContain(`</svg>${escaped(words.addTitle)}</h3>`);
      const addForm = /<form[^>]*data-testid="plan-point-add-form"[\s\S]*?<\/form>/.exec(builder)![0];
      expect(addForm).toContain(`name="eventId" value="${race.raceId}"`);
      expect(addForm).toContain(`name="uiLocale" value="${locale}"`);
      // «Unde e punctul?»: two radios, «Pe traseu» chosen by default.
      expect(addForm).toContain(`>${words.place}</legend>`);
      expect(radiosOf(addForm)).toEqual({ route: true, startFinish: false });
      expect(addForm).toContain(words.placeRoute);
      expect(addForm).toContain(words.placeStartFinish);
      // The three boxes, empty, each with the id the refusal's summary links to.
      for (const [box, label] of [
        ["name", words.name],
        ["km", words.km],
        ["coordinates", words.coordinates],
      ] as const) {
        const input = tagOf(addForm, `data-testid="plan-point-add-${box}"`);
        expect(input, box).toContain(`name="${box}"`);
        expect(input, box).toContain(`id="field-plan-point-add-${box}"`);
        expect(valueOf(addForm, `plan-point-add-${box}`), box).toBe("");
        expect(addForm).toContain(escaped(label));
      }
      expect(tagOf(addForm, 'data-testid="plan-point-add-name"')).toMatch(/required=""/);
      expect(tagOf(addForm, 'data-testid="plan-point-add-km"')).not.toMatch(/required/);
      expect(tagOf(addForm, 'data-testid="plan-point-add-km"')).toMatch(/inputMode="decimal"|inputmode="decimal"/);
      expect(addForm).toContain(escaped(words.kmHelper));
      expect(addForm).toContain(escaped(words.coordinatesHelper));
      expect(addForm).toMatch(/<button[^>]*type="submit"[^>]*data-testid="plan-point-add"/);
      expect(addForm).toContain(words.add);
      expect(addForm).not.toContain('data-testid="form-refusal"');
    }
  });

  it("keeps the builder and the pencils off the paper, prints the groups' headings and the coordinates as text, and makes every press a thumb's", async () => {
    const kits = await ownPoint("startFinish", "Kituri", "", PIATA);
    const spring = await ownPoint("route", "Izvor", "3,4", PIATA);
    await place(race.people.radu, kits);
    const page = await planPage(POINTS, race.raceId, true);

    // Never on the paper: the builder, each fold, the link's words, the label.
    expect(offPaper(page, 'data-testid="plan-points-section"')).toBe(true);
    expect(offPaper(page, 'data-testid="plan-point-edit"')).toBe(true);
    expect(offPaper(page, 'data-testid="plan-point-map"')).toBe(true);
    expect(offPaper(page, 'data-testid="plan-point-own"')).toBe(true);
    // On the paper: the two groups with their headings, each point, the coordinates as numbers, the summary.
    for (const attribute of ['data-group="startFinish"', 'data-group="route"', 'id="plan-group-start-finish"', 'id="plan-group-route"', `id="point-${kits}"`, `id="point-${spring}"`, 'data-testid="plan-summary"']) {
      const names = (/class="([^"]*)"/.exec(tagOf(page, attribute))?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
      expect(names.some((name) => new RegExp(`@media print\\{\\.${name}\\{[^}]*display:none`).test(rulesOf(page))), attribute).toBe(false);
    }
    expect(tagOf(page, 'data-testid="plan-point-coordinates"')).toBe('<span data-testid="plan-point-coordinates">');
    // A point is never split across two sheets.
    expect(classesOf(page, `id="point-${kits}"`).some((name) => new RegExp(`\\.${name}\\{[^}]*break-inside:avoid`).test(rulesOf(page)))).toBe(true);

    // 44 pixels: the link to the map, the buttons of the builder and of the fold (BR-REQ-041-01 criterion 6).
    expect(tall(page, 'data-testid="plan-point-map"')).toBe(true);
    expect(tall(page, 'data-testid="plan-point-add"')).toBe(true);
    expect(tall(page, 'data-testid="plan-point-save"')).toBe(true);
    // The point's own bar, the pencil's square (§974) and the two radios' rows.
    const bar = classesOf(page, `id="point-${spring}"`);
    expect(bar.some((name) => new RegExp(`\\.${name}>summary\\{[^}]*min-height:44px`).test(rulesOf(page)))).toBe(true);
    const pencil = classesOf(page, 'data-testid="plan-point-edit"');
    expect(pencil.some((name) => new RegExp(`\\.${name}>summary\\{[^}]*width:44px;height:44px`).test(rulesOf(page)))).toBe(true);
    const radio = /<label class="([^"]*)"><input type="radio" name="place"/.exec(page)![1].split(" ").filter((part) => part.startsWith("css-"));
    expect(radio.some((name) => new RegExp(`\\.${name}\\{[^}]*min-height:44px`).test(rulesOf(page)))).toBe(true);

    // A group with no point stays off the paper whole — a heading with nothing under it is no plan.
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.id, kits));
    const bare = await planPage(POINTS, race.raceId, true);
    expect(offPaper(bare, 'data-group="startFinish"')).toBe(true);
    expect(offPaper(bare, 'data-group="route"')).toBe(false);
  });

  it("asks before «Șterge punctul», with the point's name and how many people stand there — or that nobody does", async () => {
    const kits = await ownPoint("startFinish", "Kituri și numere");
    const question = async () => {
      const tree = await pageTree(POINTS);
      const formOf = elements(tree).find((element) => element.props["data-testid"] === "plan-point-remove-form")!;
      return elements(formOf).find((element) => typeof element.props.title === "string" && typeof element.props.body === "string")!.props as Record<string, string>;
    };
    // Nobody yet.
    expect(await question()).toMatchObject({
      label: "Șterge punctul",
      ariaLabel: "Șterge punctul: Kituri și numere",
      title: "Ștergi punctul „Kituri și numere”?",
      body: "Nimeni nu stă la acest punct.",
      confirmLabel: "Șterge punctul",
      cancelLabel: ro.Admin.confirm.cancel,
      icon: "delete",
      color: "error",
    });
    // One person, then two: they stay on the plan, at no point.
    await place(race.people.radu, kits);
    expect((await question()).body).toBe("La acest punct stă 1 voluntar: rămâne în plan, fără punct.");
    await place(race.people.ana, kits);
    expect((await question()).body).toBe("La acest punct stau 2 voluntari: rămân în plan, fără punct.");
    // A cancelled person is on no plan, and is not counted.
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, race.people.ana));
    expect((await question()).body).toBe("La acest punct stă 1 voluntar: rămâne în plan, fără punct.");
    state.locale = "en";
    expect(await question()).toMatchObject({ title: "Delete the point “Kituri și numere”?", body: "1 volunteer stands at this point: they stay on the plan, at no point.", label: "Delete the point" });
    // The three forms of a counted phrase, never an ICU plural: twenty take «de».
    expect(ro.Admin.volunteers.plan.points.removeBody.other).toBe("La acest punct stau {count} de voluntari: rămân în plan, fără punct.");
    expect(JSON.stringify([ro.Admin.volunteers.plan, en.Admin.volunteers.plan])).not.toMatch(/\{\w+,\s*plural/);
  });
});

describe("§961 «Adaugă punctul»: the action", () => {
  it("adds a point of each kind, asked at the door, and comes back to its fold, open, with its toast — the form empty for the next", async () => {
    // A form that names no view is «Tabel»'s, the page's default (§974): back to the fold, which the address opens.
    const back = `${planPath()}?view=table&saved=planPointAdded#plan-points`;
    expect(await pressed(() => addPlanPointAction(null, form({ place: "startFinish", name: "Kituri și numere", km: "", coordinates: PIATA })))).toBe(back);
    expect(toasted()).toEqual([{ kind: "success", key: "planPointAdded" }]);
    state.flashed.length = 0;
    expect(await pressed(() => addPlanPointAction(null, form({ place: "route", name: "Izvor", km: "3,4", coordinates: "" })))).toBe(back);
    expect(toasted()).toEqual([{ kind: "success", key: "planPointAdded" }]);
    expect(state.asked).toEqual(["canManageVolunteers", "canManageVolunteers"]);

    expect((await ownRows()).map((row) => [row.nameRo, row.startFinish, row.km, row.latitude])).toEqual([
      ["Kituri și numere", true, "0.00", "45.642710"],
      ["Izvor", false, "3.40", null],
    ]);
    expect((await trail()).map((row) => [row.action, row.actorStaffUserId])).toEqual([
      ["volunteer_plan.point_added", staff.MODERATOR!.id],
      ["volunteer_plan.point_added", staff.MODERATOR!.id],
    ]);
    // The page then draws each in its group, and the builder's boxes empty: the form is drawn anew when the points change.
    const page = await planPage(POINTS);
    expect(planPointsOf(groupOf(page, "startFinish")).map((part) => planPointBar(part).name)).toEqual(["Kituri și numere"]);
    expect(planPointsOf(groupOf(page, "route")).map(planPointBar)).toContainEqual({ name: "2. Izvor", line: "3,4 km · niciun voluntar" });
    for (const box of ["name", "km", "coordinates"]) expect(valueOf(builderOf(page), `plan-point-add-${box}`), box).toBe("");
    // Nobody was emailed and no public cache tag was expired: no public page reads these rows.
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("answers a refusal as the form's own state — the rule's sentence, the box it names, everything typed — and writes nothing", async () => {
    const typed = { place: "route", name: "  Punctul meu ", km: "cinci", coordinates: PIATA };
    const outcome = (await addPlanPointAction(null, form(typed))) as FormOutcome;
    expect(outcome).toMatchObject({ error: "PLAN_POINT_KM_INVALID", fields: ["km"] });
    // What was typed, box by box, as it was typed — a wrong kilometre costs none of the others.
    expect(outcome.values).toMatchObject({ place: ["route"], name: ["  Punctul meu "], km: ["cinci"], coordinates: [PIATA], eventId: [race.raceId] });
    expect(state.redirected).toEqual([]);
    expect(toasted()).toEqual([]);

    // Each rule its own sentence and its own box.
    expect(await addPlanPointAction(null, form({ place: "route", name: "", km: "5", coordinates: "" }))).toMatchObject({ error: "PLAN_POINT_NAME_MISSING", fields: ["name"], errorValues: { max: "60" } });
    expect(await addPlanPointAction(null, form({ place: "route", name: "Izvor", km: "", coordinates: "" }))).toMatchObject({ error: "PLAN_POINT_KM_INVALID", fields: ["km"] });
    expect(await addPlanPointAction(null, form({ place: "startFinish", name: "Kituri", km: "", coordinates: "pe undeva" }))).toMatchObject({ error: "COORDINATES_INVALID", fields: ["coordinates"], values: { coordinates: ["pe undeva"] } });
    expect(await addPlanPointAction(null, form({ place: "", name: "Kituri", km: "", coordinates: "" }))).toMatchObject({ error: "PLAN_POINT_PLACE_UNKNOWN", fields: ["place"] });
    expect(await ownRows()).toEqual([]);
    expect(await trail()).toEqual([]);

    // The forty-first: the sentence says the limit.
    for (let at = 0; at < PLAN_POINTS_MAX; at += 1) await ownPoint("startFinish", `Loc ${at}`);
    expect(await addPlanPointAction(null, form({ place: "route", name: "Unul în plus", km: "1", coordinates: "" }))).toMatchObject({ error: "PLAN_POINT_TOO_MANY", fields: [], errorValues: { max: "40" }, values: { name: ["Unul în plus"] } });
    expect(await ownRows()).toHaveLength(PLAN_POINTS_MAX);
  });

  it("draws the refused form with what was typed still in its boxes, the box named, and the sentence above them — in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const catalogue = locale === "ro" ? ro : en;
      const words = catalogue.Admin.volunteers.plan.points;
      const outcome = (await addPlanPointAction(null, form({ uiLocale: locale, place: "startFinish", name: "Kituri și numere", km: "12", coordinates: "undeva pe la start" }))) as FormOutcome;
      expect(outcome).toMatchObject({ error: "COORDINATES_INVALID", fields: ["coordinates"] });
      // As the server answers a plain POST: the page, with the form's returned state.
      state.refused = { action: addPlanPointAction, outcome };
      const page = await planPage();
      state.refused = undefined;

      const addForm = /<form[^>]*data-testid="plan-point-add-form"[\s\S]*?<\/form>/.exec(builderOf(page))![0];
      // The sentence, first in the form, naming the box as a link to it — and that what was typed is still there.
      const summary = /<div[^>]*data-testid="form-refusal"[\s\S]*?<\/ul>/.exec(addForm)![0];
      expect(addForm.indexOf('data-testid="form-refusal"')).toBeLessThan(addForm.indexOf('data-testid="plan-point-add-name"'));
      expect(wordsOf(summary)).toContain(wordsOf(catalogue.Admin.errors.COORDINATES_INVALID));
      expect(summary).toMatch(new RegExp(`<a[^>]*href="#field-plan-point-add-coordinates"[^>]*>${words.coordinates.replace(/[()]/g, "\\$&")}</a>`));
      expect(addForm).toContain(escaped(catalogue.Admin.forms.kept));
      // Every box as it was typed, the choice as it was made.
      expect(radiosOf(addForm)).toEqual({ route: false, startFinish: true });
      expect(valueOf(addForm, "plan-point-add-name")).toBe("Kituri și numere");
      expect(valueOf(addForm, "plan-point-add-km")).toBe("12");
      const coordinates = tagOf(addForm, 'data-testid="plan-point-add-coordinates"');
      expect(valueOf(addForm, "plan-point-add-coordinates")).toBe("undeva pe la start");
      // The box the refusal names is marked, with «Verifică acest câmp» under it; the others are not.
      expect(coordinates).toContain('aria-invalid="true"');
      expect(tagOf(addForm, 'data-testid="plan-point-add-name"')).toContain('aria-invalid="false"');
      expect(tagOf(addForm, 'data-testid="plan-point-add-km"')).toContain('aria-invalid="false"');
      expect(addForm).toContain(escaped(catalogue.Admin.forms.fieldError));
      // Nothing was written, so no other form of the page is refused with it.
      expect(page.match(/data-testid="form-refusal"/g)).toHaveLength(1);
    }
    expect(await ownRows()).toEqual([]);
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member at its own door — the service is never reached — and a form with no event names no plan", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await addPlanPointAction(null, form({ place: "route", name: "Al meu", km: "1", coordinates: "" })), role).toMatchObject({ error: "FORBIDDEN", values: { name: ["Al meu"] } });
    }
    expect(state.asked).toEqual(Array.from({ length: 4 }, () => "canManageVolunteers"));
    expect(state.changed).toBe(0);
    expect(await ownRows()).toEqual([]);
    state.actor = staff.MODERATOR;
    expect(await pressed(() => addPlanPointAction(null, form({ eventId: "not-an-id", place: "route", name: "Izvor", km: "1", coordinates: "" })))).toBe("/ro/admin/volunteers");
    expect(state.changed).toBe(0);
  });
});

describe("§961 «Salvează punctul» and «Șterge punctul»: the actions", () => {
  it("saves a point of the plan's own and comes back to that point, open; a press that changes nothing says so", async () => {
    const spring = await ownPoint("route", "Izvor", "3,4");
    await place(race.people.radu, spring);
    // A point's press comes back to «Pe puncte», the point drawn open (§974).
    const atSpring = `${planPath()}?view=points&open=${spring}#point-${spring}`;
    expect(await pressed(() => editPlanPointAction(form({ pointId: spring, place: "route", name: "Izvorul rece", km: "4,25", coordinates: PIATA })))).toBe(atSpring);
    expect(toasted()).toEqual([{ kind: "success", key: "planPointSaved" }]);
    expect(await rowOf(spring)).toMatchObject({ nameRo: "Izvorul rece", nameEn: "Izvorul rece", km: "4.25", latitude: "45.642710", longitude: "25.588710", planOnly: true, startFinish: false });
    // Radu stays where he stands: a point changed under a person moves nobody.
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, race.people.radu)))[0].checkpointId).toBe(spring);

    state.flashed.length = 0;
    expect(await pressed(() => editPlanPointAction(form({ pointId: spring, place: "route", name: "Izvorul rece", km: "4.25", coordinates: PIATA })))).toBe(atSpring);
    expect(toasted()).toEqual([{ kind: "info", key: "volunteerUnchanged" }]);
    // To the start–finish: no kilometre, no number — and the page draws it in the other group.
    await pressed(() => editPlanPointAction(form({ pointId: spring, place: "startFinish", name: "Izvorul rece", km: "4,25", coordinates: "" })));
    expect(await rowOf(spring)).toMatchObject({ startFinish: true, km: "0.00", latitude: null });
    expect(planPointsOf(groupOf(await planPage(POINTS), "startFinish")).map((part) => planPointBar(part).name)).toEqual(["Izvorul rece"]);
    expect(state.asked).toEqual(["canManageVolunteers", "canManageVolunteers", "canManageVolunteers"]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("saves the coordinates alone of an editor's point, whatever else the form posts", async () => {
    const before = await rowOf(race.points.junction);
    expect(await pressed(() => editPlanPointAction(form({ pointId: race.points.junction, place: "startFinish", name: "Alt nume", km: "99", coordinates: PIATA })))).toBe(
      `${planPath()}?view=points&open=${race.points.junction}#point-${race.points.junction}`,
    );
    expect(toasted()).toEqual([{ kind: "success", key: "planPointSaved" }]);
    expect(await rowOf(race.points.junction)).toEqual({ ...before, latitude: "45.642710", longitude: "25.588710" });
    // The page says where it is, on the event's own point — numbered where it always was, and still not «doar pe plan».
    const point = pointOf(await planPage(POINTS), race.points.junction);
    expect(planPointBar(point)).toEqual({ name: "1. Intersecția Stejeriș", line: "1,2 km · 2 voluntari" });
    expect(textOf(point, "plan-point-coordinates")).toEqual(["45.64271, 25.58871"]);
    expect(point).not.toContain('data-testid="plan-point-own"');
  });

  it("brings a refused save back to the page's alert, where its sentence is — the box's rule, a point gone meanwhile, a role that may not", async () => {
    const spring = await ownPoint("route", "Izvor", "3,4");
    const before = await rowOf(spring);
    const boxes = { pointId: spring, place: "route", name: "Izvor", km: "3,4", coordinates: "" };
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, name: "" })))).toBe(alertOf("PLAN_POINT_NAME_MISSING", spring));
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, km: "departe" })))).toBe(alertOf("PLAN_POINT_KM_INVALID", spring));
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, coordinates: "nicăieri" })))).toBe(alertOf("COORDINATES_INVALID", spring));
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, place: "undeva" })))).toBe(alertOf("PLAN_POINT_PLACE_UNKNOWN", spring));
    // A point that is not on this plan — another event's, or no id at all — is said as a point no longer on the plan, never as
    // the backoffice's «Înregistrarea nu mai există», which names a registration.
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, pointId: race.points.elsewhere })))).toBe(alertOf("PLAN_POINT_GONE", race.points.elsewhere));
    expect(await pressed(() => editPlanPointAction(form({ ...boxes, pointId: "not-an-id" })))).toBe(alertOf("PLAN_POINT_GONE"));
    expect(await rowOf(spring)).toEqual(before);
    expect(toasted()).toEqual([]);

    // The page says each code in words, in the alert region — a sentence that counts is given its number.
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const errors = (locale === "ro" ? ro : en).Admin.errors as Record<string, string>;
      for (const code of ["PLAN_POINT_NAME_MISSING", "PLAN_POINT_KM_INVALID", "COORDINATES_INVALID", "PLAN_POINT_PLACE_UNKNOWN", "PLAN_POINT_IN_EDITOR", "PLAN_POINT_TOO_MANY", "PLAN_POINT_GONE", "NOT_FOUND", "FORBIDDEN"]) {
        const page = await planPage({ planError: code });
        const said = wordsOf(/<div[^>]*id="admin-alert"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(page)![0]);
        const sentence = errors[code].replace("{max}", code === "PLAN_POINT_TOO_MANY" ? "40" : "60");
        expect(said, `${locale}: ${code}`).toBe(wordsOf(escaped(sentence)));
        expect(said, `${locale}: ${code}`).not.toMatch(/\{\w+\}/);
      }
    }
    state.locale = "ro";

    // The Tehnic role's press writes nothing: refused at the door, the service never reached.
    state.changed = 0;
    state.actor = staff.DEV;
    expect(await pressed(() => editPlanPointAction(form(boxes)))).toBe(alertOf("FORBIDDEN", spring));
    expect(await pressed(() => removePlanPointAction(form({ pointId: spring })))).toBe(alertOf("FORBIDDEN", spring));
    expect(state.changed).toBe(0);
    expect(await rowOf(spring)).toEqual(before);
  });

  it("deletes a point of the plan's own and comes back to the plan's list, its people under «Fără punct» — and refuses an editor's point", async () => {
    const kits = await ownPoint("startFinish", "Kituri");
    await place(race.people.radu, kits);
    expect(await pressed(() => removePlanPointAction(form({ pointId: kits })))).toBe(`${planPath()}?view=points#plan-list`);
    expect(toasted()).toEqual([{ kind: "success", key: "planPointRemoved" }]);
    expect(await rowOf(kits)).toBeUndefined();
    const removal = (await trail()).find((row) => row.action === "volunteer_plan.point_removed")!;
    expect(removal).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(removal.metadataJson).toMatchObject({ pointId: kits, freed: 1 });

    const page = await planPage(POINTS);
    expect(tagOf(page, 'id="plan-list"')).not.toBe("");
    expect(page).not.toContain(`id="point-${kits}"`);
    expect(textOf(page.slice(page.indexOf('data-testid="plan-unplaced"')), "plan-person-name")).toEqual(["Radu Liber"]);

    // An editor's point is not deleted here: its sentence says where it is.
    state.flashed.length = 0;
    expect(await pressed(() => removePlanPointAction(form({ pointId: race.points.bridge })))).toBe(alertOf("PLAN_POINT_IN_EDITOR", race.points.bridge));
    expect(await rowOf(race.points.bridge)).toBeDefined();
    // «Șterge punctul» pressed again — a second tap on a slow connection, or a colleague's delete first: the point is no
    // longer on the plan, and the alert says that.
    expect(await pressed(() => removePlanPointAction(form({ pointId: kits })))).toBe(alertOf("PLAN_POINT_GONE", kits));
    expect(wordsOf(/<div[^>]*id="admin-alert"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(await planPage({ planError: "PLAN_POINT_GONE" }))![0])).toBe(
      "Punctul nu mai e pe plan: a fost șters între timp.",
    );
    expect(toasted()).toEqual([]);
    expect(await pressed(() => removePlanPointAction(form({ eventId: "", pointId: kits })))).toBe("/ro/admin/volunteers");
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("has a toast in both catalogues for every press, in the brief's own words", () => {
    expect([ro.Feedback.toast.planPointAdded, ro.Feedback.toast.planPointSaved, ro.Feedback.toast.planPointRemoved]).toEqual(["Punct adăugat.", "Punct salvat.", "Punct șters."]);
    expect([en.Feedback.toast.planPointAdded, en.Feedback.toast.planPointSaved, en.Feedback.toast.planPointRemoved]).toEqual(["Point added.", "Point saved.", "Point deleted."]);
  });
});

describe("§961 the «Voluntari» list's «Punct», and one number everywhere", () => {
  it("says a start–finish point by its name and the quiet word «start–finish» — never a number or a kilometre — and a route point as before", async () => {
    const kits = await ownPoint("startFinish", "Kituri și numere", "", PIATA);
    await place(race.people.radu, kits);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.volunteers.plan;
      const page = await listPage();
      // The column, with its hint: the point, at the start–finish or on the route.
      expect(page).toContain(escaped(words.columnHint));
      // Radu's cell — in the table and in his phone card: the name, then the quiet word.
      const cells = [...page.matchAll(/<span data-testid="volunteer-point">[^<]*<span[^>]*data-testid="volunteer-point-kind"[^>]*>[^<]*<\/span><\/span>/g)].map((match) => match[0]);
      expect(cells.map((cell) => wordsOf(cell))).toEqual(["Kituri și numere · start–finish", "Kituri și numere · start–finish"]);
      for (const cell of cells) {
        expect(wordsOf(cell)).not.toMatch(/\d/);
        expect(wordsOf(cell)).not.toMatch(/\bkm\b/);
        expect(textOf(cell, "volunteer-point-kind")).toEqual([" · start–finish"]);
        expect(words.columnStartFinish).toBe("start–finish");
      }
      // The people on the route read as they did: the point's number in the route's order and its name.
      const onRoute = textOf(page, "volunteer-point").filter((text) => /^\d/.test(text));
      expect([...new Set(onRoute)].sort()).toEqual(
        locale === "ro" ? ["1. Intersecția Stejeriș", "2. Apă la cabană", "3. Podul de lemn"] : ["1. Stejeriș junction", "2. Water at the hut", "3. The wooden bridge"],
      );
    }
  });

  it("gives one point one number — or none — on the plan, in the list's cell and in the email's facts", async () => {
    // A start–finish point, and a point of the plan's own on the route between two of the editor's: the junction (1.2) and the water (5.5).
    const kits = await ownPoint("startFinish", "Kituri și numere");
    const spring = await ownPoint("route", "Izvor", "3,4");
    await place(race.people.radu, kits);
    await place(race.people.ion, spring);
    await sendVolunteerPoints(db, staff.ADMIN!, { eventId: race.raceId }, NOW);

    const plan = await readVolunteerPlan(db, staff.ADMIN!, race.raceId);
    const onPlan = new Map(plan.points.map(({ point, number }) => [point.id, number]));
    const mails = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_POINT"))) as OutboxRow[];
    const inMail = async (volunteerId: string) => (await volunteerPointAtSend(db, mails.find((row) => (row.payloadJson as { volunteerId: string }).volunteerId === volunteerId)!)).number;
    const page = await listPage();
    /** The «Punct» cell of one person's row, as words. */
    const inList = (name: string) => {
      const row = new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?>${name}<(?:(?!</tr>)[\\s\\S])*?</tr>`).exec(page)![0];
      return wordsOf(/<span data-testid="volunteer-point">[\s\S]*?<\/span>(?:<\/span>)?/.exec(row)![0]);
    };

    // Radu, at the start–finish: no number, three times.
    expect(onPlan.get(kits)).toBeNull();
    expect(await inMail(race.people.radu)).toBeNull();
    expect(inList("Radu Liber")).toBe("Kituri și numere · start–finish");
    // Ion, at the plan's own point: the route's second.
    expect(onPlan.get(spring)).toBe(2);
    expect(await inMail(race.people.ion)).toBe(2);
    expect(inList("Ion Lupu")).toBe("2. Izvor");
    // Ana before it and Dan after it, at the editor's points: the first and the third.
    expect([onPlan.get(race.points.junction), await inMail(race.people.ana), inList("Ana Pop")]).toEqual([1, 1, "1. Intersecția Stejeriș"]);
    expect([onPlan.get(race.points.water), await inMail(race.people.dan), inList("Dan Ene")]).toEqual([3, 3, "3. Apă la cabană"]);
    // …and the plan's page names them with the same numbers.
    const drawn = await planPage(POINTS);
    expect(planPointBar(pointOf(drawn, spring)).name).toBe("2. Izvor");
    expect(planPointBar(pointOf(drawn, race.points.water)).name).toBe("3. Apă la cabană");
    expect(planPointBar(pointOf(drawn, kits)).name).toBe("Kituri și numere");
  });

  it("has the «Punct» column for an event whose only points are the plan's own", async () => {
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.raceId));
    expect(await listPage()).not.toContain(escaped(ro.Admin.volunteers.plan.columnHint));
    const kits = await ownPoint("startFinish", "Kituri");
    await place(race.people.radu, kits);
    const page = await listPage();
    expect(page).toContain(escaped(ro.Admin.volunteers.plan.columnHint));
    expect(textOf(page, "volunteer-point")).toEqual(["Kituri", "Kituri"]);
  });
});
