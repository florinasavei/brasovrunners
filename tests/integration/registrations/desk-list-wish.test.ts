import { and, asc, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations, type Registration } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findFirstResultsNameAskNoticeVersion } from "@/modules/legal-documents/repository";
import { holdsResultsNameConsent } from "@/modules/results/domain/name-consent";
import { STAFF_ROLES, canWorkTheDesk, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { approvePrivacyNotice, approveTerms, createRace, registerRunner, resetNoticeCounter, type Runner } from "../../helpers/results";

/**
 * §1017 (amending §143, §910, §1004 and BR-REQ-072-01 criterion 7; BR-REQ-039-01, BR-REQ-037-08, BR-REQ-060-01) — the desk's eye
 * becomes a press for the person's own wish (the owner, 2026-11-20: «dacă cineva are semnul ăsta de „Anonim” trebuie să îl pot
 * schimba în „Cu nume” la click, dar cu acordul lor»), proved on a real database (PGlite):
 *
 * - «Anonim» → «Cu nume» and back for every desk role, through the service and through the action; a member refused (by the
 *   action and by the service), a row that is over, an address never confirmed and a closed desk refused, nothing written;
 * - one audit row `registration.list_consent_changed`, the door `DESK`, the staff member as the actor, never the name;
 * - the results' name the person's own page would set, for a registration under a notice older than the first that described the
 *   results while the question is put — and nothing of it while the question is not put;
 * - one email to the person, only when showing, carrying the `LIST_CONSENT` link that takes the name off — walked;
 * - a name the club hid stays hidden, and the eye's words after each press.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, flashed: [] as unknown[] }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "string" ? "ro" : arg.locale;
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => "ro",
  getMessages: async () => ro,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    const { DomainError } = await import("@/shared/errors/domain-error");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/shared/feedback/flash", () => ({
  flashOutcome: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
  flash: async (notice: unknown) => {
    state.flashed.push(notice);
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));

const { recordListWishAtDesk } = await import("@/modules/registrations/desk-list-wish");
const { recordListWishAtDeskAction } = await import("@/app/[locale]/admin/registrations/actions");
const { listDeskRegistrations } = await import("@/modules/registrations/admin-repository");
const { listPublicStartList } = await import("@/modules/registrations/repository");
const { readListConsent, consumeAndSetListConsent } = await import("@/modules/registrations/list-consent");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { OutboxMessageWithdrawn } = await import("@/modules/notifications/outbox");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");

/** Race morning: before the start (`RACE_STARTS_AT`, 2026-11-21 07:00 UTC), after every notice the helpers approve. */
const NOW = new Date("2026-11-21T06:00:00.000Z");
const LATER = new Date(NOW.getTime() + 60_000);
const DESK_ROLES = STAFF_ROLES.filter((role) => canWorkTheDesk(role));

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  state.flashed = [];
  raceId = (await createRace(db)).id;
  // The notice the runners registered under, in force: it describes the results, so nobody below is asked anything more (§879).
  await approvePrivacyNotice(db, { results: true });
});

/** A desk colleague of a role: one account per call, so two of a role in one test are two people. */
async function colleague(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@example.test`, displayName: `Colleague ${role} ${serial}`, role }).returning();
  return row;
}

/** A confirmed runner who did not tick «Vreau să apar»: «Anonim» on the desk. */
async function anonymousRunner(name: string, over: Partial<Runner> = {}): Promise<Registration> {
  serial += 1;
  return registerRunner(db, raceId, { name, bibNumber: 100 + serial, ticked: false, ...over });
}

async function rowOf(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function trail(id: string) {
  return db
    .select({ action: auditLogs.action, actor: auditLogs.actorStaffUserId, participant: auditLogs.participantId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, id))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

async function mails(id: string) {
  return db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, id), eq(emailOutbox.messageType, "LIST_CONSENT_RECORDED")));
}

async function refusalOf(pressed: Promise<unknown>): Promise<string | null> {
  try {
    await pressed;
    return null;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

/** The desk's row of a registration, as the page reads it. */
async function deskRowOf(id: string) {
  const row = (await listDeskRegistrations(db, { eventId: raceId, query: "", locale: "ro" })).find((candidate) => candidate.id === id);
  expect(row, id).toBeDefined();
  return row!;
}

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

/** The eye as the row draws it: the press (its words, glyph, the wish it posts and its question) or the plain chip. */
async function eyeOf(id: string, role: StaffRole | undefined, over: { readOnly?: boolean } = {}) {
  const row = await deskRowOf(id);
  const all = elements(await DeskRow({ row, locale: "ro", back: "desk", eventId: raceId, minorSigns: { ro: false, en: false }, ...(role ? { role } : {}), ...over }));
  const form = all.find((element) => element.props["data-testid"] === "desk-site-name-form");
  const button = all.find((element) => element.props["data-testid"] === "desk-site-name");
  const chip = all.find((element) => element.props.testId === "desk-site-name");
  const club = all.find((element) => element.props["data-testid"] === "desk-site-name-club");
  const listed = form ? elements(form.props.children).find((element) => element.props.name === "listed")?.props.value : undefined;
  return {
    press: form ? { words: button?.props.children, icon: button?.props.icon, listed, question: form.props.confirm as Record<string, unknown>, minHeight: (button?.props.sx as { minHeight?: number })?.minHeight } : null,
    chip: chip ? { label: chip.props.label, glyph: chip.props.glyph } : null,
    club: club ? club.props.children : null,
  };
}

describe("§1017 the desk's eye records the person's own wish, for every desk role", () => {
  it("«Anonim» → «Cu nume» and back, for each desk role: the person's own tick, one audit row each way with the colleague as the actor", async () => {
    for (const role of DESK_ROLES) {
      const actor = await colleague(role);
      const ana = await anonymousRunner(`Ana ${role}`);

      expect(await recordListWishAtDesk(db, actor, ana.id, true, NOW), role).toMatchObject({ listed: true, changed: true, emailed: true, hiddenByClub: false });
      expect((await rowOf(ana.id)).listOptOut, role).toBe(false);
      expect((await deskRowOf(ana.id)).namedOnSite, role).toBe(true);

      expect(await recordListWishAtDesk(db, actor, ana.id, false, LATER), role).toMatchObject({ listed: false, changed: true, emailed: false });
      expect((await rowOf(ana.id)).listOptOut, role).toBe(true);
      expect((await deskRowOf(ana.id)).namedOnSite, role).toBe(false);

      const rows = await trail(ana.id);
      expect(rows, role).toEqual([
        { action: "registration.list_consent_changed", actor: actor.id, participant: ana.participantId, metadata: { from: "NOT_LISTED", to: "LISTED", via: "DESK" } },
        { action: "registration.list_consent_changed", actor: actor.id, participant: ana.participantId, metadata: { from: "LISTED", to: "NOT_LISTED", via: "DESK" } },
      ]);
      // AGENTS.md §12.12: the shape of the change and the door, never who was named.
      expect(JSON.stringify(rows), role).not.toContain(`Ana ${role}`);
    }
  });

  it("refuses a member at the service, and writes nothing", async () => {
    const member = await colleague("MEMBER");
    const ana = await anonymousRunner("Ana Membru");
    expect(await refusalOf(recordListWishAtDesk(db, member, ana.id, true, NOW))).toBe("FORBIDDEN");
    expect((await rowOf(ana.id)).listOptOut).toBe(true);
    expect(await trail(ana.id)).toEqual([]);
    expect(await mails(ana.id)).toEqual([]);
  });

  it("refuses a row that is over, an address never confirmed and a closed desk, and writes nothing", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const cancelled = await anonymousRunner("Ana Anulată", { status: "CANCELLED" });
    const expired = await anonymousRunner("Ion Expirat", { status: "EXPIRED" });
    const unconfirmed = await anonymousRunner("Dan Neconfirmat", { status: "PENDING_EMAIL_CONFIRMATION" });
    expect(await refusalOf(recordListWishAtDesk(db, actor, cancelled.id, true, NOW))).toBe("LIST_WISH_OVER");
    expect(await refusalOf(recordListWishAtDesk(db, actor, expired.id, true, NOW))).toBe("LIST_WISH_OVER");
    expect(await refusalOf(recordListWishAtDesk(db, actor, unconfirmed.id, true, NOW))).toBe("LIST_WISH_ADDRESS_UNCONFIRMED");

    const ana = await anonymousRunner("Ana După");
    await db.update(events).set({ eventStatus: "COMPLETED" }).where(eq(events.id, raceId));
    expect(await refusalOf(recordListWishAtDesk(db, actor, ana.id, true, NOW))).toBe("LIST_WISH_DESK_CLOSED");

    for (const id of [cancelled.id, expired.id, unconfirmed.id, ana.id]) {
      expect((await rowOf(id)).listOptOut, id).toBe(true);
      expect(await trail(id), id).toEqual([]);
      expect(await mails(id), id).toEqual([]);
    }
    // An unknown and a malformed id: the generic refusal, never a hint.
    expect(await refusalOf(recordListWishAtDesk(db, actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true, NOW))).toBe("NOT_FOUND");
    expect(await refusalOf(recordListWishAtDesk(db, actor, "not-an-id", true, NOW))).toBe("NOT_FOUND");
  });

  it("takes the wish it posts, never a flip: the same press twice is one change, one row and one email", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const ana = await anonymousRunner("Ana Dublă");
    await recordListWishAtDesk(db, actor, ana.id, true, NOW);
    expect(await recordListWishAtDesk(db, actor, ana.id, true, LATER)).toMatchObject({ listed: true, changed: false, emailed: false });
    expect(await trail(ana.id)).toHaveLength(1);
    expect(await mails(ana.id)).toHaveLength(1);
    // Hiding a name already hidden: nothing either.
    const ion = await anonymousRunner("Ion Ascuns");
    expect(await recordListWishAtDesk(db, actor, ion.id, false, NOW)).toMatchObject({ listed: false, changed: false });
    expect(await trail(ion.id)).toEqual([]);
  });
});

describe("§1017 through the action: asserted on the server, back to the row", () => {
  const form = (id: string, listed: boolean) => {
    const data = new FormData();
    data.set("uiLocale", "ro");
    data.set("registrationId", id);
    data.set("back", "desk");
    data.set("eventId", raceId);
    data.set("listed", listed ? "1" : "0");
    return data;
  };
  const pressed = async (data: FormData) => {
    try {
      await recordListWishAtDeskAction(null, data);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return message.startsWith("REDIRECT ") ? message.slice("REDIRECT ".length) : Promise.reject(error);
    }
  };

  it("a volunteer's press records the wish and comes back to the row saying so; a member's is refused and writes nothing", async () => {
    const ana = await anonymousRunner("Ana Acțiune");
    state.actor = await colleague("CONTRIBUTOR");
    const back = await pressed(form(ana.id, true));
    expect(back).toMatch(new RegExp(`[?&]row=${ana.id}&saved=listWishNamed#reg-${ana.id}$`));
    expect((await rowOf(ana.id)).listOptOut).toBe(false);
    const [mail] = await mails(ana.id);
    // The email press's stamp: who pressed and why (`notifications/press.ts`).
    expect(mail.requestedByStaffUserId).toBe((state.actor as StaffUser).id);
    expect(mail.cause).toBe("registrations.deskListWish");

    expect(await pressed(form(ana.id, false))).toMatch(/saved=listWishAnonymous/);
    expect((await rowOf(ana.id)).listOptOut).toBe(true);

    state.actor = await colleague("MEMBER");
    expect(await pressed(form(ana.id, true))).toMatch(/error=FORBIDDEN/);
    expect((await rowOf(ana.id)).listOptOut).toBe(true);
    expect(await trail(ana.id)).toHaveLength(2);
  });

  it("takes every desk role's press both ways, back to the row each time, the email press stamped with who pressed", async () => {
    for (const role of DESK_ROLES) {
      const ana = await anonymousRunner(`Ana Rol ${role}`);
      const actor = await colleague(role);
      state.actor = actor;
      expect(await pressed(form(ana.id, true)), role).toMatch(new RegExp(`[?&]row=${ana.id}&saved=listWishNamed#reg-${ana.id}$`));
      expect((await rowOf(ana.id)).listOptOut, role).toBe(false);
      const [mail, ...more] = await mails(ana.id);
      expect(more, role).toEqual([]);
      expect(mail, role).toMatchObject({ requestedByStaffUserId: actor.id, cause: "registrations.deskListWish" });

      expect(await pressed(form(ana.id, false)), role).toMatch(new RegExp(`[?&]row=${ana.id}&saved=listWishAnonymous#reg-${ana.id}$`));
      expect((await rowOf(ana.id)).listOptOut, role).toBe(true);
      // Hiding queued nothing more; both rows name the colleague, never the person.
      expect(await mails(ana.id), role).toHaveLength(1);
      const rows = await trail(ana.id);
      expect(rows.map((row) => [row.actor, (row.metadata as { via?: unknown }).via]), role).toEqual([
        [actor.id, "DESK"],
        [actor.id, "DESK"],
      ]);
      expect(JSON.stringify(rows), role).not.toContain(`Ana Rol ${role}`);
    }
  });

  it("says a refusal in its own words, on the alert", async () => {
    state.actor = await colleague("CONTRIBUTOR");
    const unconfirmed = await anonymousRunner("Dan Adresă", { status: "PENDING_EMAIL_CONFIRMATION" });
    expect(await pressed(form(unconfirmed.id, true))).toMatch(/error=LIST_WISH_ADDRESS_UNCONFIRMED#admin-alert$/);
    expect(ro.Admin.errors.LIST_WISH_ADDRESS_UNCONFIRMED).toContain("Confirmă pe hârtie");
    // A row that is over, pressed from a page drawn before it was cancelled: refused, nothing written.
    const cancelled = await anonymousRunner("Ion Anulat Între Timp", { status: "CANCELLED" });
    expect(await pressed(form(cancelled.id, true))).toMatch(/error=LIST_WISH_OVER#admin-alert$/);
    expect((await rowOf(cancelled.id)).listOptOut).toBe(true);
    expect(await trail(cancelled.id)).toEqual([]);
    expect(await mails(cancelled.id)).toEqual([]);
  });
});

describe("§1017 the results' name, where the person's own page would ask it (§879, BR-REQ-072-01 criterion 7)", () => {
  /** The notice the runner registered under (v1) did not describe the results; the club then approved one naming the tick (v2). */
  async function olderNoticeRunner(name: string) {
    await resetTables(db);
    resetNoticeCounter();
    raceId = (await createRace(db)).id;
    await approvePrivacyNotice(db, { results: false });
    const runner = await registerRunner(db, raceId, { name, bibNumber: 7, ticked: false, noticeVersion: 1 });
    await approvePrivacyNotice(db, { results: true, resultsNameAsk: true });
    await approveTerms(db, { results: true });
    return runner;
  }

  it("records the yes the manage page would, in the same press, with one audit row that says so", async () => {
    const ana = await olderNoticeRunner("Ana Veche");
    const actor = await colleague("CONTRIBUTOR");
    expect(await recordListWishAtDesk(db, actor, ana.id, true, NOW)).toMatchObject({ changed: true, resultsConsent: true });
    const after = await rowOf(ana.id);
    expect(after.resultsNameConsent).toBe(true);
    expect(after.resultsConsentVersion).toBe(2);
    expect(holdsResultsNameConsent(after, await findFirstResultsNameAskNoticeVersion(db))).toBe(true);
    // One row, the list's: no second `results_name_consent_changed` beside it.
    expect(await trail(ana.id)).toEqual([
      {
        action: "registration.list_consent_changed",
        actor: actor.id,
        participant: ana.participantId,
        metadata: { from: "NOT_LISTED", to: "LISTED", via: "DESK", resultsNameConsent: true, noticeVersion: 2 },
      },
    ]);
    // Hiding withdraws nothing of it: the results name a runner only while the list's tick is on (§808), as the person's doors leave it.
    await recordListWishAtDesk(db, actor, ana.id, false, LATER);
    expect((await rowOf(ana.id)).resultsNameConsent).toBe(true);
    expect((await rowOf(ana.id)).listOptOut).toBe(true);
  });

  it("sets nothing of the results while the question is not put, and still records the list's wish", async () => {
    // The notice in force describes the results but does not name the tick: nothing is asked (§879).
    const ion = await registerRunner(db, raceId, { name: "Ion Nou", bibNumber: 8, ticked: false, noticeVersion: 1 });
    const actor = await colleague("CONTRIBUTOR");
    expect(await recordListWishAtDesk(db, actor, ion.id, true, NOW)).toMatchObject({ changed: true, resultsConsent: false });
    expect((await rowOf(ion.id)).resultsNameConsent).toBe(false);
    expect((await rowOf(ion.id)).listOptOut).toBe(false);
    expect((await trail(ion.id))[0].metadata).toEqual({ from: "NOT_LISTED", to: "LISTED", via: "DESK" });
  });
});

describe("§1017 the person is told at once, with the way back", () => {
  it("queues one email, only when showing, whose button is the public list's switch — walked, it takes the name off", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const ana = await anonymousRunner("Ana Email");
    await recordListWishAtDesk(db, actor, ana.id, true, NOW);
    const [mail, ...others] = await mails(ana.id);
    expect(others).toEqual([]);
    expect(mail).toMatchObject({ participantId: ana.participantId, locale: "ro", requestedByStaffUserId: actor.id, status: "PENDING" });

    const sent = await renderOutboxMessage(mail, db, LATER);
    expect(sent.subject).toContain("Cu nume pe lista participanților");
    expect(sent.text).toContain("La masa de ridicare a numerelor");
    expect(sent.text).toContain("ai cerut să apari cu numele pe lista participanților și în clasament");
    expect(sent.text).toContain("Dacă nu e așa, apasă butonul de mai jos");
    expect(sent.text).toContain("Nu vreau să apar pe lista de participanți & rezultate");
    // The English half, as the house's emails carry both.
    expect(sent.text).toContain("At the race-number pick-up desk");
    const link = /\/ro\/inregistrari\/lista\/([A-Za-z0-9_-]+)/.exec(sent.html);
    expect(link, sent.html).not.toBeNull();
    const secret = link![1];
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "LIST_CONSENT"));
    expect(token).toMatchObject({ registrationId: ana.id, participantId: ana.participantId });

    // The link reads the wish as it stands (a GET writes nothing) and one press takes the name off.
    const read = await readListConsent(db, secret, "ro", LATER);
    expect(read.ok && read.listed).toBe(true);
    const undone = await consumeAndSetListConsent(db, secret, false, LATER);
    expect(undone.ok && undone.listed).toBe(false);
    expect((await rowOf(ana.id)).listOptOut).toBe(true);
    expect((await deskRowOf(ana.id)).namedOnSite).toBe(false);

    // Hiding at the desk emails nobody.
    const ion = await anonymousRunner("Ion Fără Email", { ticked: true });
    await recordListWishAtDesk(db, actor, ion.id, false, NOW);
    expect(await mails(ion.id)).toEqual([]);
  });

  it("speaks the person's language first, both halves as every email of the house", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const emma = await anonymousRunner("Emma English");
    await db.update(registrations).set({ locale: "en" }).where(eq(registrations.id, emma.id));
    await recordListWishAtDesk(db, actor, emma.id, true, NOW);
    const [mail] = await mails(emma.id);
    expect(mail.locale).toBe("en");
    const sent = await renderOutboxMessage(mail, db, LATER);
    expect(sent.subject.indexOf("By name on the participant list")).toBe(0);
    expect(sent.subject).toContain(" / Cu nume pe lista participanților");
    expect(sent.text).toContain("At the race-number pick-up desk");
    expect(sent.text).toContain("If that is not so, press the button below");
    expect(sent.text).toContain("La masa de ridicare a numerelor");
    expect(sent.text.indexOf("At the race-number pick-up desk")).toBeLessThan(sent.text.indexOf("La masa de ridicare a numerelor"));
    expect(sent.html).toMatch(/\/en\/registrations\/list\/[A-Za-z0-9_-]+/);
  });

  it("is withdrawn at the send when the name is off the list again by then", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const ana = await anonymousRunner("Ana Răzgândită");
    await recordListWishAtDesk(db, actor, ana.id, true, NOW);
    await recordListWishAtDesk(db, actor, ana.id, false, LATER);
    const [mail] = await mails(ana.id);
    await expect(renderOutboxMessage(mail, db, LATER)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
  });

  it("writes to a minor's parent or guardian, naming the child", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const minor = await anonymousRunner("Maria Mică");
    await db.update(registrations).set({ guardianName: "Ion Părinte" }).where(eq(registrations.id, minor.id));
    await recordListWishAtDesk(db, actor, minor.id, true, NOW);
    const [mail] = await mails(minor.id);
    const sent = await renderOutboxMessage(mail, db, LATER);
    expect(sent.text).toContain("Salut, Ion Părinte,");
    expect(sent.text).toContain("ai cerut ca Maria Mică să apară cu numele pe lista participanților și în clasament");
  });
});

describe("§1017 the club's hide stands (§910)", () => {
  it("records an elite's own wish and keeps the name hidden: the eye stays «Anonim», the line says why", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const elite = await anonymousRunner("Dana Elită");
    await db.update(registrations).set({ elite: true, eliteHiddenFromSite: true }).where(eq(registrations.id, elite.id));
    await db.update(events).set({ participantListVisibility: "NAMES" }).where(eq(events.id, raceId));

    expect(await recordListWishAtDesk(db, actor, elite.id, true, NOW)).toMatchObject({ changed: true, hiddenByClub: true, emailed: true });
    expect((await rowOf(elite.id)).listOptOut).toBe(false);
    expect((await deskRowOf(elite.id)).namedOnSite).toBe(false);
    expect((await listPublicStartList(db, raceId)).map((entry) => entry.displayName)).not.toContain(elite.displayName);

    const eye = await eyeOf(elite.id, "CONTRIBUTOR");
    expect(eye.press?.words).toBe(ro.Admin.desk.siteAnonymous);
    expect(eye.club).toBe(ro.Admin.desk.siteWish.clubHiddenNamed);
    // The press is the person's own wish the other way now: hiding.
    expect(eye.press?.listed).toBe("0");
    expect(eye.press?.question.body).toBe(ro.Admin.desk.siteWish.hideBodyHidden);
  });
});

describe("§1017 the eye on the row", () => {
  it("is a press for every desk role — 44 pixels, asking first, naming the person and the email — and the chip for no role", async () => {
    const ana = await anonymousRunner("Ana Ochi");
    for (const role of DESK_ROLES) {
      const eye = await eyeOf(ana.id, role);
      expect(eye.chip, role).toBeNull();
      expect(eye.press, role).toMatchObject({ words: "Anonim", icon: "siteAnonymous", listed: "1", minHeight: 44 });
      expect(eye.press?.question, role).toMatchObject({
        title: ro.Admin.desk.siteWish.showTitle.replace("{name}", "Ana Ochi"),
        body: "Numele apare pe site; persoana primește un email și poate retrage oricând.",
        confirmLabel: "Da, a spus — afișează pe site",
        cancelLabel: "Anulează",
      });
      expect(String(eye.press?.question.email), role).toContain("Ana Ochi");
    }
    expect(ro.Admin.desk.siteWish.showTitle).toBe("{name} ți-a spus acum că vrea să apară cu numele pe lista participanților și în clasament?");
    const none = await eyeOf(ana.id, undefined);
    expect(none.press).toBeNull();
    expect(none.chip).toEqual({ label: "Anonim", glyph: "hidden" });
  });

  it("says «Cu nume» after the press, and asks the way back naming no email; a minor's question names the parent", async () => {
    const actor = await colleague("CONTRIBUTOR");
    const ana = await anonymousRunner("Ana După Apăsare");
    await recordListWishAtDesk(db, actor, ana.id, true, NOW);
    const eye = await eyeOf(ana.id, "CONTRIBUTOR");
    expect(eye.press).toMatchObject({ words: "Cu nume", icon: "siteNamed", listed: "0" });
    expect(eye.press?.question).toMatchObject({ title: "Ana După Apăsare a cerut să nu mai apară cu numele?", confirmLabel: "Da — ascunde numele" });
    expect(String(eye.press?.question.email)).toContain("Nu pleacă niciun email");

    const minor = await anonymousRunner("Maria Minoră");
    await db.update(registrations).set({ guardianName: "Ion Tată" }).where(eq(registrations.id, minor.id));
    expect((await eyeOf(minor.id, "CONTRIBUTOR")).press?.question.title).toBe(
      "Ion Tată, părintele sau tutorele, ți-a spus acum că Maria Minoră poate apărea cu numele pe lista participanților și în clasament?",
    );
  });

  it("is the chip, never a press, on a closed desk and on an address never confirmed", async () => {
    const ana = await anonymousRunner("Ana Închis");
    expect((await eyeOf(ana.id, "ADMIN", { readOnly: true })).press).toBeNull();
    expect((await eyeOf(ana.id, "ADMIN", { readOnly: true })).chip).toEqual({ label: "Anonim", glyph: "hidden" });
    const dan = await anonymousRunner("Dan Neconfirmat", { status: "PENDING_EMAIL_CONFIRMATION" });
    expect((await eyeOf(dan.id, "ADMIN")).press).toBeNull();
    expect((await eyeOf(dan.id, "ADMIN")).chip).toEqual({ label: "Anonim", glyph: "hidden" });
  });

  it("speaks English too", async () => {
    expect(en.Admin.desk.siteWish.showConfirm).toBe("Yes, they said so — show on the site");
    expect(en.Admin.desk.siteWish.cancel).toBe("Cancel");
    for (const catalogue of [ro, en]) {
      for (const [key, words] of Object.entries(catalogue.Admin.desk.siteWish)) expect(words.length, key).toBeLessThanOrEqual(200);
    }
  });
});
