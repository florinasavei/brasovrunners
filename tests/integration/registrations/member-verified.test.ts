import { isValidElement, type ReactElement, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { countRegistrationsForAdmin, listRegistrationsForAdmin, summariseRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §662 (amending §650, §524) — «membru declarat» and «membru verificat», from a real database:
 *
 * - a registration whose canonical address is a member account's (a live row on «Echipa») is
 *   «Membru (verificat)», whatever its tick; a ticked one with no account is «Membru (declarat)»;
 *   neither shows no chip. The list's row and the registration's page draw the same chip, its
 *   sentence as the tooltip;
 * - the match goes through the canonicalizer (AGENTS.md §10.4): a plus tag and `googlemail.com`
 *   still match, a Gmail dot does not (version 2 keeps the dots, §74);
 * - «Doar membrii {club}» keeps both kinds, and the count and the strip agree with it;
 * - a staff-entered row and a test row are verified by the same rule;
 * - an account removed from «Echipa» stops verifying at once: derived, never stored;
 * - the export's «Club member» reads verified / declared / empty.
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
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: MemberChip } = await import("@/modules/registrations/ui/MemberChip");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

type Props = Record<string, unknown> & { children?: ReactNode };

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
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
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

/** A registration whose participant's identity is what the canonicalizer makes of `typed`, as the form stores it. */
async function register(eventId: string, name: string, typed: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  const email = canonicalizeEmail(typed);
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email.deliveryEmail,
      normalizedEmail: email.normalizedEmail,
      canonicalEmail: email.canonicalEmail,
      canonicalizationVersion: email.canonicalizationVersion,
      defaultName: name,
      preferredLocale: "ro",
    })
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
      clubMemberDeclared: false,
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function account(email: string, role: StaffUser["role"] = "MEMBER"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: email, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
}

/** Each listed row's member chip, by name: `null` when the row draws none. */
async function chipsOn(searchParams: Record<string, string>) {
  const tree = await listPage(searchParams);
  const table = elements(tree).find((element) => element.type === AdminTable);
  const rows = (table?.props.rows ?? []) as { id: string; registeredName: string }[];
  const name = (table?.props.columns as { key: string; render: (row: unknown) => ReactNode }[]).find((column) => column.key === "name");
  return new Map(
    rows.map((row) => {
      const chips = elements(name?.render(row)).filter((element) => element.type === MemberChip);
      expect(chips.length, row.registeredName).toBeLessThanOrEqual(1);
      return [row.registeredName, chips[0]?.props ?? null] as const;
    }),
  );
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.actor = await account("organiser@dev.test", "ADMIN");
});

describe("§662: a member is declared or verified (BR-REQ-037-03)", () => {
  it("draws «verificat» for a member account's address whatever the tick, «declarat» for the tick alone, nothing for neither", async () => {
    const race = await createRace("Crosul");
    await account("ana.pop@gmail.com");
    await account("dan@example.org");
    await register(race.id, "Ana Verificata", "ana.pop@gmail.com");
    await register(race.id, "Dan Bifat", "dan@example.org", { clubMemberDeclared: true });
    await register(race.id, "Ion Declarat", "ion@example.org", { clubMemberDeclared: true });
    await register(race.id, "Eva Nimic", "eva@example.org");

    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = (locale === "ro" ? ro : en).Admin.registrations.member;
      const chips = await chipsOn({ eventId: race.id });
      expect(chips.get("Ana Verificata")).toMatchObject({ membership: "verified", label: words.verified, hint: words.verifiedHint });
      expect(chips.get("Dan Bifat")).toMatchObject({ membership: "verified", label: words.verified, hint: words.verifiedHint });
      expect(chips.get("Ion Declarat")).toMatchObject({ membership: "declared", label: words.declared, hint: words.declaredHint });
      expect(chips.get("Eva Nimic")).toBeNull();
    }
  });

  it("matches through the canonicalizer: a plus tag and googlemail still match, a Gmail dot does not (version 2)", async () => {
    const race = await createRace("Crosul");
    await account("ana.pop@gmail.com");
    await register(race.id, "Plus Tag", "Ana.Pop+crosul@googlemail.com");
    await register(race.id, "Fara Punct", "anapop@gmail.com");
    const chips = await chipsOn({ eventId: race.id });
    expect(chips.get("Plus Tag")).toMatchObject({ membership: "verified" });
    expect(chips.get("Fara Punct")).toBeNull();
  });

  it("keeps both kinds under «Doar membrii {club}», and the count and the strip agree", async () => {
    const race = await createRace("Crosul");
    await account("member@example.org");
    await register(race.id, "Verified", "member@example.org");
    await register(race.id, "Declared", "ticked@example.org", { clubMemberDeclared: true });
    await register(race.id, "Neither", "other@example.org");

    const chips = await chipsOn({ eventId: race.id, clubMember: "1" });
    expect([...chips.keys()].sort()).toEqual(["Declared", "Verified"]);
    expect(await countRegistrationsForAdmin(db, { eventId: race.id, clubMember: true })).toBe(2);
    expect((await summariseRegistrationsForAdmin(db, { eventId: race.id, clubMember: true })).real).toBe(2);
    // With no member account at all the filter is the tick alone — never an `IN ()`.
    await db.delete(staffUsers).where(eq(staffUsers.email, "member@example.org"));
    const ticked = await listRegistrationsForAdmin(db, { eventId: race.id, clubMember: true, members: [] });
    expect(ticked.map((row) => row.registeredName)).toEqual(["Declared"]);
    expect(ticked[0].memberVerified).toBe(false);
  });

  it("verifies a staff-entered row and a test row by the same rule", async () => {
    const race = await createRace("Crosul");
    await account("member@example.org");
    await account("tester@example.org");
    await register(race.id, "Entered By Staff", "member@example.org", { source: "STAFF" });
    await register(race.id, "Test Row", "tester@example.org", { kind: "TEST" });
    const chips = await chipsOn({ eventId: race.id });
    expect(chips.get("Entered By Staff")).toMatchObject({ membership: "verified" });
    expect(chips.get("Test Row")).toMatchObject({ membership: "verified" });
  });

  it("stops verifying the moment the account is removed from «Echipa»: derived, never stored", async () => {
    const race = await createRace("Crosul");
    await account("member@example.org");
    await register(race.id, "Was Member", "member@example.org", { clubMemberDeclared: true });
    await register(race.id, "Never Ticked", "member2@example.org");
    await account("member2@example.org");
    expect((await chipsOn({ eventId: race.id })).get("Was Member")).toMatchObject({ membership: "verified" });

    await db.delete(staffUsers).where(eq(staffUsers.email, "member@example.org"));
    await db.delete(staffUsers).where(eq(staffUsers.email, "member2@example.org"));
    const after = await chipsOn({ eventId: race.id });
    expect(after.get("Was Member")).toMatchObject({ membership: "declared" });
    expect(after.get("Never Ticked")).toBeNull();
  });

  it("draws the same chip on the registration's page", async () => {
    const race = await createRace("Crosul");
    await account("member@example.org");
    const verified = await register(race.id, "Verified", "member@example.org");
    const declared = await register(race.id, "Declared", "ticked@example.org", { clubMemberDeclared: true });
    const neither = await register(race.id, "Neither", "other@example.org");
    const chipOf = async (id: string) => {
      const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
      return elements(tree).filter((element) => element.type === MemberChip).map((element) => element.props);
    };
    expect(await chipOf(verified)).toEqual([expect.objectContaining({ membership: "verified", label: ro.Admin.registrations.member.verified })]);
    expect(await chipOf(declared)).toEqual([expect.objectContaining({ membership: "declared", label: ro.Admin.registrations.member.declared })]);
    expect(await chipOf(neither)).toEqual([]);
  });

  it("writes «Club member» in the export as verified, declared or empty, and filters it like the list", async () => {
    const race = await createRace("Crosul");
    await account("member@example.org");
    await register(race.id, "Verified", "member@example.org");
    await register(race.id, "Declared", "ticked@example.org", { clubMemberDeclared: true });
    await register(race.id, "Neither", "other@example.org");

    const cells = async (query: string) => {
      const csv = await (await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${race.id}${query}`))).text();
      const [header, ...lines] = csv.split("\r\n").filter((line) => line !== "");
      const at = header.split(",").indexOf("Club member");
      expect(at).toBe(7);
      return new Map(lines.map((line) => [line.split(",")[1], line.split(",")[at]]));
    };
    expect(await cells("")).toEqual(new Map([["Verified", "verified"], ["Declared", "declared"], ["Neither", ""]]));
    expect([...(await cells("&clubMember=1")).keys()].sort()).toEqual(["Declared", "Verified"]);
  });
});
