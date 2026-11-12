import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { recordMailgunStop } from "@/modules/notifications/mailgun-stop";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Cere reconfirmarea» on the backoffice's screens (the decision «Cere reconfirmarea»; BR-REQ-070-01, BR-REQ-080-01, BR-REQ-080-02): the
 * chip «A reconfirmat» on a list row whose person said «Vin» and is still registered, the filter «Reconfirmare» with its three
 * answers, the line on the registration's page; on «Trimite un mesaj participanților» the tick, its help line, the ready text
 * in both languages for «Completează cu textul de reminder», the pace line before «Trimite», and on each «Mesaje trimise» row
 * the three numbers and the progress. The pages are Server Components, so they are called and their element trees walked.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", gmail: false, noticeNamesFallback: false }));

// The club's Gmail, configured only where a test says so (`gmailIsConfigured` reads the account and its app password).
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  const gmailKeys = new Set<PropertyKey>(["CONTACT_SMTP_USER", "CONTACT_SMTP_PASSWORD"]);
  return {
    env: new Proxy(actual.env, {
      get: (target, key) => (gmailKeys.has(key) ? (state.gmail ? "club-test-account" : undefined) : Reflect.get(target, key)),
    }),
  };
});

// Whether the privacy notice in force names `{{gmailFallback}}` (§622): with the club's Gmail and the default switch, «Gmail
// preia când Mailgun se oprește» is in force only where a test says so.
vi.mock("@/modules/legal-documents/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/legal-documents/repository")>()),
  noticeDescribesGmailFallback: async () => state.noticeNamesFallback,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
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
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
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
  setRegistrationEliteAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/events/[id]/mesaje/actions", () => ({
  sendParticipantMessageAction: vi.fn(),
  previewParticipantMessageAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: ParticipantMessagesPage } = await import("@/app/[locale]/admin/events/[id]/mesaje/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: ParticipantMessageComposer } = await import("@/modules/notifications/ui/ParticipantMessageComposer");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { sendParticipantMessage } = await import("@/modules/notifications/participant-messages");
const { listRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; primary?: boolean; render: (row: unknown) => ReactNode };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const value of Object.values(node.props)) {
    if (value !== node.props.children && (isValidElement(value) || Array.isArray(value))) elements(value as ReactNode, acc);
  }
  elements(node.props.children, acc);
  return acc;
}

/** Every string under `node`, joined: what the reader sees of it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join("");
  if (!isValidElement<Props>(node)) return "";
  return textOf(node.props.children);
}

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

async function createRace() {
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
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
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
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      ...row,
    })
    .returning({ id: registrations.id, participantId: registrations.participantId });
  return created;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** An ask of a send, answered `at` (or not). */
async function asked(eventId: string, registrationId: string, sendId: string, reconfirmedAt: Date | null) {
  await db.insert(registrationReconfirmations).values({ registrationId, eventId, sendId, askedAt: new Date(Date.now() - 60_000), reconfirmedAt });
}

const listPage = (searchParams: Record<string, string>) =>
  AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
const detailPage = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
const messagesPage = (id: string) => ParticipantMessagesPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);
const tableOf = (tree: ReactNode) => elements(tree).find((element) => element.type === AdminTable);

function nameCellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const table = tableOf(tree);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  const column = (table?.props.columns as Column[]).find((candidate) => candidate.key === "name");
  return row && column ? elements(column.render(row)) : [];
}
const chipOf = (nodes: ReactElement<Props>[]) => nodes.find((element) => element.props.testId === "reconfirm-chip");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.gmail = false;
  state.noticeNamesFallback = false;
});

describe("«A reconfirmat» and «Reconfirmare» on the registrations list", () => {
  it("wears the chip on a row whose person said «Vin» and is still registered, for every role that reads the list; nothing on the others", async () => {
    const race = await createRace();
    const sendId = randomUUID();
    const yes = await register(race.id);
    const silent = await register(race.id, { status: "WAITLISTED", waitlistedAt: new Date() });
    const gone = await register(race.id, { status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "PARTICIPANT" });
    await asked(race.id, yes.id, sendId, new Date());
    await asked(race.id, silent.id, sendId, null);
    await asked(race.id, gone.id, sendId, new Date(Date.now() - 30_000));
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      const chip = chipOf(nameCellOf(tree, yes.id));
      expect(chip?.props.label, role).toBe("A reconfirmat");
      expect(chip?.props.glyph, role).toBe("reconfirmed");
      expect(chipOf(nameCellOf(tree, silent.id)), role).toBeUndefined();
      expect(chipOf(nameCellOf(tree, gone.id)), role).toBeUndefined();
    }
    state.locale = "en";
    expect(chipOf(nameCellOf(await listPage({ eventId: race.id }), yes.id))?.props.label).toBe("Reconfirmed");
  });

  it("offers «Reconfirmare» with its three answers; each keeps its rows, with the count, and rides with every link", async () => {
    const race = await createRace();
    state.actor = await staff("MODERATOR");
    const sendId = randomUUID();
    const yes = await register(race.id);
    const silent = await register(race.id);
    const cancelled = await register(race.id, { status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "ADMIN" });
    await register(race.id);
    await asked(race.id, yes.id, sendId, new Date());
    await asked(race.id, silent.id, sendId, null);
    await asked(race.id, cancelled.id, sendId, null);

    const all = await listPage({ eventId: race.id });
    const select = elements(all).find((element) => element.props.name === "reconfirm");
    expect(select?.props.label).toBe("Reconfirmare");
    expect(select?.props.helperText).toBe(ro.Admin.reconfirm.filterHelp);
    expect(select?.props.defaultValue).toBe("");
    expect(elements(select?.props.children as ReactNode).map((item) => item.props.value)).toEqual(["", "yes", "cancelled", "none"]);
    expect(textOf(select?.props.children as ReactNode)).toBe("ToateAu reconfirmatAu anulat după cerereN-au răspuns");
    expect(tableOf(all)?.props.total).toBe(4);

    for (const [answer, id] of [
      ["yes", yes.id],
      ["cancelled", cancelled.id],
      ["none", silent.id],
    ] as const) {
      const filtered = await listPage({ eventId: race.id, reconfirm: answer });
      const table = tableOf(filtered);
      expect((table?.props.rows as { id: string }[]).map((row) => row.id), answer).toEqual([id]);
      expect(table?.props.total, answer).toBe(1);
      expect((table?.props.currentParams as Record<string, string | undefined>).reconfirm, answer).toBe(answer);
      expect(elements(filtered).find((element) => element.props.name === "reconfirm")?.props.defaultValue, answer).toBe(answer);
    }
    // A value that is not one of the three filters nothing.
    expect(tableOf(await listPage({ eventId: race.id, reconfirm: "maybe" }))?.props.total).toBe(4);
  });
});

describe("the registration's page", () => {
  it("says when the person said «Vin», for every role that reads it; nothing for one who did not", async () => {
    const race = await createRace();
    const yes = await register(race.id);
    const silent = await register(race.id);
    const sendId = randomUUID();
    await asked(race.id, yes.id, sendId, new Date("2099-11-10T10:00:00.000Z"));
    await asked(race.id, silent.id, sendId, null);
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const line = elements(await detailPage(yes.id)).find((element) => element.props["data-testid"] === "registration-reconfirmed");
      // When they answered, never the day they come: «A apăsat „Vin”» and the moment in its inline form (§452).
      expect(textOf(line), role).toMatch(/^A apăsat „Vin” \p{Ll}+\., \d{1,2} \p{L}+\.? 2099, la \d{2}:\d{2}\.$/u);
      expect(elements(await detailPage(silent.id)).some((element) => element.props["data-testid"] === "registration-reconfirmed"), role).toBe(false);
    }
  });
});

describe("«Trimite un mesaj participanților»", () => {
  it("hands the composer the tick, its help line and the ready text in both languages, whatever the backoffice's language", async () => {
    const race = await createRace();
    await register(race.id);
    state.actor = await staff("MODERATOR");
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const composer = elements(await messagesPage(race.id)).find((element) => element.type === ParticipantMessageComposer);
      const labels = composer?.props.labels as Record<string, unknown> & { reminderFill: Record<string, string> };
      const catalogue = locale === "ro" ? ro : en;
      expect(labels.reconfirm, locale).toBe(catalogue.Admin.participantMessages.reconfirm);
      expect(labels.reconfirmHelp, locale).toBe(catalogue.Admin.participantMessages.reconfirmHelp);
      expect(labels.reminderFill.button, locale).toBe(catalogue.Admin.participantMessages.reminderFill.button);
      // The text itself is Romanian in the Romanian boxes and English in the English ones, placeholders literal.
      const text = (from: typeof ro) => from.Admin.participantMessages.reminderText;
      expect(labels.reminderFill.subjectRo, locale).toBe(text(ro).subject);
      expect(labels.reminderFill.subjectEn, locale).toBe(text(en).subject);
      const paragraphs = (from: typeof ro) => [text(from).p1, text(from).p2, text(from).p3, text(from).p4, text(from).p5, text(from).p6, text(from).p7];
      expect(labels.reminderFill.bodyRo, locale).toBe(paragraphs(ro).join("\n\n"));
      expect(labels.reminderFill.bodyEn, locale).toBe(paragraphs(en).join("\n\n"));
      expect(labels.reminderFill.bodyRo).toContain("{participantName}");
    }
  });

  it("words the pace and the allowance in the question before «Trimite», from the server, promising no start", async () => {
    const race = await createRace();
    for (let index = 0; index < 3; index += 1) await register(race.id);
    state.actor = await staff("MODERATOR");
    const form = elements(await messagesPage(race.id)).find((element) => element.type === ActionForm);
    const specs = form?.props.confirm as Array<{ when: { field: string; equals: string }[]; body: string; warning?: string }>;
    const all = specs.find((spec) => spec.when[0]?.equals === "ALL_ACTIVE");
    // Three messages, nothing ahead, Free's day: one hour at twenty every fifteen minutes, it fits, and the registrations' own go first.
    expect(all?.body).toContain("Pleacă treptat, câte 20 la 15 minute ziua (noaptea mai rar): cam 1 oră pe ritmul de zi. Încape în cota de azi. Emailurile înscrierilor pleacă înaintea lor.");
    expect(all?.warning).toBeUndefined();
  });

  /** 201 confirmed registrations of one race, and the page's question and composer line for «Toți cei înscriși». */
  async function twoHundredAndOne() {
    const race = await createRace();
    serial += 1;
    const batch = serial;
    const people = await db
      .insert(participants)
      .values(
        Array.from({ length: 201 }, (_, index) => {
          const email = `crowd${batch}-${index}@example.org`;
          return { deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Crowd ${index}`, preferredLocale: "ro" as const };
        }),
      )
      .returning({ id: participants.id });
    await db.insert(registrations).values(
      people.map((person, index) => ({
        eventId: race.id,
        participantId: person.id,
        kind: "REAL" as const,
        locale: "ro" as const,
        registeredName: `Crowd ${index}`,
        displayName: resolveDisplayName({ legalName: `Crowd ${index}` }),
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date(),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        status: "CONFIRMED" as const,
      })),
    );
    state.actor = await staff("MODERATOR");
    const tree = await messagesPage(race.id);
    const form = elements(tree).find((element) => element.type === ActionForm);
    const specs = form?.props.confirm as Array<{ when: { field: string; equals: string }[]; body: string; warning?: string }>;
    const spec = specs.find((candidate) => candidate.when[0]?.equals === "ALL_ACTIVE");
    const composer = elements(tree).find((element) => element.type === ParticipantMessageComposer);
    const audience = (composer?.props.audiences as Array<{ value: string; costLine?: string; deferredLine?: string; warningLine?: string }>).find((choice) => choice.value === "ALL_ACTIVE");
    return { body: spec?.body ?? "", warning: spec?.warning, audience };
  }

  /** Messages Mailgun already carried today, a minute ago. */
  async function sentToday(count: number) {
    const sentAt = new Date(Date.now() - 60_000);
    await db.insert(emailOutbox).values(
      Array.from({ length: count }, () => {
        serial += 1;
        return { participantId: null, registrationId: null, messageType: "STAFF_INVITATION" as const, locale: "ro" as const, recipientEmail: `sent${serial}@example.org`, payloadJson: {}, idempotencyKey: `sent:${serial}`, status: "SENT" as const, sentAt, createdAt: sentAt };
      }),
    );
  }

  it("(a) on a monthly plan, 201 messages: the pace as it is, that it fits the month, that the registrations' own leave first — and no warning", async () => {
    await db.insert(platformSettings).values({ key: "emailPlan", value: { plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: 100, note: "" } });
    const { body, warning, audience } = await twoHundredAndOne();
    expect(body).toContain("Pleacă treptat, câte 20 la 15 minute ziua (noaptea mai rar): cam 3 ore pe ritmul de zi. Încape în cota lunii. Emailurile înscrierilor pleacă înaintea lor.");
    expect(audience?.costLine).toMatch(/^Emailuri, cu tot cu copiile pentru club: 201 — se scad din cota Mailgun \(planul Basic: încă 10000 luna aceasta\)\.$/);
    expect(warning).toBeUndefined();
    expect(audience?.warningLine).toBeUndefined();
    expect(body).not.toMatch(/rezerv|păstrat/i);
  });

  it("(b) on Free's 100 a day with 5 sent, 201 messages: 95 today in about 2 hours, 106 over 2 more days at 100 a day, and a warning that cannot be missed", async () => {
    await sentToday(5);
    const { body, warning, audience } = await twoHundredAndOne();
    expect(body).toContain(
      "Azi pot pleca 95 dintre ele; restul așteaptă la coadă și pleacă în cel puțin încă 2 zile, cel mult 100 pe zi, cât lasă cota refăcută la miezul nopții (UTC). Nu se pierde niciunul.",
    );
    // The hours are today's 95 at 80 an hour, not all 201.
    expect(body).toContain("cam 2 ore pe ritmul de zi. Emailurile înscrierilor pleacă înaintea lor.");
    expect(body).not.toContain("cam 3 ore");
    expect(body).not.toContain("Încape în cota de azi.");
    // Today 95, then 100 and 6: the allowance on at least three days; once a day's is spent Mailgun sends nothing more that day.
    const expected =
      "Pe un plan cu cotă zilnică, mesajul acesta folosește cota zilnică în cel puțin 3 zile. Emailurile înscrierilor pleacă înaintea lui și din aceeași cotă: după ce se termină cota zilei, Mailgun nu mai trimite nimic în ziua aceea, nici emailurile înscrierilor. Un mesaj mare se trimite pe un plan lunar: «Setări» → «Emailuri» → «Planul Mailgun și cât mai putem trimite».";
    // In the dialog's warning and on the composer, beside the deferral: the same sentence, worded on the server.
    expect(warning).toBe(expected);
    expect(audience?.warningLine).toBe(expected);
    expect(audience?.deferredLine).toContain("Azi pot pleca 95 dintre ele");
    // Gmail is not configured here, so the Gmail way out is not said.
    expect(warning).not.toContain("Gmail");
    expect(body).not.toMatch(/rezerv|păstrat/i);
  });

  it("(b) the same with «Gmail preia când Mailgun se oprește» in force: 95 today by Mailgun, the rest by Gmail after it, no count of days, and the shared limits the warning", async () => {
    state.gmail = true;
    state.noticeNamesFallback = true;
    await sentToday(5);
    const { body, warning, audience } = await twoHundredAndOne();
    const deferral = "Azi pot pleca 95 prin Mailgun; restul pleacă apoi prin Gmail-ul clubului, în limita lui, și prin Mailgun când se reface cota.";
    expect(body).toContain(deferral);
    expect(audience?.deferredLine).toBe(deferral);
    // Gmail carries it once the day's allowance is spent: it waits for no reset.
    expect(body).not.toContain("în cel puțin încă");
    const expected =
      "Emailurile înscrierilor pleacă primele, dar împart cu acest mesaj cota zilei și limita Gmail. Un mesaj mare se trimite pe un plan lunar: «Setări» → «Emailuri» → «Planul Mailgun și cât mai putem trimite».";
    expect(warning).toBe(expected);
    expect(audience?.warningLine).toBe(expected);
    expect(warning).not.toContain("în cel puțin");
    for (const line of [body, warning ?? ""]) expect(line).not.toMatch(/restul \d|\d+ de ore|24/);
    state.locale = "en";
    const english = await twoHundredAndOne();
    expect(english.body).toContain("95 can go by Mailgun today; the rest then leave by the club's Gmail, within its limit, and by Mailgun when the allowance comes back.");
    expect(english.warning).toMatch(/^The registrations' own emails leave first, but they share the day's allowance and Gmail's limit with this message\. /);
  });

  it("(d) counts the send's club copy on the road it really takes: by the club's Gmail, out of Mailgun's count, said apart", async () => {
    state.gmail = true;
    await db.insert(platformSettings).values({ key: "emailPlan", value: { plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: 100, note: "" } });
    await db.insert(platformSettings).values({ key: "clubNotices", value: { participants: { bcc: ["copies@example.org"] } } });
    // The default roads: the participants' by Mailgun, the club's copies by Gmail.
    const { body, audience } = await twoHundredAndOne();
    expect(audience?.costLine).toBe(
      "Emailuri: 201 — se scad din cota Mailgun (planul Basic: încă 10000 luna aceasta). Copiile pentru club, 1, pleacă prin Gmail-ul clubului.",
    );
    // 201 on Mailgun's road, not 202: three hours at twenty every fifteen minutes either way, and it fits the month.
    expect(body).toContain("cam 3 ore pe ritmul de zi. Încape în cota lunii.");
  });

  /** The club's Gmail carries the organizers' group («announcements»), with this cap and this choice at the cap. */
  async function gmailRoad(cap: number, atGmailCap: "defer" | "mailgun") {
    state.gmail = true;
    await db.insert(platformSettings).values({
      key: "emailTransport",
      value: {
        groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "gmail", club: "gmail", newsletter: "mailgun" },
        gmailDailyCap: cap,
        gmailPaceSeconds: 6,
        atGmailCap,
        overflowToGmail: false,
        fallbackToGmail: true,
      },
    });
  }
  const GMAIL_SHARED = "Limita Gmail e comună cu celelalte emailuri care pleacă prin Gmail-ul clubului.";
  const GMAIL_PACE = "Pleacă prin Gmail-ul clubului, câte 4 la 15 minute ziua (noaptea mai rar): cam 13 ore pe ritmul de zi.";

  for (const atGmailCap of ["defer", "mailgun"] as const) {
    it(`(c) on the club's Gmail road, 201 messages that fit Gmail's room («${atGmailCap}» at the cap): Gmail's room, its limit shared, no warning`, async () => {
      await gmailRoad(250, atGmailCap);
      const { body, warning, audience } = await twoHundredAndOne();
      expect(body).toContain(`${GMAIL_PACE} Încape acum în limita Gmail. ${GMAIL_SHARED} Emailurile înscrierilor pleacă înaintea lor.`);
      expect(audience?.costLine).toBe("Emailuri prin Gmail-ul clubului: 201. Gmail mai poate trimite acum 250 din limita de 250.");
      expect(warning).toBeUndefined();
      expect(audience?.deferredLine).toBeUndefined();
      for (const line of [body, audience?.costLine ?? ""]) {
        expect(line).not.toContain("Mailgun");
        expect(line).not.toContain("cota");
        expect(line).not.toContain("24 de ore");
      }
    });
  }

  it("(c) on the club's Gmail road, 201 messages that do not fit and wait at the cap: the rest wait, and the shared limit is the dialog's warning", async () => {
    await gmailRoad(200, "defer");
    const { body, warning, audience } = await twoHundredAndOne();
    expect(body).toContain(
      `Acum pot pleca 200 dintre ele; restul așteaptă să se facă loc în limita Gmail de 200. Nu se pierde niciunul. ${GMAIL_PACE} Emailurile înscrierilor pleacă înaintea lor.`,
    );
    expect(audience?.costLine).toBe("Emailuri prin Gmail-ul clubului: 201. Gmail mai poate trimite acum 200 din limita de 200.");
    expect(warning).toBe(GMAIL_SHARED);
    expect(audience?.warningLine).toBe(GMAIL_SHARED);
    expect(body).not.toContain(GMAIL_SHARED);
    for (const line of [body, audience?.costLine ?? "", audience?.deferredLine ?? ""]) {
      expect(line).not.toContain("Mailgun");
      expect(line).not.toContain("cota");
      expect(line).not.toContain("20 la 15 minute");
      // «the rest», never «celelalte 1».
      expect(line).not.toMatch(/celelalte \d/);
    }
  });

  it("(c) on the club's Gmail road, 201 messages that do not fit and overflow to Mailgun at the cap: the rest by Mailgun, against its allowance", async () => {
    await gmailRoad(200, "mailgun");
    const { body, warning } = await twoHundredAndOne();
    expect(body).toContain(
      `Prin Gmail pot pleca acum 200 dintre ele; restul pleacă prin Mailgun, cum e setat la limita Gmail, și se scade din cota Mailgun. ${GMAIL_PACE} Emailurile înscrierilor pleacă înaintea lor.`,
    );
    expect(warning).toBe(GMAIL_SHARED);
    expect(body).not.toMatch(/celelalte \d/);
  });

  // The weekday is the house's short form: «joi» has no dot, «vin.» has one — either, so the test holds on every day (CI, 2026-11-12).
  const STOPPED_UNTIL = String.raw`Mailgun e oprit acum, până \p{L}+\.?, \d{1,2} \p{L}+\.? \d{4}, la \d{2}:\d{2}\.`;
  for (const inForce of [false, true]) {
    const switchWords = inForce ? "«Gmail preia când Mailgun se oprește» in force" : "no fallback in force";
    const after = inForce ? "Până atunci emailurile pleacă prin Gmail-ul clubului, în limita lui." : "Mesajul începe să plece când repornește.";

    it(`(e) Mailgun stopped now (a pause, on a monthly plan, ${switchWords}): one sentence says until when and who sends meanwhile, and nothing leaves «now»`, async () => {
      state.gmail = inForce;
      state.noticeNamesFallback = inForce;
      await db.insert(platformSettings).values({ key: "emailPlan", value: { plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: 100, note: "" } });
      await recordMailgunStop(db, { kind: "paused", until: new Date(Date.now() + 20 * 60_000) }, new Date());
      const { body, warning } = await twoHundredAndOne();
      expect(body).toMatch(
        new RegExp(`${STOPPED_UNTIL} ${after.replace(/[.()]/g, "\\$&")} Pleacă treptat, câte 20 la 15 minute ziua \\(noaptea mai rar\\): cam 3 ore pe ritmul de zi\\. Emailurile înscrierilor pleacă înaintea lor\\.`, "u"),
      );
      expect(body).not.toContain(inForce ? "Mesajul începe să plece când repornește." : "Gmail");
      expect(body).not.toContain("Încape în cota lunii.");
      expect(body).not.toContain("pot pleca");
      expect(warning).toBeUndefined();
      state.locale = "en";
      const english = await twoHundredAndOne();
      expect(english.body).toMatch(
        inForce
          ? /Mailgun is stopped now, until .+\. Until then the emails leave by the club's Gmail, within its limit\./
          : /Mailgun is stopped now, until .+\. The message starts leaving when it restarts\./,
      );
      expect(english.body).not.toContain("It fits this month's allowance.");
    });

    it(`(e) Mailgun stopped now (its daily allowance spent, Free with 5 sent, ${switchWords}): the stop said, no «Azi pot pleca», the daily warning kept`, async () => {
      state.gmail = inForce;
      state.noticeNamesFallback = inForce;
      await sentToday(5);
      await recordMailgunStop(db, { kind: "allowance", until: nextAllowanceResetAt(new Date()) }, new Date());
      const { body, warning } = await twoHundredAndOne();
      expect(body).toMatch(new RegExp(`${STOPPED_UNTIL} ${after.replace(/[.()]/g, "\\$&")}`, "u"));
      expect(body).not.toContain("Azi pot pleca");
      expect(body).not.toContain("Încape în cota de azi.");
      if (inForce) expect(warning).toMatch(/^Emailurile înscrierilor pleacă primele, dar împart cu acest mesaj cota zilei și limita Gmail\. /);
      else expect(warning).toContain("Pe un plan cu cotă zilnică, mesajul acesta folosește cota zilnică în cel puțin 3 zile.");
    });
  }

  it("draws «Mesaje trimise» subjects with the event's own fields filled, and keeps a participant's field as typed", async () => {
    const race = await createRace();
    const actor = await staff("MODERATOR");
    state.actor = actor;
    await register(race.id);
    const ready = { ro: "Ne vedem la {eventTitle}? Spune-ne dacă vii", en: "See you at {eventTitle}? Tell us if you come" };
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: randomUUID(), subject: ready, body: { ro: "Spune-ne.", en: "Tell us." } }, new Date(Date.now() - 60_000));
    await sendParticipantMessage(
      db,
      actor,
      { eventId: race.id, audience: "ALL_ACTIVE", sendId: randomUUID(), subject: { ro: "{participantName}, vii la {eventTitle}?", en: "{participantName}, coming?" }, body: { ro: "Spune-ne.", en: "Tell us." } },
      new Date(),
    );
    const rows = elements(await messagesPage(race.id)).filter((element) => element.props["data-testid"] === "participant-message-history-row");
    const texts = rows.map((row) => textOf(row));
    const readySubject = texts.find((text) => text.includes("Ne vedem la"));
    expect(readySubject).toContain("Ne vedem la Crosul? Spune-ne dacă vii");
    expect(readySubject).not.toContain("{eventTitle}");
    const personal = texts.find((text) => text.includes("{participantName}"));
    expect(personal).toContain("{participantName}, vii la Crosul?");
  });

  it("gives each «Mesaje trimise» row the three numbers of a send that asked and how far it has left; neither for a send that did not ask", async () => {
    const race = await createRace();
    const actor = await staff("MODERATOR");
    state.actor = actor;
    const yes = await register(race.id);
    const silent = await register(race.id);
    await register(race.id, { kind: "TEST" });
    const words = { subject: { ro: "Vii?", en: "Coming?" }, body: { ro: "Spune-ne.", en: "Tell us." } };
    const askId = randomUUID();
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: askId, askReconfirm: true, ...words }, new Date(Date.now() - 60_000));
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: randomUUID(), ...words }, new Date());
    await db.update(registrationReconfirmations).set({ reconfirmedAt: new Date() }).where(eq(registrationReconfirmations.registrationId, yes.id));
    await db
      .update(emailOutbox)
      .set({ status: "SENT", sentAt: new Date() })
      .where(and(eq(emailOutbox.registrationId, silent.id), eq(emailOutbox.idempotencyKey, `organizer-message:${askId}:registration:${silent.id}`)));

    const rows = elements(await messagesPage(race.id)).filter((element) => element.props["data-testid"] === "participant-message-history-row");
    expect(rows).toHaveLength(2);
    const [plain, asking] = rows;
    expect(elements(plain).some((element) => element.props["data-testid"] === "participant-message-history-answers")).toBe(false);
    const answers = elements(asking).find((element) => element.props["data-testid"] === "participant-message-history-answers");
    expect(textOf(answers)).toBe("Au reconfirmat 1 · Au anulat 0 · N-au răspuns 1");
    const progress = elements(asking).find((element) => element.props["data-testid"] === "participant-message-history-progress");
    expect(textOf(progress)).toBe("Au plecat 1 · Așteaptă 1");
    expect(textOf(elements(plain).find((element) => element.props["data-testid"] === "participant-message-history-progress"))).toBe("Au plecat 0 · Așteaptă 2");
  });

  it("one rule for «a reconfirmat» after two asking sends — answered after the first, silent after the second: every screen says re-confirmed", async () => {
    const race = await createRace();
    const actor = await staff("MODERATOR");
    state.actor = actor;
    const answered = await register(race.id);
    const silent = await register(race.id);
    const probe = await register(race.id, { kind: "TEST" });
    const words = { subject: { ro: "Vii?", en: "Coming?" }, body: { ro: "Spune-ne.", en: "Tell us." } };
    const first = randomUUID();
    const second = randomUUID();
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: first, askReconfirm: true, ...words }, new Date(Date.now() - 120_000));
    // The first person (and the test row) say «Vin» after the first send; the second send asks everybody again.
    await db
      .update(registrationReconfirmations)
      .set({ reconfirmedAt: new Date(Date.now() - 90_000) })
      .where(and(eq(registrationReconfirmations.sendId, first), inArray(registrationReconfirmations.registrationId, [answered.id, probe.id])));
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: second, askReconfirm: true, ...words }, new Date(Date.now() - 60_000));
    const open = await db.select().from(registrationReconfirmations).where(eq(registrationReconfirmations.sendId, second));
    expect(open.every((ask) => ask.reconfirmedAt === null)).toBe(true);

    // «Mesaje trimise»: both rows count the person under «Au reconfirmat», the test row nowhere.
    const rows = elements(await messagesPage(race.id)).filter((element) => element.props["data-testid"] === "participant-message-history-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const answers = elements(row).find((element) => element.props["data-testid"] === "participant-message-history-answers");
      expect(textOf(answers)).toBe("Au reconfirmat 1 · Au anulat 0 · N-au răspuns 1");
    }
    // The list's filter, its chip and the export's moment agree.
    const ids = async (reconfirm: "yes" | "none") => (await listRegistrationsForAdmin(db, { eventId: race.id, reconfirm, excludeTest: true })).map((row) => row.id);
    expect(await ids("yes")).toEqual([answered.id]);
    expect(await ids("none")).toEqual([silent.id]);
    const tree = await listPage({ eventId: race.id });
    expect(chipOf(nameCellOf(tree, answered.id))?.props.label).toBe("A reconfirmat");
    expect(chipOf(nameCellOf(tree, silent.id))).toBeUndefined();
    // The export's «Reconfirmat» is the row's `reconfirmedAt` (`export/route.ts`): filled for the person, empty for the silent.
    const exported = await listRegistrationsForAdmin(db, { eventId: race.id, excludeTest: true });
    expect(exported.find((row) => row.id === answered.id)?.reconfirmedAt).toBeInstanceOf(Date);
    expect(exported.find((row) => row.id === silent.id)?.reconfirmedAt).toBeNull();
  });

  it("counts under «N-au răspuns» only a registration that can answer: an offer made since the ask is not silent, on «Mesaje trimise» and in the filter alike", async () => {
    const race = await createRace();
    const actor = await staff("MODERATOR");
    state.actor = actor;
    const silent = await register(race.id);
    const offered = await register(race.id, { status: "WAITLISTED", waitlistedAt: new Date() });
    const offeredYes = await register(race.id, { status: "WAITLISTED", waitlistedAt: new Date() });
    const words = { subject: { ro: "Vii?", en: "Coming?" }, body: { ro: "Spune-ne.", en: "Tell us." } };
    await sendParticipantMessage(db, actor, { eventId: race.id, audience: "ALL_ACTIVE", sendId: randomUUID(), askReconfirm: true, ...words }, new Date(Date.now() - 60_000));
    await db.update(registrationReconfirmations).set({ reconfirmedAt: new Date() }).where(eq(registrationReconfirmations.registrationId, offeredYes.id));
    // Both waiting entries are offered a place after the ask: no button any more, still registered.
    await db
      .update(registrations)
      .set({ status: "WAITLIST_OFFERED", offerCreatedAt: new Date(), holdExpiresAt: new Date(Date.now() + 86_400_000) })
      .where(inArray(registrations.id, [offered.id, offeredYes.id]));

    const [row] = elements(await messagesPage(race.id)).filter((element) => element.props["data-testid"] === "participant-message-history-row");
    const answers = elements(row).find((element) => element.props["data-testid"] === "participant-message-history-answers");
    // «Au reconfirmat» keeps the offer that answered (still registered, an ask answered); the silent offer is in neither.
    expect(textOf(answers)).toBe("Au reconfirmat 1 · Au anulat 0 · N-au răspuns 1");
    const ids = async (reconfirm: "yes" | "none") => (await listRegistrationsForAdmin(db, { eventId: race.id, reconfirm, excludeTest: true })).map((one) => one.id);
    expect(await ids("yes")).toEqual([offeredYes.id]);
    expect(await ids("none")).toEqual([silent.id]);
  });
});
