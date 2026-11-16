import { randomUUID } from "node:crypto";
import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { setVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { type ConfirmSpec, decodeFlash, withOption } from "@/shared/feedback/notice";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { type PlanRace, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Trimite fiecăruia punctul lui» on the page of «Planul voluntarilor», and its Server
 * Action, from a real database:
 *
 * - the page states the four numbers the service counted — who is written to, who already knows their point, who stands at a
 *   point with no address, who stands at none — beside the button and again in the question the button asks, with the email
 *   that leaves and to how many, in both languages;
 * - «Trimite din nou tuturor» is a box in that question while somebody already knows their point, and the button itself once
 *   everybody does; with nobody to write to there is no button, and the sentence that says why;
 * - the action asks the capability at its own door, hands the box to the service, comes back to the plan at its section with a
 *   toast that states how many messages were queued (and how many people have no address), or with the refusal's code, which
 *   the page says in words; every row it queues carries the press's cause and who pressed.
 *
 * Who is written to, the message and the state at the send are `plan-mail.test.ts`.
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
  /** How many times the press's service was reached, and with which «din nou tuturor». */
  pressed: [] as boolean[],
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
// The house's typed routing, reduced to what the screens ask of it (`plan.test.ts`'s stand-in).
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
// The press's service itself, counted: a press refused at the action's door never reaches it.
vi.mock("@/modules/volunteers/point-mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/point-mail")>();
  return {
    ...real,
    sendVolunteerPoints: (...args: Parameters<typeof real.sendVolunteerPoints>) => {
      state.pressed.push(args[2].again === true);
      return real.sendVolunteerPoints(...args);
    },
  };
});

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { sendVolunteerPointsAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
const { sendVolunteerPoints } = await import("@/modules/volunteers/point-mail");

const NOW = new Date("2026-11-16T10:00:00.000Z");

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
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  race = await seedPlanRace(db, NOW);
  state.pressed.length = 0;
});

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
const byTestId = (tree: unknown, id: string) => elements(tree).find((element) => element.props["data-testid"] === id);

const pageTree = (query: Record<string, string> = {}, id = race.raceId) => VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) });
/** The question «Trimite fiecăruia punctul lui» asks, as the page hands it to its form — or none when there is no form. */
const questionOf = async (query: Record<string, string> = {}): Promise<ConfirmSpec | null> => ((byTestId(await pageTree(query), "plan-mail-form") as Element | undefined)?.props.confirm as ConfirmSpec | undefined) ?? null;

/** A page as the server streams it, Suspense settled; React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, keepStyles = false) => html(await pageTree(query), keepStyles);
/** The section «Trimite fiecăruia punctul lui» of a rendered page, up to the plan's own summary. */
const sectionOf = (page: string) => page.slice(page.indexOf('data-testid="plan-mail-section"'), page.indexOf('data-testid="plan-summary"'));
const textOf = (page: string, testid: string) => page.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`))?.[1] ?? null;
/** As the markup carries an apostrophe and a quotation mark. */
const escaped = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

const place = (id: string, checkpointId: string) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, NOW);
/** A press of the service itself, outside the action: the state the page then reads. */
const pressService = (again = false) => sendVolunteerPoints(db, staff.ADMIN!, { eventId: race.raceId, again }, NOW);
const pointMails = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_POINT"));
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "event.volunteer_points_sent");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: race.raceId, again: "", ...fields })) data.set(key, value);
  return data;
}
/** The action pressed with the page's form; answers the address it sends the browser to. */
async function press(fields: Record<string, string> = {}): Promise<string> {
  state.redirected.length = 0;
  state.flashed.length = 0;
  const outcome: Promise<FormOutcome | null> = sendVolunteerPointsAction(null, form(fields));
  await expect(outcome).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}
const toasted = () => state.flashed.map((value) => decodeFlash(value));
const back = () => `/ro/admin/events/${race.raceId}/plan-voluntari#plan-mail`;

describe("§NNN the plan's page: «Trimite fiecăruia punctul lui» and its four numbers", () => {
  it("states the numbers beside the button and in the question, with the email that leaves and to how many", async () => {
    const page = await planPage();
    const section = sectionOf(page);
    const words = ro.Admin.volunteers.plan.mail;
    expect(section).toContain(words.title);
    expect(section).toContain(words.help);
    // Ana, Dan and Ion are written to; nobody was told yet; Zoe has no address; Radu stands at no point.
    expect(textOf(page, "plan-mail-counts")).toBe("Scriem la: 3 · Își știu deja punctul: 0 · La un punct, dar fără adresă de email: 1 · Încă fără punct: 1");

    // The form: the event, the page's language, and «din nou tuturor» posted empty as drawn.
    const formAt = section.slice(section.indexOf('data-testid="plan-mail-form"'));
    expect(formAt).toContain(`name="eventId" value="${race.raceId}"`);
    expect(formAt).toContain('name="uiLocale" value="ro"');
    expect(formAt).toMatch(/<input type="hidden" name="again" value=""\/>/);
    expect(formAt).toMatch(/<button[^>]*type="submit"[^>]*data-testid="plan-mail-send"[^>]*>/);
    expect(formAt).toContain(words.send);
    expect(section).not.toContain('data-testid="plan-mail-nobody"');
    expect(section).not.toContain('data-testid="plan-mail-all-told"');

    // The question: the four numbers one a line, and — worded by the one builder — the email and whom it reaches.
    const question = (await questionOf())!;
    expect(question).toMatchObject({ title: words.confirmTitle, body: words.confirmBody, confirmLabel: words.confirm, cancelLabel: ro.Admin.confirm.cancel });
    expect(question.lines).toEqual(["Scriem la: 3", "Își știu deja punctul: 0", "La un punct, dar fără adresă de email: 1", "Încă fără punct: 1"]);
    expect(question.email).toBe("Pleacă 3 emailuri „Punctul tău de voluntar”, câte unul către fiecare voluntar care nu-și știe încă punctul.");
    // The road the email takes is the builder's too, derived from the email it names: the confirmations', as the role's message.
    expect(question.road).toMatchObject({ group: "confirmations" });
    // Nobody knows their point yet: «everybody» is who the press writes to anyway — no box to tick.
    expect(question.option).toBeUndefined();
    // A press that writes to people is not a deletion.
    expect(question.destructive).toBeUndefined();
  });

  it("says the picture goes with it when the plan has one", async () => {
    expect((await questionOf())!.body).toBe(ro.Admin.volunteers.plan.mail.confirmBody);
    const [stored] = await db
      .insert(mediaAssets)
      .values({ keyPrefix: ladderKeyPrefixOf(randomUUID()), originalFilename: "harta.png", width: 2400, height: 1600, byteSize: 1000, createdAt: NOW, lastReferencedAt: NOW })
      .returning();
    await setVolunteerPlanPicture(db, staff.ADMIN!, { eventId: race.raceId, assetId: stored.id }, NOW);
    expect((await questionOf())!.body).toBe(ro.Admin.volunteers.plan.mail.confirmBodyPicture);
  });

  it("offers «Trimite din nou tuturor» as a box in the question while somebody already knows their point", async () => {
    await pressService();
    // Radu placed since: one person still to tell, three who know.
    await place(race.people.radu, race.points.bridge);
    const page = await planPage();
    expect(textOf(page, "plan-mail-counts")).toBe("Scriem la: 1 · Își știu deja punctul: 3 · La un punct, dar fără adresă de email: 1 · Încă fără punct: 0");
    expect(sectionOf(page)).toMatch(/<input type="hidden" name="again" value=""\/>/);
    expect(sectionOf(page)).toContain(ro.Admin.volunteers.plan.mail.send);

    const question = (await questionOf())!;
    expect(question.title).toBe(ro.Admin.volunteers.plan.mail.confirmTitle);
    expect(question.lines).toEqual(["Scriem la: 1", "Își știu deja punctul: 3", "La un punct, dar fără adresă de email: 1", "Încă fără punct: 0"]);
    expect(question.email).toBe("Pleacă 1 email „Punctul tău de voluntar”, câte unul către fiecare voluntar care nu-și știe încă punctul.");
    expect(question.option).toMatchObject({ field: "again", label: ro.Admin.volunteers.plan.mail.againTick });

    // Ticked, the question reads as the wider press: everybody at a point with an address, those who know among them.
    const wider = withOption(question, true);
    expect(wider.lines).toEqual(["Scriem la: 4", "Dintre ei, își știu deja punctul: 3", "La un punct, dar fără adresă de email: 1", "Încă fără punct: 0"]);
    expect(wider.email).toBe("Pleacă 4 emailuri „Punctul tău de voluntar”, câte unul către fiecare voluntar pus la un punct.");
    // The same title, body and buttons: one question, widened.
    expect(wider).toMatchObject({ title: question.title, body: question.body, confirmLabel: question.confirmLabel });
  });

  it("turns the button itself into «Trimite din nou tuturor» once everybody at a point knows theirs", async () => {
    await pressService();
    const page = await planPage();
    const section = sectionOf(page);
    const words = ro.Admin.volunteers.plan.mail;
    expect(textOf(page, "plan-mail-counts")).toBe("Scriem la: 0 · Își știu deja punctul: 3 · La un punct, dar fără adresă de email: 1 · Încă fără punct: 1");
    // The form itself asks for everybody again: the box drawn `on`, nothing to tick.
    expect(section).toMatch(/<input type="hidden" name="again" value="on"\/>/);
    expect(section).toMatch(new RegExp(`data-testid="plan-mail-send"[^>]*>[\\s\\S]*?${words.again}</button>`));
    expect(section).not.toContain(`${words.send}</button>`);
    expect(textOf(page, "plan-mail-all-told")).toBe(words.allTold);

    const question = (await questionOf())!;
    expect(question).toMatchObject({ title: words.againTitle, confirmLabel: words.again, body: words.confirmBody });
    expect(question.lines).toEqual(["Scriem la: 3", "Dintre ei, își știu deja punctul: 3", "La un punct, dar fără adresă de email: 1", "Încă fără punct: 1"]);
    expect(question.email).toBe("Pleacă 3 emailuri „Punctul tău de voluntar”, câte unul către fiecare voluntar pus la un punct.");
    expect(question.option).toBeUndefined();
  });

  it("offers no press at all when nobody with an address stands at a point, and says why", async () => {
    for (const id of [race.people.ana, race.people.dan, race.people.ion]) await place(id, "");
    const page = await planPage();
    const section = sectionOf(page);
    expect(textOf(page, "plan-mail-counts")).toBe("Scriem la: 0 · Își știu deja punctul: 0 · La un punct, dar fără adresă de email: 1 · Încă fără punct: 4");
    expect(textOf(page, "plan-mail-nobody")).toBe(ro.Admin.volunteers.plan.mail.nobody);
    expect(section).not.toContain('data-testid="plan-mail-form"');
    expect(section).not.toContain('data-testid="plan-mail-send"');
    expect(await questionOf()).toBeNull();
  });

  it("is in English for an English reader: the numbers, the button and the question", async () => {
    state.locale = "en";
    const words = en.Admin.volunteers.plan.mail;
    const page = await planPage();
    const section = sectionOf(page);
    expect(section).toContain(words.title);
    expect(section).toContain(escaped(words.help));
    expect(textOf(page, "plan-mail-counts")).toBe("Written to: 3 · Already know their point: 0 · At a point, but with no email address: 1 · At no point yet: 1");
    expect(section).toContain('name="uiLocale" value="en"');
    expect(section).toContain(`${words.send}</button>`);

    const question = (await questionOf())!;
    expect(question).toMatchObject({ title: words.confirmTitle, body: words.confirmBody, confirmLabel: words.confirm, cancelLabel: en.Admin.confirm.cancel });
    expect(question.lines).toEqual(["Written to: 3", "Already know their point: 0", "At a point, but with no email address: 1", "At no point yet: 1"]);
    expect(question.email).toBe("3 emails “Your volunteer point” go out, one to each volunteer who has not been told their point yet.");

    // Everybody told, and one placed since: the box, then the button itself, in English.
    await pressService();
    const told = await planPage();
    expect(textOf(told, "plan-mail-counts")).toBe("Written to: 0 · Already know their point: 3 · At a point, but with no email address: 1 · At no point yet: 1");
    expect(sectionOf(told)).toContain(`${words.again}</button>`);
    expect(textOf(told, "plan-mail-all-told")).toBe(escaped(words.allTold));
    expect((await questionOf())!).toMatchObject({ title: words.againTitle, confirmLabel: words.again });
    await place(race.people.radu, race.points.bridge);
    const mixed = (await questionOf())!;
    expect(mixed.option).toMatchObject({ field: "again", label: words.againTick });
    expect(withOption(mixed, true).lines).toEqual(["Written to: 4", "Of them, already know their point: 3", "At a point, but with no email address: 1", "At no point yet: 0"]);

    // …and the sentence for nobody.
    for (const id of [race.people.ana, race.people.dan, race.people.ion, race.people.radu]) await place(id, "");
    expect(textOf(await planPage(), "plan-mail-nobody")).toBe(words.nobody);
  });

  it("keeps the press off the paper — the printed plan is the points and the people — and gives the button a 44-pixel target", async () => {
    const page = await planPage({}, true);
    const css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
    const tagOf = (testid: string) => page.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`))![0];
    /** The generated classes of one element, and what their rules say on screen and inside `@media print`. */
    const rulesOf = (testid: string) => {
      const classes = (tagOf(testid).match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter((name) => name.startsWith("css-"));
      expect(classes.length, `${testid} carries a generated class`).toBeGreaterThan(0);
      const all = (pattern: (name: string) => RegExp) => classes.flatMap((name) => [...css.matchAll(pattern(name))].map((match) => match[1])).join(";");
      return {
        screen: all((name) => new RegExp(`(?:^|\\}|\\s)\\.${name}\\{([^}]*)\\}`, "g")),
        print: all((name) => new RegExp(`@media print\\{\\.${name}\\{([^}]*)\\}`, "g")),
      };
    };
    expect(rulesOf("plan-mail-section").print).toMatch(/display:none/);
    // The section has its own place to come back to.
    expect(tagOf("plan-mail-section")).toContain('id="plan-mail"');
    // The press is for a thumb: 44 pixels at least (AGENTS.md §18.5).
    expect(rulesOf("plan-mail-send").screen).toMatch(/min-height:44px/);
  });

  it("is a 404 for a role that may not work the volunteers: the numbers are never read for it", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(pageTree(), role).rejects.toThrow("NOT_FOUND");
    }
  });
});

describe("§NNN the press: `sendVolunteerPointsAction`", () => {
  it("queues the messages, comes back to the plan at its section, and says how many were queued and how many people have no address", async () => {
    expect(await press()).toBe(back());
    // Asked at the action's own door, by name; the service reached once, with the box as posted.
    expect(state.asked).toEqual(["canManageVolunteers"]);
    expect(state.pressed).toEqual([false]);

    const rows = await pointMails();
    expect(rows).toHaveLength(3);
    // Every row carries the press: its cause, one id for the three, and who pressed.
    expect(new Set(rows.map((row) => row.cause))).toEqual(new Set(["volunteers.sendPoints"]));
    expect(new Set(rows.map((row) => row.pressId)).size).toBe(1);
    expect(rows[0].pressId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(rows.map((row) => row.requestedByStaffUserId))).toEqual(new Set([staff.MODERATOR!.id]));

    // One toast: the sentence with the people who have no address, since Zoe has none.
    const [toast] = toasted();
    expect(toasted()).toHaveLength(1);
    expect(toast).toMatchObject({ kind: "success", key: "planPointsSentSomeWithout", values: { count: "3", noAddress: "1" } });
    // …and what the press emailed, read back from its own rows: the type, to how many — never a name or an address.
    expect(toast!.values).toMatchObject({ mailType: "VOLUNTEER_POINT", mailTo: "people", mailPeople: "3" });
    expect(JSON.stringify(toast)).not.toMatch(/example\.test|Ana|Dan|Ion/);

    // One row of the trail, the counts only.
    const written = await trail();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(written[0].metadataJson).toEqual({ queued: 3, told: 0, noAddress: 1, unplaced: 1, again: false });
  });

  it("says the plain sentence when everybody at a point has an address", async () => {
    await db.delete(eventVolunteers).where(eq(eventVolunteers.id, race.people.zoe));
    expect(await press()).toBe(back());
    expect(toasted()[0]).toMatchObject({ kind: "success", key: "planPointsSent", values: { count: "3" } });
    expect(toasted()[0]!.values).not.toHaveProperty("noAddress");
  });

  it("comes back with the refusal's code when everybody was already told, and writes to everybody with the box ticked", async () => {
    await press();
    // The same press again, the box empty: nothing queued, the code in the address, no toast.
    expect(await press()).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?planError=VOLUNTEER_POINTS_ALL_TOLD#plan-mail`);
    expect(toasted()).toEqual([]);
    expect(await pointMails()).toHaveLength(3);
    // The page says the refusal in words, in both languages.
    expect(await planPage({ planError: "VOLUNTEER_POINTS_ALL_TOLD" })).toContain(ro.Admin.errors.VOLUNTEER_POINTS_ALL_TOLD);
    state.locale = "en";
    expect(await planPage({ planError: "VOLUNTEER_POINTS_ALL_TOLD" })).toContain(escaped(en.Admin.errors.VOLUNTEER_POINTS_ALL_TOLD));
    state.locale = "ro";

    // «Trimite din nou tuturor», ticked in the question: `on` in the form.
    expect(await press({ again: "on" })).toBe(back());
    expect(state.pressed).toEqual([false, false, true]);
    expect(await pointMails()).toHaveLength(6);
    expect(toasted()[0]).toMatchObject({ key: "planPointsSentSomeWithout", values: { count: "3", noAddress: "1" } });
    expect((await trail()).map((row) => (row.metadataJson as { again: boolean }).again)).toEqual([false, true]);
    // Anything but the box's own value is the narrower press.
    for (const value of ["true", "1", "ON", " on"]) {
      expect(await press({ again: value }), value).toContain("planError=VOLUNTEER_POINTS_ALL_TOLD");
    }
    expect(await pointMails()).toHaveLength(6);
  });

  it("comes back with the reason when nobody with an address stands at a point, and the page says it", async () => {
    for (const id of [race.people.ana, race.people.dan, race.people.ion]) await place(id, "");
    expect(await press()).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?planError=VOLUNTEER_POINTS_NOBODY#plan-mail`);
    expect(await press({ again: "on" })).toContain("planError=VOLUNTEER_POINTS_NOBODY#plan-mail");
    expect(await pointMails()).toEqual([]);
    expect(toasted()).toEqual([]);
    expect(await trail()).toEqual([]);
    expect(await planPage({ planError: "VOLUNTEER_POINTS_NOBODY" })).toContain(ro.Admin.errors.VOLUNTEER_POINTS_NOBODY);
    state.locale = "en";
    expect(await planPage({ planError: "VOLUNTEER_POINTS_NOBODY" })).toContain(escaped(en.Admin.errors.VOLUNTEER_POINTS_NOBODY));
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member at its own door: the service is never reached", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await press(), role).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?planError=FORBIDDEN#plan-mail`);
      expect(await press({ again: "on" }), role).toBe(`/ro/admin/events/${race.raceId}/plan-voluntari?planError=FORBIDDEN#plan-mail`);
    }
    expect(state.asked).toEqual(Array.from({ length: 8 }, () => "canManageVolunteers"));
    expect(state.pressed).toEqual([]);
    expect(await pointMails()).toEqual([]);
    expect(await trail()).toEqual([]);
    expect(toasted()).toEqual([]);
  });

  it("goes to the volunteers' screen for a form with no event, and answers NOT_FOUND for an event that is not there", async () => {
    expect(await press({ eventId: "" })).toBe("/ro/admin/volunteers");
    expect(await press({ eventId: "not-an-id" })).toBe("/ro/admin/volunteers");
    const missing = "11111111-1111-4111-8111-111111111111";
    expect(await press({ eventId: missing })).toBe(`/ro/admin/events/${missing}/plan-voluntari?planError=NOT_FOUND#plan-mail`);
    expect(await pointMails()).toEqual([]);
  });

  it("has every sentence it can say in both languages, each stating its count", () => {
    for (const catalogue of [ro, en]) {
      for (const key of ["planPointsSent", "planPointsSentSomeWithout"] as const) {
        const forms = catalogue.Feedback.toast[key];
        for (const form of ["one", "few", "other"] as const) expect(forms[form], `${key}.${form}`).toContain("{count}");
      }
      for (const form of ["one", "few", "other"] as const) expect(catalogue.Feedback.toast.planPointsSentSomeWithout[form]).toContain("{noAddress}");
      for (const code of ["VOLUNTEER_POINTS_NOBODY", "VOLUNTEER_POINTS_ALL_TOLD", "FORBIDDEN", "NOT_FOUND"] as const) expect(catalogue.Admin.errors[code], code).toEqual(expect.any(String));
    }
    // The refusal that says how to write again names the box by the words the question shows.
    expect(ro.Admin.errors.VOLUNTEER_POINTS_ALL_TOLD).toContain(ro.Admin.volunteers.plan.mail.again);
    expect(en.Admin.errors.VOLUNTEER_POINTS_ALL_TOLD).toContain(en.Admin.volunteers.plan.mail.again);
  });
});
