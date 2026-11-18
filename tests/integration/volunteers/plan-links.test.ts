import { randomUUID } from "node:crypto";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventVolunteerPlanLinks, PLAN_LINKS_MAX } from "@/db/schema/volunteer-plan";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { addVolunteerPlanLink, readVolunteerPlan, readVolunteerPlanMaps, removeVolunteerPlanLink } from "@/modules/volunteers/plan";
import { decodeFlash } from "@/shared/feedback/notice";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnOpen, elementWith } from "../../helpers/volunteer-plan";

/**
 * §978 «Poze și hărți», BR-REQ-060-01 — the links of «Planul voluntarilor» (the owner, 2026-11-18: «am facut spre exemplu un
 * google maps custom map si vreau sa pot pune url-ul»), from a real database:
 *
 * - whoever works the volunteers adds an address — `https:` or `http:` only, read whole, at most 2 000 characters — with an
 *   optional label of at most 120, each going last, twelve at most, and takes one off; the same address again changes
 *   nothing; each change one audit row with the link's id alone; the event's row does not move; anybody else is refused with
 *   nothing written;
 * - the plan reads them in their order with their host, and the email reads the same;
 * - «Adaugă linkul» keeps what was typed on a refusal and names the box; a press comes back to the fold, open;
 * - the page draws each link in bold, opening in a new tab, 44 pixels tall, its host in grey, «Șterge linkul» beside it,
 *   which asks; on paper the label and the whole address as text, the controls off the sheet.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  asked: [] as string[],
  flashed: [] as string[],
  serviceCalls: 0,
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
      state.asked.push(capability.name);
      if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "the door refused");
      return state.actor;
    },
  };
});
// The services themselves, counted: a press refused at the action's door never reaches them.
vi.mock("@/modules/volunteers/plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/plan")>();
  return {
    ...real,
    addVolunteerPlanLink: (...args: Parameters<typeof real.addVolunteerPlanLink>) => {
      state.serviceCalls += 1;
      return real.addVolunteerPlanLink(...args);
    },
    removeVolunteerPlanLink: (...args: Parameters<typeof real.removeVolunteerPlanLink>) => {
      state.serviceCalls += 1;
      return real.removeVolunteerPlanLink(...args);
    },
  };
});

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { addPlanLinkAction, removePlanLinkAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");

const NOW = new Date("2026-11-18T10:00:00.000Z");
/** A made-up Google My Maps address, as «Distribuie» copies one. */
const MY_MAP = "https://www.google.com/maps/d/viewer?mid=1AbCdEfGhIjKlMnOp&usp=sharing";

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let otherId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  Object.assign(state, { locale: "ro", serviceCalls: 0 });
  state.redirected.length = 0;
  state.asked.length = 0;
  state.flashed.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  const [race, other] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), acceptsVolunteers: true },
      { type: "RACE", startsAt: new Date("2026-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  otherId = other.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  await db.insert(eventCheckpoints).values({ eventId: raceId, km: "1.20", nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", kinds: ["DIRECTION"], position: 0 });
});

let presses = 0;
const moment = () => new Date(NOW.getTime() + ++presses * 1000);
const addLink = (actor: StaffUser, url: unknown, label: unknown = "", eventId = raceId) => addVolunteerPlanLink(db, actor, { eventId, url, label }, moment());
const removeLink = (actor: StaffUser, id: unknown, eventId = raceId) => removeVolunteerPlanLink(db, actor, { eventId, id }, moment());
const linkRows = async (eventId = raceId) => db.select().from(eventVolunteerPlanLinks).where(eq(eventVolunteerPlanLinks.eventId, eventId)).orderBy(asc(eventVolunteerPlanLinks.position));
const trail = async () =>
  (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "event.volunteer_plan_link_added" || row.action === "event.volunteer_plan_link_removed");

async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, keepStyles = false) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id: raceId }), searchParams: Promise.resolve(query) }), keepStyles);
const tagsOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((match) => match[0]);
const cssOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
function rulesOf(page: string, testid: string): { screen: string; print: string } {
  const css = cssOf(page);
  const classes = ((tagsOf(page, testid)[0] ?? "").match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter((name) => name.startsWith("css-"));
  expect(classes.length, `${testid} carries a generated class`).toBeGreaterThan(0);
  const escaped = classes.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const all = (pattern: (name: string) => RegExp) => escaped.flatMap((name) => [...css.matchAll(pattern(name))].map((match) => match[1])).join(";");
  return {
    screen: all((name) => new RegExp(`(?:^|\\}|\\s)\\.${name}\\{([^}]*)\\}`, "g")),
    print: all((name) => new RegExp(`@media print\\{\\.${name}\\{([^}]*)\\}`, "g")),
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, ...fields })) data.set(key, value);
  return data;
}
async function press(action: (form: FormData) => Promise<void>, fields: Record<string, string> = {}): Promise<string> {
  state.redirected.length = 0;
  state.flashed.length = 0;
  await expect(action(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}
/** «Adaugă linkul», an `ActionForm`'s action: a refusal is returned, a success redirects. */
async function addPress(fields: Record<string, string>): Promise<FormOutcome | string> {
  state.redirected.length = 0;
  state.flashed.length = 0;
  try {
    return (await addPlanLinkAction(null, form(fields)))!;
  } catch (error) {
    if ((error as Error).message !== "NEXT_REDIRECT") throw error;
    return state.redirected[0];
  }
}
const toasted = () => state.flashed.map((value) => decodeFlash(value)?.key);
const back = (view = "table") => `/ro/admin/events/${raceId}/plan-voluntari?view=${view}&saved=planMaps#plan-maps`;

describe("§978 the plan's links: added, each last, and taken off", () => {
  it("lets the Organizer add an address with a label, audited with the link's id alone, and moves nothing of the event", async () => {
    const [before] = await db.select().from(events).where(eq(events.id, raceId));
    expect(await addLink(staff.MODERATOR!, `  ${MY_MAP}  `, "  Harta voluntarilor  ")).toEqual({ changed: true });
    const [row] = await linkRows();
    // Trimmed, as typed otherwise; one label for both languages.
    expect(row).toMatchObject({ url: MY_MAP, label: "Harta voluntarilor", position: 1 });
    expect((await db.select().from(events).where(eq(events.id, raceId)))[0]).toEqual(before);
    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "event.volunteer_plan_link_added", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    // Never the address or the label.
    expect(rows[0].metadataJson).toEqual({ linkId: row.id });
  });

  it("keeps an empty label as none, puts each link last, and changes nothing for an address already on the plan", async () => {
    await addLink(staff.ADMIN!, MY_MAP, "");
    await addLink(staff.ADMIN!, "http://traseu.example.test/harta.pdf", "Traseul, PDF");
    expect(await addLink(staff.ADMIN!, MY_MAP, "Alt nume")).toEqual({ changed: false });
    expect((await linkRows()).map((row) => [row.url, row.label, row.position])).toEqual([
      [MY_MAP, null, 1],
      ["http://traseu.example.test/harta.pdf", "Traseul, PDF", 2],
    ]);
    expect(await trail()).toHaveLength(2);
    // The plan reads them in that order, each with its host — `www.` left off.
    expect((await readVolunteerPlan(db, staff.MODERATOR!, raceId)).links.map(({ url, label, host }) => ({ url, label, host }))).toEqual([
      { url: MY_MAP, label: null, host: "google.com" },
      { url: "http://traseu.example.test/harta.pdf", label: "Traseul, PDF", host: "traseu.example.test" },
    ]);
    // …and the email's own read, with nobody signed in, the same.
    expect((await readVolunteerPlanMaps(db, raceId)).links.map((link) => link.url)).toEqual([MY_MAP, "http://traseu.example.test/harta.pdf"]);
  });

  it("refuses anything that is no web address, naming the box: another scheme, no host, a space, nothing, too long", async () => {
    const tooLong = `https://maps.example.test/${"a".repeat(2000)}`;
    for (const url of ["", "   ", "javascript:alert(1)", "data:text/html,<b>x</b>", "mailto:ana.pop@example.test", "ftp://files.example.test/harta", "file:///etc/hosts", "maps.google.com/d/viewer", "https://", "https://maps.example .test/x", "https://maps.example.test/a b", "https://maps.example.test/\tx", tooLong, 42, null]) {
      await expect(addLink(staff.ADMIN!, url), JSON.stringify(url).slice(0, 40)).rejects.toMatchObject({ code: "VALIDATION_ERROR", reason: "PLAN_LINK_URL", fields: ["url"] });
    }
    // Exactly 2 000 characters is taken.
    const longest = `https://maps.example.test/${"a".repeat(2000 - "https://maps.example.test/".length)}`;
    expect(longest).toHaveLength(2000);
    expect(await addLink(staff.ADMIN!, longest)).toEqual({ changed: true });
    expect(await linkRows()).toHaveLength(1);
  });

  it("refuses a label past 120 characters, naming its box", async () => {
    await expect(addLink(staff.ADMIN!, MY_MAP, "h".repeat(121))).rejects.toMatchObject({ code: "VALIDATION_ERROR", reason: "PLAN_LINK_LABEL", fields: ["label"], values: { max: "120" } });
    expect(await addLink(staff.ADMIN!, MY_MAP, "h".repeat(120))).toEqual({ changed: true });
  });

  it(`holds ${PLAN_LINKS_MAX} links at most: the next is refused with its sentence, and nothing is written`, async () => {
    for (let n = 0; n < PLAN_LINKS_MAX; n += 1) await addLink(staff.ADMIN!, `https://maps.example.test/${n}`);
    await expect(addLink(staff.ADMIN!, "https://maps.example.test/extra")).rejects.toMatchObject({ code: "VALIDATION_ERROR", reason: "PLAN_LINKS_FULL", values: { max: "12" } });
    expect(await linkRows()).toHaveLength(PLAN_LINKS_MAX);
    await removeLink(staff.ADMIN!, (await linkRows())[3].id);
    expect(await addLink(staff.ADMIN!, "https://maps.example.test/extra")).toEqual({ changed: true });
    expect((await linkRows()).at(-1)).toMatchObject({ url: "https://maps.example.test/extra", position: PLAN_LINKS_MAX + 1 });
  });

  it("takes one off by its id, audited with that id, and nothing for a link that is not this plan's", async () => {
    await addLink(staff.ADMIN!, MY_MAP);
    await addLink(staff.ADMIN!, MY_MAP, "", otherId);
    const [mine] = await linkRows();
    const [theirs] = await linkRows(otherId);
    expect(await removeLink(staff.ADMIN!, theirs.id)).toEqual({ changed: false });
    for (const none of [randomUUID(), "not-an-id", "", null]) expect(await removeLink(staff.ADMIN!, none)).toEqual({ changed: false });
    expect(await removeLink(staff.ADMIN!, mine.id)).toEqual({ changed: true });
    expect(await linkRows()).toEqual([]);
    expect(await linkRows(otherId)).toHaveLength(1);
    const rows = (await trail()).filter((row) => row.entityId === raceId);
    expect(rows.map((row) => row.action)).toEqual(["event.volunteer_plan_link_added", "event.volunteer_plan_link_removed"]);
    expect(rows[1].metadataJson).toEqual({ linkId: mine.id });
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member before anything is read, with nothing written (BR-REQ-060-01)", async () => {
    await addLink(staff.ADMIN!, MY_MAP);
    const [kept] = await linkRows();
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      await expect(addLink(staff[role]!, "https://maps.example.test/x"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(addLink(staff[role]!, "javascript:alert(1)", "", "not-an-id"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeLink(staff[role]!, kept.id), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await linkRows()).map((row) => row.id)).toEqual([kept.id]);
    expect(await trail()).toHaveLength(1);
  });

  it("asks for an event that is there, and is deleted with it", async () => {
    await expect(addLink(staff.ADMIN!, MY_MAP, "", "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeLink(staff.ADMIN!, randomUUID(), "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await addLink(staff.ADMIN!, MY_MAP);
    await db.delete(events).where(eq(events.id, raceId));
    expect(await db.select().from(eventVolunteerPlanLinks)).toEqual([]);
  });
});

describe("§978 the page's presses: «Adaugă linkul», «Șterge linkul»", () => {
  it("adds a link and comes back to the fold, open; takes it off; says what happened each time", async () => {
    expect(await addPress({ url: MY_MAP, label: "Harta voluntarilor" })).toBe(back());
    expect(toasted()).toEqual(["planLinkAdded"]);
    expect(await addPress({ url: MY_MAP, label: "", view: "points" })).toBe(back("points"));
    expect(toasted()).toEqual(["volunteerUnchanged"]);
    const [row] = await linkRows();
    expect(await press(removePlanLinkAction, { linkId: row.id })).toBe(back());
    expect(toasted()).toEqual(["planLinkRemoved"]);
    expect(await press(removePlanLinkAction, { linkId: row.id })).toBe(back());
    expect(toasted()).toEqual(["volunteerUnchanged"]);
    expect(state.asked).toEqual(Array.from({ length: 4 }, () => "canManageVolunteers"));
  });

  it("keeps what was typed on a refusal, naming the box and the sentence, and redirects nowhere", async () => {
    const refused = (await addPress({ url: "maps.google.com/d/viewer", label: "Harta" })) as FormOutcome;
    expect(refused).toMatchObject({ error: "PLAN_LINK_URL", fields: ["url"] });
    expect(refused.values).toMatchObject({ url: ["maps.google.com/d/viewer"], label: ["Harta"] });
    expect(state.redirected).toEqual([]);
    expect(ro.Admin.errors.PLAN_LINK_URL).toBe("Scrie adresa întreagă, care începe cu https://.");
    const label = (await addPress({ url: MY_MAP, label: "x".repeat(121) })) as FormOutcome;
    expect(label).toMatchObject({ error: "PLAN_LINK_LABEL", fields: ["label"], errorValues: { max: "120" } });
    for (let n = 0; n < PLAN_LINKS_MAX; n += 1) await addLink(staff.ADMIN!, `https://maps.example.test/${n}`);
    expect(await addPress({ url: MY_MAP })).toMatchObject({ error: "PLAN_LINKS_FULL", errorValues: { max: "12" } });
  });

  it("refuses the other roles at the action's own door: the service is never reached", async () => {
    await addLink(staff.ADMIN!, MY_MAP);
    const [kept] = await linkRows();
    state.serviceCalls = 0;
    state.asked.length = 0;
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await addPress({ url: "https://maps.example.test/x" }), role).toMatchObject({ error: "FORBIDDEN" });
      expect(await press(removePlanLinkAction, { linkId: kept.id }), role).toBe(`/ro/admin/events/${raceId}/plan-voluntari?view=table&planError=FORBIDDEN#admin-alert`);
    }
    expect(state.asked).toEqual(Array.from({ length: 8 }, () => "canManageVolunteers"));
    expect(state.serviceCalls).toBe(0);
    expect(await linkRows()).toHaveLength(1);
  });
});

describe("§978 «Poze și hărți» draws the links", () => {
  it("draws each link in bold, opening in a new tab, its host after it, with «Șterge linkul», and the fold open", async () => {
    await addLink(staff.ADMIN!, MY_MAP, "Harta voluntarilor");
    await addLink(staff.ADMIN!, "https://traseu.example.test/harti/2026/crosul-de-toamna-varianta-lunga-cu-puncte.pdf");
    const page = await planPage();
    const fold = elementWith(page, 'data-testid="plan-maps-section"');
    expect(drawnOpen(fold)).toBe(true);
    expect(fold).toContain('data-testid="plan-maps-state">nicio poză · 2 linkuri<');
    const opens = tagsOf(fold, "plan-link-open");
    expect(opens).toHaveLength(2);
    expect(opens[0]).toContain(`href="${MY_MAP.replace(/&/g, "&amp;")}"`);
    for (const open of opens) {
      expect(open).toMatch(/^<a /);
      expect(open).toContain('target="_blank"');
      expect(open).toContain('rel="noopener noreferrer"');
    }
    // The label, or with none the host and the start of its path, cut.
    const words = [...fold.matchAll(/data-testid="plan-link-open"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(words[0]).toBe("Harta voluntarilor");
    expect(words[1]).toMatch(/^traseu\.example\.test\/harti\/2026\/crosul-de-.*…$/);
    expect(words[1].length).toBeLessThanOrEqual(48);
    expect(opens[0]).toContain('aria-label="Harta voluntarilor — se deschide într-o filă nouă"');
    expect([...fold.matchAll(/data-testid="plan-link-host"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["google.com", "traseu.example.test"]);
    // «Șterge linkul» asks, naming the link; it posts the link's id and nothing else of it.
    const removes = [...fold.matchAll(/<form[^>]*data-testid="plan-link-remove-form"[\s\S]*?<\/form>/g)].map((match) => match[0]);
    expect(removes).toHaveLength(2);
    const [first] = await linkRows();
    expect(removes[0]).toContain(`name="linkId" value="${first.id}"`);
    expect(removes[0]).toContain('aria-label="Șterge linkul Harta voluntarilor"');
    expect(removes[0]).not.toContain('name="url"');
    // The add form: the address, required; what it is; the hint; the button.
    const add = elementWith(fold, 'data-testid="plan-link-add-form"');
    const url = tagsOf(add, "plan-link-add-url")[0];
    expect(url).toMatch(/^<input /);
    expect(url).toContain('name="url"');
    expect(url).toContain('required=""');
    expect(url).toMatch(/maxLength="2000"/i);
    expect(url).toContain('inputMode="url"');
    const label = tagsOf(add, "plan-link-add-label")[0];
    expect(label).toContain('name="label"');
    expect(label).toMatch(/maxLength="120"/i);
    expect(label).not.toContain("required");
    expect(add).toContain(ro.Admin.volunteers.plan.link.url);
    expect(add).toContain(ro.Admin.volunteers.plan.link.label);
    expect(add).toContain("De exemplu harta ta din Google My Maps: „Distribuie”, accesul „Oricine are linkul”, apoi copiază linkul aici.");
    expect(add).toContain(ro.Admin.volunteers.plan.link.add);
  });

  it("is in English for an English reader", async () => {
    await addLink(staff.ADMIN!, MY_MAP, "The volunteers' map");
    state.locale = "en";
    const page = await planPage({ view: "points" });
    expect(page).toContain('data-testid="plan-maps-state">no picture · 1 link<');
    expect(page).toContain(en.Admin.volunteers.plan.link.add);
    expect(page).toContain("Address (https://…)");
    expect(page).toContain("What it is (optional)");
  });

  it("gives a thumb 44 pixels on each link and on «Adaugă linkul»; on paper the label and the whole address, no control", async () => {
    await addLink(staff.ADMIN!, MY_MAP, "Harta voluntarilor");
    const page = await planPage({}, true);
    expect(rulesOf(page, "plan-link-open").screen).toMatch(/min-height:44px/);
    expect(rulesOf(page, "plan-link-open").screen).toMatch(/font-weight:700/);
    expect(rulesOf(page, "plan-link-add").screen).toMatch(/min-height:44px/);
    // On paper: the label as text and the whole address beside it; the host, the remove and the add form off the sheet.
    expect(rulesOf(page, "plan-link-open").print).toMatch(/min-height:0/);
    expect(rulesOf(page, "plan-link-address").screen).toMatch(/display:none/);
    expect(rulesOf(page, "plan-link-address").print).toMatch(/display:inline/);
    expect([...page.matchAll(/data-testid="plan-link-address"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual([MY_MAP.replace(/&/g, "&amp;")]);
    for (const testid of ["plan-link-host", "plan-link-remove-form", "plan-link-controls"]) expect(rulesOf(page, testid).print, testid).toMatch(/display:none/);
  });

  it(`offers no add form once the plan holds ${PLAN_LINKS_MAX} links`, async () => {
    for (let n = 0; n < PLAN_LINKS_MAX; n += 1) await addLink(staff.ADMIN!, `https://maps.example.test/${n}`);
    const page = await planPage();
    expect(tagsOf(page, "plan-link")).toHaveLength(PLAN_LINKS_MAX);
    expect(page).not.toContain('data-testid="plan-link-add-form"');
  });
});
