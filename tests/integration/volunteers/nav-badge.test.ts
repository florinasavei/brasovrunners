import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { AdminTab } from "@/modules/staff-identity/ui/AdminTabs";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The «Voluntari» tab, read like «Înscrieri» (the owner, 2026-11-04, of «Voluntari 2» beside a race with nine volunteers:
 * «un countar total greșit»): the badge is everyone still in at the events ahead — «Înscris» and «Confirmat», never the
 * cancelled, a past event's or a cancelled event's — and, only when some need the organizers, a smaller pill beside it with
 * how many are to confirm or to place («de confirmat sau de repartizat»), each person once, named for a screen reader; the
 * tooltip says both. Until then the badge was the unanswered offers alone (§839).
 *
 * The shell is a Server Component, so it is called and its tree walked for the tabs it hands the bar; the bar is then
 * drawn as the server sends it. The Tehnic role has no tab and costs no query.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string } }) => `/${locale}${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), usePathname: () => "/ro/admin/volunteers" }));

const { default: BackofficeShell } = await import("@/modules/staff-identity/ui/BackofficeShell");
const { default: AdminTabs } = await import("@/modules/staff-identity/ui/AdminTabs");
const { forgetVolunteersBadgeCount } = await import("@/modules/volunteers/nav-count");
const { forgetRegisteredBadgeCount } = await import("@/modules/registrations/nav-count");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first: a Server Component's tree, read without a browser. */
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

const DAY = 24 * 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetVolunteersBadgeCount();
  forgetRegisteredBadgeCount();
});

async function event(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(Date.now() + 30 * DAY), acceptsVolunteers: true, ...over })
    .returning({ id: events.id });
  return row.id;
}

/** A volunteer typed by the club (§865), in a state, given the roles named. */
async function volunteer(eventId: string, name: string, state: "REGISTERED" | "CONFIRMED" | "CANCELLED", given: string[] = []) {
  const [row] = await db.insert(eventVolunteers).values({ eventId, name, source: "STAFF", state }).returning({ id: eventVolunteers.id });
  if (given.length > 0) await db.insert(eventVolunteerRoleAssignments).values(given.map((roleId) => ({ volunteerId: row.id, roleId })));
}

/** The tabs the shell hands the bar, for a staff member of this role. */
async function tabsFor(role: StaffRole): Promise<AdminTab[]> {
  const tree = await BackofficeShell({ locale: "ro", staffUser: { displayName: "Ana", email: "ana@example.test", role }, signOut: async () => {}, children: null });
  const bar = elements(tree).find((element) => element.type === AdminTabs);
  if (!bar) throw new Error("no tab bar");
  return bar.props.items as AdminTab[];
}
const volunteersTab = (tabs: AdminTab[]) => tabs.find((tab) => tab.section === "volunteers");

/** The race of 2026-11-04, small: four still in, three of them waiting for the organizers; the rest outside the figure. */
async function race() {
  const raceId = await event();
  const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 }).returning({ id: eventVolunteerRoles.id });
  await volunteer(raceId, "Ana Înscrisă", "REGISTERED");
  // An offer unanswered, with a role already given: to confirm.
  await volunteer(raceId, "Bogdan Înscris", "REGISTERED", [water.id]);
  // Confirmed and placed: nothing to do.
  await volunteer(raceId, "Cristi Confirmat", "CONFIRMED", [water.id]);
  // Confirmed with no role: to place.
  await volunteer(raceId, "Dana Fără Rol", "CONFIRMED");
  // Not in it: a cancelled person, a past event's, a cancelled event's.
  await volunteer(raceId, "Elena Anulată", "CANCELLED");
  await volunteer(await event({ startsAt: new Date(Date.now() - 30 * DAY) }), "Fane Trecut", "REGISTERED");
  await volunteer(await event({ eventStatus: "CANCELLED" }), "Gina Anulat", "REGISTERED");
}

describe("the «Voluntari» tab, read like «Înscrieri» (2026-11-04)", () => {
  it("the badge is everyone still in at the events ahead, the pill those to confirm or to place, and the tooltip both", async () => {
    await race();
    const tab = volunteersTab(await tabsFor("ADMIN"));
    expect(tab?.count).toBe(4);
    expect(tab?.countPills).toEqual([{ kind: "toAct", count: 3, label: "3 de confirmat sau de repartizat" }]);
    expect(tab?.countHint).toBe("Voluntari la evenimentele care urmează, fără anulați: 4 · de confirmat sau de repartizat: 3");

    // Drawn as «Înscrieri» is: the filled figure, then the outlined pill with its glyph, named for a screen reader.
    const html = renderToStaticMarkup(createElement(AdminTabs, { items: [tab as AdminTab] })).replace(/<style\b[\s\S]*?<\/style>/g, "");
    expect(html).toContain(`${ro.Admin.nav.volunteers} `);
    expect(html).toContain(">4<");
    const pill = /<span[^>]*data-testid="volunteers-toAct-pill"[^>]*>([\s\S]*?)<\/span>/.exec(html);
    expect(pill?.[0]).toContain('aria-label="3 de confirmat sau de repartizat"');
    expect(pill?.[0]).toContain('role="img"');
    expect(pill?.[1]).toContain('data-testid="ManageAccountsIcon"');
    expect(pill?.[1].replace(/<svg[\s\S]*?<\/svg>/, "")).toBe("3");
  });

  it("with nobody to confirm or place, the badge alone; with nobody still in, no figure at all", async () => {
    const raceId = await event();
    const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 }).returning({ id: eventVolunteerRoles.id });
    await volunteer(raceId, "Cristi Confirmat", "CONFIRMED", [water.id]);
    await volunteer(raceId, "Elena Anulată", "CANCELLED");
    const tab = volunteersTab(await tabsFor("ADMIN"));
    expect(tab?.count).toBe(1);
    expect(tab?.countPills).toBeUndefined();
    expect(tab?.countHint).toBe("Voluntari la evenimentele care urmează, fără anulați: 1 · de confirmat sau de repartizat: 0");
    expect(renderToStaticMarkup(createElement(AdminTabs, { items: [tab as AdminTab] }))).not.toContain("-pill");

    await resetTables(db);
    forgetVolunteersBadgeCount();
    const empty = volunteersTab(await tabsFor("ADMIN"));
    expect(empty).toBeDefined();
    expect(empty?.count).toBeUndefined();
    expect(empty?.countPills).toBeUndefined();
  });

  it("the Organizer reads the same figures; the Tehnic role has no tab", async () => {
    await race();
    const tab = volunteersTab(await tabsFor("MODERATOR"));
    expect(tab?.count).toBe(4);
    expect(tab?.countPills?.map((pill) => pill.count)).toEqual([3]);
    expect(volunteersTab(await tabsFor("DEV"))).toBeUndefined();
  });
});
