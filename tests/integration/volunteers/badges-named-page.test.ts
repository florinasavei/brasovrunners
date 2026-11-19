import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { catalogueOf } from "@/i18n/catalogue";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { NAMED_COLOUR_WORDS } from "@/modules/volunteers/badges/badge-named";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §988 — «Ecusoane cu nume» on «Ecusoane pentru voluntari» (`/admin/events/[id]/badges`; the hotfix of 2026-11-19, amending §764's
 * «no name is printed» and the page's «no volunteer is read»; BR-REQ-050-02, BR-REQ-060-01), read from a real database: below
 * «Tipărire», a box whose list starts with one «WORD; First name» line per confirmed volunteer of the event — the design's word, the
 * first name only, never a person still «Înscris», a cancelled one or another event's — posting to `/badges/named` with the page's
 * language; with nobody confirmed it starts empty and says so. Both languages. The page is the badges designer's alone: every other
 * role meets the 404 an unknown page gets, and nobody without a staff session reads anything.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { catalogueOf: catalogue } = await import("@/i18n/catalogue");
  return {
    // The page's language for `getTranslations("Admin")`; a badge's own for `{ locale, namespace }` (`badge-words.ts`).
    getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
      const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
      return createTranslator({ locale, messages: catalogue(locale), namespace: (typeof arg === "string" ? arg : arg.namespace) as "Admin" });
    },
    getLocale: async () => state.locale,
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/media/storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/media/storage")>()), isStorageConfigured: () => false }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string }) => `/${locale}${href}`,
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
}));
// The door as the real one answers it: no session is the domain's UNAUTHENTICATED.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const { default: EventBadgesPage } = await import("@/app/[locale]/admin/events/[id]/badges/page");
const { default: BadgeNamedPanel } = await import("@/modules/volunteers/badges/ui/BadgeNamedPanel");
const { default: BadgePrintPanel } = await import("@/modules/volunteers/badges/ui/BadgePrintPanel");

type Props = Record<string, unknown> & { children?: ReactNode };
type NamedProps = Parameters<typeof BadgeNamedPanel>[0];

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

async function volunteer(eventId: string, name: string, volunteerState: "REGISTERED" | "CONFIRMED" | "CANCELLED") {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  await db.insert(eventVolunteers).values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "+40700000001", source: "PUBLIC", state: volunteerState });
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  const [race, other] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), acceptsVolunteers: true },
      { type: "RACE", startsAt: new Date("2099-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  otherId = other.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul toamnei" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "Autumn cross" },
    { eventId: otherId, locale: "ro", slug: `altul-${otherId.slice(0, 8)}`, title: "Alt cros" },
    { eventId: otherId, locale: "en", slug: `other-${otherId.slice(0, 8)}`, title: "Another cross" },
  ]);
});

/** The two confirmed people of the race, and the three the list must never name: one still «Înscris», one cancelled, one at another event. */
async function seedPeople() {
  await volunteer(raceId, "Dan Ene", "CONFIRMED");
  await volunteer(raceId, "Ana Maria Pop", "CONFIRMED");
  await volunteer(raceId, "Bogdan Ilie", "REGISTERED");
  await volunteer(raceId, "Cora Stan", "CANCELLED");
  await volunteer(otherId, "Eugenia Lupu", "CONFIRMED");
}

async function pageTree(locale: "ro" | "en" = "ro", id = raceId): Promise<ReactNode> {
  state.locale = locale;
  return EventBadgesPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve({}) });
}
/** The box's element in the page, as the page hands it its props. */
function namedPanelOf(tree: ReactNode): ReactElement<NamedProps & Props> {
  const found = elements(tree).filter((element) => element.type === BadgeNamedPanel);
  expect(found).toHaveLength(1);
  return found[0] as unknown as ReactElement<NamedProps & Props>;
}
/** The box as the server streams it, Suspense settled and Emotion's styles out of the way. */
async function panelHtml(props: NamedProps, locale: "ro" | "en"): Promise<string> {
  state.locale = locale;
  const drawn = await BadgeNamedPanel(props);
  const intl = { locale, timeZone: "Europe/Bucharest", messages: catalogueOf(locale) } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, drawn), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
/** What the box's textarea starts with, as the browser reads it. */
function linesOf(html: string): string {
  const textareas = [...html.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g)].filter((match) => /name="lines"/.test(match[1]));
  expect(textareas).toHaveLength(1);
  return textareas[0][2].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

describe("§988 «Ecusoane cu nume» on the badges page", () => {
  it("is the last box, below «Tipărire», for the event and in the page's language", async () => {
    const tree = await pageTree();
    const all = elements(tree);
    const panel = namedPanelOf(tree);
    expect(all.indexOf(panel)).toBeGreaterThan(all.findIndex((element) => element.type === BadgePrintPanel));
    const boxes = ([] as ReactNode[]).concat((tree as ReactElement<Props>).props.children).filter(isValidElement);
    expect(boxes.at(-1)).toBe(panel);
    expect(panel.props).toMatchObject({ eventId: raceId, locale: "ro" });
  });

  it("starts with one line per confirmed volunteer of the event — the design's word and the first name only, by name — never one «Înscris», cancelled or another event's", async () => {
    await seedPeople();
    const panel = namedPanelOf(await pageTree());
    expect(panel.props.lines).toBe("VOLUNTAR; Ana\nVOLUNTAR; Dan");
    const html = await panelHtml(panel.props, "ro");
    expect(linesOf(html)).toBe("VOLUNTAR; Ana\nVOLUNTAR; Dan");
    for (const name of ["Bogdan", "Cora", "Eugenia", "Maria", "Pop", "Ene", "Ilie", "Stan", "Lupu"]) expect(linesOf(html), name).not.toContain(name);
    for (const name of ["Bogdan", "Cora", "Eugenia"]) expect(html, name).not.toContain(name);
    // A form that works with scripts off, posting the list and the page's language to the route — never a name in an address.
    expect(html).toMatch(new RegExp(`<form[^>]*action="/api/admin/events/${raceId}/badges/named"`));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="locale"[^>]*value="ro"|<input[^>]*name="locale"[^>]*type="hidden"[^>]*value="ro"/);
    const words = catalogueOf("ro").Admin.badges.named;
    expect(html).toContain(words.title);
    expect(html).toContain(words.download);
    expect(html).toContain(NAMED_COLOUR_WORDS.ro);
    expect(html).not.toContain('data-testid="badge-named-empty"');
  });

  it("starts empty while nobody is confirmed, and says so", async () => {
    await volunteer(raceId, "Bogdan Ilie", "REGISTERED");
    await volunteer(raceId, "Cora Stan", "CANCELLED");
    await volunteer(otherId, "Eugenia Lupu", "CONFIRMED");
    const panel = namedPanelOf(await pageTree());
    expect(panel.props.lines).toBe("");
    const html = await panelHtml(panel.props, "ro");
    expect(linesOf(html)).toBe("");
    expect(html).toContain('data-testid="badge-named-empty"');
    expect(html).toContain(catalogueOf("ro").Admin.badges.named.empty);
  });

  it("speaks English: the design's English word, the box's words and the colours' names", async () => {
    await seedPeople();
    const panel = namedPanelOf(await pageTree("en"));
    expect(panel.props).toMatchObject({ locale: "en", lines: `${catalogueOf("en").Admin.badges.defaults.label}; Ana\n${catalogueOf("en").Admin.badges.defaults.label}; Dan` });
    const html = await panelHtml(panel.props, "en");
    const words = catalogueOf("en").Admin.badges.named;
    expect(html).toContain(words.title);
    expect(html).toContain(words.download);
    expect(html).toContain(NAMED_COLOUR_WORDS.en);
    expect(html).toMatch(/name="locale"[^>]*value="en"|value="en"[^>]*name="locale"/);
    await db.delete(eventVolunteers);
    const empty = await panelHtml(namedPanelOf(await pageTree("en")).props, "en");
    expect(empty).toContain(words.empty);
  });

  it("starts with the club's own word when the design has one, in the page's language", async () => {
    await seedPeople();
    await db.update(events).set({ badgeDesign: { ...DEFAULT_BADGE_DESIGN, labelRo: "Staff", labelEn: "Crew" } }).where(eq(events.id, raceId));
    expect(namedPanelOf(await pageTree("ro")).props.lines).toBe("Staff; Ana\nStaff; Dan");
    expect(namedPanelOf(await pageTree("en")).props.lines).toBe("Crew; Ana\nCrew; Dan");
  });

  it.each(["MODERATOR", "ADMIN", "SUPERADMIN"] as const)("is there for the %s, who designs the badges", async (role) => {
    await seedPeople();
    state.actor = staff[role];
    expect(namedPanelOf(await pageTree()).props.lines).toBe("VOLUNTAR; Ana\nVOLUNTAR; Dan");
  });

  it.each(["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const)("is not there for the %s: the page is the 404 an unknown page gets (BR-REQ-060-01)", async (role) => {
    await seedPeople();
    state.actor = staff[role];
    await expect(pageTree()).rejects.toThrow("NOT_FOUND");
  });

  it("reads nothing without a staff session", async () => {
    state.actor = undefined;
    await expect(pageTree()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("is the 404 an unknown page gets for an id that is no uuid and an event that does not exist", async () => {
    await expect(pageTree("ro", "not-an-id")).rejects.toThrow("NOT_FOUND");
    await expect(pageTree("ro", "00000000-0000-4000-8000-000000000000")).rejects.toThrow("NOT_FOUND");
  });
});
