import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { changePlanPoint } from "@/modules/volunteers/plan-points";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { decodeFlash } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnOpen, elementWith, type PlanRace, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §978, amending §949 and §974, BR-REQ-041-01, BR-REQ-060-01 — «Fără punct» on «Planul voluntarilor» (the owner, 2026-11-18:
 * «aici eu vreau sa pot asigna voluntari la punct direct de aici: Si sectiunea trebuie sa fie collapsible»):
 *
 * - a fold (`plan-unplaced`), last in both views, closed as every fold of the page, its closed line how many stand at no
 *   point, open after a press made in it (`saved=planUnplaced`), printed open with its arrow off;
 * - on each person's line, while the plan has a point, a form off the paper posting «Pune aici»'s own action with the person,
 *   `at=unplaced` and a native select of the plan's points — required, empty first, «Pe traseu» numbered with its kilometre in
 *   the plan's one order, then «La start–finish», a group with no point left out — and «Pune», 44 pixels, named for the person;
 * - a press comes back to «Fără punct», open, the person placed; a refusal to the page's alert, as every press of the page.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  flashed: [] as string[],
}));

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
const { placeVolunteerAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");

const NOW = new Date("2026-11-18T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;
const own = { kits: "", start: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  Object.assign(state, { locale: "ro" });
  state.redirected.length = 0;
  state.flashed.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  // Radu stands at no point; Ana is taken off hers, so two people wait under «Fără punct».
  race = await seedPlanRace(db, NOW);
  await changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id: race.people.ana, checkpointId: "" }, NOW);
  own.kits = (await changePlanPoint(db, staff.ADMIN!, { kind: "add", eventId: race.raceId, place: "startFinish", name: "Kituri și numere", km: "", coordinates: "" }, NOW)).id;
  own.start = (await changePlanPoint(db, staff.ADMIN!, { kind: "add", eventId: race.raceId, place: "startFinish", name: "Linia de start", km: "", coordinates: "" }, NOW)).id;
});

async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, id = race.raceId, keepStyles = false) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) }), keepStyles);
const tagsOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((match) => match[0]);
const cssOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
const classesIn = (tag: string) => (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter((name) => name.startsWith("css-"));
/** Every rule the element's own classes carry, inside `@media print`. */
const printOf = (page: string, classes: string[]) =>
  classes
    .flatMap((name) => [...cssOf(page).matchAll(/@media print\{((?:[^{}]*\{[^}]*\})+)\}/g)].flatMap((block) => [...block[1].matchAll(new RegExp(`\\.${name}([^{]*)\\{([^}]*)\\}`, "g"))].map((rule) => `${rule[1]}{${rule[2]}}`)))
    .join(";");
const screenOf = (page: string, classes: string[]) => classes.flatMap((name) => [...cssOf(page).matchAll(new RegExp(`(?:^|\\}|\\s)\\.${name}\\{([^}]*)\\}`, "g"))].map((match) => match[1])).join(";");
const unplacedOf = (page: string) => elementWith(page, 'data-testid="plan-unplaced"');
const linesOf = (fold: string) => [...fold.matchAll(/data-testid="plan-unplaced-person"/g)].map((match) => elementWith(fold.slice(fold.lastIndexOf("<", match.index)), 'data-testid="plan-unplaced-person"'));
const toasted = () => state.flashed.map((value) => decodeFlash(value)?.key);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: race.raceId, view: "table", ...fields })) data.set(key, value);
  return data;
}
async function press(fields: Record<string, string>): Promise<string> {
  state.redirected.length = 0;
  state.flashed.length = 0;
  await expect(placeVolunteerAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}
const checkpointOf = async (id: string) => (await db.select({ checkpointId: eventVolunteers.checkpointId }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].checkpointId;

describe("§978 «Fără punct» is a fold", () => {
  it("is last in both views, closed, its closed line how many stand at no point — and open after a press made in it", async () => {
    for (const view of ["table", "points"]) {
      const page = await planPage({ view });
      const fold = unplacedOf(page);
      expect(fold).toMatch(/^<details[^>]*id="plan-unplaced"/);
      expect(drawnOpen(fold)).toBe(false);
      expect(fold).toContain(`</svg>${ro.Admin.volunteers.plan.unplacedTitle}<`);
      expect(fold).toContain('data-testid="plan-unplaced-count">2 voluntari<');
      // Last: after the email's fold.
      expect(page.indexOf('data-testid="plan-unplaced"')).toBeGreaterThan(page.indexOf('data-testid="plan-mail-section"'));
      expect(drawnOpen(unplacedOf(await planPage({ view, saved: "planUnplaced" })))).toBe(true);
    }
    // In English.
    state.locale = "en";
    expect(unplacedOf(await planPage())).toContain('data-testid="plan-unplaced-count">2 volunteers<');
    // Everybody placed: the closed line says nobody, and the sentence inside says so.
    state.locale = "ro";
    for (const id of [race.people.ana, race.people.radu]) await changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId: own.kits }, NOW);
    const all = unplacedOf(await planPage());
    expect(all).toContain(`data-testid="plan-unplaced-count">${ro.Admin.volunteers.plan.peopleNone}<`);
    expect(all).toContain('data-testid="plan-unplaced-none"');
    expect(all).toContain(ro.Admin.volunteers.plan.unplacedNone);
  });

  it("says both ways to place a person, and prints open with its arrow off, the people without the forms", async () => {
    const page = await planPage({}, race.raceId, true);
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    expect(unplacedOf(plain)).toContain(ro.Admin.volunteers.plan.unplacedHelp);
    expect(ro.Admin.volunteers.plan.unplacedHelp).toBe("Încă nu stau la niciun punct. Alege-le punctul aici, pe rândul fiecăruia, sau cu „Pune aici” la punct.");
    expect(en.Admin.volunteers.plan.unplacedHelp).toMatch(/here, on each one's line, or with "Put here" at the point/);
    const print = printOf(page, classesIn(tagsOf(plain, "plan-unplaced")[0]));
    expect(print).toMatch(/::details-content\{display:block;content-visibility:visible/);
    expect(print).toMatch(/>summary::before\{display:none/);
    expect(print).not.toMatch(/(^|;)\{display:none/);
    for (const testid of ["plan-unplaced-place-form", "plan-unplaced-help"]) expect(printOf(page, classesIn(tagsOf(plain, testid)[0])), testid).toMatch(/(^|;)\{display:none/);
  });
});

describe("§978 each person at no point has the point to put them at, and «Pune»", () => {
  it("posts «Pune aici»'s own action with the person, `at=unplaced` and a required native select of the plan's points, grouped", async () => {
    const page = await planPage();
    const lines = linesOf(unplacedOf(page));
    expect(lines.map((line) => /data-testid="plan-person-name"[^>]*>(?:<a[^>]*>)?([^<]*)</.exec(line)?.[1])).toEqual(["Ana Pop", "Radu Liber"]);
    const [ana] = lines;
    const placeForm = /<form[^>]*data-testid="plan-unplaced-place-form"[\s\S]*?<\/form>/.exec(ana)![0];
    expect(placeForm).toContain(`name="volunteerId" value="${race.people.ana}"`);
    expect(placeForm).toContain('name="at" value="unplaced"');
    expect(placeForm).toContain(`name="eventId" value="${race.raceId}"`);
    expect(placeForm).toContain('name="view" value="table"');
    // The native select: the phone's own list, required, an empty first choice.
    const select = /<select[^>]*>[\s\S]*?<\/select>/.exec(placeForm)![0];
    expect(select).toMatch(/^<select[^>]*name="checkpointId"/);
    expect(select).toContain('required=""');
    expect(select).toContain('data-testid="plan-unplaced-select"');
    expect(select).toMatch(/<select[^>]*><option value="" selected="">Alege punctul<\/option>/);
    // «Pe traseu» first, numbered in the plan's one order with its kilometre; then «La start–finish», by name.
    const groups = [...select.matchAll(/<optgroup label="([^"]*)">([\s\S]*?)<\/optgroup>/g)].map((match) => ({
      label: match[1],
      options: [...match[2].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((option) => [option[1], option[2]]),
    }));
    expect(groups).toEqual([
      {
        label: "Pe traseu",
        options: [
          [race.points.junction, "1. Intersecția Stejeriș · km 1,2"],
          [race.points.water, "2. Apă la cabană · km 5,5"],
          [race.points.bridge, "3. Podul de lemn · km 7,25"],
        ],
      },
      {
        label: "La start–finish",
        options: [
          [own.kits, "Kituri și numere"],
          [own.start, "Linia de start"],
        ],
      },
    ]);
    // «Pune»: the house's button with the glyph by its name, 44 pixels, named for the person.
    const button = tagsOf(placeForm, "plan-unplaced-place")[0];
    expect(button).toMatch(/^<button[^>]*type="submit"/);
    expect(button).toContain('aria-label="Pune la punctul ales: Ana Pop"');
    expect(placeForm).toContain(">Pune<");
    const styled = await planPage({}, race.raceId, true);
    expect(screenOf(styled, classesIn(tagsOf(styled, "plan-unplaced-place")[0]))).toMatch(/min-height:44px/);
  });

  it("leaves a group with no point out, and draws no form on a plan with no point at all", async () => {
    await changePlanPoint(db, staff.ADMIN!, { kind: "remove", eventId: race.raceId, id: own.kits }, NOW);
    await changePlanPoint(db, staff.ADMIN!, { kind: "remove", eventId: race.raceId, id: own.start }, NOW);
    const select = /<select[^>]*data-testid="plan-unplaced-select"[\s\S]*?<\/select>|<select[\s\S]*?data-testid="plan-unplaced-select"[\s\S]*?<\/select>/.exec(unplacedOf(await planPage()))![0];
    expect([...select.matchAll(/<optgroup label="([^"]*)"/g)].map((match) => match[1])).toEqual(["Pe traseu"]);
    // In English, the groups' and the choice's own words.
    state.locale = "en";
    const english = unplacedOf(await planPage());
    expect(english).toContain('<optgroup label="On the route">');
    expect(english).toContain('<option value="" selected="">Choose the point</option>');
    expect(english).toContain(">1. Stejeriș junction · km 1.2<");
    state.locale = "ro";
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.raceId));
    const bare = unplacedOf(await planPage());
    expect(linesOf(bare)).toHaveLength(5);
    expect(bare).not.toContain('data-testid="plan-unplaced-place-form"');
  });

  it("places the person from their line and comes back to «Fără punct», open; a refusal to the page's alert", async () => {
    expect(await press({ volunteerId: race.people.radu, checkpointId: own.kits, at: "unplaced" })).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?view=table&saved=planUnplaced#plan-unplaced`);
    expect(toasted()).toEqual(["volunteerPlaced"]);
    expect(await checkpointOf(race.people.radu)).toBe(own.kits);
    // Pressed on «Pe puncte», back to it.
    expect(await press({ volunteerId: race.people.ana, checkpointId: race.points.bridge, at: "unplaced", view: "points" })).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?view=points&saved=planUnplaced#plan-unplaced`);
    expect(await checkpointOf(race.people.ana)).toBe(race.points.bridge);
    const page = await planPage({ saved: "planUnplaced" });
    expect(drawnOpen(unplacedOf(page))).toBe(true);
    expect(linesOf(unplacedOf(page))).toEqual([]);

    // A point of another event, or none chosen: refused at the alert, the person where they were.
    expect(await press({ volunteerId: race.people.ana, checkpointId: race.points.elsewhere, at: "unplaced" })).toMatch(/\?view=table&planError=[A-Z_]+#admin-alert$/);
    expect(await checkpointOf(race.people.ana)).toBe(race.points.bridge);
    // A role that may not: refused by the service, nothing moved.
    state.actor = staff.DEV;
    expect(await press({ volunteerId: race.people.ana, checkpointId: own.start, at: "unplaced" })).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?view=table&planError=FORBIDDEN#admin-alert`);
    expect(await checkpointOf(race.people.ana)).toBe(race.points.bridge);
  });

  it("leaves «Pune aici» and «Scoate» as they were: back to the point, open", async () => {
    expect(await press({ volunteerId: race.people.radu, checkpointId: race.points.water, at: race.points.water, view: "points" })).toBe(
      `/ro/admin/events/${race.raceId}/plan-voluntari?view=points&open=${race.points.water}#point-${race.points.water}`,
    );
    expect(await press({ volunteerId: race.people.radu, checkpointId: "", at: race.points.water, view: "points" })).toBe(
      `/ro/admin/events/${race.raceId}/plan-voluntari?view=points&open=${race.points.water}#point-${race.points.water}`,
    );
    expect(await checkpointOf(race.people.radu)).toBeNull();
  });
});
