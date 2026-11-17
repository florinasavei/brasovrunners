import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listDeskRegistrations } from "@/modules/registrations/admin-repository";
import { editRegistrationAnswers } from "@/modules/registrations/admin-service";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (the owner, 2026-11-17: «că momentan nu se deosebesc cu nimic»), BR-REQ-038-01, BR-REQ-031-06, BR-REQ-037-03
 * («Modifică datele») and BR-REQ-037-05 (the staff entry) — the screens of the members' race number by the one rule
 * (offered, the member tick, not «Elită»):
 *
 * - the bibs page's print card counts the members' bibs the sheet prints, offers the two part downloads only then, and
 *   draws the members' pile first — with no member account anywhere — and no «asked but not verified» line any more;
 * - the registration's page says «Număr de membru» beside the number exactly when the rule holds, and its «Modifică
 *   datele» corrects the member tick with no «Vreau numărul de membru» box beside it;
 * - the staff entry asks the member tick alone, at an event that offers the members' bib, in Română and in English;
 * - the desk's «Arată numărul» asks the bib's picture by the same rule (`m=1`), so a tick corrected in «Modifică datele»
 *   is a new address and never the picture the browser kept for the preview's cache hour.
 *
 * The pages are Server Components: they are called and their element trees walked, as the other screen tests do.
 * The public form without the question is `tests/unit/registrations/member-bib-form.test.ts`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "string" ? state.locale : arg.locale;
    const namespace = typeof arg === "string" ? arg : arg.namespace;
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
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  setRegistrationRaffleAction: vi.fn(),
  deleteSponsorListRecordAction: vi.fn(),
  turnRunnerIntoVolunteerAction: vi.fn(),
  turnVolunteerIntoRunnerAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  createRegistrationAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  undoCheckInAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: NewRegistrationPage } = await import("@/app/[locale]/admin/registrations/new/page");
const { default: EventBibsPage } = await import("@/app/[locale]/admin/events/[id]/bibs/page");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first, through `children` only — what the page itself wrote. */
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

/** The text an element holds, its children joined: what a reader sees of a line. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<Props>(node)) return textOf(node.props.children);
  return "";
}

const byTestId = (all: ReactElement<Props>[], id: string) => all.filter((element) => element.props["data-testid"] === id);
const named = (all: ReactElement<Props>[], name: string) => all.filter((element) => element.props.name === name);

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

async function race(memberBib: boolean): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Start",
      bibDesign: memberBib ? { member: { enabled: true, bandColour: "#6a1b9a" } } : null,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: "The cross" },
  ]);
  return event.id;
}

async function runner(eventId: string, options: { declared: boolean; bib: number; status?: RegistrationStatus; elite?: boolean }): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const status = options.status ?? "CONFIRMED";
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date("2026-11-01T10:00:00.000Z"),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      clubMemberDeclared: options.declared,
      elite: options.elite ?? false,
      bibNumber: options.bib,
      confirmedAt: new Date("2026-11-02T10:00:00.000Z"),
      ...(status === "CANCELLED" ? { cancelledAt: new Date("2026-11-03T10:00:00.000Z"), cancellationSource: "ADMIN" as const } : {}),
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function admin(): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `admin-${serial}@dev.test`, displayName: "Admin", role: "ADMIN" }).returning();
  return user;
}

const bibsPage = async (eventId: string) => elements(await EventBibsPage({ params: Promise.resolve({ locale: state.locale, id: eventId }) } as never));
const detailPage = async (id: string, searchParams: Record<string, string> = {}) =>
  elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(searchParams) } as never));
const entryPage = async () => elements(await NewRegistrationPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({}) } as never));

describe("§NNN the bibs page's print card counts the members' bibs by the tick", () => {
  it("counts the ticked, confirmed, unmarked runners — no account anywhere — offers the two parts, and draws them first", async () => {
    state.actor = await admin();
    const eventId = await race(true);
    const plain = await runner(eventId, { declared: false, bib: 1 });
    const memberA = await runner(eventId, { declared: true, bib: 2 });
    const memberB = await runner(eventId, { declared: true, bib: 3 });
    // Not on this sheet, so not in its count: a marked runner (the elite sheet's) and a cancelled one.
    await runner(eventId, { declared: true, bib: 4, elite: true });
    await runner(eventId, { declared: true, bib: 5, status: "CANCELLED" });

    const all = await bibsPage(eventId);
    const [sample] = byTestId(all, "bibs-member-sample");
    expect(sample).toBeDefined();
    expect(textOf(sample)).toContain(ro.Admin.bibs.memberSampleCaption.replace("{count}", "2"));
    expect(byTestId(all, "bibs-download-members")).toHaveLength(1);
    expect(byTestId(all, "bibs-download-others")).toHaveLength(1);
    // The «asked but not verified» line is gone with the state (§NNN).
    expect(byTestId(all, "bibs-member-unverified")).toHaveLength(0);
    // The grid: the members' pile first, as the paper prints it (§681).
    const grid = all.filter((element) => typeof element.props.src === "string" && String(element.props.src).includes("registration="));
    const order = grid.map((element) => /registration=([0-9a-f-]+)/.exec(String(element.props.src))?.[1]);
    expect(order).toEqual([memberA, memberB, plain]);
    expect(grid.map((element) => String(element.props.src).includes("&m=1"))).toEqual([true, true, false]);
  });

  it("counts nobody, and offers no part, while the design's switch is off — the ticks or not", async () => {
    state.actor = await admin();
    const eventId = await race(false);
    await runner(eventId, { declared: true, bib: 1 });
    await runner(eventId, { declared: false, bib: 2 });
    const all = await bibsPage(eventId);
    expect(byTestId(all, "bibs-member-sample")).toHaveLength(0);
    expect(byTestId(all, "bibs-download-members")).toHaveLength(0);
    expect(byTestId(all, "bibs-download-others")).toHaveLength(0);
  });
});

describe("§NNN the registration's page: «Număr de membru» by the rule, and «Modifică datele» without the wish", () => {
  it("says «Număr de membru» beside the number for the tick at an event that offers it — never without the tick, the design or for «Elită»", async () => {
    state.actor = await admin();
    const on = await race(true);
    const off = await race(false);
    const cases: Array<[string, boolean]> = [
      [await runner(on, { declared: true, bib: 1 }), true],
      [await runner(on, { declared: false, bib: 2 }), false],
      [await runner(on, { declared: true, bib: 3, elite: true }), false],
      [await runner(off, { declared: true, bib: 1 }), false],
    ];
    for (const [id, shown] of cases) {
      const line = byTestId(await detailPage(id), "member-bib");
      expect(line.length, id).toBe(shown ? 1 : 0);
      if (shown) expect(textOf(line[0])).toBe(ro.Admin.registrations.memberBib.printed);
    }
    state.locale = "en";
    expect(textOf(byTestId(await detailPage(cases[0][0]), "member-bib")[0])).toBe(en.Admin.registrations.memberBib.printed);
  });

  it("corrects the member tick in «Modifică datele» with no «Vreau numărul de membru» box, and says the tick decides the bib (ro, en)", async () => {
    state.actor = await admin();
    const eventId = await race(true);
    const id = await runner(eventId, { declared: true, bib: 1 });
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const catalogue = locale === "ro" ? ro : en;
      const all = await detailPage(id, { answers: "1" });
      const tick = named(all, "clubMemberDeclared");
      expect(tick, locale).toHaveLength(1);
      expect(tick[0].props.defaultChecked).toBe(true);
      // Its help says the tick decides the members' number too, where the event offers one.
      expect(tick[0].props.help).toBe(catalogue.Admin.registrations.answers.memberHelp.replace("{club}", CLUB_NAME));
      expect(String(tick[0].props.help)).toContain(locale === "ro" ? "Bifa decide și numărul membrilor" : "The tick also decides the members' number");
      expect(named(all, "memberBibWanted"), locale).toHaveLength(0);
      expect(named(all, "was.memberBibWanted"), locale).toHaveLength(0);
    }
  });
});

describe("§NNN the desk asks the bib's picture by the rule: a corrected tick is a new address", () => {
  // The review of §NNN: the preview keeps an answer an hour, and the desk's address carried `e=1` but never `m=1`.
  it("puts `m=1` in the desk's picture address for the tick at an event that offers it, and drops it once «Modifică datele» clears the tick", async () => {
    const actor = await admin();
    state.actor = actor;
    const on = await race(true);
    const off = await race(false);
    const member = await runner(on, { declared: true, bib: 1 });
    const plain = await runner(on, { declared: false, bib: 2 });
    const elite = await runner(on, { declared: true, bib: 3, elite: true });
    const designOff = await runner(off, { declared: true, bib: 1 });
    /** The address the desk's «Arată numărul» fold asks, for one runner of an event. */
    const pictureOf = async (eventId: string, id: string) => {
      const row = (await listDeskRegistrations(db, { eventId, query: "", locale: "ro" })).find((candidate) => candidate.id === id);
      expect(row, id).toBeDefined();
      const all = elements(await DeskRow({ row: row!, locale: "ro", back: "desk", eventId, minorSigns: { ro: false, en: false } }));
      const pictures = all.filter((element) => element.type === "img");
      expect(pictures, id).toHaveLength(1);
      return String(pictures[0].props.src);
    };

    const before = await pictureOf(on, member);
    expect(before).toContain("&m=1");
    expect(await pictureOf(on, plain)).not.toContain("&m=1");
    // An elite bib never wears the members' design (§897): `e=1`, never `m=1`.
    const elitePicture = await pictureOf(on, elite);
    expect(elitePicture).toContain("&e=1");
    expect(elitePicture).not.toContain("&m=1");
    expect(await pictureOf(off, designOff)).not.toContain("&m=1");

    // The tick corrected: the same runner, the same number and design — a new address, never the hour-old picture.
    await editRegistrationAnswers(db, actor, member, { clubMemberDeclared: false }, new Date("2026-11-17T10:00:00.000Z"));
    const after = await pictureOf(on, member);
    expect(after).not.toContain("&m=1");
    expect(after).not.toBe(before);
  });
});

describe("§NNN the staff entry asks the member tick alone", () => {
  it("draws «Sunt membru» and no «Vreau numărul de membru» at an event that offers the members' bib, in Română and in English", async () => {
    state.actor = await admin();
    await race(true);
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const all = await entryPage();
      expect(byTestId(all, "registration-new-form"), locale).toHaveLength(1);
      expect(named(all, "clubMemberDeclared"), locale).toHaveLength(1);
      expect(named(all, "memberBibWanted"), locale).toHaveLength(0);
      const words = all.map((element) => textOf(element.props.children)).join(" ");
      expect(words).not.toContain("Vreau numărul de membru");
      expect(words).not.toContain("I want the members' number");
    }
  });
});
