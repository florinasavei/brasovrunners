import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, registrationStatus } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { STATUS_GLYPHS } from "@/shared/ui/status-glyphs";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §847 — the registration's own page as cards (the owner, 2026-10-21, of the backoffice: «they look like they
 * are from a different app, not consistent at all»): every section a `Panel` with its glyph, in the order a reader
 * needs them, the rarely opened ones folded, each verb in its card and gated exactly as before; and one state chip
 * (`RegistrationStatusChip`) for the list, the page and the desk.
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
  // «Adaugă pe lista de așteptare» (§NNN): the list page and the queue panel import it; not under test here.
  addToWaitlistAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
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
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: Panel } = await import("@/shared/ui/Panel");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { default: WhatToTell } = await import("@/modules/registrations/ui/WhatToTell");
const { default: NotesCard } = await import("@/modules/registrations/ui/NotesCard");
const { default: RegistrationStatusChip, REGISTRATION_STATUS_CHIP } = await import("@/modules/registrations/ui/RegistrationStatusChip");

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

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace() {
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
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "Crosul" },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, status: "CONFIRMED" | "CANCELLED") {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
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
      resultsNameConsent: true,
      resultsConsentVersion: 1,
      status,
      bibNumber: status === "CONFIRMED" ? serial : null,
      confirmedAt: new Date(),
      ...(status === "CANCELLED" ? { cancelledAt: new Date(), cancellationSource: "ADMIN" as const } : {}),
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function detailPage(id: string) {
  return elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never));
}

const byTestId = (all: ReactElement<Props>[], id: string) => all.find((element) => element.props["data-testid"] === id);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§847 the registration's page: every section a card", () => {
  it("in the order a reader needs them, the rare ones folded, the erase red — the Administrator's", async () => {
    const race = await createRace();
    const id = await register(race.id, "CONFIRMED");
    state.actor = await staff("ADMIN");
    const all = await detailPage(id);
    const at = (predicate: (element: ReactElement<Props>) => boolean) => all.findIndex(predicate);
    const card = (testId: string) => at((element) => element.type === Panel && element.props["data-testid"] === testId);

    const order = [
      at((element) => element.type === WhatToTell),
      at((element) => element.props["data-testid"] === "resend-form"),
      card("race-day"),
      card("emails-section"),
      at((element) => element.type === NotesCard),
      card("answers"),
      at((element) => element.type === Panel && element.props.id === "emergency"),
      card("timeline"),
      card("withdraw-consent"),
      card("cancel-registration"),
      card("erase-registration"),
    ];
    expect(order.every((index) => index >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // No bare heading left between the cards: every section's title is a card's.
    expect(all.filter((element) => element.props.variant === "h3")).toHaveLength(0);
    const panels = all.filter((element) => element.type === Panel && element.props.variant !== "help");
    for (const panel of panels) expect(panel.props.glyph, String(panel.props.title)).toEqual(expect.any(String));

    // The daily work open; what is read when somebody asks, and the three verbs that end or take away, folded.
    expect(byTestId(all, "race-day")?.props.collapsible).toBeFalsy();
    expect(byTestId(all, "answers")?.props.collapsible).toBeFalsy();
    expect(byTestId(all, "timeline")?.props.collapsible).toBeFalsy();
    for (const testId of ["emails-section", "withdraw-consent", "cancel-registration", "erase-registration"]) {
      expect(byTestId(all, testId)?.props.collapsible, testId).toBe(true);
    }
    expect(byTestId(all, "erase-registration")?.props.tone).toBe("danger");
  });

  it("keeps each folded verb's required reason inside its own form, so `ActionForm` opens the fold on a refusal", async () => {
    const race = await createRace();
    const id = await register(race.id, "CONFIRMED");
    state.actor = await staff("ADMIN");
    const all = await detailPage(id);
    for (const [card, form] of [
      ["withdraw-consent", "withdraw-consent-form"],
      ["cancel-registration", "cancel-registration-form"],
      ["erase-registration", "erase-registration-form"],
    ] as const) {
      const inside = elements(byTestId(all, card));
      const actionForm = inside.find((element) => element.type === ActionForm && element.props["data-testid"] === form);
      expect(actionForm, card).toBeDefined();
      const required = elements(actionForm).filter((element) => element.props.required === true);
      expect(required.map((element) => element.props.name), card).toContain("reason");
    }
  });

  it("draws the same cards and gates for the Organizer: no withdraw, cancel or erase, race day and the answers as before", async () => {
    const race = await createRace();
    const id = await register(race.id, "CONFIRMED");
    state.actor = await staff("MODERATOR");
    const all = await detailPage(id);
    for (const testId of ["withdraw-consent", "cancel-registration", "erase-registration", "resend-form"]) expect(byTestId(all, testId), testId).toBeUndefined();
    expect(byTestId(all, "race-day")).toBeDefined();
    expect(byTestId(all, "answers")).toBeDefined();
    expect(byTestId(all, "answers-open")?.props.children).toBe("Arată datele");
  });

  it("draws no race-day card on a registration that is over, and folds what the team did with its count", async () => {
    const race = await createRace();
    const id = await register(race.id, "CANCELLED");
    const admin = await staff("ADMIN");
    state.actor = admin;
    await db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "registration.cancelled_by_staff", entityType: "registration", entityId: id, metadataJson: { reason: "nu mai vine" } });
    const all = await detailPage(id);
    expect(byTestId(all, "race-day")).toBeUndefined();
    const trail = byTestId(all, "audit-trail");
    expect(trail?.props.title).toBe(ro.Admin.registrations.auditTrail);
    expect(trail?.props.collapsible).toBe(true);
    expect(trail?.props.aside).toBe("1 acțiune");
    // An ended registration can be erased still, and not cancelled again.
    expect(byTestId(all, "erase-registration")).toBeDefined();
    expect(byTestId(all, "cancel-registration")).toBeUndefined();
  });
});

describe("§847 one state chip for a registration", () => {
  it("names every state with a glyph from the backoffice's table and the backoffice's word", () => {
    for (const status of registrationStatus.enumValues) {
      const chip = REGISTRATION_STATUS_CHIP[status];
      expect(chip.label, status).toBe(REGISTRATION_STATUS_LABEL[status]);
      expect(chip.glyph in STATUS_GLYPHS, status).toBe(true);
    }
    // Each state its own picture: a glance tells them apart.
    expect(new Set(Object.values(REGISTRATION_STATUS_CHIP).map((chip) => chip.glyph)).size).toBe(registrationStatus.enumValues.length);
  });

  it("is the chip beside the name on the registration's page", async () => {
    const race = await createRace();
    const id = await register(race.id, "CONFIRMED");
    state.actor = await staff("ADMIN");
    const all = await detailPage(id);
    const chips = all.filter((element) => element.type === RegistrationStatusChip);
    expect(chips).toHaveLength(1);
    expect(chips[0].props.status).toBe("CONFIRMED");
  });
});

describe("§847 the page as it is drawn", () => {
  it("renders one heading per card, under the person's name, in the page's order", async () => {
    const race = await createRace();
    const id = await register(race.id, "CONFIRMED");
    state.actor = await staff("ADMIN");
    const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    // The cards hold async Server Components (the notes, the paper's «i»): rendered the way the server streams them.
    const { prelude } = await prerenderToNodeStream(createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as never, tree));
    let html = "";
    for await (const chunk of prelude) html += String(chunk);
    const headings = [...html.matchAll(/<(h[23])[^>]*>([\s\S]*?)<\/\1>/g)].map(([, level, inner]) => `${level} ${inner.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "")}`);
    const words = ro.Admin.registrations;
    expect(headings).toEqual([
      expect.stringMatching(/^h2 Runner \d+$/),
      `h3 ${words.tell.title}`,
      `h3 ${words.raceDayTitle}`,
      `h3 ${words.emails.title}0 emailuri`,
      `h3 ${words.notes.title}nicio notă`,
      `h3 ${words.answers.title}`,
      `h3 ${words.emergency.title}`,
      `h3 ${words.timeline}`,
      `h3 ${words.withdraw.title}`,
      `h3 ${words.cancelTitle}`,
      `h3 ${words.deleteTitle}`,
    ]);
  });
});
