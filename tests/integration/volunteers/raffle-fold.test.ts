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
 * §NNN, BR-REQ-050-02 — the editor's «Tombolă» fold (the owner, 2026-11-20: «plus că aici ar trebui să fie o secțiune colapsată cu
 * „Tombola”»), and the volunteers in the raffle with the V numbers they draw at «Confirmă» (his other half: «vreau să le dau automat
 * numere și voluntarilor… cumva sunt excluși de pe lista de la tombolă»), read from a real database:
 *
 * - «Ziua cursei» → «Tombolă»: the confirmed volunteers counted with their V numbers, after the race numbers, and nothing on the page
 *   about setting numbers — no line, no way to a numbers form; a confirmed volunteer the deployment left without a V number for a few
 *   minutes reads «Nu · fără număr» on its own row, nothing more; reading the tab or the editor gives nobody a number;
 * - «Schimbă în editor» opens the «Tombolă» fold itself (`#box-raffle`);
 * - the editor page opens «Tombolă» only when back from the save that moved the raffle's settings (`?saved=event&raffle=1`), which the
 *   save says.
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

/** A race in 2099 holding a raffle «Din oficiu», every group ticked. */
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

/** A volunteer, confirmed unless told otherwise, holding the V number given (§NNN: «V001» is 1) — or none yet. */
async function volunteer(name: string, volunteerNumber: number | null, more: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "CONFIRMED", source: "STAFF", roleId, volunteerNumber, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}

/**
 * The owner's Saturday: two runners with numbers; two volunteers confirmed — V001 and V002, as «Confirmă» numbered them —, one
 * registered and not confirmed yet, and one cancelled, who keeps the V003 they drew, retired.
 */
async function saturday() {
  await runner("Ana Popescu", 7);
  await runner("Bogdan Ionescu", 12);
  await volunteer("Ion Voluntar", 1);
  await volunteer("Maria Voluntar", 2);
  await volunteer("Petru În Așteptare", null, { state: "REGISTERED" });
  await volunteer("Radu Anulat", 3, { state: "CANCELLED" });
}

const tab = async (query: Record<string, string> = {}) => html(await RafflePage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) }));
const countsOf = (page: string) => words(/data-testid="raffle-counts"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "");
/** The table's rows, once each — the table's own `<tr>`s, not the phone cards. */
const rowsOf = (page: string) => [...page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1])).filter((row) => row !== "" && !row.startsWith(ro.Admin.raffle.columns.number) && !row.startsWith(en.Admin.raffle.columns.number));
/** What the fold's first round drew to send the reader to a numbers form: gone, the volunteers being numbered by themselves. */
const NUMBERS_LINE = /raffle-volunteers-without-number|box-volunteer-numbers|Numerele voluntarilor încep de la|Volunteers' numbers start at|nu au număr|have no number/;
/** The page's markup and its words, so an id, a link or a sentence of that line would all be found. */
const markupAndWords = (page: string) => `${page}\n${words(page)}`;

describe("§NNN «Ziua cursei» → «Tombolă» with the volunteers numbered by themselves", () => {
  it("counts the confirmed volunteers with their V numbers, after the race numbers, and says nothing about setting numbers", async () => {
    await saturday();
    const page = await tab();
    // The one not confirmed yet is out, and the cancelled one is not on the tab at all: the two confirmed take part, with the numbers
    // «Confirmă» gave them, after the race numbers.
    expect(countsOf(page)).toBe("Participă: 4 · Alergători: 2 · Elite: 0 · Voluntari: 2 · Prezenți dintre ei: 0");
    expect(rowsOf(page)).toEqual([
      expect.stringMatching(/^7 Ana Popescu Alergător Da /),
      expect.stringMatching(/^12 Bogdan Ionescu Alergător Da /),
      expect.stringMatching(/^V001 Ion Voluntar Voluntar Da /),
      expect.stringMatching(/^V002 Maria Voluntar Voluntar Da /),
      expect.stringMatching(/^— Petru În Așteptare Voluntar Nu · neconfirmat /),
    ]);
    expect(markupAndWords(page)).not.toMatch(NUMBERS_LINE);
    state.locale = "en";
    const english = await tab();
    expect(rowsOf(english).find((row) => row.includes("Ion Voluntar"))).toMatch(/^V001 Ion Voluntar Volunteer Yes /);
    expect(markupAndWords(english)).not.toMatch(NUMBERS_LINE);
  });

  it("says «Nu · fără număr» on the row alone of a confirmed volunteer the deployment left without a V number yet — no line, no link", async () => {
    // Confirmed in the minutes between the migration and the new deployment: the maintenance job numbers them (§NNN); until then the
    // row says why, as every other row does.
    await volunteer("Ion Voluntar", null);
    const page = await tab();
    expect(countsOf(page)).toBe("Participă: 0 · Alergători: 0 · Elite: 0 · Voluntari: 0 · Prezenți dintre ei: 0");
    expect(rowsOf(page)).toEqual([expect.stringMatching(/^— Ion Voluntar Voluntar Nu · fără număr /)]);
    expect(markupAndWords(page)).not.toMatch(NUMBERS_LINE);
  });

  it("gives nobody a number by being read: the V number is drawn at «Confirmă», never by a page", async () => {
    await volunteer("Ion Voluntar", null);
    await volunteer("Petru În Așteptare", null, { state: "REGISTERED" });
    await tab();
    state.actor = admin;
    await EditEventPage({ params: Promise.resolve({ locale: "ro", id: eventId }), searchParams: Promise.resolve({}) } as never);
    const rows = await db.select({ number: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(rows.map((row) => row.number)).toEqual([null, null]);
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

describe("§NNN the editor page: «Tombolă» open after its save", () => {
  const registrationBox = async (searchParams: Record<string, string> = {}) => {
    const tree = await EditEventPage({ params: Promise.resolve({ locale: "ro", id: eventId }), searchParams: Promise.resolve(searchParams) } as never);
    const box = everything(tree).find((element) => element.type === RegistrationBox);
    expect(box, "the registration card is drawn").toBeDefined();
    return box!.props as { raffleSaved?: boolean };
  };

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

  it("hands the registration card nothing to count about the volunteers' numbers", async () => {
    await saturday();
    state.actor = admin;
    expect(Object.keys(await registrationBox())).not.toContain("volunteersWithoutNumber");
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
