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
import { readClubMailboxRejections } from "@/modules/notifications/club-mailbox-rejections";
import { refusedInvitations } from "@/modules/notifications/delivery-evidence";
import { CLUB_COPY_FLAG, DEFAULT_CLUB_NOTICES } from "@/modules/notifications/domain/club-notices";
import type { RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import { findRegistrationDetailForAdmin, listDeskRegistrations, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { shortDay, unbreakableLine } from "@/modules/registrations/ui/rejected-email-words";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-01, BR-REQ-037-02, BR-REQ-038-01 (§663; amending §650, §76, §83; the data decision §NNN; §NNN) —
 * «Email respins» drawn where the club looks, from a real database: one line under the name on the list (a
 * link to the registration's «Emailuri»), the filter's count, the line and its to-do under the address, the
 * section «Emailuri» (the story, the participant's own emails newest first, the club's apart by role), the
 * resend questions' first sentence, «Ce îi spui», the desk's one QR chip — and the club's own mailboxes and
 * invitations.
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
const { default: EmailStateLine } = await import("@/modules/registrations/ui/EmailStateLine");
const { default: DeskEmailChip } = await import("@/modules/registrations/ui/DeskEmailChip");
const { default: WhatToTell } = await import("@/modules/registrations/ui/WhatToTell");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");
const { default: ClubMailboxRejectionsPanel } = await import("@/modules/notifications/ui/ClubMailboxRejectionsPanel");

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
const short = ro.Admin.emails.typesShort;
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

async function participantOf(registrationId: string) {
  const [{ participantId }] = await db.select({ participantId: registrations.participantId }).from(registrations).where(eq(registrations.id, registrationId));
  return participantId;
}

/** A row of the outbox for this registration: the participant's own message unless the input says otherwise. */
async function outbox(
  registrationId: string,
  input: {
    messageType: EmailMessageType;
    status: "SENT" | "BOUNCED" | "COMPLAINED";
    at: Date;
    key: string;
    reason?: string | null;
    cause?: RejectionCause | null;
    rejected?: boolean;
    recipient?: string;
    payload?: Record<string, unknown>;
    detail?: string | null;
  },
) {
  await db.insert(emailOutbox).values({
    participantId: await participantOf(registrationId),
    messageType: input.messageType,
    recipientEmail: input.recipient ?? "runner-rejected@example.org",
    locale: "ro",
    payloadJson: input.payload ?? {},
    idempotencyKey: input.key,
    status: input.status,
    lastError: input.reason ?? null,
    providerDetail: input.detail ?? null,
    rejectionCause: input.cause ?? null,
    rejectedAt: input.rejected ? input.at : null,
    registrationId,
    createdAt: new Date(input.at.getTime() - 60_000),
    sentAt: input.at,
  });
}

async function staff(role: "ADMIN" | "MODERATOR" = "ADMIN"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
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

type Column = { key: string; render: (row: unknown) => ReactNode };

async function listOf(params: Record<string, string>) {
  const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(params) } as never);
  const table = elements(tree).find((element) => element.type === AdminTable);
  const rows = table?.props.rows as { id: string }[];
  const name = (table?.props.columns as Column[]).find((column) => column.key === "name");
  const lines = (id: string) => elements(name?.render(rows.find((row) => row.id === id))).filter((element) => element.type === EmailStateLine);
  return { tree, rows, lines };
}

describe("the list: one line under the name, a link to «Emailuri» (§NNN)", () => {
  it("draws the cause, the email's short name and its day; the filter says how many; no provider words", async () => {
    const race = await createRace();
    const confirmed = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    const never = await register(race.id, { status: "PENDING_EMAIL_CONFIRMATION" });
    const complained = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT });
    const fine = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT });
    await outbox(confirmed, { messageType: "EVENT_REMINDER", status: "BOUNCED", at: new Date("2026-09-30T09:00:00.000Z"), reason: "old", key: "old" });
    await outbox(confirmed, { messageType: "BIB_ASSIGNED", status: "BOUNCED", at: BIB_SENT, cause: "no-such-address", rejected: true, detail: "550 5.1.1 mailbox unavailable", key: "bib" });
    const verifyAt = new Date("2026-10-02T10:00:00.000Z");
    await outbox(never, { messageType: "VERIFY_REGISTRATION_EMAIL", status: "BOUNCED", at: verifyAt, cause: "mailbox-full", rejected: true, key: "verify" });
    await outbox(complained, { messageType: "ORGANIZER_MESSAGE", status: "COMPLAINED", at: BIB_SENT, key: "spam" });
    state.actor = await staff();

    const kept = await listOf({ eventId: race.id, bounced: "1" });
    expect(kept.rows.map((row) => row.id).sort()).toEqual([confirmed, never, complained].sort());
    const lineOf = (id: string) => {
      const lines = kept.lines(id);
      expect(lines).toHaveLength(1);
      return lines[0].props as { href: string; words: { line: string; tone: string } };
    };
    const bib = lineOf(confirmed);
    expect(bib.href).toBe("/ro/admin/registrations#emailuri");
    expect(bib.words.tone).toBe("error");
    // The newest refusal of the address, by its cause: the email's short name and its day, unbreakable parts.
    expect(bib.words.line).toBe(unbreakableLine(`${words.label["no-such-address"]} · ${short.BIB_ASSIGNED} · ${shortDay(BIB_SENT, "ro")}`));
    expect(lineOf(never).words.line).toBe(unbreakableLine(`${words.label["mailbox-full"]} · ${short.VERIFY_REGISTRATION_EMAIL} · ${shortDay(verifyAt, "ro")}`));
    expect(lineOf(complained).words.line.startsWith(unbreakableLine(words.label.complained))).toBe(true);
    // No list payload carries the provider's words, nor any address.
    expect(JSON.stringify(kept.lines(confirmed).map((line) => line.props))).not.toMatch(/550 5\.1\.1|@/);

    // The tick says how many it keeps, before anybody ticks it — the same three.
    const all = await listOf({ eventId: race.id });
    expect(all.lines(fine)).toHaveLength(0);
    const tick = elements(all.tree).find((element) => element.props.name === "bounced");
    expect(text(tick?.props.children)).toBe(fill(ro.Admin.registrations.bouncedOnly, { count: "3" }));
    expect(tick?.props.help).toBe(ro.Admin.registrations.bouncedOnlyHelp);

    // The listing's own query carries the object the line reads: the state and its facts, no provider text.
    const listed = await listRegistrationsForAdmin(db, { eventId: race.id, emailBounced: true });
    expect(listed.find((row) => row.id === confirmed)?.emailState).toEqual({
      kind: "unreachable",
      messageType: "BIB_ASSIGNED",
      at: BIB_SENT,
      atKnown: true,
      sent: true,
      status: "BOUNCED",
      cause: "no-such-address",
      own: true,
      press: "confirmation",
      laterDeliveredAt: null,
      retriedAt: null,
      retriedVia: null,
    });
    // A refusal written before `rejected_at` was stored says so: its instant is not the refusal's.
    expect(listed.find((row) => row.id === complained)?.emailState?.atKnown).toBe(false);
    expect(JSON.stringify(listed)).not.toContain("550 5.1.1");
  });

  it("asks before a resend what the last refusal says of it — the row's and the family's question alike", async () => {
    const race = await createRace();
    const id = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    await outbox(id, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, cause: "suppressed", rejected: true, key: "suppressed" });
    state.actor = await staff();
    const { tree } = await listOf({ eventId: race.id });
    const table = elements(tree).find((element) => element.type === AdminTable);
    const actions = (table?.props.rowActions as (row: unknown) => ReactNode)((table?.props.rows as unknown[])[0]);
    const forms = elements(actions).filter((element) => typeof element.props.confirm === "object" && element.props.confirm !== null);
    const resend = forms.find((element) => (element.props.confirm as { title: string }).title === ro.Admin.confirm.resendTitle);
    const name = (await findRegistrationDetailForAdmin(db, id))!.registeredName;
    // The warning first; the question's own sentence unchanged; the press never blocked.
    expect((resend?.props.confirm as { body: string }).body).toBe(`${words.warn.suppressed} ${fill(ro.Admin.confirm.resendWhat.CONFIRMED, { name })}`);
  });
});

describe("the registration's page: the line, its to-do, and «Emailuri» (§NNN)", () => {
  it("says the short line and the to-do under the address; the story, the own emails newest first, the club's apart; «Ce îi spui»", async () => {
    const race = await createRace();
    const id = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    // Six of the participant's own emails delivered before, then the race number refused: seven of their own.
    for (let index = 0; index < 6; index += 1) {
      await outbox(id, { messageType: "ORGANIZER_MESSAGE", status: "SENT", at: new Date(Date.UTC(2026, 8, 20 + index, 9)), key: `sent-${index}` });
    }
    await outbox(id, { messageType: "BIB_ASSIGNED", status: "BOUNCED", at: BIB_SENT, cause: "no-such-address", rejected: true, detail: "550 5.1.1 mailbox unavailable", key: "bib" });
    // The club's own: the archive copy and a copy of a participant's message — by role, never by address.
    await outbox(id, { messageType: "DECLARATION_ARCHIVE", status: "BOUNCED", at: new Date("2026-10-02T09:00:00.000Z"), cause: "mailbox-full", rejected: true, recipient: "archive@example.org", key: "archive" });
    await outbox(id, { messageType: "REGISTRATION_CONFIRMED", status: "SENT", at: new Date("2026-10-01T09:00:00.000Z"), recipient: "copies@example.org", payload: { [CLUB_COPY_FLAG]: true }, key: "copy" });
    state.actor = await staff();

    const detail = await findRegistrationDetailForAdmin(db, id);
    expect(detail?.emailState).toMatchObject({ kind: "unreachable", messageType: "BIB_ASSIGNED", cause: "no-such-address", atKnown: true, code: null, detail: "550 5.1.1 mailbox unavailable" });

    const all = elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never));
    // Under the address: the list's line, a link to the section, and the Administrator's to-do — the place first.
    const under = all.find((element) => element.props["data-testid"] === "email-state");
    const line = elements(under).find((element) => element.type === EmailStateLine);
    expect(line?.props.href).toBe("#emailuri");
    expect((line?.props.words as { line: string }).line).toBe(unbreakableLine(`${words.label["no-such-address"]} · ${short.BIB_ASSIGNED} · ${shortDay(BIB_SENT, "ro")}`));
    expect(text(all.find((element) => element.props["data-testid"] === "email-state-todo"))).toBe(`${words.placeKept} ${words.todoKept}`);
    // Never a chip in the heading any more.
    expect(all.some((element) => element.props["data-testid"] === "email-rejected")).toBe(false);

    // «Emailuri»: open while somebody must act, after the verbs.
    const section = all.find((element) => element.props.id === "emailuri");
    expect(section?.props.title).toBe(ro.Admin.registrations.emails.title);
    expect((section?.props.openWhen as { attention: boolean }).attention).toBe(true);
    const order = (testId: string) => all.findIndex((element) => element.props["data-testid"] === testId);
    expect(order("resend-form")).toBeLessThan(order("emails-section"));
    // The whole story: the long name, why, whether the address had been confirmed, the provider's small print.
    const story = text(all.find((element) => element.props["data-testid"] === "emails-story"));
    expect(story).toContain(fill(words.which, { type: ro.Admin.emails.types.BIB_ASSIGNED, instant: at(BIB_SENT) }));
    expect(story).toContain(words.why.cause["no-such-address"]);
    expect(story).toContain(fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" }));
    // The participant's own, newest first: the refused race number, then the messages before it; five in view.
    const own = elements(all.find((element) => element.props["data-testid"] === "emails-own")).filter((element) => element.props["data-testid"] === "email-row");
    expect(own).toHaveLength(5);
    expect(own[0].props["data-status"]).toBe("BOUNCED");
    expect(text(own[0])).toContain(`${short.BIB_ASSIGNED} · ${ro.Admin.registrations.emails.role.participant}`);
    const rest = all.find((element) => element.props["data-testid"] === "emails-all");
    expect(rest?.props.title).toBe(fill(ro.Admin.registrations.emails.all, { count: "7" }));
    expect(elements(rest).filter((element) => element.props["data-testid"] === "email-row")).toHaveLength(2);
    // The club's, behind their own fold, by role — never a club mailbox's address.
    const club = all.find((element) => element.props["data-testid"] === "emails-club");
    expect(club?.props.title).toBe(fill(ro.Admin.registrations.emails.club, { count: "2" }));
    const clubRows = elements(club).filter((element) => element.props["data-testid"] === "email-row");
    expect(clubRows.map((row) => row.props["data-role"])).toEqual(["archive", "copy"]);
    expect(text(club)).not.toMatch(/@example\.org/);
    expect(text(all.find((element) => element.props["data-testid"] === "emails-legend"))).toBe(`${ro.Admin.registrations.emails.legend} ${ro.Admin.registrations.emails.legendKept}`);

    // «Ce îi spui»: the email in the participant's words and its day, why, and the place kept.
    const tell = all.find((element) => element.type === WhatToTell);
    const lines = tell?.props.lines as string[];
    expect(lines.at(-1)).toBe(ro.Admin.registrations.tell.rejected.placeKept);
    expect(lines.at(-2)).toBe(
      fill(ro.Admin.registrations.tell.rejected.lost, {
        type: short.BIB_ASSIGNED,
        date: formatDay(BIB_SENT, { locale: "ro", timeZone: "Europe/Bucharest", style: "long", year: false, position: "inline" }),
        why: ro.Admin.registrations.tell.rejected.why["no-such-address"],
      }),
    );

    // The resend's and the reminder's questions open with what the refusal says of them.
    const confirmOf = (testId: string) => (all.find((element) => element.props["data-testid"] === testId)?.props.confirm as { body: string }).body;
    expect(confirmOf("resend-form").startsWith(`${words.warn.noSuchAddress} `)).toBe(true);
    expect(confirmOf("reminder-form").startsWith(`${words.warn.noSuchAddress} `)).toBe(true);
  });

  it("asks the Organizer to ask an Administrator, and draws an email sent again quietly, the section closed", async () => {
    const race = await createRace();
    const owed = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 18 });
    const waiting = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 19 });
    const LATER = new Date("2026-10-05T10:00:00.000Z");
    await outbox(owed, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, cause: "mailbox-full", rejected: true, key: "owed" });
    await outbox(waiting, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, cause: "mailbox-full", rejected: true, key: "waiting" });
    await db.update(emailOutbox).set({ laterDeliveredAt: LATER }).where(eq(emailOutbox.idempotencyKey, "owed"));
    await db.update(emailOutbox).set({ retriedAt: LATER, retriedVia: "mailgun" }).where(eq(emailOutbox.idempotencyKey, "waiting"));
    state.actor = await staff("MODERATOR");

    const list = await listOf({ eventId: race.id });
    expect(list.lines(waiting)).toHaveLength(0);
    expect((list.lines(owed)[0].props.words as { line: string; tone: string }).tone).toBe("warning");
    expect((list.lines(owed)[0].props.words as { line: string }).line).toBe(unbreakableLine(fill(words.line.missing, { short: short.REGISTRATION_CONFIRMED })));

    const page = elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id: owed }), searchParams: Promise.resolve({}) } as never));
    expect(text(page.find((element) => element.props["data-testid"] === "email-state-todo"))).toBe(`${words.placeKept} ${words.todoAskAdmin.confirmation}`);
    // The Organizer is drawn no resend at all (§289).
    expect(page.some((element) => element.props["data-testid"] === "resend-form")).toBe(false);

    const quiet = elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id: waiting }), searchParams: Promise.resolve({}) } as never));
    const line = elements(quiet.find((element) => element.props["data-testid"] === "email-state")).find((element) => element.type === EmailStateLine);
    expect((line?.props.words as { tone: string; line: string }).tone).toBe("info");
    expect((line?.props.words as { line: string }).line).toBe(unbreakableLine(fill(words.line.retried, { date: shortDay(LATER, "ro") })));
    expect(((quiet.find((element) => element.props.id === "emailuri")?.props.openWhen) as { attention: boolean }).attention).toBe(false);
    const tell = quiet.find((element) => element.type === WhatToTell);
    expect(tell?.props.lines as string[]).not.toContain(ro.Admin.registrations.tell.rejected.placeKept);
  });
});

describe("the desk: one chip, for the QR confirmation only (§NNN, §67)", () => {
  it("says «Fără QR pe email — caută după nume» for the confirmation, nothing for the reminder, never an address", async () => {
    const race = await createRace();
    const qr = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 17 });
    const reminder = await register(race.id, { emailConfirmedAt: CONFIRMED_AT, confirmedAt: CONFIRMED_AT, bibNumber: 18 });
    await outbox(qr, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: BIB_SENT, cause: "mailbox-full", rejected: true, detail: "552 5.2.2 mailbox full", key: "qr" });
    await outbox(reminder, { messageType: "EVENT_REMINDER", status: "BOUNCED", at: BIB_SENT, cause: "mailbox-full", rejected: true, key: "reminder" });
    const desk = await listDeskRegistrations(db, { eventId: race.id, query: "", locale: "ro" });
    const chipOf = async (id: string) =>
      elements(await DeskRow({ row: desk.find((row) => row.id === id)!, locale: "ro", back: "desk", minorSigns: { ro: false, en: false } })).filter((element) => element.type === DeskEmailChip);
    const chips = await chipOf(qr);
    expect(chips).toHaveLength(1);
    expect(chips[0].props.label).toBe(words.desk.label);
    expect(chips[0].props.hint).toBe(`${words.desk.hint} ${words.todoTellCause["mailbox-full"]}`);
    expect(JSON.stringify(chips[0].props)).not.toMatch(/@|552/);
    expect(await chipOf(reminder)).toHaveLength(0);
    // The desk's own projection carries no provider words.
    expect(JSON.stringify(desk)).not.toContain("552 5.2.2");
  });
});

describe("the club's own side (§NNN)", () => {
  it("lists the club's mailboxes that refuse its emails by address while still the club's, by role once removed — never a subscriber's or a runner's", async () => {
    const race = await createRace();
    const id = await register(race.id);
    const now = new Date("2026-10-08T10:00:00.000Z");
    await outbox(id, { messageType: "DECLARATION_ARCHIVE", status: "BOUNCED", at: new Date("2026-10-07T09:00:00.000Z"), cause: "mailbox-full", rejected: true, recipient: "archive@example.org", key: "archive" });
    await outbox(id, { messageType: "CLUB_CONFIRMATION_NOTICE", status: "BOUNCED", at: new Date("2026-10-06T09:00:00.000Z"), cause: "suppressed", rejected: true, recipient: "gone@example.org", key: "notice" });
    await outbox(id, { messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", at: new Date("2026-10-06T09:00:00.000Z"), cause: "no-such-address", rejected: true, recipient: "runner@example.org", key: "own" });
    // A subscriber's newsletter: the public's, no participant.
    await db.insert(emailOutbox).values({
      participantId: null,
      messageType: "NEWSLETTER",
      recipientEmail: "subscriber@example.com",
      locale: "ro",
      payloadJson: {},
      idempotencyKey: "newsletter",
      status: "BOUNCED",
      rejectionCause: "no-such-address",
      rejectedAt: new Date("2026-10-06T09:00:00.000Z"),
      sentAt: new Date("2026-10-06T09:00:00.000Z"),
    });
    const notices = { ...DEFAULT_CLUB_NOTICES, declarations: { to: "archive@example.org", cc: [], bcc: [] } };
    const groups = await readClubMailboxRejections(db, notices, undefined, now);
    expect(groups.map((group) => [group.address, group.role, group.todo])).toEqual([
      ["archive@example.org", "archive", "mailbox"],
      [null, "notice", "removed"],
    ]);
    const panel = elements(await ClubMailboxRejectionsPanel({ locale: "ro", groups }));
    const said = text(panel);
    expect(said).toContain("archive@example.org");
    expect(said).not.toMatch(/gone@|subscriber@|runner@/);
    expect(said).toContain(ro.Admin.emails.clubRejections.role.notice);
    expect(said).toContain(ro.Admin.emails.clubRejections.todo.mailbox);
  });

  it("marks on «Echipa» an invitation whose newest email was refused, not one sent again since, nor the club's account's refusal", async () => {
    const now = new Date("2026-10-08T10:00:00.000Z");
    const invitation = async (recipient: string, status: "SENT" | "BOUNCED", minutes: number, cause: RejectionCause | null = null) =>
      db.insert(emailOutbox).values({
        participantId: null,
        messageType: "STAFF_INVITATION",
        recipientEmail: recipient,
        locale: "ro",
        payloadJson: {},
        idempotencyKey: `invite-${recipient}-${minutes}`,
        status,
        rejectionCause: cause,
        createdAt: new Date(now.getTime() - minutes * 60_000),
        sentAt: status === "SENT" || cause !== "account" ? new Date(now.getTime() - minutes * 60_000) : null,
      });
    await invitation("Refused@example.org", "BOUNCED", 10, "no-such-address");
    await invitation("again@example.org", "BOUNCED", 30, "mailbox-full");
    await invitation("again@example.org", "SENT", 5);
    await invitation("account@example.org", "BOUNCED", 10, "account");
    const refused = await refusedInvitations(db, now);
    expect([...refused.entries()]).toEqual([["refused@example.org", "no-such-address"]]);
  });
});
