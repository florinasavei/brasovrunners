import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { formatDay } from "@/i18n/dates";
import { findRegistrationDetailForAdmin, listDeskRegistrations, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-03, BR-REQ-038-01 criterion 8 (§663; amending §650, §76, §83) — «Email respins» on the
 * registrations list, the registration's page and the desk, from a real database: the chip's tooltip says
 * which email was rejected (its «Emailuri» name), when, why, whether the address had been confirmed
 * before it, and what to do; the provider's reason is the small print, never a `title`. A confirmed row
 * whose race-number email bounced, a never-confirmed row whose address email bounced, and a complaint.
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
const { default: EmailRejectedChip } = await import("@/modules/registrations/ui/EmailRejectedChip");
const { default: WhatToTell } = await import("@/modules/registrations/ui/WhatToTell");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");

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

const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : isValidElement(node)
        ? text((node.props as Props).children)
        : "";

const words = ro.Admin.registrations.rejected;
const at = (instant: Date) => formatDay(instant, { locale: "ro", timeZone: "Europe/Bucharest", style: "short", withTime: true, position: "inline" });
const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), template);

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

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
      privacyAcknowledgedAt: new Date("2026-09-30T08:00:00.000Z"),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function rejected(registrationId: string, input: { messageType: EmailMessageType; status: "BOUNCED" | "COMPLAINED"; at: Date; reason?: string | null; key: string }) {
  // The participant's own message (§NNN): their id on the row, as every message to them carries it.
  const [{ participantId }] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, registrationId));
  await db.insert(emailOutbox).values({
    participantId,
    messageType: input.messageType,
    recipientEmail: "runner-rejected@example.org",
    locale: "ro",
    payloadJson: {},
    idempotencyKey: input.key,
    status: input.status,
    lastError: input.reason ?? null,
    registrationId,
    createdAt: new Date(input.at.getTime() - 60_000),
    sentAt: input.at,
  });
}

async function staff(): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "ADMIN", role: "ADMIN" }).returning();
  return user;
}

const CONFIRMED_AT = new Date("2026-10-01T07:30:00.000Z");
const BIB_SENT = new Date("2026-10-03T09:15:00.000Z");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("«Email respins» says which email, when and why (§663)", () => {
  it("on the list: a confirmed row whose race-number email bounced, a never-confirmed row, a complaint; the newest rejection wins", async () => {
    const race = await createRace();
    const confirmed = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    const never = await register(race.id, { status: "PENDING_EMAIL_CONFIRMATION" });
    const complained = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT });
    // An older bounce under the newer one: the chip speaks of the newest.
    await rejected(confirmed, { messageType: "EVENT_REMINDER", status: "BOUNCED", at: new Date("2026-09-30T09:00:00.000Z"), reason: "old", key: "old" });
    await rejected(confirmed, { messageType: "BIB_ASSIGNED", status: "BOUNCED", at: BIB_SENT, reason: "550 5.1.1 mailbox unavailable", key: "bib" });
    const verifyAt = new Date("2026-10-02T10:00:00.000Z");
    await rejected(never, { messageType: "VERIFY_REGISTRATION_EMAIL", status: "BOUNCED", at: verifyAt, reason: "550 no such user", key: "verify" });
    await rejected(complained, { messageType: "ORGANIZER_MESSAGE", status: "COMPLAINED", at: BIB_SENT, reason: null, key: "spam" });
    state.actor = await staff();

    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race.id, bounced: "1" }) } as never);
    const table = elements(tree).find((element) => element.type === AdminTable);
    const rows = table?.props.rows as { id: string }[];
    expect(rows.map((row) => row.id).sort()).toEqual([confirmed, never, complained].sort());
    const name = (table?.props.columns as { key: string; render: (row: unknown) => ReactNode }[]).find((column) => column.key === "name");
    const chipOf = (id: string) => {
      const chips = elements(name?.render(rows.find((row) => row.id === id))).filter((element) => element.type === EmailRejectedChip);
      expect(chips).toHaveLength(1);
      return chips[0].props as { label: string; sentences: string[]; reason: string | null };
    };

    const bib = chipOf(confirmed);
    expect(bib.label).toBe(ro.Admin.registrations.emailRejected);
    expect(bib.sentences).toEqual([
      fill(words.which, { type: ro.Admin.emails.types.BIB_ASSIGNED, instant: at(BIB_SENT) }),
      words.why.BOUNCED,
      fill(words.confirmedBefore, { date: at(CONFIRMED_AT) }),
      words.todo,
    ]);
    // No list payload carries the provider's words (§NNN): the small print is the registration page's alone.
    expect(bib.reason).toBeNull();

    const verify = chipOf(never);
    expect(verify.sentences[0]).toBe(fill(words.which, { type: ro.Admin.emails.types.VERIFY_REGISTRATION_EMAIL, instant: at(verifyAt) }));
    expect(verify.sentences[2]).toBe(words.neverConfirmed);

    const spam = chipOf(complained);
    expect(spam.sentences[1]).toBe(words.why.COMPLAINED);
    expect(spam.reason).toBeNull();

    // The listing's own query carries the object the chip reads: one subquery, the state and its facts, no provider text.
    const listed = await listRegistrationsForAdmin(db, { eventId: race.id, emailBounced: true });
    expect(listed.find((row) => row.id === confirmed)?.emailState).toEqual({
      kind: "unreachable",
      messageType: "BIB_ASSIGNED",
      at: BIB_SENT,
      sent: true,
      status: "BOUNCED",
      cause: "other",
      own: true,
      press: "confirmation",
      laterDeliveredAt: null,
      retriedAt: null,
      retriedVia: null,
    });
    expect(JSON.stringify(listed)).not.toContain("550 5.1.1");
  });

  it("on the registration's page: the chip, the same words under the address, and one sentence in «Ce îi spui»", async () => {
    const race = await createRace();
    const id = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    await rejected(id, { messageType: "BIB_ASSIGNED", status: "BOUNCED", at: BIB_SENT, reason: "550 5.1.1 mailbox unavailable", key: "bib" });
    state.actor = await staff();

    const detail = await findRegistrationDetailForAdmin(db, id);
    expect(detail?.emailState).toEqual({
      kind: "unreachable",
      messageType: "BIB_ASSIGNED",
      at: BIB_SENT,
      sent: true,
      status: "BOUNCED",
      cause: "other",
      own: true,
      press: "confirmation",
      laterDeliveredAt: null,
      retriedAt: null,
      retriedVia: null,
      code: null,
      detail: "550 5.1.1 mailbox unavailable",
    });

    const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    const all = elements(tree);
    const chip = all.find((element) => element.type === EmailRejectedChip);
    const sentences = [
      fill(words.which, { type: ro.Admin.emails.types.BIB_ASSIGNED, instant: at(BIB_SENT) }),
      words.why.BOUNCED,
      fill(words.confirmedBefore, { date: at(CONFIRMED_AT) }),
      words.todo,
    ];
    expect(chip?.props.sentences).toEqual(sentences);
    const line = all.find((element) => element.props["data-testid"] === "email-rejected-words");
    expect(text(line)).toBe(`${sentences.join(" ")}${fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" })}`);
    const tell = all.find((element) => element.type === WhatToTell);
    expect((tell?.props.lines as string[]).at(-1)).toBe(ro.Admin.registrations.tell.rejected.BOUNCED);
  });

  it("at the desk: the same words, no address, and what to tell the person in front of it — never «Sună persoana» (§67, §NNN)", async () => {
    const race = await createRace();
    const id = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    await rejected(id, { messageType: "BIB_ASSIGNED", status: "BOUNCED", at: BIB_SENT, reason: "550 5.1.1 mailbox unavailable", key: "bib" });
    const [row] = await listDeskRegistrations(db, { eventId: race.id, query: "", locale: "ro" });
    expect(row.emailConfirmedAt).toEqual(CONFIRMED_AT);
    const tree = await DeskRow({ row, locale: "ro", back: "desk", minorSigns: { ro: false, en: false } });
    const chip = elements(tree).find((element) => element.type === EmailRejectedChip);
    expect(chip?.props.sentences).toEqual([
      fill(words.which, { type: ro.Admin.emails.types.BIB_ASSIGNED, instant: at(BIB_SENT) }),
      words.why.BOUNCED,
      fill(words.confirmedBefore, { date: at(CONFIRMED_AT) }),
      words.todoTellUnreachable,
    ]);
    expect(JSON.stringify(chip?.props)).not.toContain("@example.org");
    // The desk's own projection (§67, §NNN): never the provider's words, which a redactor could miss an address in.
    expect(JSON.stringify(row)).not.toContain("550 5.1.1");
    expect(chip?.props.reason).toBeNull();
  });

  it("speaks only for what asks somebody to act: a message sent again lights nothing; the desk asks for an Administrator", async () => {
    const race = await createRace();
    const waiting = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 18 });
    const owed = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 19 });
    await rejected(waiting, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, reason: "bounce", key: "waiting" });
    await rejected(owed, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, reason: "bounce", key: "owed" });
    const LATER = new Date("2026-10-05T10:00:00.000Z");
    // Sent again before this release («Retrimite QR»), no delivery will ever be reported for it.
    await db.update(emailOutbox).set({ retriedAt: LATER, retriedVia: "mailgun" }).where(eq(emailOutbox.idempotencyKey, "waiting"));
    // The address works again; this message is owed.
    await db.update(emailOutbox).set({ laterDeliveredAt: LATER }).where(eq(emailOutbox.idempotencyKey, "owed"));
    state.actor = await staff();

    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
    const table = elements(tree).find((element) => element.type === AdminTable);
    const rows = table?.props.rows as { id: string }[];
    const name = (table?.props.columns as { key: string; render: (row: unknown) => ReactNode }[]).find((column) => column.key === "name");
    const chips = (id: string) => elements(name?.render(rows.find((row) => row.id === id))).filter((element) => element.type === EmailRejectedChip);
    expect(chips(waiting)).toHaveLength(0);
    expect(chips(owed)).toHaveLength(1);
    // The Administrator may send it again, and is told so.
    expect((chips(owed)[0].props as { sentences: string[] }).sentences.slice(1)).toEqual([
      fill(words.why.missing, { date: at(LATER) }),
      fill(words.confirmedBefore, { date: at(CONFIRMED_AT) }),
      words.todoPress.confirmation,
    ]);
    const kept = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race.id, bounced: "1" }) } as never);
    expect((elements(kept).find((element) => element.type === AdminTable)?.props.rows as { id: string }[]).map((row) => row.id)).toEqual([owed]);

    // The registration's page: no red line and no chip for the message sent again, nor a refusal in «Ce îi spui».
    const page = elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id: waiting }), searchParams: Promise.resolve({}) } as never));
    expect(page.find((element) => element.type === EmailRejectedChip)).toBeUndefined();
    expect(page.find((element) => element.props["data-testid"] === "email-rejected-words")).toBeUndefined();
    const tell = page.find((element) => element.type === WhatToTell);
    expect(tell?.props.lines as string[]).not.toContain(ro.Admin.registrations.tell.rejected.BOUNCED);

    // At the desk, which every staff role works: the owed email with its date, and «ask an Administrator».
    const desk = await listDeskRegistrations(db, { eventId: race.id, query: "", locale: "ro" });
    const deskChip = async (id: string) =>
      elements(await DeskRow({ row: desk.find((row) => row.id === id)!, locale: "ro", back: "desk", minorSigns: { ro: false, en: false } })).find(
        (element) => element.type === EmailRejectedChip,
      );
    expect(await deskChip(waiting)).toBeUndefined();
    expect((await deskChip(owed))?.props.sentences).toEqual([
      fill(words.which, { type: ro.Admin.emails.types.REGISTRATION_CONFIRMED, instant: at(BIB_SENT) }),
      fill(words.why.missing, { date: at(LATER) }),
      fill(words.confirmedBefore, { date: at(CONFIRMED_AT) }),
      words.todoAskAdmin.confirmation,
    ]);
  });
});
