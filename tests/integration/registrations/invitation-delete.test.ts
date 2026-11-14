import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { InvitationRefusal } from "@/modules/registrations/domain/invitations";
import { isDomainError } from "@/shared/errors/domain-error";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Șterge» on an invitation that ended unaccepted (the owner, 2026-11-14, with a withdrawn invitation's row on
 * the registrations list: «am o invitație retrasă, vreau să o pot șterge!»). BR-REQ-037-07, and BR-REQ-060-01 for who.
 *
 * What is protected, on real PostgreSQL (PGlite), through the service, the panel as the server draws it and the real action:
 * - only an invitation that holds nothing is deleted — withdrawn, or past its deadline; one still open keeps its row
 *   and its counted place (BR-REQ-034-01: a live invitation is never deleted raw), one accepted keeps its registration;
 * - one past its deadline that the job has not stamped yet is swept first: its stamp, its `event.invitation_expired`
 *   row and the offer of its place to the line are made before the row goes;
 * - the row goes with its link, and what is left is one audit row with the invitation's id and how it had ended —
 *   never the name or the address; no place, state or email moves and the invitee is written nothing;
 * - the Administrator's alone: every other role is refused on the server, and the panel offers the verb to nobody else.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
// «Invitații» is a Server Component: its words from the catalogues, as the page has them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    getLocale: async () => state.locale,
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: state.locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));

const { confirmEmail, deleteEndedInvitationByStaff, inviteToEventByStaff, submitRegistration, withdrawInvitationByStaff } = await import("@/modules/registrations/service");
const { deleteEndedInvitation } = await import("@/modules/registrations/admin-service");
const { acceptInvitation, readInvitationLink } = await import("@/modules/registrations/invitations");
const { countOccupied } = await import("@/modules/registrations/repository");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { default: InvitationsPanel } = await import("@/modules/registrations/ui/InvitationsPanel");
const { deleteInvitationAction } = await import("@/app/[locale]/admin/registrations/invitation-actions");

const NOW = new Date("2026-11-10T08:00:00.000Z");
const STARTS = new Date("2026-11-21T07:00:00.000Z");
const DAY = 24 * 3_600_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];
type Element = ReactElement<Record<string, unknown>>;

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
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.invalid", displayName: "Organizer", role: "MODERATOR" }).returning();
  state.actor = admin;
});

async function createEvent(capacity: number, options: { auto?: boolean } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      eventStatus: "SCHEDULED",
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

/** What the invitation's form and the public form post. */
const answers = (firstName: string, sentAt: Date) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: `${firstName.toLowerCase()}@example.invalid`,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 1_000).toISOString(),
});

const invite = (event: EventInput, name: string, days: number, sentAt: Date = NOW) =>
  inviteToEventByStaff(db, event, { people: [{ name, email: `${name.split(" ")[0].toLowerCase()}@example.invalid` }], days, outsideCapacity: false }, admin, sentAt);

/** Somebody from the public form, with the address proved: on a full race, the waiting list. */
async function registered(event: EventInput, firstName: string, minute: number) {
  await submitRegistration(db, event, answers(firstName, at(minute)), at(minute), "REAL", { source: "PUBLIC" as const, createdByStaffUserId: null });
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${firstName} Munteanu`));
  return confirmEmail(db, event, row.id, at(minute));
}

const invitationOf = async (name: string) => (await db.select().from(eventInvitations).where(eq(eventInvitations.name, name)))[0];
const invitationsOf = (eventId: string) => db.select().from(eventInvitations).where(eq(eventInvitations.eventId, eventId));
const occupied = async (eventId: string, when: Date) => computeOccupied(await countOccupied(db, eventId, when));
const audits = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action as (typeof auditLogs.$inferSelect)["action"]));
const tokens = () => db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "ACCEPT_INVITATION"));
const refusalOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

/** The secret the newest invitation email of an address carries, rendered as the drain would. */
async function linkOf(email: string, when: Date): Promise<string> {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION"))).filter((row) => row.recipientEmail === email);
  const message = await renderOutboxMessage({ ...rows[rows.length - 1], status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return match[1];
}

describe("§NNN BR-REQ-037-07 «Șterge» deletes only an invitation that ended unaccepted", () => {
  it("a withdrawn one: the row and its link go, the trail keeps the id and how it ended — never the name or the address — and nothing else moves", async () => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 7);
    await invite(event, "Ana Pop", 7);
    const secret = await linkOf("paul@example.invalid", at(1));
    await linkOf("ana@example.invalid", at(1));
    expect(await tokens()).toHaveLength(2);
    const paul = await invitationOf("Paul Pepene");
    await withdrawInvitationByStaff(db, paul.id, admin, at(2));
    const emailsBefore = (await db.select().from(emailOutbox)).length;
    const before = await occupied(event.id, at(3));

    expect(await deleteEndedInvitationByStaff(db, paul.id, admin, at(3))).toEqual({ ended: "withdrawn" });

    // The row is gone and so is its link; the other invitation, its link and its kept place are as they were.
    expect((await invitationsOf(event.id)).map((row) => row.name)).toEqual(["Ana Pop"]);
    expect((await tokens()).map((token) => token.invitationId)).toEqual([(await invitationOf("Ana Pop")).id]);
    expect(await occupied(event.id, at(3))).toBe(before);
    // Nobody is written: no email is queued by the press.
    expect((await db.select().from(emailOutbox)).length).toBe(emailsBefore);
    // The link's page no longer finds an invitation, and its press registers nobody.
    expect((await readInvitationLink(db, secret, "ro", at(4))).kind).not.toBe("open");
    expect((await acceptInvitation(db, secret, answers("Paul", at(4)), at(4))).ok).toBe(false);
    expect(await db.select().from(registrations)).toEqual([]);

    // The trail: on the event, by the Administrator, the invitation's id and how it had ended — and nothing of the person.
    const [row] = await audits("event.invitation_deleted");
    expect(row).toMatchObject({ entityType: "event", entityId: event.id, actorStaffUserId: admin.id, participantId: null, metadataJson: { invitationId: paul.id, ended: "withdrawn" } });
    expect(Object.keys(row.metadataJson as object).sort()).toEqual(["ended", "invitationId"]);
    expect(JSON.stringify(row)).not.toMatch(/Paul|Pepene|paul@example/);
  });

  it("an email of the invitation still in the queue leaves nothing: the drain reads the invitation as gone", async () => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 7);
    const paul = await invitationOf("Paul Pepene");
    await withdrawInvitationByStaff(db, paul.id, admin, at(1));
    await deleteEndedInvitationByStaff(db, paul.id, admin, at(2));
    const [queued] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION"));
    const refused = await refusalOf(renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: at(3) }, db, at(3)));
    expect((refused as Error).name).toBe("OutboxMessageWithdrawn");
  });

  it("one the job stamped expired is deleted, and the trail says it had expired", async () => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 1);
    await linkOf("paul@example.invalid", at(1));
    expect(await tokens()).toHaveLength(1);
    const after = new Date(NOW.getTime() + DAY + 60_000);
    await runRegistrationMaintenance(db, after);
    const paul = await invitationOf("Paul Pepene");
    expect(paul.expiredAt).toEqual(after);

    expect(await deleteEndedInvitationByStaff(db, paul.id, admin, new Date(after.getTime() + 60_000))).toEqual({ ended: "expired" });
    expect(await invitationsOf(event.id)).toEqual([]);
    expect(await tokens()).toEqual([]);
    expect((await audits("event.invitation_deleted"))[0].metadataJson).toEqual({ invitationId: paul.id, ended: "expired" });
  });

  it("past its deadline and not swept yet: the sweep's stamp, its audit row and the offer of the place come first, then the row goes", async () => {
    const event = await createEvent(1, { auto: true });
    await invite(event, "Paul Pepene", 1);
    await linkOf("paul@example.invalid", at(1));
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const paul = await invitationOf("Paul Pepene");
    const after = new Date(NOW.getTime() + DAY + 60_000);
    // The job has not run: no stamp yet, and nobody offered.
    expect(paul.expiredAt).toBeNull();
    expect(await audits("event.invitation_expired")).toEqual([]);

    expect(await deleteEndedInvitationByStaff(db, paul.id, admin, after)).toEqual({ ended: "expired" });

    // What the job would have done is done: the expiry is on the trail, by nobody, and the freed place is offered to the line.
    const [expired] = await audits("event.invitation_expired");
    expect(expired).toMatchObject({ entityId: event.id, actorStaffUserId: null });
    expect((expired.metadataJson as { invitationId: string }).invitationId).toBe(paul.id);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
    // …and then the row is gone, with its link.
    expect(await invitationsOf(event.id)).toEqual([]);
    expect(await tokens()).toEqual([]);
    expect((await audits("event.invitation_deleted"))[0].metadataJson).toEqual({ invitationId: paul.id, ended: "expired" });
  });

  it("BR-REQ-034-01 refuses one still open: the row, its link and its counted place stay, and nothing is written", async () => {
    const event = await createEvent(1);
    await invite(event, "Paul Pepene", 7);
    await linkOf("paul@example.invalid", at(1));
    const paul = await invitationOf("Paul Pepene");
    expect(await occupied(event.id, at(1))).toBe(1);

    const refused = await refusalOf(deleteEndedInvitationByStaff(db, paul.id, admin, at(1)));
    expect(refused).toBeInstanceOf(InvitationRefusal);
    expect((refused as InvitationRefusal).refusal).toBe("INVITATION_NOT_ENDED");

    expect(await invitationOf("Paul Pepene")).toEqual(paul);
    expect(await tokens()).toHaveLength(1);
    expect(await occupied(event.id, at(1))).toBe(1);
    expect(await audits("event.invitation_deleted")).toEqual([]);
  });

  it("refuses one that became a registration: the invitation stays with its registration", async () => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 7);
    const secret = await linkOf("paul@example.invalid", at(1));
    const accepted = await acceptInvitation(db, secret, answers("Paul", at(2)), at(2));
    expect(accepted.ok).toBe(true);
    const paul = await invitationOf("Paul Pepene");
    expect(paul.acceptedAt).not.toBeNull();

    const refused = await refusalOf(deleteEndedInvitationByStaff(db, paul.id, admin, at(3)));
    expect((refused as InvitationRefusal).refusal).toBe("INVITATION_NOT_ENDED");
    expect(await invitationsOf(event.id)).toHaveLength(1);
    expect(await db.select().from(registrations)).toHaveLength(1);
    expect(await audits("event.invitation_deleted")).toEqual([]);
  });

  it("a second press, an id that names nothing and a malformed one find no invitation", async () => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 7);
    const paul = await invitationOf("Paul Pepene");
    await withdrawInvitationByStaff(db, paul.id, admin, at(1));
    await deleteEndedInvitationByStaff(db, paul.id, admin, at(2));
    for (const id of [paul.id, "00000000-0000-4000-8000-000000000000", "not-an-id", ""]) {
      const refused = await refusalOf(deleteEndedInvitationByStaff(db, id, admin, at(3)));
      expect(isDomainError(refused) && refused.code, id).toBe("NOT_FOUND");
    }
    expect(await audits("event.invitation_deleted")).toHaveLength(1);
  });

  it.each([["MODERATOR"], ["DEV"], ["CONTRIBUTOR"], ["COPYWRITER"], ["MEMBER"]] as const)(
    "BR-REQ-060-01 refuses the %s role, in the service and in the admin service, and deletes nothing",
    async (role) => {
      const event = await createEvent(3);
      await invite(event, "Paul Pepene", 7);
      const paul = await invitationOf("Paul Pepene");
      await withdrawInvitationByStaff(db, paul.id, admin, at(1));
      const [other] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.invalid`, displayName: role, role }).returning();
      for (const attempt of [deleteEndedInvitationByStaff(db, paul.id, other, at(2)), deleteEndedInvitation(db, other, paul.id, at(2))]) {
        const refused = await refusalOf(attempt);
        expect(isDomainError(refused) && refused.code, role).toBe("FORBIDDEN");
      }
      expect(await invitationsOf(event.id)).toHaveLength(1);
      expect(await audits("event.invitation_deleted")).toEqual([]);
    },
  );

  it.each([["ADMIN"], ["SUPERADMIN"]] as const)("serves the %s role", async (role) => {
    const event = await createEvent(3);
    await invite(event, "Paul Pepene", 7);
    const paul = await invitationOf("Paul Pepene");
    await withdrawInvitationByStaff(db, paul.id, admin, at(1));
    const [who] = await db.insert(staffUsers).values({ email: `second-${role.toLowerCase()}@example.invalid`, displayName: role, role }).returning();
    expect(await deleteEndedInvitation(db, who, paul.id, at(2))).toEqual({ ended: "withdrawn" });
    expect(await invitationsOf(event.id)).toEqual([]);
  });
});

/** Every element of a tree the Server Component returned, depth first. */
function elementsOf(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

type DeleteView = { confirm: ConfirmSpec; hidden: Record<string, string>; action: unknown; button: Record<string, unknown> };

/** Each invitation's «Șterge» as the panel draws it, by the invitee's name; absent where the row offers none. */
async function deleteForms(event: EventInput, now: Date, mayManage = true): Promise<Map<string, DeleteView | undefined>> {
  const never = (async () => null) as never;
  const tree = await InvitationsPanel({ db, actor: { role: mayManage ? "ADMIN" : "MODERATOR" }, locale: state.locale, eventId: event.id, mayManage, sendAction: never, resendAction: never, withdrawAction: never, deleteAction: deleteInvitationAction, now });
  const view = new Map<string, DeleteView | undefined>();
  for (const row of elementsOf(tree).filter((element) => element.props["data-testid"] === "invitation-row")) {
    const inside = elementsOf(row);
    const name = inside.map((element) => element.props.children).find((child) => typeof child === "string" && / (Pop|Pepene|Munteanu|Ionescu)$/.test(child)) as string;
    const form = inside.find((element) => element.props["data-testid"] === "invitation-delete-form");
    const within = form ? elementsOf(form.props.children as ReactNode) : [];
    view.set(
      name,
      form && {
        confirm: form.props.confirm as ConfirmSpec,
        action: form.props.action,
        hidden: Object.fromEntries(within.filter((element) => element.type === "input" && element.props.type === "hidden").map((input) => [String(input.props.name), String(input.props.value)])),
        button: within.find((element) => element.props.icon === "delete")?.props ?? {},
      },
    );
  }
  return view;
}

/** The action pressed with a form's own hidden fields; answers what the page it redirects to is told. */
async function press(hidden: Record<string, string>, pressedAt: Date): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(hidden)) form.set(name, value);
  try {
    await atTheClock(pressedAt, () => deleteInvitationAction(null, form));
  } catch (error) {
    const digest = String((error as { digest?: unknown } | null)?.digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    const told = /[?&](saved|error)=([A-Za-z_]+)(?=[&#;]|$)/.exec(digest);
    if (!told) throw new Error(`the redirect says neither saved nor error: ${digest}`);
    // Back at the section, on the event's own list.
    expect(digest).toContain(`eventId=${hidden.eventId}`);
    expect(digest).toContain("#registrations-invitations");
    return `${told[1]}=${told[2]}`;
  }
  throw new Error("expected a redirect");
}

describe("§NNN the panel offers «Șterge» on an ended invitation, and the press deletes it", () => {
  /** Four invitations of one event: open, withdrawn, expired and accepted. */
  async function four() {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    await invite(event, "Paul Pepene", 7);
    await invite(event, "Dan Ionescu", 1);
    await invite(event, "Elena Munteanu", 7);
    await withdrawInvitationByStaff(db, (await invitationOf("Paul Pepene")).id, admin, at(1));
    const secret = await linkOf("elena@example.invalid", at(2));
    expect((await acceptInvitation(db, secret, answers("Elena", at(3)), at(3))).ok).toBe(true);
    // Two days on: Dan's one day has passed, the others' seven have not.
    return { event, later: new Date(NOW.getTime() + 2 * DAY) };
  }

  it("on a withdrawn and on an expired invitation, never on an open or an accepted one; the question says the row goes and nobody is emailed", async () => {
    const { event, later } = await four();
    const forms = await deleteForms(event, later);
    expect([...forms].filter(([, form]) => form).map(([name]) => name).sort()).toEqual(["Dan Ionescu", "Paul Pepene"]);
    expect(forms.get("Ana Pop")).toBeUndefined();
    expect(forms.get("Elena Munteanu")).toBeUndefined();

    const paul = forms.get("Paul Pepene")!;
    expect(paul.action).toBe(deleteInvitationAction);
    expect(paul.hidden).toEqual({ uiLocale: "ro", eventId: event.id, invitationId: (await invitationOf("Paul Pepene")).id });
    expect(paul.button).toMatchObject({ icon: "delete", label: "Șterge", pendingLabel: "Se șterge…", color: "error" });
    expect(paul.confirm).toMatchObject({
      title: "Ștergi invitația?",
      body: "Invitația pentru Paul Pepene dispare din listă, cu linkul ei. Nu se poate reveni.",
      email: "Nu pleacă niciun email către Paul Pepene.",
      destructive: true,
      confirmLabel: "Șterge",
    });

    state.locale = "en";
    const english = (await deleteForms(event, later)).get("Dan Ionescu")!;
    expect(english.button).toMatchObject({ label: "Delete", pendingLabel: "Deleting…" });
    expect(english.confirm).toMatchObject({ title: "Delete the invitation?", body: "The invitation for Dan Ionescu leaves the list, with its link. This cannot be undone.", confirmLabel: "Delete" });
  });

  it("BR-REQ-060-01 the Organizer reads the list and is offered no «Șterge»; a press of theirs is refused and deletes nothing", async () => {
    const { event, later } = await four();
    const forms = await deleteForms(event, later, false);
    expect([...forms.values()].every((form) => form === undefined)).toBe(true);

    state.actor = organizer;
    const paul = await invitationOf("Paul Pepene");
    expect(await press({ uiLocale: "ro", eventId: event.id, invitationId: paul.id }, later)).toBe("error=FORBIDDEN");
    expect(await invitationsOf(event.id)).toHaveLength(4);
  });

  it("the press deletes the withdrawn and the expired one and says so; pressed again, or on an open one, it deletes nothing and says why", async () => {
    const { event, later } = await four();
    const forms = await deleteForms(event, later);

    expect(await press(forms.get("Paul Pepene")!.hidden, later)).toBe("saved=invitationDeleted");
    expect(await press(forms.get("Dan Ionescu")!.hidden, later)).toBe("saved=invitationDeleted");
    expect((await invitationsOf(event.id)).map((row) => row.name).sort()).toEqual(["Ana Pop", "Elena Munteanu"]);
    expect((await audits("event.invitation_deleted")).map((row) => (row.metadataJson as { ended: string }).ended).sort()).toEqual(["expired", "withdrawn"]);

    // A stale page: the same press again, and a press aimed at the open invitation.
    expect(await press(forms.get("Paul Pepene")!.hidden, later)).toBe("error=NOT_FOUND");
    const ana = await invitationOf("Ana Pop");
    expect(await press({ uiLocale: "ro", eventId: event.id, invitationId: ana.id }, later)).toBe("error=INVITATION_NOT_ENDED");
    expect(await invitationOf("Ana Pop")).toEqual(ana);
    expect(await audits("event.invitation_deleted")).toHaveLength(2);
  });

  it("says the refusal and the toast in both languages", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.errors.INVITATION_NOT_ENDED.length).toBeGreaterThan(20);
      expect(catalogue.Admin.invitations.errors.INVITATION_NOT_ENDED).toBe(catalogue.Admin.errors.INVITATION_NOT_ENDED);
      expect(catalogue.Feedback.toast.invitationDeleted.length).toBeGreaterThan(5);
      expect(catalogue.Admin.emails.causes.registrations.invitationDelete.length).toBeGreaterThan(5);
    }
    expect(ro.Feedback.toast.invitationDeleted).toBe("Invitație ștearsă.");
  });
});
