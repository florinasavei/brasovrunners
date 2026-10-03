import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §641 (amending §79, §629; the owner, 2026-10-02: «vreau să pot retrimite orice pas») — «Retrimite
 * emailul» covers the waiting list: one `WAITLIST_JOINED`, rendered at send time with the standing
 * of that moment, in the registration's own language, and nothing else changes. The registration's
 * page offers the button for a waiting row and the dialog says which email the press sends.
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
  // «Datele înscrierii» (§645), folding «Corectează numele».
  editRegistrationAnswersAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  // The member tick and its sweep (§645).
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  declarationHoldAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { resendRegistrationMessage } = await import("@/modules/registrations/admin-service");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
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

const NOW = new Date("2026-10-02T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
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
  serial = 0;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 1, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
  const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

async function person(status: RegistrationStatus, waitlistedAt: Date | null, locale: "ro" | "en" = "ro") {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${serial}`, preferredLocale: locale })
    .returning();
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status,
      locale,
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
      waitlistedAt,
    })
    .returning();
  return registration;
}

const admin = () => ({ id: (state.actor as StaffUser).id, role: "ADMIN" as const });

const outboxOf = (registrationId: string) => db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId)).orderBy(emailOutbox.createdAt);

describe("§641 the resend of a waiting row", () => {
  it("queues one WAITLIST_JOINED, marked as a manual resend, in the registration's language, and changes nothing", async () => {
    await person("WAITLISTED", at(-3));
    const mine = await person("WAITLISTED", at(-2), "en");

    await resendRegistrationMessage(db, admin(), mine.id, NOW);

    const rows = await outboxOf(mine.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ messageType: "WAITLIST_JOINED", locale: "en", isManualResend: true, requestedByStaffUserId: (state.actor as StaffUser).id });
    // The first send's key is `registration:<id>:...` of its own; a resend is a new trigger (§12.11).
    expect(rows[0].idempotencyKey).toContain(":manual-resend:");

    const [after] = await db.select().from(registrations).where(eq(registrations.id, mine.id));
    expect(after.status).toBe("WAITLISTED");
    expect(after.waitlistedAt?.getTime()).toBe(at(-2).getTime());
    // Nobody else was written to.
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });

  it("says the standing of the moment it is sent: two people ahead gone, the resend says the new place", async () => {
    const cancels = await person("WAITLISTED", at(-4));
    const offered = await person("WAITLISTED", at(-3));
    const mine = await person("WAITLISTED", at(-2));
    await person("WAITLISTED", at(-1));

    await resendRegistrationMessage(db, admin(), mine.id, NOW);
    const [first] = await outboxOf(mine.id);
    expect((await renderOutboxMessage(first, db, NOW)).text).toContain("erai pe locul 3 din 4.");

    // Two people ahead leave the line: one cancels, one is offered the place.
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, cancels.id));
    await db.update(registrations).set({ status: "WAITLIST_OFFERED" }).where(eq(registrations.id, offered.id));

    await resendRegistrationMessage(db, admin(), mine.id, at(2));
    const rows = await outboxOf(mine.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].idempotencyKey).not.toBe(rows[0].idempotencyKey);
    const message = await renderOutboxMessage(rows[1], db, at(2));
    expect(message.text).toContain("erai pe locul 1 din 2.");
    expect(message.text).not.toContain("locul 3 din 4");
  });

  it("mints a new «Nu mai pot ajunge» manage link and supersedes the earlier email's, changing no state (BR-REQ-036-02 c5, §558)", async () => {
    await person("WAITLISTED", at(-3));
    const mine = await person("WAITLISTED", at(-2));
    const tokens = () =>
      db
        .select()
        .from(emailActionTokens)
        .where(and(eq(emailActionTokens.registrationId, mine.id), eq(emailActionTokens.purpose, "MANAGE_REGISTRATION")))
        .orderBy(emailActionTokens.createdAt);

    await resendRegistrationMessage(db, admin(), mine.id, NOW);
    const [first] = await outboxOf(mine.id);
    expect((await renderOutboxMessage(first, db, NOW)).text).toContain("Nu mai pot");
    const afterFirst = await tokens();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].invalidatedAt).toBeNull();

    await resendRegistrationMessage(db, admin(), mine.id, at(2));
    const rows = await outboxOf(mine.id);
    expect((await renderOutboxMessage(rows[1], db, at(2))).text).toContain("Nu mai pot");
    const afterSecond = await tokens();
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[0].invalidatedAt).not.toBeNull();
    expect(afterSecond[0].supersededByTokenId).toBe(afterSecond[1].id);
    expect(afterSecond[1].invalidatedAt).toBeNull();

    const [after] = await db.select().from(registrations).where(eq(registrations.id, mine.id));
    expect(after.status).toBe("WAITLISTED");
  });

  it("with the count kept private (§634), the resent email says neither a place nor a count", async () => {
    await db.update(events).set({ waitlistCountPublic: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(-3));
    await person("WAITLISTED", at(-2));
    const mine = await person("WAITLISTED", at(-1));
    await resendRegistrationMessage(db, admin(), mine.id, NOW);
    const [row] = await outboxOf(mine.id);
    const { text } = await renderOutboxMessage(row, db, NOW);
    expect(text).toContain("erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(text).not.toContain("erai pe locul");
    expect(text).not.toMatch(/din 3|singura persoană|mai aștept/);
  });

  it("with the club choosing whom to offer, says how many others wait and no position (§629)", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(-3));
    const mine = await person("WAITLISTED", at(-2));
    await resendRegistrationMessage(db, admin(), mine.id, NOW);
    const [row] = await outboxOf(mine.id);
    const message = await renderOutboxMessage(row, db, NOW);
    expect(message.text).toContain("pe lista de așteptare mai aștepta o altă persoană.");
    expect(message.text).not.toContain("erai pe locul");
  });

  it("refuses the others' messages: a reminder for a waiting row, and an Organizer's press", async () => {
    const mine = await person("WAITLISTED", at(-2));
    await expect(resendRegistrationMessage(db, admin(), mine.id, NOW, "EVENT_REMINDER")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
    await expect(resendRegistrationMessage(db, { id: admin().id, role: "MODERATOR" }, mine.id, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
    );
    expect(await outboxOf(mine.id)).toHaveLength(0);
  });

  it("refuses a cancelled event: nothing is offered there, and its participants were told (§331)", async () => {
    const mine = await person("WAITLISTED", at(-2));
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, eventId));
    await expect(resendRegistrationMessage(db, admin(), mine.id, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
    expect(await outboxOf(mine.id)).toHaveLength(0);
  });

  it("leaves its trail: the audit rows name no new action, the row names the message type", async () => {
    const mine = await person("WAITLISTED", at(-2));
    await resendRegistrationMessage(db, admin(), mine.id, NOW, undefined, "queue");
    const [row] = await outboxOf(mine.id);
    expect(row.messageType).toBe("WAITLIST_JOINED");
    // Queued, not sent now: no «sent now» row (§540); the press is the outbox row's own marks.
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, mine.id))).filter((entry) => entry.action === "registration.sent_now")).toHaveLength(0);
  });
});

describe("§641 the registration's page", () => {
  async function resendForm(id: string, locale: "ro" | "en") {
    state.locale = locale;
    const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve({}) } as never);
    const all = elements(tree);
    const form = all.find((element) => element.props["data-testid"] === "resend-form");
    const button = elements(form?.props.children as ReactNode).find((element) => element.props.icon === "resend");
    return { form, button };
  }

  it("offers «Retrimite emailul» for a waiting row, and the dialog says which email it sends, in both languages", async () => {
    const mine = await person("WAITLISTED", at(-2));
    const { form, button } = await resendForm(mine.id, "ro");
    expect(form).toBeDefined();
    expect(button?.props.disabled).toBeFalsy();
    const confirm = form!.props.confirm as { title: string; body: string };
    expect(confirm.title).toBe("Retrimiți emailul?");
    expect(confirm.body).toBe("Runner 1 primește din nou emailul de pe lista de așteptare, cu situația cozii de acum; linkul din emailul vechi nu mai merge.");

    const english = await resendForm(mine.id, "en");
    expect((english.form!.props.confirm as { body: string }).body).toBe("Runner 1 gets the waiting-list email again, with where the line stands now; the link in the old email stops working.");
  });

  it("names the email of every other state too", async () => {
    const wanted: [RegistrationStatus, string][] = [
      ["PENDING_EMAIL_CONFIRMATION", "linkul de confirmare a adresei"],
      ["PENDING_DECLARATION", "linkul pentru semnarea declarației"],
      ["WAITLIST_OFFERED", "oferta de loc"],
      ["CONFIRMED", "confirmarea cu codul QR"],
      ["CANCELLED", "înștiințarea despre starea înscrierii"],
      ["EXPIRED", "înștiințarea despre starea înscrierii"],
    ];
    for (const [status, words] of wanted) {
      const registration = await person(status, null);
      const { form } = await resendForm(registration.id, "ro");
      expect((form!.props.confirm as { body: string }).body, status).toContain(words);
    }
  });
});
