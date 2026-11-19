import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §992, BR-REQ-038-01 — an invitation's blank bib on the registration's page: under «Înscriere pe invitație — trimisă de …»,
 * what the invitation's «La confirmare primește un BIB gol» will do before the confirmation, and after it which spare the
 * confirmation gave, or that none was free and which ordinary number came; the trail («Ce a făcut echipa») says the same in
 * its own words with the number, under the Administrator who sent the invitation. Both languages; nothing for an
 * invitation sent without the tick, nor for a test registration.
 *
 * The page is a Server Component: it is called and its element tree walked, as the other screen tests do. The confirmation
 * is the desk's real one (`confirmRegistrationByStaff`), so the trail's row is the one the service writes.
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
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
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
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/spare-bib-actions", () => ({ giveSpareBibAction: () => null }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { confirmRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");

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

/** The text a node's children spell, strings and numbers only. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<Props>(node)) return textOf(node.props.children);
  return "";
}

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let desk: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  state.locale = "ro";
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: new Date() });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [desk] = await db.insert(staffUsers).values({ email: "desk@dev.test", displayName: "Desk", role: "CONTRIBUTOR" }).returning();
  state.actor = admin;
});

async function createRace(spare: [number, number] | null = [154, 156]) {
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
      walkInBibStart: spare ? spare[0] : null,
      walkInBibCount: spare ? spare[1] - spare[0] + 1 : null,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-ro-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `crosul-en-${event.id.slice(0, 8)}`, title: "Crosul" },
  ]);
  return event;
}

/**
 * A registration waiting for its declaration (or confirmed, wearing `bibNumber`), and the accepted invitation it came from —
 * sent by the Administrator, with the blank-bib tick or not.
 */
async function invited(eventId: string, options: { blankBib: boolean; kind?: "REAL" | "TEST"; bibNumber?: number }) {
  serial += 1;
  const email = `invited${serial}@example.org`;
  const name = `Ana Pop ${serial}`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const confirmed = options.bibNumber !== undefined;
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: options.kind ?? "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: true,
      resultsConsentVersion: 1,
      status: confirmed ? "CONFIRMED" : "PENDING_DECLARATION",
      emailConfirmedAt: new Date(),
      ...(confirmed ? { confirmedAt: new Date(), bibNumber: options.bibNumber } : { holdExpiresAt: new Date("2099-11-20T08:00:00.000Z") }),
    })
    .returning({ id: registrations.id, registeredName: registrations.registeredName });
  await db.insert(eventInvitations).values({
    eventId,
    participantId: participant.id,
    name,
    email,
    canonicalEmail: email,
    invitedByStaffUserId: admin.id,
    sentAt: new Date("2026-11-19T09:00:00.000Z"),
    expiresAt: new Date("2099-11-20T08:00:00.000Z"),
    lastSentAt: new Date("2026-11-19T09:00:00.000Z"),
    blankBib: options.blankBib,
    acceptedAt: new Date("2026-11-19T10:00:00.000Z"),
    acceptedRegistrationId: registration.id,
  });
  return registration;
}

async function detailPage(id: string) {
  return elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never));
}

const byTestId = (all: ReactElement<Props>[], id: string) => all.find((element) => element.props["data-testid"] === id);
const lineOf = async (id: string) => textOf(byTestId(await detailPage(id), "registration-invitation-blank-bib")?.props.children);
const trailLines = async (id: string) => elements(byTestId(await detailPage(id), "audit-trail")).map((element) => textOf(element.props.children));

describe("§992 the registration's page says what its invitation's blank bib did", () => {
  it("before the confirmation, what it will do; after it, the spare given — on the page and in the trail, under the sender", async () => {
    const race = await createRace();
    const ana = await invited(race.id, { blankBib: true });
    expect(await lineOf(ana.id)).toBe("Invitația îi dă un BIB gol la confirmare: cel mai mic liber atunci.");

    await confirmRegistrationByStaff(db, desk, ana.id, new Date());
    expect(await lineOf(ana.id)).toBe("La confirmare a primit BIB-ul gol 154, cum cerea invitația.");
    const lines = await trailLines(ana.id);
    expect(lines.some((line) => line.includes("BIB gol dat la confirmare, cum cerea invitația · Ana Admin · nr. 154"))).toBe(true);

    state.locale = "en";
    expect(await lineOf(ana.id)).toBe("At confirmation, got blank bib 154, as the invitation asked.");
    expect((await trailLines(ana.id)).some((line) => line.includes("Blank bib given at confirmation, as the invitation asked · Ana Admin · no. 154"))).toBe(true);
  });

  it("no spare free at the confirmation: which ordinary number came, on the page and in the trail", async () => {
    const race = await createRace([154, 154]);
    await invited(race.id, { blankBib: false, bibNumber: 154 });
    const ana = await invited(race.id, { blankBib: true });
    await confirmRegistrationByStaff(db, desk, ana.id, new Date());
    expect(await lineOf(ana.id)).toBe("Invitația cerea un BIB gol, dar la confirmare nu mai era niciunul liber: a primit numărul 1.");
    expect((await trailLines(ana.id)).some((line) => line.includes("Niciun BIB gol liber la confirmare: numărul obișnuit, deși invitația cerea unul gol · Ana Admin · nr. 1"))).toBe(true);
    state.locale = "en";
    expect(await lineOf(ana.id)).toBe("The invitation asked for a blank bib, but none was free at confirmation: got number 1.");
  });

  it("before the confirmation in English; nothing for an invitation without the tick, nor for a test registration", async () => {
    const race = await createRace();
    state.locale = "en";
    expect(await lineOf((await invited(race.id, { blankBib: true })).id)).toBe("The invitation gives a blank bib at confirmation: the lowest one free then.");
    state.locale = "ro";
    const plain = await invited(race.id, { blankBib: false });
    expect(byTestId(await detailPage(plain.id), "registration-invitation-blank-bib")).toBeUndefined();
    // The invitation's own line is there all the same.
    expect(byTestId(await detailPage(plain.id), "registration-invited")).toBeDefined();
    const test = await invited(race.id, { blankBib: true, kind: "TEST" });
    expect(byTestId(await detailPage(test.id), "registration-invitation-blank-bib")).toBeUndefined();
  });
});
