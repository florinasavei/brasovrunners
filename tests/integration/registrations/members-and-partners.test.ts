import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { CLUB_SHORT_NAME } from "@/theme/brand";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Cine s-a înscris» → «Dintre cei {n} confirmați» (§NNN; the owner, 2026-11-18: «aș vrea să văd mai clar, câți sunt Brașov
 * Runners și câți sunt de la sponsori?»; BR-REQ-050-02, BR-REQ-070-01): among the confirmed real registrations the chip
 * «Confirmată» counts — the special guests among them, never a test row, never another state or another event — how many are
 * the club's members (verified by a member account's address, or declared by the tick), how many came through partners
 * (each partner by name, whatever its capitals, largest first), how many neither, and how many are both; each count a link
 * to the list filtered to those people.
 *
 * Read from a real database (PGlite), with made-up people and made-up partners. The page is a Server Component: it is called
 * and its element tree walked, as `partner-column.test.ts` walks it; the block is rendered to markup on its own.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

// The real catalogues; a page's `getTranslations("Admin")` answers in the language the test is drawing in.
vi.mock("next-intl/server", async () => {
  const { intlServerMock } = await import("../../helpers/intl-server");
  return {
    ...intlServerMock,
    getTranslations: async (arg: string | { locale?: string; namespace: string }) =>
      intlServerMock.getTranslations(typeof arg === "string" ? { locale: state.locale, namespace: arg } : arg),
  };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
  Link: () => null,
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  // The coarse gate, as the real one asks it: the role's capability, refused FORBIDDEN otherwise.
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined, flash: async () => undefined }));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
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
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  setRegistrationRaffleAction: vi.fn(),
  deleteSponsorListRecordAction: vi.fn(),
  turnRunnerIntoVolunteerAction: vi.fn(),
  turnVolunteerIntoRunnerAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: MembersAndPartners } = await import("@/modules/registrations/ui/MembersAndPartners");
const { countByPartner, summariseRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");

/** Made-up partners: no real sponsor's name. */
const BAKERY = "Brutăria Exemplu";
const CAFE = "Cafeneaua de Test";

type Props = Record<string, unknown> & { children?: ReactNode };
type Composition = NonNullable<Awaited<ReturnType<typeof summariseRegistrationsForAdmin>>["composition"]>;
type Hrefs = { members?: string; partners?: string; byPartner?: Record<string, string> };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const value of Object.values(node.props)) {
    if (value !== node.props.children && (isValidElement(value) || Array.isArray(value))) elements(value as ReactNode, acc);
  }
  elements(node.props.children, acc);
  return acc;
}

/** The words a reader sees: Emotion's styles out, every tag a space. */
const words = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const NOW = new Date();

async function createRace(title = "Crosul") {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(NOW.getTime() + 30 * 24 * 3_600_000),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title },
  ]);
  return event;
}

/** One made-up registration, confirmed and real unless `row` says otherwise; `email` lets a member account match it. */
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}, email = `runner${++serial}@example.org`) {
  const name = `Alergător ${serial}`;
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
      submittedAt: new Date(NOW.getTime() - ++serial * 60_000),
      ...row,
    })
    .returning({ id: registrations.id });
  return created;
}

async function staff(role: StaffRole, email = `${role.toLowerCase()}-${++serial}@example.invalid`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: `Coleg ${serial}`, role }).returning();
  return user;
}

/**
 * The race the owner's question is about, in small: nine confirmed real registrations — two members by a member account's
 * address (one of them ticked too), one who only ticked and came through the bakery, three more from the bakery (one spelled
 * in small letters), one from the café, two nobody, one special guest nobody — and the rows that must never be counted: a
 * pending member, a waiting partner's person, a confirmed test row that is both, and a confirmed member at another event.
 */
async function seedRace() {
  const race = await createRace();
  const other = await createRace("Alt eveniment");
  await staff("MEMBER", "membru-unu@example.org");
  await staff("MEMBER", "membru-doi@example.org");
  await register(race.id, {}, "membru-unu@example.org");
  await register(race.id, { clubMemberDeclared: true }, "membru-doi@example.org");
  await register(race.id, { clubMemberDeclared: true, partnerName: BAKERY });
  await register(race.id, { partnerName: BAKERY });
  await register(race.id, { partnerName: "brutăria exemplu" });
  await register(race.id, { partnerName: CAFE });
  await register(race.id);
  await register(race.id);
  await register(race.id, { outsideCapacity: true });
  // Never counted.
  await register(race.id, { status: "PENDING_DECLARATION", clubMemberDeclared: true, partnerName: BAKERY });
  await register(race.id, { status: "WAITLISTED", partnerName: CAFE });
  await register(race.id, { kind: "TEST", clubMemberDeclared: true, partnerName: BAKERY });
  await register(other.id, { clubMemberDeclared: true, partnerName: BAKERY });
  return race;
}

const listPage = (searchParams: Record<string, string>) =>
  AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
const blockOf = (tree: ReactNode) => elements(tree).find((element) => element.type === MembersAndPartners);

async function drawn(composition: Composition, locale: "ro" | "en" = "ro", hrefs: Hrefs = {}): Promise<string> {
  state.locale = locale;
  const element = await MembersAndPartners({ composition, locale, club: CLUB_SHORT_NAME, hrefs });
  return element ? renderToStaticMarkup(element) : "";
}

/** A test's own figures, without a database: the words are the subject. */
const figures = (parts: Partial<Composition> & { confirmed: number }): Composition => {
  const all = { members: 0, verified: 0, declared: 0, partners: 0, byPartner: [], both: 0, ...parts };
  return { ...all, others: all.confirmed - all.members - all.partners + all.both };
};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  state.locale = "ro";
  await resetTables(db);
});

describe("the confirmed by member and partner, counted with the summary (§NNN)", () => {
  it("counts the confirmed real registrations of the chosen event alone, members split, partners by name, the overlap", async () => {
    const race = await seedRace();
    const members = [...new Set(["membru-unu@example.org", "membru-doi@example.org"])];
    const summary = await summariseRegistrationsForAdmin(db, { eventId: race.id, members });
    // The chip «Confirmată» and the block count the same people: the special guest in, the test row out.
    expect(summary.byStatus.CONFIRMED).toBe(9);
    expect(summary.composition).toEqual({
      confirmed: 9,
      members: 3,
      verified: 2,
      declared: 1,
      partners: 4,
      byPartner: [
        { name: expect.stringMatching(/^brutăria exemplu$/i), count: 3 },
        { name: CAFE, count: 1 },
      ],
      both: 1,
      others: 3,
    });
  });

  it("reads the member accounts itself when the caller hands none, and follows the list's other filters as the chips do", async () => {
    const race = await seedRace();
    expect((await summariseRegistrationsForAdmin(db, { eventId: race.id }))?.composition).toMatchObject({ members: 3, verified: 2 });
    // Filtered to one partner, the block is about that partner's confirmed people, as the chip «Confirmată» is.
    const one = await summariseRegistrationsForAdmin(db, { eventId: race.id, partner: CAFE });
    expect(one.byStatus.CONFIRMED).toBe(1);
    expect(one.composition).toMatchObject({ confirmed: 1, members: 0, partners: 1, others: 0, byPartner: [{ name: CAFE, count: 1 }] });
  });

  it("counts nothing with every event listed: the block is about one event", async () => {
    await seedRace();
    const summary = await summariseRegistrationsForAdmin(db, {});
    expect(summary.composition).toBeNull();
    expect(summary.byStatus.CONFIRMED).toBe(10);
  });

  it("groups a partner's names whatever their capitals, in the first spelling met, largest first, a tie by name", () => {
    expect(countByPartner(["Zeta", "Alfa", "alfa", "Beta", "zeta", "ZETA"])).toEqual([
      { name: "Zeta", count: 3 },
      { name: "Alfa", count: 2 },
      { name: "Beta", count: 1 },
    ]);
    expect(countByPartner(["Beta", "Alfa"])).toEqual([
      { name: "Alfa", count: 1 },
      { name: "Beta", count: 1 },
    ]);
    expect(countByPartner([])).toEqual([]);
  });
});

describe("«Dintre cei {n} confirmați» in «Cine s-a înscris»", () => {
  it("is drawn under the state chips with the counts, each a link to the list filtered to those confirmed people", async () => {
    const race = await seedRace();
    state.actor = await staff("MODERATOR");
    const block = blockOf(await listPage({ eventId: race.id }));
    expect(block).toBeDefined();
    const props = block!.props as unknown as { composition: Composition; hrefs: Hrefs; club: string };
    expect(props.club).toBe(CLUB_SHORT_NAME);
    expect(props.composition).toMatchObject({ confirmed: 9, members: 3, verified: 2, declared: 1, partners: 4, both: 1, others: 3 });
    const query = (href: string | undefined) => Object.fromEntries(new URL(href ?? "", "https://example.invalid").searchParams);
    expect(query(props.hrefs.members)).toEqual({ eventId: race.id, status: "CONFIRMED", clubMember: "1" });
    expect(query(props.hrefs.partners)).toEqual({ eventId: race.id, status: "CONFIRMED", partner: "1" });
    // A partner by name links to the one-partner filter, in the event's spelling; the café too.
    const bakery = props.composition.byPartner[0].name;
    expect(query(props.hrefs.byPartner?.[bakery])).toMatchObject({ eventId: race.id, status: "CONFIRMED" });
    expect(query(props.hrefs.byPartner?.[bakery]).partnerName?.toLowerCase()).toBe(BAKERY.toLowerCase());
    expect(query(props.hrefs.byPartner?.[CAFE])).toEqual({ eventId: race.id, status: "CONFIRMED", partnerName: CAFE });
    expect(query(props.hrefs.byPartner?.[CAFE]).partner).toBeUndefined();

    const html = await drawn(props.composition, "ro", props.hrefs);
    const text = words(html);
    expect(text).toContain("Dintre cei 9 confirmați:");
    expect(text).toContain(`3 membri ${CLUB_SHORT_NAME} (2 verificați, 1 declarat)`);
    expect(text).toMatch(/4 de la parteneri — brutăria exemplu 3 · Cafeneaua de Test 1/i);
    expect(text).toContain("3 ceilalți — nici membri, nici de la parteneri");
    expect(text).toContain("1 e și membru, și de la parteneri: numărat la amândouă.");
    expect(html).toContain(`data-testid="registrations-composition-members"`);
    expect(html.match(/<a [^>]*data-testid="registrations-composition-partner"/g)).toHaveLength(2);
    // «Ceilalți» has no link: the list has no «not a member» filter.
    expect(html).not.toMatch(/<a [^>]*data-testid="registrations-composition-others"/);
  });

  it("is not drawn with every event listed", async () => {
    await seedRace();
    state.actor = await staff("MODERATOR");
    expect(blockOf(await listPage({ eventId: "all" }))).toBeUndefined();
  });

  it("draws nothing while nobody is confirmed, and the split and the overlap only when there is something to say", async () => {
    expect(await drawn(figures({ confirmed: 0 }))).toBe("");
    const plain = words(await drawn(figures({ confirmed: 20, members: 5, verified: 5, partners: 2, byPartner: [{ name: CAFE, count: 2 }] })));
    expect(plain).toContain("Dintre cei 20 de confirmați:");
    expect(plain).toContain(`5 membri ${CLUB_SHORT_NAME}`);
    expect(plain).not.toContain("verificați");
    expect(plain).not.toContain("amândouă");
    expect(plain).toContain("13 ceilalți");
  });

  it("links a count only above nought, and a partner only where the filter takes its name", async () => {
    const html = await drawn(figures({ confirmed: 3, partners: 2, byPartner: [{ name: CAFE, count: 1 }, { name: BAKERY, count: 1 }] }), "ro", {
      members: "/ro/admin/registrations?clubMember=1",
      partners: "/ro/admin/registrations?partner=1",
      byPartner: { [CAFE]: "/ro/admin/registrations?partnerName=x" },
    });
    // Nought members: the words, no link.
    expect(html).not.toMatch(/<a [^>]*data-testid="registrations-composition-members"/);
    expect(html).toMatch(/<a [^>]*data-testid="registrations-composition-partners"/);
    expect(html.match(/<a [^>]*data-testid="registrations-composition-partner"/g)).toHaveLength(1);
    expect(words(html)).toContain(`0 membri ${CLUB_SHORT_NAME}`);
  });

  it("says it in English with the same counts", async () => {
    const text = words(
      await drawn(figures({ confirmed: 9, members: 3, verified: 2, declared: 1, partners: 4, byPartner: [{ name: BAKERY, count: 3 }, { name: CAFE, count: 1 }], both: 1 }), "en"),
    );
    expect(text).toContain("Of the 9 confirmed:");
    expect(text).toContain(`3 ${CLUB_SHORT_NAME} members (2 verified, 1 declared)`);
    expect(text).toContain(`4 from partners — ${BAKERY} 3 · ${CAFE} 1`);
    expect(text).toContain("3 others — neither members nor from partners");
    expect(text).toContain("1 is both a member and from a partner: counted in both.");
  });
});
