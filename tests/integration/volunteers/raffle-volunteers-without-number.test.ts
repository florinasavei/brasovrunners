import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02 — why the volunteers are out of the raffle, said where it is seen (the owner, 2026-11-20: «vreau să le dau
 * automat numere și voluntarilor, pentru că văd că deși voluntarii sunt bifați aici… cumva sunt excluși de pe lista de la tombolă»),
 * and the editor's «Tombolă» fold opening after its save, read from a real database:
 *
 * - «Ziua cursei» → «Tombolă»: under «Voluntari: N», how many confirmed volunteers wear no number and the way to the volunteers'
 *   series (`/admin/events/<id>#box-volunteer-numbers`) — only while «Voluntarii» is ticked and some are out; a registered (not yet confirmed) or cancelled
 *   volunteer is not counted; in both languages; gone once «Salvează numerele» numbered them, who then take part;
 * - «Schimbă în editor» opens the «Tombolă» fold itself (`#box-raffle`);
 * - the editor page counts the same people from the «Voluntari» card's own read and hands the count to the registration card, and
 *   opens «Tombolă» only when back from the save that moved the raffle's settings (`?saved=event&raffle=1`), which the save says.
 *
 * The events start in 2099, so the pages' own clock keeps them ahead; the made-up people are nobody.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RafflePage } = await import("@/app/[locale]/admin/checkin/tombola/page");
const { default: EditEventPage } = await import("@/app/[locale]/admin/events/[id]/page");
const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");
const { setVolunteerNumbersStartAction } = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");
const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, the props that carry elements included (the editor's `main` and `below`). */
function everything(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) everything(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const [key, value] of Object.entries(node.props)) {
    if (key === "children" || isValidElement(value) || Array.isArray(value)) everything(value as ReactNode, acc);
  }
  return acc;
}

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");
const HINT = "raffle-volunteers-without-number";

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
let admin: StaffUser;
let organizer: StaffUser;
let eventId: string;
let roleId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Coleg ADMIN", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "moderator@example.test", displayName: "Coleg MODERATOR", role: "MODERATOR" }).returning();
  state.actor = organizer;
  ({ eventId, roleId } = await race());
});

/** A race in 2099 holding a raffle «Din oficiu», every group ticked, with no volunteers' series yet. */
async function race(over: Partial<typeof events.$inferInsert> = {}) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", capacity: 50, editorialStatus: "PUBLISHED", publishedAt: EFFECTIVE, locationName: "Parcul Noua", hasRaffle: true, ...over })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}`, excerpt: "O cursă." },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}`, excerpt: "A race." },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

async function runner(name: string, bibNumber: number | null): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: EFFECTIVE,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: EFFECTIVE,
      bibNumber,
      checkinCode: newCheckinCode(),
    })
    .returning({ id: registrations.id });
  return row.id;
}

async function volunteer(name: string, bibNumber: number | null, more: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "CONFIRMED", source: "STAFF", roleId, bibNumber, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}

/** The owner's Saturday: two runners with numbers, two confirmed volunteers without one, one registered but not confirmed, one cancelled. */
async function saturday() {
  await runner("Ana Popescu", 7);
  await runner("Bogdan Ionescu", 12);
  await volunteer("Ion Voluntar", null);
  await volunteer("Maria Voluntar", null);
  await volunteer("Petru În Așteptare", null, { state: "REGISTERED" });
  await volunteer("Radu Anulat", null, { state: "CANCELLED" });
}

const tab = async (query: Record<string, string> = {}) => html(await RafflePage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) }));
/** The line's markup, from its own tag to the end of its link, or null when it is not drawn. */
const hintOf = (page: string) => {
  const at = page.indexOf(`data-testid="${HINT}"`);
  return at === -1 ? null : page.slice(page.lastIndexOf("<", at), page.indexOf("</a>", page.indexOf(`data-testid="${HINT}-link"`, at)) + 4);
};
const countsOf = (page: string) => words(/data-testid="raffle-counts"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "");

describe("§NNN «Ziua cursei» → «Tombolă» says why the volunteers are out", () => {
  it("says beside «Voluntari: N» how many confirmed volunteers wear no number, and the way to the volunteers' series", async () => {
    await saturday();
    const page = await tab();
    // The one not confirmed yet and the cancelled one are not counted: only the two confirmed without a number.
    expect(countsOf(page)).toBe("Participă: 2 · Alergători: 2 · Elite: 0 · Voluntari: 0 · Prezenți dintre ei: 0");
    const hint = hintOf(page);
    expect(hint, "the line is drawn").not.toBeNull();
    expect(words(hint ?? "")).toContain("2 voluntari confirmați nu au număr, deci nu intră la tombolă. Setează „Numerele voluntarilor încep de la” în cardul «Voluntari»: fiecare confirmat primește pe loc un număr.");
    // Right under the counts, before the filters.
    expect(page.indexOf('data-testid="raffle-counts"')).toBeLessThan(page.indexOf(`data-testid="${HINT}"`));
    expect(page.indexOf(`data-testid="${HINT}"`)).toBeLessThan(page.indexOf('data-testid="raffle-filters"'));
    // Its link: the event's editor, at the «Voluntari» card's numbers form.
    expect(hint).toMatch(new RegExp(`href="/ro/admin/events/${eventId}#box-volunteer-numbers"`));
    expect(words(hint ?? "")).toContain(ro.Admin.raffle.volunteersWithoutNumberLink);
    // The two say «Nu · fără număr» on their rows, as before: the line says why, the rows say who.
    expect(words(page)).toContain("Ion Voluntar Voluntar Nu · fără număr");
  });

  it("says it in the one form for one person, and in English on the English page", async () => {
    await volunteer("Ion Voluntar", null);
    expect(words(hintOf(await tab()) ?? "")).toContain("1 voluntar confirmat nu are număr, deci nu intră la tombolă.");
    state.locale = "en";
    const page = await tab();
    expect(words(hintOf(page) ?? "")).toContain("1 confirmed volunteer has no number, so is not in the raffle. Set “Volunteers' numbers start at” in the “Volunteers” card: each one confirmed gets a number at once.");
    expect(hintOf(page)).toMatch(new RegExp(`href="/en/admin/events/${eventId}#box-volunteer-numbers"`));
  });

  it("is gone while every confirmed volunteer has a number, or while «Voluntarii» is unticked", async () => {
    await volunteer("Ion Voluntar", 500);
    await volunteer("Petru În Așteptare", null, { state: "REGISTERED" });
    expect(hintOf(await tab())).toBeNull();
    await volunteer("Maria Voluntar", null);
    expect(hintOf(await tab())).not.toBeNull();
    await db.update(events).set({ raffleVolunteers: false }).where(eq(events.id, eventId));
    const unticked = await tab();
    expect(hintOf(unticked)).toBeNull();
    expect(words(unticked)).toContain("Maria Voluntar Voluntar Nu · grupa nu e bifată");
  });

  it("is gone once «Salvează numerele» numbered them — the series' start the club chose — and they take part", async () => {
    await saturday();
    expect(hintOf(await tab())).not.toBeNull();
    // The «Voluntari» card's own form, its own action: the Organizer works the volunteers.
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("eventId", eventId);
    form.set("start", "500");
    await expect(setVolunteerNumbersStartAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected[0]).toBe(`/ro/admin/events/${eventId}#box-volunteers`);
    const numbered = await db.select({ name: eventVolunteers.name, number: eventVolunteers.bibNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(Object.fromEntries(numbered.map((row) => [row.name, row.number]))).toEqual({ "Ion Voluntar": 500, "Maria Voluntar": 501, "Petru În Așteptare": null, "Radu Anulat": null });
    const page = await tab();
    expect(hintOf(page)).toBeNull();
    expect(countsOf(page)).toBe("Participă: 4 · Alergători: 2 · Elite: 0 · Voluntari: 2 · Prezenți dintre ei: 0");
  });

  it("chooses no number by itself: reading the tab, or the editor, gives nobody a number", async () => {
    await saturday();
    await tab();
    state.actor = admin;
    await EditEventPage({ params: Promise.resolve({ locale: "ro", id: eventId }), searchParams: Promise.resolve({}) } as never);
    const rows = await db.select({ number: eventVolunteers.bibNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(rows.every((row) => row.number === null)).toBe(true);
    expect((await db.select({ start: events.volunteerBibStart }).from(events).where(eq(events.id, eventId)))[0].start).toBeNull();
  });

  it("sends «Schimbă în editor» to the «Tombolă» fold itself", async () => {
    state.actor = admin;
    const page = await tab();
    expect(page).toMatch(new RegExp(`href="/ro/admin/events/${eventId}#box-raffle"[^>]*data-testid="raffle-settings-edit"|data-testid="raffle-settings-edit"[^>]*href="/ro/admin/events/${eventId}#box-raffle"`));
    // The tab's sentence for an event without one names the fold too.
    expect(ro.Admin.raffle.noRaffle).toContain("„Numere de concurs” → „Tombolă”");
    expect(en.Admin.raffle.noRaffle).toContain("“Race numbers” → “Raffle”");
  });
});

describe("§NNN the editor page: the count, and «Tombolă» open after its save", () => {
  const registrationBox = async (searchParams: Record<string, string> = {}) => {
    const tree = await EditEventPage({ params: Promise.resolve({ locale: "ro", id: eventId }), searchParams: Promise.resolve(searchParams) } as never);
    const box = everything(tree).find((element) => element.type === RegistrationBox);
    expect(box, "the registration card is drawn").toBeDefined();
    return box!.props as { volunteersWithoutNumber?: number; raffleSaved?: boolean };
  };

  it("hands the registration card the confirmed volunteers without a number, from the «Voluntari» card's own read", async () => {
    await saturday();
    state.actor = admin;
    expect((await registrationBox()).volunteersWithoutNumber).toBe(2);
    await db.update(eventVolunteers).set({ bibNumber: 600 }).where(eq(eventVolunteers.name, "Ion Voluntar"));
    expect((await registrationBox()).volunteersWithoutNumber).toBe(1);
  });

  it("opens «Tombolă» only when back from the save that moved the raffle's settings", async () => {
    state.actor = admin;
    expect((await registrationBox()).raffleSaved).toBe(false);
    expect((await registrationBox({ saved: "event", raffle: "1" })).raffleSaved).toBe(true);
    expect((await registrationBox({ saved: "eventSeries", applied: "2", raffle: "1" })).raffleSaved).toBe(true);
    // Another save's banner, or the flag alone in a typed address: closed.
    expect((await registrationBox({ saved: "event" })).raffleSaved).toBe(false);
    expect((await registrationBox({ raffle: "1" })).raffleSaved).toBe(false);
    expect((await registrationBox({ saved: "eliteAdded", raffle: "1" })).raffleSaved).toBe(false);
  });
});

describe("§NNN the save says when it moved the raffle's settings", () => {
  /** The editor's settings as they post for this race, the raffle's boxes drawn as the fold draws them. */
  async function settingsForm(raffle: { volunteers: boolean; how: "true" | "false" }): Promise<FormData> {
    const [row] = await db.select({ version: events.version }).from(events).where(eq(events.id, eventId));
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("eventId", eventId);
    form.set("event.expectedVersion", String(row.version));
    for (const [name, value] of Object.entries({
      type: "RACE",
      eventStatus: "SCHEDULED",
      timezone: "Europe/Bucharest",
      startsAtWallTime: "2099-11-21T09:00",
      locationName: "Parcul Noua",
      locationNameEn: "Parcul Noua",
      surface: "ASPHALT",
      difficulty: "MEDIUM",
      costType: "FREE",
      registrationMode: "EXTERNAL",
      externalProvider: "Alt club",
      externalRegistrationUrl: "https://alt-club.example.test/inscriere",
      participantListVisibility: "HIDDEN",
    })) {
      form.set(`event.${name}`, value);
    }
    form.set("event.hasRaffle.present", "1");
    form.set("event.hasRaffle", "on");
    for (const [name, on] of [["raffleRunners", true], ["raffleElites", true], ["raffleVolunteers", raffle.volunteers], ["raffleSignUpOpen", false]] as const) {
      form.set(`event.${name}.present`, "1");
      if (on) form.set(`event.${name}`, "on");
    }
    form.set("event.raffleSignUp", raffle.how);
    return form;
  }

  async function save(form: FormData): Promise<string> {
    state.redirected.length = 0;
    const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
      if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
      throw error;
    });
    expect(outcome, JSON.stringify(outcome)).toBe("redirected");
    return state.redirected[0] ?? "";
  }

  it("answers `raffle=1` when a raffle box moved, and nothing when the boxes post what was saved", async () => {
    state.actor = admin;
    // «Voluntarii» unticked: a raffle setting moved.
    const moved = await save(await settingsForm({ volunteers: false, how: "false" }));
    expect(moved).toMatch(/[?&]saved=event(&|#)/);
    expect(moved).toMatch(/[?&]raffle=1(&|#)/);
    expect((await db.select({ on: events.raffleVolunteers }).from(events).where(eq(events.id, eventId)))[0].on).toBe(false);
    // The same boxes again: saved, nothing of the raffle moved, the fold stays as the page draws it.
    const same = await save(await settingsForm({ volunteers: false, how: "false" }));
    expect(same).toMatch(/[?&]saved=event(&|#)/);
    expect(same).not.toContain("raffle=");
    // «Cum participă» moved alone: the flag again.
    expect(await save(await settingsForm({ volunteers: false, how: "true" }))).toMatch(/[?&]raffle=1(&|#)/);
  });
});
