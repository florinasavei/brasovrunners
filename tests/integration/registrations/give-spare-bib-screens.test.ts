import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { SPARE_BIB_FIELD } from "@/modules/registrations/admin-service";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-038-01, BR-REQ-060-01 — «Dă-i un BIB gol» on a registration's page (the owner, 2026-11-19: «trebuie să pot
 * aloca numere dintre cele goale, adică astea — spre ex. 154 deja e la …»): a fold beside the number, offered on
 * a confirmed real registration whether or not its bib is printed, with a native select of the event's free spares —
 * lowest first, the lowest chosen — and one press behind the house's question, which says what happens: the runner wears
 * the number chosen, the old one is retired and its printed bib void, and the email is the answer pressed (§976). Hidden
 * when no spare is free or none was reserved; offered to a role that may not replace a number only on a row with none.
 *
 * The page is a Server Component: it is called and its element tree walked, as the other screen tests do.
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
const giveSpareBibAction = vi.hoisted(() => () => null);
vi.mock("@/app/[locale]/admin/registrations/[id]/spare-bib-actions", () => ({ giveSpareBibAction }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { default: RecallField } = await import("@/shared/forms/recall");
const { default: GlyphButton } = await import("@/shared/ui/GlyphButton");

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
let serial = 0;

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

async function register(eventId: string, options: { bibNumber: number | null; printed?: boolean; status?: "CONFIRMED" | "PENDING_DECLARATION"; kind?: "REAL" | "TEST" }) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const name = `Radu Pop ${serial}`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const status = options.status ?? "CONFIRMED";
  const [created] = await db
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
      status,
      bibNumber: options.bibNumber,
      bibPrintedAt: options.printed ? new Date("2026-11-17T10:00:00.000Z") : null,
      ...(status === "CONFIRMED" ? { confirmedAt: new Date() } : { emailConfirmedAt: new Date(), holdExpiresAt: new Date("2099-11-20T08:00:00.000Z") }),
    })
    .returning({ id: registrations.id, registeredName: registrations.registeredName });
  return created;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function detailPage(id: string) {
  return elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never));
}

const byTestId = (all: ReactElement<Props>[], id: string) => all.find((element) => element.props["data-testid"] === id);
const spareForm = (all: ReactElement<Props>[]) => all.find((element) => element.type === ActionForm && element.props["data-testid"] === "spare-bib-form");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§NNN «Dă-i un BIB gol» on the registration's page", () => {
  it("offers the free spares to a printed runner, lowest first and chosen, behind a question that says what happens", async () => {
    const race = await createRace();
    // 154 is on somebody already: the select starts at 155.
    await register(race.id, { bibNumber: 154, printed: true });
    const runner = await register(race.id, { bibNumber: 27, printed: true });
    state.actor = await staff("ADMIN");
    const all = await detailPage(runner.id);

    const form = spareForm(all);
    expect(form, "the fold's form").toBeDefined();
    expect(form?.props.action).toBe(giveSpareBibAction);
    // Inside the race-day card, beside the number.
    expect(elements(byTestId(all, "race-day")).includes(form as ReactElement<Props>)).toBe(true);
    const inside = elements(form);
    expect(textOf(byTestId(inside, "spare-bib-fold"))).toBe("Dă-i un BIB gol");

    const select = inside.find((element) => element.type === RecallField && element.props.name === SPARE_BIB_FIELD);
    expect(select?.props.select).toBe(true);
    expect((select?.props.slotProps as { select?: { native?: boolean } }).select?.native).toBe(true);
    expect(select?.props.defaultValue).toBe("155");
    const options = elements(select?.props.children as ReactNode).filter((element) => element.type === "option");
    expect(options.map((option) => [option.props.value, textOf(option.props.children)])).toEqual([
      ["155", "155"],
      ["156", "156"],
    ]);
    // Who, which registration: the desk's hidden fields, never a name or an address in the form.
    expect(inside.filter((element) => element.type === "input").map((element) => [element.props.name, element.props.value])).toEqual([
      ["uiLocale", "ro"],
      ["registrationId", runner.id],
    ]);
    // A thumb's target, by its glyph's name (§318).
    const press = inside.find((element) => element.type === GlyphButton && element.props.type === "submit");
    expect(press?.props.icon).toBe("number");
    expect((press?.props.sx as { minHeight?: number }).minHeight).toBe(44);
    expect(textOf(press?.props.children as ReactNode)).toBe("Dă-i BIB-ul");

    // The question: the number chosen is filled from the select at the press; the old one is retired, its paper void.
    const confirm = form?.props.confirm as Record<string, unknown>;
    expect(confirm.title).toBe("Îi dai BIB-ul gol?");
    expect(confirm.body).toBe(
      `${runner.registeredName} poartă de acum numărul {spareNumber}, de pe BIB-ul gol. Numărul 27 se retrage și nu se mai dă nimănui, iar BIB-ul tipărit cu el nu mai e valabil.`,
    );
    expect(confirm.fillFromChosen).toEqual([SPARE_BIB_FIELD]);
    expect(confirm.confirmLabel).toBe("Dă-i BIB-ul");
    expect(String(confirm.email)).toContain(runner.registeredName);
    expect(String(confirm.email)).toContain(ro.Admin.emails.types.BIB_ASSIGNED);
    // «Dă-i BIB-ul și trimite emailul» / «Dă-i BIB-ul fără email» (§976).
    expect(confirm.emailOptOut).toMatchObject({ field: "sendEmail" });

    // The number line no longer says a printed number never changes.
    expect(all.some((element) => textOf(element.props.children) === "Numărul de concurs: 27. E tipărit, deci se schimbă doar cu un BIB gol.")).toBe(true);
  });

  it("offers it on a number not printed too, the question naming the number retired, and in English", async () => {
    const race = await createRace();
    const runner = await register(race.id, { bibNumber: 3 });
    state.actor = await staff("ADMIN");
    let confirm = spareForm(await detailPage(runner.id))?.props.confirm as Record<string, unknown>;
    expect(confirm.body).toBe(`${runner.registeredName} poartă de acum numărul {spareNumber}, de pe BIB-ul gol. Numărul 3 se retrage și nu se mai dă nimănui.`);

    state.locale = "en";
    const all = await detailPage(runner.id);
    confirm = spareForm(all)?.props.confirm as Record<string, unknown>;
    expect(confirm.title).toBe("Give the blank bib?");
    expect(confirm.body).toBe(`${runner.registeredName} wears number {spareNumber} from now on, from the blank bib. Number 3 is retired and never given to anybody else.`);
    expect(textOf(byTestId(elements(spareForm(all)), "spare-bib-fold"))).toBe("Give a blank bib");
  });

  it("is not offered when every spare is given, when none was reserved, nor on a test row or one not confirmed", async () => {
    state.actor = await staff("ADMIN");
    const full = await createRace([154, 155]);
    await register(full.id, { bibNumber: 154 });
    await register(full.id, { bibNumber: 155 });
    const late = await register(full.id, { bibNumber: 9, printed: true });
    const latePage = await detailPage(late.id);
    expect(spareForm(latePage)).toBeUndefined();
    // No blank bib to give: the printed number's line keeps saying it no longer changes.
    expect(latePage.some((element) => textOf(element.props.children) === "Numărul de concurs: 9. E tipărit, deci nu se mai schimbă.")).toBe(true);

    const none = await createRace(null);
    const plain = await register(none.id, { bibNumber: 4, printed: true });
    expect(spareForm(await detailPage(plain.id))).toBeUndefined();

    const race = await createRace();
    const pending = await register(race.id, { bibNumber: null, status: "PENDING_DECLARATION" });
    expect(spareForm(await detailPage(pending.id))).toBeUndefined();
    const test = await register(race.id, { bibNumber: null, kind: "TEST" });
    expect(spareForm(await detailPage(test.id))).toBeUndefined();
  });

  it("offers the Organizer the fold only on a row with no number: replacing one is the Administrator's", async () => {
    const race = await createRace();
    const numbered = await register(race.id, { bibNumber: 27, printed: true });
    const gap = await register(race.id, { bibNumber: null });
    state.actor = await staff("MODERATOR");
    const numberedPage = await detailPage(numbered.id);
    expect(spareForm(numberedPage)).toBeUndefined();
    // Not the Organizer's to change: the line says it no longer changes, never «doar cu un BIB gol».
    expect(numberedPage.some((element) => textOf(element.props.children) === "Numărul de concurs: 27. E tipărit, deci nu se mai schimbă.")).toBe(true);
    const confirm = spareForm(await detailPage(gap.id))?.props.confirm as Record<string, unknown>;
    // No old number, so no sentence about one.
    expect(confirm.body).toBe(`${gap.registeredName} poartă de acum numărul {spareNumber}, de pe BIB-ul gol.`);
  });

  it("says on the timeline which blank bib was given and which number it retired", async () => {
    const race = await createRace();
    const runner = await register(race.id, { bibNumber: 154, printed: true });
    const admin = await staff("ADMIN");
    state.actor = admin;
    const audit = (metadata: Record<string, unknown>) =>
      db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "registration.bib_set", entityType: "registration", entityId: runner.id, metadataJson: { eventId: race.id, ...metadata } });
    await audit({ from: 27, to: 154, spare: true, printedReplaced: true });
    await audit({ from: null, to: 155, spare: true, printedReplaced: false });
    await audit({ from: 5, to: 156, spare: true, printedReplaced: false });
    const lines = elements(byTestId(await detailPage(runner.id), "audit-trail")).map((element) => textOf(element.props.children));
    expect(lines.some((line) => line.includes("BIB gol dat: 154, în locul numărului tipărit 27, retras"))).toBe(true);
    expect(lines.some((line) => line.includes("BIB gol dat: 155 ·"))).toBe(true);
    expect(lines.some((line) => line.includes("BIB gol dat: 156, în locul numărului 5, retras"))).toBe(true);
    // The label says both numbers; no second «— → 155» under it.
    expect(lines.some((line) => line.includes("→"))).toBe(false);
  });
});
