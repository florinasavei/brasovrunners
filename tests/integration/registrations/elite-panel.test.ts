import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Elite» on the registrations list (the owner, 2026-11-04, who looked there for an elite on the race's separate list
 * and did not find her: that list lived only in the event's editor; then, of two sub-lists counted apart, «sunt 2
 * elite»). For the event chosen, a closed fold — the medal, its line «N elite» — holding every elite in one numbered list,
 * each line saying its kind: the separate list's names «fără înscriere — doar numele pe BIB» (and numbers),
 * then the registrations marked «Elită» in every state, «cu înscriere», each a link to its page with its state chip;
 * never another event's line, an unmarked registration or a test row. It ends with the link to the editor's elite card,
 * «Gestionează lista de elite» for the Administrator, «Vezi lista de elite în editor» for the Organizer. No fold while
 * the list spans every event. The kits' elites link to the same card.
 *
 * The page is a Server Component, so it is called and its element tree walked; the fold is then drawn as the server
 * sends it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the page asks of it: the locale's prefix and the params filled in.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    return `/${locale}${path}`;
  };
  return { getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href), Link: () => null };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: ElitePanel } = await import("@/modules/registrations/ui/ElitePanel");
const { default: KitCount } = await import("@/modules/registrations/ui/KitCount");
const { default: PlaceOutlook } = await import("@/modules/registrations/ui/PlaceOutlook");
const { listEliteMarkedRegistrations } = await import("@/modules/registrations/elite-mark");
const { setRegistrationEliteAction } = await import("@/app/[locale]/admin/registrations/actions");

type Props = Record<string, unknown> & { children?: ReactNode };

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

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR" | "DEV"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
}

const panelOf = (tree: ReactNode) => elements(tree).find((element) => element.type === ElitePanel);
/** The «Numere de concurs» fold, its header line the `aside`. */
const bibsPanelOf = (tree: ReactNode) => elements(tree).find((element) => element.props.id === "registrations-bibs");
/** The fold as the server sends it: its words, Emotion's styles out. */
async function drawn(panel: ReactElement<Props>): Promise<string> {
  return renderToStaticMarkup(await ElitePanel(panel.props as never)).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

/** The race of 2026-11-04: Ingrid on the separate list, Silviu registered and marked — and what must stay out. */
async function seed() {
  const race = await createRace("Crosul");
  const other = await createRace("Alt-cros");
  await db.insert(eventEliteEntries).values([
    { eventId: race.id, name: "Ingrid Elita", bibNumber: 7, createdAt: new Date("2026-11-01T10:00:00.000Z") },
    { eventId: race.id, name: "Ana Fara Numar", createdAt: new Date("2026-11-02T10:00:00.000Z") },
    { eventId: other.id, name: "Alt Eveniment" },
  ]);
  const silviu = await register(race.id, "Silviu Stoica", { elite: true, bibNumber: 12 });
  const mara = await register(race.id, "Mara Anulata", { elite: true, status: "CANCELLED" });
  await register(race.id, "Test Elita", { elite: true, kind: "TEST" });
  await register(race.id, "Nemarcat Simplu");
  await register(other.id, "Marcat Altundeva", { elite: true });
  return { race, silviu, mara };
}

describe("«Elite» on the registrations list (2026-11-04)", () => {
  it("lists both kinds of elite for the event chosen, read-only, with the link to the editor's elite card", async () => {
    const { race, silviu, mara } = await seed();
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id });
    const panel = panelOf(tree);
    expect(panel).toBeDefined();
    const card = `/ro/admin/events/${race.id}#bib-elite`;
    expect(panel?.props.cardHref).toBe(card);
    expect(panel?.props.mayManage).toBe(true);
    // The separate list in the order typed; the marked registrations by name, every state, never a test row.
    expect((panel?.props.entries as { name: string }[]).map((entry) => entry.name)).toEqual(["Ingrid Elita", "Ana Fara Numar"]);
    expect((panel?.props.marked as { name: string; status: string }[]).map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "Mara Anulata", status: "CANCELLED" },
      { name: "Silviu Stoica", status: "CONFIRMED" },
    ]);

    const html = await drawn(panel!);
    const text = words(html);
    // The fold: the medal, closed, its line counting both.
    expect(html).toContain('data-testid="MilitaryTechIcon"');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(text).toContain("Elite");
    expect(text).toContain("4 elite");
    expect(text).not.toContain("pe lista separată ·");
    // One numbered list, each line its kind: the names on the bib first, in the order typed, then the registrations.
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(text).toContain("Ingrid Elita fără înscriere — doar numele pe BIB nr. 7");
    expect(text).toContain("Ana Fara Numar fără înscriere — doar numele pe BIB");
    expect(text).toContain("Mara Anulata cu înscriere Anulată");
    expect(text).toContain("Silviu Stoica cu înscriere Confirmată nr. 12");
    const order = ["Ingrid Elita", "Ana Fara Numar", "Mara Anulata", "Silviu Stoica"].map((name) => text.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).not.toContain("Alt Eveniment");
    expect(text).not.toContain("Marcat Altundeva");
    expect(text).not.toContain("Test Elita");
    expect(text).not.toContain("Nemarcat Simplu");
    // Each marked registration: a link to its page and its state chip.
    expect(html).toMatch(new RegExp(`<a[^>]*href="/ro/admin/registrations/${silviu}"[^>]*>Silviu Stoica</a>`));
    expect(html).toMatch(new RegExp(`<a[^>]*href="/ro/admin/registrations/${mara}"[^>]*>Mara Anulata</a>`));
    expect(html.match(/data-testid="registrations-elite-status"/g)).toHaveLength(2);
    expect(text).toContain("Anulată");
    expect(text).toContain("Confirmată");
    // The Administrator's press (2026-11-11) is on the registered lines only: one form and one button each, none on the names.
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<a[^>]*href="${card}"[^>]*data-testid="registrations-elite-card"[^>]*>[\\s\\S]*Gestionează lista de elite</a>`));

    // The kits on the same page link their elites to the same card.
    const kits = elements(tree).find((element) => element.type === KitCount);
    expect(kits?.props).toMatchObject({ elites: 2, eliteHref: card, locale: "ro" });

    // «Locuri» counts the separate list among the people at the start; the places themselves stay the allocator's.
    const places = elements(tree).find((element) => element.type === PlaceOutlook);
    expect(places?.props).toMatchObject({ elites: 2, locale: "ro" });
    const placesText = words(renderToStaticMarkup(await PlaceOutlook({ ...places!.props, door: undefined } as never)).replace(/<style[^>]*>[\s\S]*?<\/style>/g, ""));
    // The places' own sum, read by the page, and the two names on top of it.
    const { totalIfAll } = places!.props.outlook as { totalIfAll: number };
    expect(placesText).toContain(`Oameni la start dacă intră toți: ${totalIfAll + 2}, inclusiv 2 elite din lista separată.`);

    // «Numere de concurs»: the registrations' bibs, then the separate list's beside them.
    expect(bibsPanelOf(tree)?.props.aside).toBe("BIB-uri: 0 din 1 printate — doar înscrierile confirmate · + 2 BIB-uri de elită, din lista separată");
  });

  it("says no elite bib and no elite at the start while the separate list is empty", async () => {
    const race = await createRace("Fara-elite");
    await register(race.id, "Silviu Stoica", { elite: true, bibNumber: 12 });
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id });
    expect(bibsPanelOf(tree)?.props.aside).toBe("BIB-uri: 0 din 1 printate — doar înscrierile confirmate");
    const places = elements(tree).find((element) => element.type === PlaceOutlook);
    expect(places?.props).toMatchObject({ elites: 0 });
    const placesText = words(renderToStaticMarkup(await PlaceOutlook({ ...places!.props, door: undefined } as never)));
    expect(placesText).not.toContain("inclusiv");
  });

  it("says an event with no elite in both lists' words, and draws no fold while the list spans every event", async () => {
    const race = await createRace("Gol");
    state.actor = await staff("ADMIN");
    const panel = panelOf(await listPage({ eventId: race.id }));
    const text = words(await drawn(panel!));
    expect(text).toContain("0 elite");
    expect(text).toContain("Nicio elită la acest eveniment.");
    expect(await drawn(panel!)).not.toContain("<ol");
    expect(panelOf(await listPage({ eventId: "all" }))).toBeUndefined();
  });

  it("the Administrator gets a one-press «Nu mai e elită» on each registered line, with the row menu's fields and a named button; none on a name without a registration", async () => {
    const { race, silviu, mara } = await seed();
    state.actor = await staff("ADMIN");
    const panel = panelOf(await listPage({ eventId: race.id }));
    const unmark = panel?.props.unmark as { action: unknown; listQuery: string } | undefined;
    expect(unmark).toBeDefined();
    expect(unmark?.action).toBe(setRegistrationEliteAction);
    const html = await drawn(panel!);
    const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(2);
    for (const [id, name] of [[mara, "Mara Anulata"], [silviu, "Silviu Stoica"]]) {
      const one = forms.find((form) => form.includes(`name="registrationId" value="${id}"`));
      expect(one).toBeDefined();
      expect(one).toContain('name="uiLocale" value="ro"');
      expect(one).toContain('name="elite" value="0"');
      expect(one).toMatch(/name="listQuery" value="[^"]*"/);
      expect(one).toContain(`aria-label="Nu mai e elită: ${name}"`);
      expect(one).toContain('data-testid="registrations-elite-unmark"');
    }
    // The names on the bib only carry no press.
    expect(forms.join("")).not.toContain("Ingrid Elita");
    expect(html.match(/data-testid="registrations-elite-unmark"/g)).toHaveLength(2);
    // English: the name in the accessible name too.
    state.locale = "en";
    const english = await drawn(panelOf(await listPage({ eventId: race.id }))!);
    expect(english).toContain('aria-label="No longer elite: Silviu Stoica"');
  });

  it("the Organizer reads it, his link saying he reads; the readers refuse every role that may not read the list", async () => {
    const { race } = await seed();
    state.actor = await staff("MODERATOR");
    const panel = panelOf(await listPage({ eventId: race.id }));
    expect(panel?.props.mayManage).toBe(false);
    const text = words(await drawn(panel!));
    expect(text).toContain("Vezi lista de elite în editor");
    expect(text).not.toContain("Gestionează");
    // No press for him: no prop, no form, no button but the link.
    expect(panel?.props.unmark).toBeUndefined();
    const html = await drawn(panel!);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("registrations-elite-unmark");
    // The Tehnic role never reaches the page; the reader refuses it all the same (BR-REQ-060-01).
    const tehnic = await staff("DEV");
    await expect(listEliteMarkedRegistrations(db, tehnic, race.id)).rejects.toSatisfy((error) => isDomainError(error) && error.code === "FORBIDDEN");
  });

  it("speaks English on the English page", async () => {
    const { race } = await seed();
    state.actor = await staff("ADMIN");
    state.locale = "en";
    const panel = panelOf(await listPage({ eventId: race.id }));
    const text = words(await drawn(panel!));
    expect(text).toContain("Elites");
    expect(text).toContain("4 elites");
    expect(text).toContain("Ingrid Elita not registered — the name on the bib only no. 7");
    expect(text).toMatch(/Silviu Stoica registered \S+ no\. 12/);
    expect(text).toContain("Manage the elite list");
    const tree = await listPage({ eventId: race.id });
    expect(bibsPanelOf(tree)?.props.aside).toBe("Bibs: 0 of 1 printed — confirmed registrations only · + 2 elite bibs, from the separate list");
    const places = elements(tree).find((element) => element.type === PlaceOutlook);
    expect(words(renderToStaticMarkup(await PlaceOutlook({ ...places!.props, door: undefined } as never)))).toMatch(/People at the start if everybody comes: \d+, including 2 elites on the separate list\./);
  });
});
