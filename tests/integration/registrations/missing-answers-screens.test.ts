import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { completeMissingAnswers } from "@/modules/registrations/complete-answers";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { TYPED_ANSWERS } from "../../helpers/missing-answers";

/**
 * BR-REQ-037-05 criteria 25–26 (§905) — «Date lipsă» in the backoffice: a registration still standing that lacks answers
 * the public form requires wears the chip on the registrations list's row and on its own page, for every role that reads
 * them; the page says which answers, in words, and — to the Administrator — how they are completed: by the person from
 * their own link, or typed through «Modifică datele». A complete registration, a cancelled one, and one completed since
 * wear nothing. The internal list's two dialogs say the details are asked when the person signs.
 *
 * The pages are Server Components, so they are called and their element trees walked, as `elite-mark-screens.test.ts` does.
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
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
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
const { default: ReserveListPanel } = await import("@/modules/registrations/ui/ReserveListPanel");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; render: (row: unknown) => ReactNode };

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

/** The words under `node`, as a reader meets them. */
function wordsOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => wordsOf(child as ReactNode)).join(" ");
  if (!isValidElement<Props>(node)) return "";
  return wordsOf(node.props.children);
}

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(capacity = 150) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "Crosul" },
  ]);
  return event;
}

/** Every answer the public form requires, as the form writes them. */
const FORM_ANSWERS = {
  source: "PUBLIC" as const,
  firstName: "Ana",
  lastName: "Pop",
  birthDate: "1990-05-01",
  sex: "FEMALE" as const,
  nationality: "RO",
  country: "RO",
  city: "Sibiu",
  phone: "+40711111111",
  emergencyContactName: "Ion Pop",
  emergencyContactPhone: "+40722222222",
  tshirtSize: "NONE" as const,
};

/** A staff entry's row: a name and an address, nothing the entry relaxes (§33, §888). */
const STAFF_ENTRY = { source: "STAFF" as const, firstName: "Mara", lastName: "Munteanu", tshirtSize: "NONE" as const };

let serial = 0;
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner${serial}@example.org`;
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
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
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

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
}

async function detailPage(id: string) {
  return RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);
}

/** The «Nume» cell of one row, walked: where the row's chips are. */
function nameCellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const table = elements(tree).find((element) => element.type === AdminTable);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  const column = (table?.props.columns as Column[]).find((candidate) => candidate.key === "name");
  return row && column ? elements(column.render(row)) : [];
}

const chipOf = (nodes: ReactElement<Props>[]) => nodes.find((element) => element.props.testId === "missing-answers-chip");
const lineOf = (nodes: ReactElement<Props>[]) => nodes.find((element) => element.props["data-testid"] === "missing-answers-line");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("BR-REQ-037-05 criterion 25: «Date lipsă» on the registrations list", () => {
  it("marks a standing registration that lacks answers, for every role that reads the list — never a complete or a cancelled one", async () => {
    const race = await createRace();
    const owing = await register(race.id, { ...STAFF_ENTRY, status: "PENDING_DECLARATION", holdExpiresAt: new Date("2099-11-01T00:00:00.000Z") });
    const confirmedOwing = await register(race.id, STAFF_ENTRY);
    const complete = await register(race.id, FORM_ANSWERS);
    const cancelled = await register(race.id, { ...STAFF_ENTRY, status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "ADMIN" });

    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      for (const id of [owing, confirmedOwing]) {
        const chip = chipOf(nameCellOf(tree, id));
        expect(chip?.props.label, role).toBe("Date lipsă");
        expect(chip?.props.glyph, role).toBe("missingAnswers");
      }
      expect(chipOf(nameCellOf(tree, complete)), role).toBeUndefined();
      expect(chipOf(nameCellOf(tree, cancelled)), role).toBeUndefined();
    }

    state.locale = "en";
    state.actor = await staff("ADMIN");
    expect(chipOf(nameCellOf(await listPage({ eventId: race.id }), owing))?.props.label).toBe("Missing details");
  });

  it("is gone once the person completes the answers from their own link", async () => {
    const race = await createRace();
    const owing = await register(race.id, STAFF_ENTRY);
    state.actor = await staff("ADMIN");
    expect(chipOf(nameCellOf(await listPage({ eventId: race.id }), owing))).toBeDefined();
    await completeMissingAnswers(db, owing, TYPED_ANSWERS, new Date(), "MANAGE_LINK");
    expect(chipOf(nameCellOf(await listPage({ eventId: race.id }), owing))).toBeUndefined();
  });
});

describe("BR-REQ-037-05 criterion 25: «Date lipsă» on the registration's page", () => {
  it("names the answers in words, and tells the Administrator how they are completed — the person's link, or «Modifică datele»", async () => {
    const race = await createRace();
    const owing = await register(race.id, STAFF_ENTRY);
    const words = ro.Admin.registrations.answers.fields;
    const named = [words.birthDate, words.city, words.sex, words.nationality, words.phone, words.emergencyContactName, words.emergencyContactPhone];

    state.actor = await staff("ADMIN");
    const admin = elements(await detailPage(owing));
    expect(chipOf(admin)?.props.label).toBe("Date lipsă");
    const line = wordsOf(lineOf(admin));
    for (const field of named) expect(line).toContain(field);
    expect(line).toContain(ro.Admin.registrations.missingAnswers.how);

    // The Organizer reads the same answers missing, and is not told to act on them.
    state.actor = await staff("MODERATOR");
    const organizer = wordsOf(lineOf(elements(await detailPage(owing))));
    expect(organizer).toContain(words.birthDate);
    expect(organizer).toContain(ro.Admin.registrations.missingAnswers.hint);
    expect(organizer).not.toContain(ro.Admin.registrations.missingAnswers.how);

    state.locale = "en";
    state.actor = await staff("ADMIN");
    const english = elements(await detailPage(owing));
    expect(chipOf(english)?.props.label).toBe("Missing details");
    expect(wordsOf(lineOf(english))).toContain(en.Admin.registrations.missingAnswers.how);
  });

  it("a registration the public form wrote: no chip and no line; one completed since: neither any more", async () => {
    const race = await createRace();
    const complete = await register(race.id, FORM_ANSWERS);
    const owing = await register(race.id, STAFF_ENTRY);
    state.actor = await staff("ADMIN");
    const page = elements(await detailPage(complete));
    expect(chipOf(page)).toBeUndefined();
    expect(lineOf(page)).toBeUndefined();

    await completeMissingAnswers(db, owing, TYPED_ANSWERS, new Date(), "MANAGE_LINK");
    const completed = elements(await detailPage(owing));
    expect(chipOf(completed)).toBeUndefined();
    expect(lineOf(completed)).toBeUndefined();
  });
});

describe("BR-REQ-037-05 criterion 26: the internal list's dialogs say the details are asked at the signature", () => {
  it("«Mută pe lista oficială» and «Oferă-i un loc acum» each say it, in both languages", async () => {
    const race = await createRace(1);
    const entry = { id: "00000000-0000-4000-8000-000000000001", eventId: race.id, firstName: "Luca", lastName: "Ionescu", email: "luca@example.ro", note: null, partnerName: null, createdAt: new Date(), createdByName: "Admin" };
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      state.locale = locale;
      const panel = await ReserveListPanel({
        locale,
        eventId: race.id,
        entries: [entry],
        addAction: vi.fn(),
        saveNoteAction: vi.fn(),
        deleteAction: vi.fn(),
        moveAction: vi.fn(),
        opened: true,
      });
      const move = elements(panel).find((element) => element.props["data-testid"] === "reserve-move-form");
      const questions = move?.props.confirm as ConfirmSpec[];
      // The offer's question and the move's: both, each with the sentence.
      expect(questions).toHaveLength(2);
      for (const question of questions) expect(question.body, question.title).toContain(catalogue.Admin.reserve.detailsAtSigning);
      // …which says the person checks the full name the club typed as well (§907).
      expect(catalogue.Admin.reserve.detailsAtSigning).toContain(locale === "ro" ? "își verifică numele complet" : "checks their full name");
    }
  });
});
