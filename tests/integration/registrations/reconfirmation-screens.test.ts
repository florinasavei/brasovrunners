import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Cere reconfirmarea» on the backoffice's screens (the decision «Cere reconfirmarea»; BR-REQ-060-01, BR-REQ-080-02): the
 * chip «A reconfirmat» on a list row whose person said «Vin» and is still registered, the filter «Reconfirmare» with its three
 * answers, the line on the registration's page; on «Trimite un mesaj participanților» the tick, its help line, the ready text
 * in both languages for «Completează cu textul de reminder», the pace line before «Trimite», and on each «Mesaje trimise» row
 * the three numbers and the progress. The pages are Server Components, so they are called and their element trees walked.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

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
      expect(textOf(line), role).toMatch(/^A spus că vine .*2099.*\.$/);
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
      expect(labels.reminderFill.bodyRo, locale).toBe([text(ro).p1, text(ro).p2, text(ro).p3, text(ro).p4, text(ro).p5, text(ro).p6].join("\n\n"));
      expect(labels.reminderFill.bodyEn, locale).toBe([text(en).p1, text(en).p2, text(en).p3, text(en).p4, text(en).p5, text(en).p6].join("\n\n"));
      expect(labels.reminderFill.bodyRo).toContain("{participantName}");
    }
  });

  it("words the pace and the allowance in the question before «Trimite», from the server, promising no start", async () => {
    const race = await createRace();
    for (let index = 0; index < 3; index += 1) await register(race.id);
    state.actor = await staff("MODERATOR");
    const form = elements(await messagesPage(race.id)).find((element) => element.type === ActionForm);
    const specs = form?.props.confirm as Array<{ when: { field: string; equals: string }[]; body: string }>;
    const all = specs.find((spec) => spec.when[0]?.equals === "ALL_ACTIVE");
    // Three messages, nothing ahead, Free's day: one hour at twenty every fifteen minutes, and it fits.
    expect(all?.body).toContain("Pleacă treptat, câte 20 la 15 minute ziua (noaptea mai rar): cam 1 oră pe ritmul de zi.");
    expect(all?.body).toContain("Încape în cota de azi.");
  });

  it("on Free's 100 a day, 201 messages: 90 today at their own pace, the other 111 over at least two more days, never all after one midnight", async () => {
    const race = await createRace();
    const people = await db
      .insert(participants)
      .values(
        Array.from({ length: 201 }, (_, index) => {
          const email = `crowd${index}@example.org`;
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
    const form = elements(await messagesPage(race.id)).find((element) => element.type === ActionForm);
    const specs = form?.props.confirm as Array<{ when: { field: string; equals: string }[]; body: string }>;
    const body = specs.find((spec) => spec.when[0]?.equals === "ALL_ACTIVE")?.body ?? "";
    // 100 less the reserve of 10 is 90 a day: 90 now, and 111 need two more midnights at 90 each.
    expect(body).toContain(
      "Azi pot pleca 90 dintre ele; celelalte 111 rămân la coadă și pleacă singure în cel puțin încă 2 zile, cel mult 90 pe zi, cât lasă cota refăcută la miezul nopții (UTC).",
    );
    // The hours are today's 90 at 80 an hour, not all 201.
    expect(body).toContain("cam 2 ore pe ritmul de zi.");
    expect(body).not.toContain("cam 3 ore");
    expect(body).not.toContain("pleacă singure după miezul nopții");
    expect(body).not.toContain("Încape în cota de azi.");
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
});
