import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { eq } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { readPlaceDeadlines } from "@/modules/registrations/admin-repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §635 — «Când pierde lumea locul? Trebuie să apară asta in back-office» (the owner, 2026-10-02): where
 * the sentences show, read from a real database.
 *
 * - the registrations list scoped to one event carries «Când se pierde un loc» under «Cine s-a
 *   înscris»; the list over every event does not — no single window or setting is true of all of them;
 * - every role that reads the list reads it, the Organizer too (§289);
 * - the counts are real rows only: a test registration is in no number the club is given (§12.6);
 * - the queue panel says the held places' sentences beside «Rezervate».
 *
 * The list page is a Server Component, so it is called and its element tree walked; the block it
 * hands `PlaceDeadlines` is then rendered with the real translator over the real catalogues.
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
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  // The registration's own page (§635's timeline).
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  correctRegisteredNameAction: vi.fn(),
  // The member tick and its sweep (§NNN).
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: PlaceDeadlines } = await import("@/modules/registrations/ui/PlaceDeadlines");
const { default: QueuePanel } = await import("@/modules/registrations/ui/QueuePanel");
const { default: EditEventPage } = await import("@/app/[locale]/admin/events/[id]/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");

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

/** The text a person reads: Emotion's style blocks and the tags gone, entities back. */
function text(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<\/p>/g, "</p>\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

let db: TestDatabase;
let close: () => Promise<void>;

const START = new Date("2099-11-21T08:00:00.000Z");

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: START,
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      featured: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert>) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: `Runner ${serial}`,
    displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date(),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    ...row,
  }).returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR" | "DEV"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§635 «Când se pierde un loc» on the registrations list", () => {
  it("scoped to one event: the block under «Cine s-a înscris», real rows only — for the Administrator and the Organizer", async () => {
    const race = await createRace("Crosul");
    const later = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    // A test row is in no number the club is given (§12.6).
    await register(race.id, { status: "PENDING_DECLARATION", kind: "TEST", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    await register(race.id, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: later });

    // MODERATOR is the Organizer («Organizator»).
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      const block = elements(tree).find((element) => element.type === PlaceDeadlines);
      expect(block, role).toBeDefined();
      const rendered = text(renderToStaticMarkup(await PlaceDeadlines(block!.props as never)));
      expect(rendered).toContain("Când se pierde un loc");
      expect(rendered).toContain("2 persoane au de semnat declarația și își țin locul până ");
      expect(rendered).toContain("(cu 2 zile înainte de start).");
      expect(rendered).toContain("După termen locul nu se pierde singur");
      expect(rendered).toContain("O persoană n-a confirmat încă adresa: linkul e valabil 48 de ore");
      await resetStaff();
    }
    // The Tehnic role reads no list, so nothing new either (§289).
    state.actor = await staff("DEV");
    await expect(listPage({ eventId: race.id })).rejects.toThrow("NOT_FOUND");
  });

  it("over every event: no block", async () => {
    const race = await createRace("Crosul");
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: "all" });
    expect(elements(tree).some((element) => element.type === PlaceDeadlines)).toBe(false);
  });
});

describe("§635 the queue panel: the held places' sentences beside «Rezervate»", () => {
  it("only the held part, in the event's zone, with the setting's words", async () => {
    const race = await createRace("Crosul");
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    await register(race.id, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date(Date.now() + 60 * 60_000) });
    const html = renderToStaticMarkup(
      await QueuePanel({
        db,
        event: { id: race.id, capacity: race.capacity, waitlistCapacity: race.waitlistCapacity, timezone: race.timezone, waitlistAutoOffer: false },
        waiting: 0,
        now: new Date(),
      }),
    );
    const panel = text(html);
    expect(html).toContain('data-testid="queue-place-deadlines"');
    expect(panel).toContain("O persoană are de semnat declarația și își ține locul până ");
    // Not the email's sentence: the panel is about the places held.
    expect(panel).not.toContain("n-a confirmat încă adresa");
  });
});

describe("§635 «Înscrierile primite» on the event's page", () => {
  it("carries every sentence, and hands the queue panel the same counts — one read", async () => {
    const race = await createRace("Crosul");
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-19T08:00:00.000Z") });
    await register(race.id, { status: "WAITLIST_OFFERED", offerCreatedAt: new Date(), holdExpiresAt: new Date(Date.now() + 60 * 60_000) });
    state.actor = await staff("MODERATOR");
    const tree = await EditEventPage({ params: Promise.resolve({ locale: "ro", id: race.id }), searchParams: Promise.resolve({}) } as never);
    const all = elements(tree);
    // The box sits in the page's `below`, a prop rather than a child: walk it too.
    const below = all.flatMap((element) => (element.props.below ? elements(element.props.below as ReactNode) : []));
    const block = below.find((element) => element.type === PlaceDeadlines);
    expect(block).toBeDefined();
    const rendered = text(renderToStaticMarkup(await PlaceDeadlines(block!.props as never)));
    expect(rendered).toContain("O persoană are de semnat declarația și își ține locul până ");
    expect(rendered).toContain("O persoană are o ofertă din lista de așteptare, valabilă cel mult 24 de ore");
    const panel = below.find((element) => element.type === QueuePanel);
    expect(panel?.props.placeDeadlines).toEqual(block!.props.event ? { event: block!.props.event, counts: block!.props.counts } : undefined);
  });
});

describe("§635 the counts: past the deadline as the sweep reads it", () => {
  it("a hold whose first declaration email is still queued is not past its deadline (§513)", async () => {
    const race = await createRace("Crosul");
    const past = new Date(Date.now() - 60 * 60_000);
    await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: past });
    const queued = await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: past });
    const [row] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, queued));
    await db.insert(emailOutbox).values({
      participantId: row.participantId,
      registrationId: queued,
      messageType: "COMPLETE_DECLARATION",
      locale: "ro",
      recipientEmail: "queued@example.org",
      payloadJson: { [STARTS_DEADLINE]: true },
      idempotencyKey: `queued-${queued}`,
    });
    const facts = await readPlaceDeadlines(db, race.id, new Date());
    // Both hold a place; only the one whose email has left is past its deadline — its send re-bases the other's.
    expect(facts?.counts.held).toBe(2);
    expect(facts?.counts.heldPast).toBe(1);
  });
});

describe("§635 the registration's page: the timeline names the deadline its state waits on", () => {
  /** The timeline's «label: value» lines, as the page writes them. */
  async function timeline(id: string): Promise<string> {
    const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    const lines: string[] = [];
    for (const element of elements(tree)) {
      const children: unknown = element.props.children;
      if (Array.isArray(children) && children.length === 3 && children[1] === ": ") lines.push(children.join(""));
    }
    return lines.join("\n");
  }

  it("a live hold, one past its deadline, a row waiting for its address, an ended row", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const ahead = new Date("2099-11-19T08:00:00.000Z");
    const past = new Date(Date.now() - 60 * 60_000);
    const day = (value: Date) => formatDay(value, { locale: "ro", timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

    // A place held for the declaration: «Ține locul până», the deadline alone.
    const live = await timeline(await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: ahead }));
    expect(live).toContain(`Ține locul până: ${day(ahead)}`);
    expect(live).not.toContain("Rezervarea expiră");
    expect(live).not.toContain("Linkul din email expiră");
    expect(live).not.toContain("termen depășit");

    // Past it, the place is kept while nobody asks for it (§160): the journey's kept words beside the date.
    const kept = await timeline(await register(race.id, { status: "PENDING_DECLARATION", holdExpiresAt: past }));
    expect(kept).toContain(`Ține locul până: ${day(past)} — termen depășit, locul se ține cât nu-l cere nimeni`);

    // Waiting for its address: the email's link, and no hold.
    const link = new Date("2099-11-10T08:00:00.000Z");
    const waiting = await timeline(await register(race.id, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: link }));
    expect(waiting).toContain(`Linkul din email expiră: ${day(link)}`);
    expect(waiting).not.toContain("Ține locul până");

    // An ended row keeps «Rezervarea expiră», and names no link.
    const ended = await timeline(
      await register(race.id, { status: "EXPIRED", holdExpiresAt: past, emailLinkExpiresAt: link, expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" }),
    );
    expect(ended).toContain(`Rezervarea expiră: ${day(past)}`);
    expect(ended).not.toContain("Ține locul până");
    expect(ended).not.toContain("Linkul din email expiră");
    expect(ended).not.toContain("termen depășit");
  });
});

async function resetStaff() {
  await db.delete(staffUsers);
}
