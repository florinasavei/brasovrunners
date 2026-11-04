import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import type { PlanRow } from "@/modules/registrations/domain/race-plan";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, registerRunner, type Runner } from "../../helpers/results";

/**
 * «Planul locurilor» (§NNN) on a real database (PGlite):
 *
 * - BR-REQ-060-01 — the page and its reader are the Organizer's, the Administrator's and the Superadministrator's: the
 *   Tehnic role and the volunteer get the 404, from the page and again from `readRacePlan`; a malformed id and an
 *   unknown event the same;
 * - BR-REQ-034-02 — the places taken inside the capacity are the allocator's own (`countOccupied`), their kinds add up
 *   to them, the lapsed holds are the sweep's (not one whose first email is still queued), and nobody outside the
 *   places — a special guest, an invitation «Pe lista de invitați speciali», an elite line, a volunteer — is counted
 *   among them; the runners are the places taken, the special guests and the elite list's lines, a registration marked
 *   elite once; what to order, now and if every place fills, is the sum of its parts, a kit and a bib per elite line;
 * - BR-REQ-050-02 — the page draws the registrations list's own «Locuri», «Pe site acum» (said, never offered: no
 *   form) and «Kituri de pregătit», then «Pe categorii», «Termene», «De comandat» and «Istoric capacitate», in both
 *   languages; an event registered elsewhere gets one sentence, an event with no limit only what is needed now.
 *
 * The page reads the real clock, so its fixtures are dated from now; the reader's are dated from `NOW`, passed in.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
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
/** The locale-aware link, as a plain anchor with its parameters and query filled in. */
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const path = (locale: string, href: Href) =>
    typeof href === "string"
      ? `/${locale}${href}`
      : `/${locale}${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}${href.query ? `?${new URLSearchParams(href.query)}` : ""}`;
  return {
    getPathname: ({ locale, href }: { locale?: string; href: Href }) => path(locale ?? state.locale, href),
    Link: ({ href, children }: { href: Href; children: ReactNode }) => createElement("a", { href: path(state.locale, href) }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({ requireStaff: async () => state.actor }));

const { readRacePlan } = await import("@/modules/registrations/race-plan");
const { countOccupied } = await import("@/modules/registrations/repository");
const { default: RacePlanPage } = await import("@/app/[locale]/admin/events/[id]/locuri/page");

const NOW = new Date("2026-11-03T10:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

async function runners(eventId: string, n: number, input: Omit<Runner, "name" | "bibNumber"> = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(await registerRunner(db, eventId, { name: "Ana Test", bibNumber: null, ...input }));
  return rows;
}

let invited = 0;
async function invite(eventId: string, expiresAt: Date, outsideCapacity = false) {
  invited += 1;
  const email = `plan.invited${invited}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ioana Test", preferredLocale: "ro" })
    .returning();
  await db.insert(eventInvitations).values({ eventId, participantId: participant.id, name: "Ioana Test", email, canonicalEmail: email, sentAt: NOW, lastSentAt: NOW, expiresAt, outsideCapacity });
}

/**
 * The race of the plan: 20 places; 6 confirmed (2 of them elite) and a confirmed test row; three declarations to sign —
 * one past its deadline, one past it whose first email is still queued (§513: not lapsed), one ahead; an open offer;
 * an open invitation; two waiting; three special guests; a special guest's open invitation and one lapsed; two elite
 * lines; three lines of the internal list; two volunteers with a kit, one cancelled with one, one without.
 */
async function race(dated: Date) {
  const event = await createRace(db, { capacity: 20, startsAt: new Date(dated.getTime() + 18 * DAY) });
  await runners(event.id, 4);
  for (const row of await runners(event.id, 2)) await db.update(registrations).set({ elite: true }).where(eq(registrations.id, row.id));
  await runners(event.id, 1, { kind: "TEST" });
  const [past, queued, ahead] = await runners(event.id, 3, { status: "PENDING_DECLARATION" });
  await db.update(registrations).set({ holdExpiresAt: new Date(dated.getTime() - HOUR) }).where(eq(registrations.id, past.id));
  await db.update(registrations).set({ holdExpiresAt: new Date(dated.getTime() - HOUR) }).where(eq(registrations.id, queued.id));
  await db.update(registrations).set({ holdExpiresAt: new Date(dated.getTime() + DAY) }).where(eq(registrations.id, ahead.id));
  await db.insert(emailOutbox).values({
    participantId: queued.participantId,
    registrationId: queued.id,
    messageType: "COMPLETE_DECLARATION",
    locale: "ro",
    recipientEmail: "queued@example.org",
    payloadJson: { [STARTS_DEADLINE]: true },
    idempotencyKey: `plan-queued-${queued.id}`,
  });
  const [offer] = await runners(event.id, 1, { status: "WAITLIST_OFFERED" });
  await db.update(registrations).set({ holdExpiresAt: new Date(dated.getTime() + DAY) }).where(eq(registrations.id, offer.id));
  await invite(event.id, new Date(dated.getTime() + DAY));
  await runners(event.id, 2, { status: "WAITLISTED" });
  await runners(event.id, 2, { outsideCapacity: true });
  await runners(event.id, 1, { outsideCapacity: true, status: "PENDING_DECLARATION" });
  await invite(event.id, new Date(dated.getTime() + DAY), true);
  await invite(event.id, new Date(dated.getTime() - DAY), true);
  await runners(event.id, 2, { status: "CANCELLED" });
  await db.insert(eventEliteEntries).values([
    { eventId: event.id, name: "Elita Unu" },
    { eventId: event.id, name: "Elita Doi", bibNumber: 900 },
  ]);
  for (let i = 0; i < 3; i++) await db.insert(eventReserveEntries).values({ eventId: event.id, firstName: "Ana", lastName: `Internă ${i}` });
  for (const [state, hasKit] of [
    ["CONFIRMED", true],
    ["REGISTERED", true],
    ["CANCELLED", true],
    ["CONFIRMED", false],
  ] as const) {
    await db.insert(eventVolunteers).values({ eventId: event.id, name: "Vlad Test", source: "STAFF", state, hasKit });
  }
  return event;
}

const countOf = (rows: readonly PlanRow[], key: string) => rows.find((row) => row.key === key)?.count;

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    if (error instanceof Error) return error.message;
  }
  return "none";
}

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** The page, as the Next route renders it, for the staff member and the id. */
async function page(actor: StaffUser, id: string, locale: "ro" | "en" = "ro"): Promise<string> {
  state.actor = actor;
  state.locale = locale;
  return markup(await RacePlanPage({ params: Promise.resolve({ locale, id }) }));
}

describe("BR-REQ-060-01 «Planul locurilor» is for whoever reads the registrations (§NNN)", () => {
  it("lets the Organizer, the Administrator and the Superadministrator read it; refuses the Tehnic role and a volunteer", async () => {
    const event = await race(NOW);
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      const actor = await person(db, role, role);
      expect((await readRacePlan(db, actor, event.id, NOW)).internal, role).toBe(true);
    }
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      expect(await refusal(readRacePlan(db, { role }, event.id, NOW)), role).toBe("FORBIDDEN");
    }
  });

  it("answers a malformed id and an unknown event with NOT_FOUND, before any query on the id", async () => {
    const organizer = { role: "MODERATOR" as const };
    expect(await refusal(readRacePlan(db, organizer, "not-a-uuid", NOW))).toBe("NOT_FOUND");
    expect(await refusal(readRacePlan(db, organizer, "00000000-0000-4000-8000-000000000000", NOW))).toBe("NOT_FOUND");
  });

  it("is the 404 of a page that does not exist for the Tehnic role, a malformed id and an unknown event", async () => {
    const event = await race(new Date());
    const tehnic = await person(db, "DEV", "Tehnic");
    const organizer = await person(db, "MODERATOR", "Organizator");
    expect(await refusal(page(tehnic, event.id))).toBe("NOT_FOUND");
    expect(await refusal(page(organizer, "nope"))).toBe("NOT_FOUND");
    expect(await refusal(page(organizer, "00000000-0000-4000-8000-000000000000"))).toBe("NOT_FOUND");
    expect(await page(organizer, event.id)).toContain('data-testid="race-plan-title"');
  });
});

describe("BR-REQ-034-02 «Pe categorii» counts as the allocator counts (§NNN)", () => {
  it("takes the places inside the capacity from the allocator's own count, and nobody outside them", async () => {
    const event = await race(NOW);
    const plan = await readRacePlan(db, { role: "MODERATOR" }, event.id, NOW);
    if (!plan.internal) throw new Error("an event registered here");
    const counts = await countOccupied(db, event.id, NOW);
    const { inside, outside, lists } = plan.rows;

    // The allocator's own figure, and «Locuri»'s: the same outlook.
    expect(countOf(inside, "occupied")).toBe(computeOccupied(counts));
    expect(countOf(inside, "occupied")).toBe(plan.outlook?.occupied);
    expect(countOf(inside, "occupied")).toBe(12);
    const kinds = inside.filter((row) => ["confirmed", "declaration", "offered", "invited", "family"].includes(row.key));
    expect(kinds.reduce((sum, row) => sum + (row.count ?? 0), 0)).toBe(12);
    // Seven confirmed — the test row among them, counted like any other (§30) and said apart — two of them elite.
    expect(countOf(inside, "confirmed")).toBe(7);
    expect(countOf(inside, "eliteConfirmed")).toBe(2);
    expect(plan.rows.test).toBe(1);
    // Three to sign; past its deadline only the one whose first email left (§513), as the sweep reads it.
    expect(countOf(inside, "declaration")).toBe(3);
    expect(countOf(inside, "lapsed")).toBe(counts.lapsedDeclarationHolds);
    expect(countOf(inside, "lapsed")).toBe(1);
    expect(countOf(inside, "offered")).toBe(1);
    expect(countOf(inside, "invited")).toBe(1);
    expect(countOf(inside, "family")).toBe(0);
    expect(countOf(inside, "free")).toBe(8);
    expect(countOf(inside, "capacity")).toBe(20);

    // Outside the places: three special guests by state, one open invitation of theirs (the lapsed one is not), two
    // elite lines and two volunteers with a kit (the cancelled one is not).
    expect(countOf(outside, "outside")).toBe(3);
    expect(countOf(outside, "outsideConfirmed")).toBe(2);
    expect(countOf(outside, "outsideDeclaration")).toBe(1);
    expect(countOf(outside, "outsideInvitations")).toBe(1);
    expect(countOf(outside, "eliteEntries")).toBe(2);
    expect(countOf(outside, "volunteersWithKit")).toBe(2);
    expect(countOf(lists, "waiting")).toBe(2);
    expect(countOf(lists, "internal")).toBe(3);

    // Every runner: the twelve places taken — the two marked elite among them, counted once — the three special guests
    // and the two elite lines; if every place fills, the twenty places and the special guests' open invitation too.
    expect(countOf(plan.rows.runners, "runnersNow")).toBe(12 + 3 + 2);
    expect(countOf(plan.rows.runners, "runnersIfFull")).toBe(20 + 3 + 1 + 2);

    // If every place fills: the runners, then a kit per volunteer and the desk's spare numbers (none) — each the sum of
    // the parts it writes out, a kit and a bib per elite line.
    expect(plan.totals?.kits.total).toBe(20 + 3 + 1 + 2 + 2);
    expect(plan.totals?.bibs.total).toBe(20 + 3 + 1 + 2 + 0);
    // «Kituri de pregătit» as the list counts it: the real rows holding a place and the open invitations.
    expect(plan.kits.registrations).toBe(6 + 3 + 1 + 3);
    expect(plan.kits.invitations).toBe(2);
    expect(plan.volunteersWithKit).toBe(2);
    // Every kit needed now: those, the elite lines and the volunteers with a kit.
    expect(plan.kitsNow.total).toBe(13 + 2 + 2 + 2);
    expect(plan.eliteEntries).toBe(2);
  });

  it("counts an event with no limit from the same allocator's count, and has nothing to order «if every place fills»", async () => {
    const event = await createRace(db, { capacity: null, startsAt: new Date(NOW.getTime() + 18 * DAY) });
    await runners(event.id, 3);
    await runners(event.id, 1, { status: "PENDING_DECLARATION" });
    await runners(event.id, 2, { outsideCapacity: true });
    const plan = await readRacePlan(db, { role: "ADMIN" }, event.id, NOW);
    if (!plan.internal) throw new Error("an event registered here");
    expect(plan.outlook).toBeNull();
    expect(countOf(plan.rows.inside, "occupied")).toBe(4);
    expect(countOf(plan.rows.inside, "capacity")).toBeNull();
    expect(plan.rows.inside.some((row) => row.key === "free")).toBe(false);
    expect(countOf(plan.rows.outside, "outside")).toBe(2);
    expect(plan.totals).toBeNull();
  });
});

describe("BR-REQ-050-02 the page draws the list's own readers, read only, in both languages (§NNN)", () => {
  it("draws «Locuri» and «Pe site acum» as the list does, the tick said and never offered, then the four folds", async () => {
    const event = await race(new Date());
    const organizer = await person(db, "MODERATOR", "Organizator");
    const html = await page(organizer, event.id);
    // The list's own components, unchanged.
    for (const id of ["registrations-places", "registrations-public-now", "registrations-public-door-state", "registrations-kits", "race-plan-table", "place-deadlines", "race-plan-order", "capacity-history"]) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
    // Read only: no form, no tick to press, whatever the role.
    expect(html).not.toContain("<form");
    expect(html).not.toContain('data-testid="registrations-public-door-form"');
    const words = text(html);
    expect(words).toContain("Planul locurilor — Crosul Tâmpei");
    expect(words).toContain("Locuri libere acum: 8 din 20");
    expect(words).toContain("Ocupate 12 din 20 · fără loc din capacitate 3 · alergători 17 · pe liste 5");
    expect(words).toContain("Dacă se ocupă toate locurile: kituri 28 · numere de concurs 26");
    expect(words).toContain("Kituri acum, cu toți: 19");
    expect(words).toContain("pe lista de elită: 2");
    expect(words).toContain("Plus BIB-uri cu nume de pe lista de elită: 2");
    expect(words).toContain("Alergători acum (ocupate, invitați speciali, lista de elită) 17");
    expect(html).toContain('data-testid="race-plan-runners-note"');
    expect(words).toContain("Înscrieri de test active: 1.");
    expect(words).toContain("nicio schimbare înregistrată");
    // Every fold but «Locuri» closed.
    expect(html.match(/<details/g)?.length).toBe(4);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    // The door to the race numbers, the back links.
    expect(html).toContain(`href="/ro/admin/events/${event.id}/bibs"`);
    expect(html).toContain(`href="/ro/admin/events/${event.id}"`);
    expect(html).toContain(`href="/ro/admin/registrations?eventId=${event.id}"`);
  });

  it("speaks English", async () => {
    const event = await race(new Date());
    const admin = await person(db, "ADMIN", "Admin");
    const words = text(await page(admin, event.id, "en"));
    expect(words).toContain("Places plan — Tampa Race");
    expect(words).toContain("By category");
    expect(words).toContain("To order");
    expect(words).toContain("Capacity history");
    expect(words).not.toContain("Planul locurilor");
  });

  it("says one sentence for an event registered elsewhere, and only what is needed now for one with no limit", async () => {
    const organizer = await person(db, "MODERATOR", "Organizator");
    const elsewhere = await createRace(db, { registrationMode: "EXTERNAL", externalRegistrationUrl: "https://example.org/register", capacity: null });
    const outside = await page(organizer, elsewhere.id);
    expect(outside).toContain('data-testid="race-plan-not-here"');
    expect(outside).not.toContain('data-testid="race-plan-table"');

    const open = await createRace(db, { capacity: null, startsAt: new Date(Date.now() + 18 * DAY) });
    await runners(open.id, 2);
    await db.insert(eventEliteEntries).values({ eventId: open.id, name: "Elita Trei" });
    const html = await page(organizer, open.id);
    expect(html).toContain('data-testid="race-plan-uncapped"');
    expect(html).toContain('data-testid="registrations-public-now"');
    expect(html).not.toContain('data-testid="registrations-places"');
    expect(html).toContain('data-testid="race-plan-order-uncapped"');
    // Two runners holding a place and an elite line: a kit each.
    expect(text(html)).toContain("Kituri acum: 3");
    expect(html).not.toContain('data-row="runnersIfFull"');
  });
});
