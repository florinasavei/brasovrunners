import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { checkInByStaff, recordCodeScan } from "@/modules/registrations/admin-service";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { checkIn } from "@/modules/registrations/service";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §996, BR-REQ-037-08 — the registration's own page (the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a
 * scanat, cine a marcat prezent»):
 *
 * - its trail «Ce a făcut echipa» names each scan of the code at the desk — «Cod scanat la masă» / “Code scanned at the desk” —
 *   with its moment and the account, like every other row, and the check-in's line says who marked the runner present, the
 *   person's own «Am ajuns» and an account gone since in words;
 * - «Deschide la masă» is the one link to the scanned page, and it is never prefetched and says it comes from this page
 *   (`from=registration`), so viewing a registration records no scan behind it.
 *
 * The page is a Server Component: it is called and its element tree walked, as the other screen tests do. The made-up people and
 * the desk accounts are nobody.
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
// A link the page draws keeps its props, so its address and its prefetch are read off the tree.
const Link = vi.hoisted(() => (props: Record<string, unknown>) => props.children ?? null);
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link }));
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

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first — a card's `aside` too. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  if (isValidElement(node.props.aside)) elements(node.props.aside as ReactNode, acc);
  elements(node.props.children, acc);
  return acc;
}
/** Every string under `node`, joined: the sentence a line writes. */
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Props>(node)) return text(node.props.children);
  return "";
}

const START = new Date("2099-11-21T07:00:00.000Z");
/** «08:12» on the club's clock (UTC+2 in November). */
const at = (clock: string) => new Date(`2099-11-21T${String(Number(clock.slice(0, 2)) - 2).padStart(2, "0")}:${clock.slice(3)}:00.000Z`);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let qr2: StaffUser;
let gone: StaffUser;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Coleg ADMIN", role: "ADMIN" }).returning();
  [qr2] = await db.insert(staffUsers).values({ email: "qr2@example.test", displayName: "QR2", role: "CONTRIBUTOR" }).returning();
  [gone] = await db.insert(staffUsers).values({ email: "gone@example.test", displayName: "Plecat", role: "CONTRIBUTOR" }).returning();
  state.actor = admin;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: START, locationName: "Start" })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul", title: "Crosul" },
    { eventId, locale: "en", slug: "cross", title: "The cross" },
  ]);
});

async function runner(name: string): Promise<{ id: string; participantId: string; code: string }> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const code = newCheckinCode();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: START,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: START,
      bibNumber: 27 + serial,
      checkinCode: code,
    })
    .returning({ id: registrations.id });
  return { id: row.id, participantId: participant.id, code };
}

const detail = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);
/** The trail's lines, each as one sentence. */
const trailLines = (tree: ReactNode) => {
  const panel = elements(tree).find((element) => element.props["data-testid"] === "audit-trail");
  return panel ? elements(panel.props.children).filter((element) => element.props.variant === "body2").map((element) => text(element)) : [];
};

describe("§996 the registration's own page", () => {
  it("names each scan of the code in its trail, with the moment and the account — in both languages", async () => {
    const ana = await runner("Ana Pop");
    await recordCodeScan(db, qr2, { id: ana.id, eventId, participantId: ana.participantId }, at("08:12"));
    await checkInByStaff(db, qr2, ana.id, "in", at("08:13"));
    const lines = trailLines(await detail(ana.id));
    const scan = lines.find((line) => line.includes("Cod scanat la masă"));
    expect(scan).toBeDefined();
    expect(scan).toMatch(/08:12 · Cod scanat la masă · QR2$/);
    expect(lines.some((line) => /08:13 · Marcat prezent · QR2$/.test(line))).toBe(true);
    state.locale = "en";
    expect(trailLines(await detail(ana.id)).some((line) => /08:12 · Code scanned at the desk · QR2$/.test(line))).toBe(true);
  });

  it("says who marked the runner present on the check-in's line: the account, the person's own «Am ajuns», an account gone since", async () => {
    const ana = await runner("Ana Pop");
    const ion = await runner("Ion Lupu");
    const eva = await runner("Eva Stan");
    await checkInByStaff(db, qr2, ana.id, "in", at("08:13"));
    await checkIn(db, ion.id, null, at("08:20"));
    await checkInByStaff(db, gone, eva.id, "in", at("08:25"));
    await db.delete(staffUsers).where(eq(staffUsers.id, gone.id));
    const line = async (id: string) => elements(await detail(id)).map((element) => text(element)).find((sentence) => sentence.startsWith("Prezent: "));
    expect(await line(ana.id)).toMatch(/· QR2$/);
    expect(await line(ion.id)).toMatch(/· prin „Am ajuns”$/);
    expect(await line(eva.id)).toMatch(/· cont șters$/);
  });

  it("links the scanned page once, never prefetched and from this page, so a view of the registration records no scan", async () => {
    const ana = await runner("Ana Pop");
    const links = elements(await detail(ana.id)).filter((element) => element.type === Link && (element.props.href as { pathname?: string } | undefined)?.pathname === "/admin/checkin/[code]");
    expect(links).toHaveLength(1);
    expect(links[0].props).toMatchObject({ prefetch: false, href: { pathname: "/admin/checkin/[code]", params: { code: ana.code }, query: { from: "registration" } } });
  });
});
