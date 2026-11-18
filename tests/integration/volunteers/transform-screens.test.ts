import { asc, eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { STAFF_ROLES, canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §948 — «Transformă în voluntar» and «Transformă în alergător» on the screens (the owner, 2026-11-15: «aș vrea să pot
 * să „transform" un alergător în voluntar și invers»). BR-REQ-037-03, BR-REQ-060-01, BR-REQ-041-01.
 *
 * What is protected, on real PostgreSQL (PGlite), through the two panels as the server draws them, the two pages that
 * hand them their press, and the real actions:
 * - each press asks first, naming the person, every email they get and — for the runner — the freed place's offer, a
 *   printed bib and «Trimite emailul» for the person's two emails together;
 * - the pages draw each fold only for a role that may manage registrations, and only where the press can work: a real
 *   registration that can still be cancelled; a volunteer who is not cancelled, on an event that takes registrations
 *   on the site and has not started;
 * - the actions post what the panels hold, refuse on the server whoever is not an Administrator, keep what was typed
 *   on a refusal, and land on the page of what the person became.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: Record<string, string> } }) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`,
  Link: () => null,
}));
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
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
// The panels are Server Components: their words from the catalogues, as the pages have them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    setRequestLocale: () => {},
    getLocale: async () => state.locale,
    getTranslations: async (arg: string | { locale: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = typeof arg === "string" ? state.locale : (arg.locale as "ro" | "en");
      return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
    },
  };
});
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));

const { default: TurnIntoVolunteerPanel } = await import("@/modules/volunteers/ui/TurnIntoVolunteerPanel");
const { default: TurnIntoRunnerPanel, splitVolunteerName } = await import("@/modules/volunteers/ui/TurnIntoRunnerPanel");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { turnRunnerIntoVolunteerAction, turnVolunteerIntoRunnerAction } = await import("@/app/[locale]/admin/registrations/actions");
const { changeVolunteer } = await import("@/modules/volunteers/volunteers");

// The actions read the wall clock, so the fixture is set against it: a race a month from now, every press today.
const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let seq = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  admin = await staff("ADMIN");
  state.actor = admin;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${seq++}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A race with one volunteers' role; `registrationMode` and the start as given. */
async function createRace(options: { capacity?: number; startsAt?: Date; registrationMode?: "INTERNAL" | "NONE"; roles?: boolean } = {}) {
  const internal = options.registrationMode !== "NONE";
  const [event] = await db
    .insert(events)
    .values({
      type: internal ? "RACE" : "GROUP_RUN",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: internal ? "INTERNAL" : "NONE",
      capacity: internal ? (options.capacity ?? 10) : null,
      bibStartNumber: 1,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning({ id: events.id });
  seq += 1;
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${seq}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${seq}` },
  ]);
  let roleId = "";
  if (options.roles !== false) {
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
    roleId = role.id;
  }
  return { eventId: event.id, roleId };
}

/** A runner of the race, written as the flow leaves one in the status given. */
async function runner(eventId: string, name: string, status: "CONFIRMED" | "WAITLISTED" | "CANCELLED" | "PENDING_EMAIL_CONFIRMATION" = "CONFIRMED", more: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  seq += 1;
  const email = `runner-${seq}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [first, ...rest] = name.split(" ");
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      firstName: first,
      lastName: rest.join(" "),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      ...(status === "CONFIRMED" ? { confirmedAt: NOW, emailConfirmedAt: NOW } : {}),
      ...(status === "WAITLISTED" ? { waitlistedAt: NOW, emailConfirmedAt: NOW } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...more,
    })
    .returning({ id: registrations.id });
  return row.id;
}

/** A volunteer as the card's hand entry writes one, confirmed, with the role given. */
async function volunteer(eventId: string, roleId: string, name: string, email: string | null): Promise<string> {
  const added = await changeVolunteer(db, admin, { kind: "add", eventId, fields: { assignedRoleIds: [roleId], name, email: email ?? "", phone: "+40712345678" } }, NOW, { sendEmail: false });
  await changeVolunteer(db, admin, { kind: "setState", eventId, id: added.volunteer.id, state: "CONFIRMED" }, NOW, { sendEmail: false });
  return added.volunteer.id;
}

/** Every element of a tree: the children, and any element handed through another prop. */
function elements(node: unknown, acc: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, acc);
    return acc;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return acc;
  acc.push(node as Element);
  for (const value of Object.values(node.props)) if (Array.isArray(value) || isValidElement(value)) elements(value, acc);
  return acc;
}

const byTestId = (tree: unknown, id: string) => elements(tree).find((element) => element.props["data-testid"] === id);
const hiddenOf = (form: Element) =>
  Object.fromEntries(
    elements(form.props.children)
      .filter((element) => element.type === "input" && element.props.type === "hidden")
      .map((input) => [String(input.props.name), String(input.props.value)]),
  );
const textOf = (tree: unknown): string =>
  elements(tree)
    .flatMap((element) => (Array.isArray(element.props.children) ? element.props.children : [element.props.children]))
    .filter((child): child is string => typeof child === "string")
    .join(" ");

/** An action pressed with a form; answers the address it sends the browser to, or the refusal it hands back. */
async function press(action: (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>, fields: Record<string, string>): Promise<{ to: string } | { refusal: FormOutcome }> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  try {
    const outcome = await action(null, form);
    if (outcome) return { refusal: outcome };
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return { to: message.slice("REDIRECT ".length) };
    throw error;
  }
  throw new Error("expected a redirect or a refusal");
}

const trail = async (action: string) => (await db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(asc(auditLogs.createdAt))).map((row) => row.metadataJson as Record<string, unknown>);

describe("§948 BR-REQ-037-03 «Transformă în voluntar»: the fold on the registration's page", () => {
  const panel = (more: Partial<Parameters<typeof TurnIntoVolunteerPanel>[0]> = {}) =>
    TurnIntoVolunteerPanel({
      locale: "ro",
      registrationId: "11111111-1111-4111-8111-111111111111",
      name: "Radu Munteanu",
      roles: [
        { id: "22222222-2222-4222-8222-222222222222", label: "Punct de apă (Traseu)" },
        { id: "33333333-3333-4333-8333-333333333333", label: "Start" },
      ],
      eventCardHref: "/ro/admin/events/e#box-volunteers",
      toVolunteerAction: turnRunnerIntoVolunteerAction,
      printedBib: null,
      freesAPlace: true,
      ...more,
    });

  it("asks first: the person, both emails they get, the freed place's offer, and «Trimite emailul» for the person's two together", async () => {
    const tree = await panel();
    const form = byTestId(tree, "to-volunteer-form") as Element;
    expect(form.props.action).toBe(turnRunnerIntoVolunteerAction);
    const confirm = form.props.confirm as ConfirmSpec;
    const words = ro.Admin.registrations.toVolunteer;
    expect(confirm).toMatchObject({ title: words.confirmTitle, body: words.confirmBody, confirmLabel: words.action, destructive: true });
    expect(confirm.email).toBe("Pleacă 1 email către Radu Munteanu: „Înscriere anulată”.");
    const also = confirm.also ?? [];
    // The second email is the person's too: said with the first, and unsaid — like it — once the box is unticked.
    expect(also).toContainEqual({ text: "Apoi încă 1 email către aceeași persoană: „Rolul tău de voluntar”." });
    // The next in line's offer is theirs, whatever the box says.
    expect(also).toContainEqual({ text: ro.Admin.confirm.mail.nextInLineMaybe });
    // Two answers (§976): «… și trimite emailul» / «… fără email», each the press's own verb filled in by the dialog.
    expect(confirm.emailOptOut).toMatchObject({ field: "sendEmail", sendLabel: ro.Admin.confirm.mail.sendButton, skipLabel: ro.Admin.confirm.mail.skipButton });

    expect(hiddenOf(form)).toEqual({ uiLocale: "ro", registrationId: "11111111-1111-4111-8111-111111111111" });
    const select = elements(form.props.children).find((element) => element.props.name === "roleId") as Element;
    expect(select.props).toMatchObject({ select: true, required: true, defaultValue: "22222222-2222-4222-8222-222222222222" });
    expect(elements(select.props.children).map((option) => [option.props.value, option.props.children])).toEqual([
      ["22222222-2222-4222-8222-222222222222", "Punct de apă (Traseu)"],
      ["33333333-3333-4333-8333-333333333333", "Start"],
    ]);
    expect(byTestId(tree, "to-volunteer-submit")?.props).toMatchObject({ icon: "volunteers", type: "submit", children: words.action });
    expect(textOf(tree)).toContain(words.numberNote);
  });

  it("names a printed bib before the press, and says nothing of an offer for a registration that holds no place", async () => {
    const confirm = (byTestId(await panel({ printedBib: "007", freesAPlace: false }), "to-volunteer-form") as Element).props.confirm as ConfirmSpec;
    expect(confirm.body).toBe(`Numărul 007 e deja tipărit; după anulare rămâne retras — nu se dă altcuiva — și trebuie scos din teanc. ${ro.Admin.registrations.toVolunteer.confirmBody}`);
    expect((confirm.also ?? []).map((line) => line.text)).not.toContain(ro.Admin.confirm.mail.nextInLineMaybe);
  });

  it("on an event with no role yet says so and links the event's «Voluntari» card: no form, nothing to press", async () => {
    const tree = await panel({ roles: [] });
    expect(byTestId(tree, "to-volunteer-form")).toBeUndefined();
    const empty = byTestId(tree, "to-volunteer-no-roles") as Element;
    expect(textOf(empty)).toContain(ro.Admin.registrations.toVolunteer.noRoles);
    expect(elements(empty).find((element) => element.props.href)?.props).toMatchObject({ href: "/ro/admin/events/e#box-volunteers", children: ro.Admin.registrations.toVolunteer.noRolesLink });
  });

  it("speaks English on the English backoffice", async () => {
    state.locale = "en";
    const confirm = (byTestId(await panel({ locale: "en" }), "to-volunteer-form") as Element).props.confirm as ConfirmSpec;
    expect(confirm.title).toBe(en.Admin.registrations.toVolunteer.confirmTitle);
    expect(confirm.email).toContain("Radu Munteanu");
    expect((confirm.also ?? []).some((line) => line.text.includes(en.Admin.emails.types.VOLUNTEER_ROLE_ASSIGNED))).toBe(true);
  });

  it("BR-REQ-060-01: the page draws the fold for the Administrator alone, on a real registration that can still be cancelled — with the event's roles", async () => {
    const { eventId, roleId } = await createRace();
    const confirmed = await runner(eventId, "Radu Munteanu");
    const page = async (id: string) => elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never));
    const fold = async (id: string) => (await page(id)).find((element) => element.type === TurnIntoVolunteerPanel);

    const drawn = await fold(confirmed);
    expect(drawn?.props).toMatchObject({
      registrationId: confirmed,
      name: "Radu Munteanu",
      roles: [{ id: roleId, label: "Punct de apă" }],
      toVolunteerAction: turnRunnerIntoVolunteerAction,
      printedBib: null,
      freesAPlace: true,
      eventCardHref: `/ro/admin/events/${eventId}#box-volunteers`,
    });
    // A runner who only waits frees no place; one whose bib is on paper has it named.
    expect((await fold(await runner(eventId, "Elena Pop", "WAITLISTED")))?.props).toMatchObject({ freesAPlace: false });
    expect((await fold(await runner(eventId, "Dan Ionescu", "CONFIRMED", { bibNumber: 7, bibPrintedAt: NOW })))?.props).toMatchObject({ printedBib: "7" });
    // Nobody to move: a cancelled registration, one whose address was never confirmed, a test one.
    expect(await fold(await runner(eventId, "Mara Pop", "CANCELLED"))).toBeUndefined();
    expect(await fold(await runner(eventId, "Ion Pop", "PENDING_EMAIL_CONFIRMATION"))).toBeUndefined();
    expect(await fold(await runner(eventId, "Test Pop", "CONFIRMED", { kind: "TEST" }))).toBeUndefined();

    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) continue;
      state.actor = await staff(role);
      const shown = await page(confirmed).catch((error: Error) => (error.message === "NOT_FOUND" ? [] : Promise.reject(error)));
      expect(shown.find((element) => element.type === TurnIntoVolunteerPanel), role).toBeUndefined();
    }
  });
});

describe("§948 BR-REQ-037-03 «Transformă în voluntar»: the press", () => {
  it("posts the role chosen, cancels with the page's own reason in the language of who pressed, and lands on the volunteer's page", async () => {
    const { eventId, roleId } = await createRace();
    const radu = await runner(eventId, "Radu Munteanu");

    const pressed = await press(turnRunnerIntoVolunteerAction, { uiLocale: "ro", registrationId: radu, roleId });

    const [row] = await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(row).toMatchObject({ name: "Radu Munteanu", state: "CONFIRMED", roleId });
    expect(pressed).toEqual({ to: `/ro/admin/volunteers/${row.id}?saved=runnerBecameVolunteer#admin-alert` });
    expect((await db.select().from(registrations).where(eq(registrations.id, radu)))[0].status).toBe("CANCELLED");
    expect((await trail("registration.cancelled_by_staff"))[0]).toMatchObject({ reason: ro.Admin.registrations.toVolunteer.reason });
    // Both of the person's emails carry the press's cause and who pressed.
    const sent = await db.select().from(emailOutbox).orderBy(asc(emailOutbox.messageType));
    expect(sent.map((email) => [email.messageType, email.cause])).toEqual([
      ["REGISTRATION_CANCELLED", "registrations.toVolunteer"],
      ["VOLUNTEER_ROLE_ASSIGNED", "registrations.toVolunteer"],
    ]);
    expect(new Set(sent.map((email) => email.requestedByStaffUserId))).toEqual(new Set([admin.id]));
    expect(ro.Feedback.toast.runnerBecameVolunteer).toBeTruthy();
    expect(en.Feedback.toast.runnerBecameVolunteer).toBeTruthy();
  });

  it("answered «Transformă în voluntar fără email» (`sendEmail` off) sends the person nothing and says so on the way back; the English page writes its reason in English", async () => {
    const { eventId, roleId } = await createRace();
    const radu = await runner(eventId, "Radu Munteanu");

    const pressed = await press(turnRunnerIntoVolunteerAction, { uiLocale: "en", registrationId: radu, roleId, sendEmail: "off" });

    const [row] = await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(pressed).toEqual({ to: `/en/admin/volunteers/${row.id}?saved=runnerBecameVolunteer&mailSkipped=1#admin-alert` });
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect((await trail("registration.cancelled_by_staff"))[0]).toMatchObject({ reason: en.Admin.registrations.toVolunteer.reason, emailSkipped: true });
  });

  it("BR-REQ-060-01: refuses on the server whoever is not an Administrator, and a role that is not the event's — the role chosen kept, nothing written", async () => {
    const { eventId, roleId } = await createRace();
    const other = await createRace();
    const radu = await runner(eventId, "Radu Munteanu");

    const wrongRole = await press(turnRunnerIntoVolunteerAction, { uiLocale: "ro", registrationId: radu, roleId: other.roleId });
    expect(wrongRole).toMatchObject({ refusal: { error: "VALIDATION_ERROR", fields: ["roleId"], values: { roleId: [other.roleId] } } });
    expect(ro.Admin.errors.RUNNER_TO_VOLUNTEER_MINOR).toBeTruthy();
    expect(en.Admin.errors.RUNNER_TO_VOLUNTEER_MINOR).toBeTruthy();

    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) continue;
      state.actor = await staff(role);
      expect(await press(turnRunnerIntoVolunteerAction, { uiLocale: "ro", registrationId: radu, roleId }), role).toMatchObject({ refusal: { error: "FORBIDDEN" } });
    }
    expect((await db.select().from(registrations).where(eq(registrations.id, radu)))[0].status).toBe("CONFIRMED");
    expect(await db.select().from(eventVolunteers)).toEqual([]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("writes the timeline's line for the registration in both languages", () => {
    expect(ro.Admin.registrations.audit.registration.became_volunteer).toContain("voluntar");
    expect(en.Admin.registrations.audit.registration.became_volunteer).toContain("volunteer");
  });
});

describe("§948 BR-REQ-037-03 «Transformă în alergător»: the fold on the volunteer's page", () => {
  const panel = (more: Partial<Parameters<typeof TurnIntoRunnerPanel>[0]> = {}) =>
    TurnIntoRunnerPanel({
      locale: "ro",
      eventId: "11111111-1111-4111-8111-111111111111",
      volunteerId: "22222222-2222-4222-8222-222222222222",
      name: "Ana Maria Pop",
      email: "ana@example.test",
      toRunnerAction: turnVolunteerIntoRunnerAction,
      ...more,
    });

  it("asks first: the address the person is registered on, and the entry's email by its outcome, naming the person as typed", async () => {
    const tree = await panel();
    const form = byTestId(tree, "to-runner-form") as Element;
    expect(form.props.action).toBe(turnVolunteerIntoRunnerAction);
    const confirm = form.props.confirm as ConfirmSpec;
    const words = ro.Admin.volunteers.toRunner;
    expect(confirm).toMatchObject({ title: words.confirmTitle, confirmLabel: words.action, fillFrom: ["firstName", "lastName"] });
    expect(confirm.body).toContain("ana@example.test");
    // The two outcomes of the one allocator, both named: the waiting list's email or the declaration to sign.
    expect(confirm.email).toContain("{firstName} {lastName}");
    expect(confirm.email).toContain(ro.Admin.emails.types.WAITLIST_JOINED);
    expect(confirm.email).toContain(ro.Admin.emails.types.COMPLETE_DECLARATION);
    expect(confirm.emailOptOut).toBeUndefined();
    expect(confirm.destructive).toBeUndefined();

    expect(hiddenOf(form)).toEqual({ uiLocale: "ro", eventId: "11111111-1111-4111-8111-111111111111", volunteerId: "22222222-2222-4222-8222-222222222222" });
    const boxes = elements(form.props.children).filter((element) => element.props.name === "firstName" || element.props.name === "lastName");
    expect(boxes.map((box) => [box.props.name, box.props.defaultValue, box.props.required])).toEqual([
      ["firstName", "Ana Maria", true],
      ["lastName", "Pop", true],
    ]);
    // The relay tick (§33): the official list's own words, required.
    const tick = elements(form.props.children).find((element) => element.props.name === "relayedByParticipantRequest") as Element;
    expect(tick.props).toMatchObject({ required: true, children: ro.Admin.registrations.relayConfirmation });
    expect(byTestId(tree, "to-runner-submit")?.props).toMatchObject({ icon: "addPerson", type: "submit", children: words.action });
  });

  it("starts the two names from the volunteer's one line, for the Administrator to check", () => {
    expect(splitVolunteerName("Ana Pop")).toEqual({ firstName: "Ana", lastName: "Pop" });
    expect(splitVolunteerName("  Ana   Maria  Pop ")).toEqual({ firstName: "Ana Maria", lastName: "Pop" });
    expect(splitVolunteerName("Ana")).toEqual({ firstName: "Ana", lastName: "" });
    expect(splitVolunteerName("")).toEqual({ firstName: "", lastName: "" });
  });

  it("for a volunteer with no address says why, and draws no form", async () => {
    const tree = await panel({ email: null });
    expect(byTestId(tree, "to-runner-form")).toBeUndefined();
    expect(textOf(byTestId(tree, "to-runner-no-address"))).toContain(ro.Admin.volunteers.toRunner.noAddress);
  });

  it("BR-REQ-060-01: the page draws the fold for the Administrator alone — not the Organizer, who works this page — and only where the entry can work", async () => {
    const { eventId, roleId } = await createRace();
    const ana = await volunteer(eventId, roleId, "Ana Pop", "ana@example.test");
    const fold = async (id: string) =>
      elements(await AdminVolunteerPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never)).find((element) => element.type === TurnIntoRunnerPanel);

    expect((await fold(ana))?.props).toMatchObject({ eventId, volunteerId: ana, name: "Ana Pop", email: "ana@example.test", toRunnerAction: turnVolunteerIntoRunnerAction });
    // A row with no address is drawn, to say why it cannot be pressed.
    expect((await fold(await volunteer(eventId, roleId, "Ion Fără Adresă", null)))?.props).toMatchObject({ email: null });

    // A cancelled volunteer, an event that takes no registrations on the site, an event that has started: no fold.
    await changeVolunteer(db, admin, { kind: "setState", eventId, id: ana, state: "CANCELLED" }, NOW, { sendEmail: false });
    expect(await fold(ana)).toBeUndefined();
    const training = await createRace({ registrationMode: "NONE" });
    expect(await fold(await volunteer(training.eventId, training.roleId, "Dan Pop", "dan@example.test"))).toBeUndefined();
    const started = await createRace({ startsAt: new Date(NOW.getTime() - 3_600_000) });
    expect(await fold(await volunteer(started.eventId, started.roleId, "Eva Pop", "eva@example.test"))).toBeUndefined();

    const live = await volunteer(eventId, roleId, "Mara Pop", "mara@example.test");
    state.actor = await staff("MODERATOR");
    expect(await fold(live)).toBeUndefined();
  });
});

describe("§948 BR-REQ-037-03 «Transformă în alergător»: the press", () => {
  const fields = (eventId: string, volunteerId: string, more: Record<string, string> = {}) => ({ uiLocale: "ro", eventId, volunteerId, firstName: "Ana", lastName: "Pop", relayedByParticipantRequest: "on", ...more });

  it("on a free place registers the person with the declaration to sign and lands on the registration's page; on a full race, on the waiting list", async () => {
    const { eventId, roleId } = await createRace({ capacity: 1 });
    const ana = await volunteer(eventId, roleId, "Ana Pop", "ana@example.test");

    const placed = await press(turnVolunteerIntoRunnerAction, fields(eventId, ana));

    const [registration] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(registration).toMatchObject({ status: "PENDING_DECLARATION", registeredName: "Ana Pop" });
    expect(placed).toEqual({ to: `/ro/admin/registrations/${registration.id}?saved=volunteerBecameRunnerPlaced#admin-alert` });
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, ana)))[0].state).toBe("CANCELLED");
    const sent = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration.id));
    expect(sent.map((email) => [email.messageType, email.cause, email.requestedByStaffUserId])).toEqual([["COMPLETE_DECLARATION", "volunteers.toRunner", admin.id]]);

    // The race is now full: the next volunteer joins the line.
    const dan = await volunteer(eventId, roleId, "Dan Ionescu", "dan@example.test");
    const waiting = await press(turnVolunteerIntoRunnerAction, fields(eventId, dan, { firstName: "Dan", lastName: "Ionescu" }));
    const [second] = await db.select().from(registrations).where(eq(registrations.registeredName, "Dan Ionescu"));
    expect(second.status).toBe("WAITLISTED");
    expect(waiting).toEqual({ to: `/ro/admin/registrations/${second.id}?saved=volunteerBecameRunnerWaiting#admin-alert` });
    for (const key of ["volunteerBecameRunnerPlaced", "volunteerBecameRunnerWaiting"] as const) {
      expect(ro.Feedback.toast[key]).toBeTruthy();
      expect(en.Feedback.toast[key]).toBeTruthy();
    }
  });

  it("BR-REQ-060-01: refuses on the server the Organizer and every other role, the entry without its tick, and a person already running on the address — what was typed kept, nothing written", async () => {
    const { eventId, roleId } = await createRace();
    const ana = await volunteer(eventId, roleId, "Ana Pop", "ana@example.test");

    const noTick = await press(turnVolunteerIntoRunnerAction, fields(eventId, ana, { relayedByParticipantRequest: "" }));
    expect(noTick).toMatchObject({ refusal: { error: "VALIDATION_ERROR", values: { firstName: ["Ana"], lastName: ["Pop"] } } });
    expect((noTick as { refusal: FormOutcome }).refusal.fields).toContain("relayedByParticipantRequest");

    // The volunteer's address already holds this person's registration: the entry's own sentence.
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: "ana@example.test", normalizedEmail: "ana@example.test", canonicalEmail: "ana@example.test", canonicalizationVersion: 2, defaultName: "Ana Pop", preferredLocale: "ro" })
      .returning({ id: participants.id });
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: "Ana Pop",
      firstName: "Ana",
      lastName: "Pop",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: NOW,
      emailConfirmedAt: NOW,
    });
    expect(await press(turnVolunteerIntoRunnerAction, fields(eventId, ana))).toMatchObject({ refusal: { error: "STAFF_ALREADY_ON_ADDRESS" } });
    expect(ro.Admin.errors.VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS).toBeTruthy();
    expect(en.Admin.errors.VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS).toBeTruthy();

    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) continue;
      state.actor = await staff(role);
      expect(await press(turnVolunteerIntoRunnerAction, fields(eventId, ana)), role).toMatchObject({ refusal: { error: "FORBIDDEN" } });
    }
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, ana)))[0].state).toBe("CONFIRMED");
    expect(await db.select().from(registrations).where(eq(registrations.eventId, eventId))).toHaveLength(1);
    expect(await trail("volunteer.became_runner")).toEqual([]);
  });
});
