import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { recordPaperVolunteerAgreement, requestVolunteerAgreement } from "@/modules/volunteers/agreement";
import { countConfirmedVolunteers } from "@/modules/volunteers/badges/badges";
import { agreementRolesStamp } from "@/modules/volunteers/domain/volunteer";
import { recordPaperVolunteerGuardian, requestVolunteerGuardian } from "@/modules/volunteers/guardian";
import { readPublicVolunteersList } from "@/modules/volunteers/public-list";
import { changeVolunteer, listVolunteers, submitVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { bornAged } from "../../helpers/volunteer-birth";
import { readSheet } from "../../helpers/xlsx";

/**
 * §865 — a volunteer the club types with no address, no telephone number, or neither (the owner, 2026-10-28: «Cand adaug voluntar
 * de mana, as vrea sa pot adaug si fara adresa de mail si telefon, doar sa fie asa pe lista»), on a real schema, through the card's
 * own Server Actions, the services and the pages:
 *
 * - «Adaugă» and «Modifică» take either box empty on a row the club typed (`STAFF`); a row the person typed on the public form keeps
 *   both, and the public form still asks both;
 * - a row with no address meets no address's uniqueness — two of one name both stand — and an address typed into it later does, refused
 *   on the email box (`VOLUNTEER_ALREADY_LISTED`) when it is another row's;
 * - no outbox row is ever queued for it — the roles given, taken back, changed, a reopening, the agreement's copy after the paper, the
 *   parent's paper — and a message queued while it still had an address is withdrawn at the send once the address is gone;
 * - the verbs that only send an email are not drawn for it, one line says why where they would be, and the service refuses them
 *   (`VOLUNTEER_NO_EMAIL`) when posted anyway;
 * - every display of the person — the person's page, the «Voluntari» list, the CSV, the Excel files, the public list, the badges' count —
 *   draws a missing address or telephone number as nothing: no «null», no `mailto:` or `tel:` to nothing.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", redirected: [] as string[] }));

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
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screens ask of it: the locale's prefix, the params filled in, a query appended.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf(state.locale, href), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");
const eventExport = await import("@/app/api/admin/events/[id]/volunteers/route");
const allExport = await import("@/app/api/admin/volunteers/export/route");
const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");

const NOW = new Date("2026-10-28T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const STARTS = new Date(NOW.getTime() + 30 * DAY);
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
/** A date of birth that makes a person `years` old on the event's day (§773). */
const aged = (years: number) => bornAged(years, STARTS);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;
let waterId: string;
let finishId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

/** The notice in force names the volunteers, the agreement's acceptance, the profile and the minors (§754, §758, §765, §768), in both languages. */
async function approveNotice() {
  const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}, {{volunteerMinors}}): ${text}`] }] });
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
    { locale: "en", title: "Privacy", body: body("we keep the name") },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/** The volunteer agreement from the platform's template, in both languages (its minors' clause names the guardian). */
async function approveAgreement() {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
  await insertLegalDocumentVersion(db, {
    key: "VOLUNTEER_AGREEMENT",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  await approveNotice();
  await approveAgreement();
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: STARTS, featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY) })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${eventId.slice(0, 8)}`, title: "Crosul", locationName: "Parcul central" },
    { eventId, locale: "en", slug: `cross-${eventId.slice(0, 8)}`, title: "The cross", locationName: "Central park" },
  ]);
  const [water, finish] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 },
      { eventId, nameRo: "Sosire", nameEn: "Finish", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  waterId = water.id;
  finishId = finish.id;
});

/** A posted form; a list is a group of boxes posting one name several times (the roles ticked, §761). */
function form(fields: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") data.set(name, value);
    else for (const item of value) data.append(name, item);
  }
  return data;
}

type Stateful = (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;

/** Runs an action that redirects on success and returns its refusal otherwise. */
async function post(action: Stateful, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

/** A one-button form: it always redirects back, with the refusal's code in the address when it has one. */
async function press(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

/** «Adaugă un voluntar de mână» through the card's action; the boxes left out are posted empty, as the form posts them. */
async function addByHand(fields: Record<string, string | readonly string[]>): Promise<string> {
  const outcome = await post(actions.addVolunteerAction, form({ email: "", phone: "", note: "", roleIds: [waterId], ...fields }));
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
  const [row] = await db
    .select({ id: eventVolunteers.id })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.name, String(fields.name))))
    .orderBy(eventVolunteers.createdAt);
  return row.id;
}

const rowOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
const outbox = () => db.select().from(emailOutbox);
const trail = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(auditLogs.createdAt)).map((row) => row.action);
const render = (row: unknown, at = NOW) => renderOutboxMessage({ ...(row as OutboxRow), status: "PROCESSING", lockedAt: at }, db, at);

/** What the card's «PDF de semnat» printed for this person now: the version in force in their language and their roles. */
async function printedFor(id: string) {
  const person = await rowOf(id);
  const version = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", person.locale, NOW);
  const given = (await db.select({ roleId: eventVolunteerRoleAssignments.roleId }).from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, id))).map((row) => row.roleId);
  const chosen = (await db.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, id))).map((row) => row.roleId);
  return { documentId: version?.id ?? "", roles: agreementRolesStamp(given, chosen) };
}

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

const personPage = async (id: string, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return html(await AdminVolunteerPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve({}) }));
};
const listPage = async (params: Record<string, string> = {}) => {
  state.locale = "ro";
  return html(await AdminVolunteersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(params) }));
};

/** An input's opening tag by its exact name. */
const inputNamed = (page: string, name: string) => new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";

/** Nothing of a missing value leaks into a page as words or as a link. */
function expectNoNullShown(page: string) {
  expect(page).not.toMatch(/>\s*null\s*</);
  expect(page).not.toMatch(/mailto:(null|")/);
  expect(page).not.toMatch(/tel:(null|")/);
}

describe("§865 the table's two CHECKs, on the migrated schema the suite runs on", () => {
  const base = () => ({ eventId, name: "Doar Nume", source: "STAFF" as const, createdAt: NOW, updatedAt: NOW });

  it("refuses an address without its canonical form or its version, and either of those without an address", async () => {
    for (const address of [
      { email: "a@example.test", canonicalEmail: null, canonicalizationVersion: 2 },
      { email: "a@example.test", canonicalEmail: "a@example.test", canonicalizationVersion: null },
      { email: null, canonicalEmail: "a@example.test", canonicalizationVersion: 2 },
    ]) {
      await expectViolation(db.insert(eventVolunteers).values({ ...base(), ...address }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_volunteers_address_whole" });
    }
  });

  it("refuses a row from the public form without an address, or without a telephone number", async () => {
    await expectViolation(db.insert(eventVolunteers).values({ ...base(), source: "PUBLIC", phone: "+40712345678" }), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "event_volunteers_public_contact",
    });
    await expectViolation(
      db.insert(eventVolunteers).values({ ...base(), source: "PUBLIC", email: "p@example.test", canonicalEmail: "p@example.test", canonicalizationVersion: 2 }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_volunteers_public_contact" },
    );
  });

  it("takes a row the club typed with a name alone — twice, the same name — and still refuses one address twice", async () => {
    await db.insert(eventVolunteers).values([base(), base()]);
    expect(await db.select({ id: eventVolunteers.id }).from(eventVolunteers).where(eq(eventVolunteers.name, "Doar Nume"))).toHaveLength(2);
    const withAddress = { ...base(), email: "x@example.test", canonicalEmail: "x@example.test", canonicalizationVersion: 2 };
    await db.insert(eventVolunteers).values(withAddress);
    await expectViolation(db.insert(eventVolunteers).values(withAddress), { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "event_volunteers_event_canonical_email_unique" });
  });
});

describe("§865 «Adaugă» and «Modifică» take a person the club types with no address, no telephone, or neither", () => {
  it("adds one with neither, one with an address alone and one with a telephone alone — the address's three columns null together", async () => {
    const nameOnly = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    const emailOnly = await addByHand({ name: "Doar Email", email: "Doar.Email@Example.test" });
    const phoneOnly = await addByHand({ name: "Doar Telefon", phone: "0712 345 678" });
    expect(await rowOf(nameOnly)).toMatchObject({ email: null, canonicalEmail: null, canonicalizationVersion: null, phone: null, source: "STAFF", state: "REGISTERED", createdByStaffUserId: admin.id });
    expect(await rowOf(emailOnly)).toMatchObject({ email: "Doar.Email@Example.test", canonicalEmail: "doar.email@example.test", canonicalizationVersion: 2, phone: null });
    expect(await rowOf(phoneOnly)).toMatchObject({ email: null, canonicalEmail: null, canonicalizationVersion: null, phone: "+40712345678" });
    // The card's read hands them on as they are: null, never "".
    const listed = (await listVolunteers(db, eventId)).map((person) => [person.name, person.email, person.phone]).sort();
    expect(listed).toEqual([
      ["Doar Email", "Doar.Email@Example.test", null],
      ["Doar Nume", null, null],
      ["Doar Telefon", null, "+40712345678"],
    ]);
    // Audited by ids, as every entry.
    expect((await trail()).filter((action) => action === "volunteer.added")).toHaveLength(3);
  });

  it("lets two people of one name, entered with no address, both stand", async () => {
    const first = await addByHand({ name: "Maria Pop" });
    expect(await post(actions.addVolunteerAction, form({ name: "Maria Pop", email: "", phone: "", note: "", roleIds: [finishId] }))).toBe("redirected");
    const marias = await db.select({ id: eventVolunteers.id }).from(eventVolunteers).where(eq(eventVolunteers.name, "Maria Pop"));
    expect(marias).toHaveLength(2);
    expect(marias.map((row) => row.id)).toContain(first);
  });

  it("still refuses what is typed and is no address or no number, naming the box and keeping what was typed", async () => {
    const badAddress = await post(actions.addVolunteerAction, form({ name: "Greșit", email: "nu-e-adresă", phone: "", note: "", roleIds: [waterId] }));
    expect(badAddress).toMatchObject({ error: "VALIDATION_ERROR", fields: ["email"] });
    expect((badAddress as FormOutcome).values.email?.[0]).toBe("nu-e-adresă");
    expect(await post(actions.addVolunteerAction, form({ name: "Greșit", email: "", phone: "abc", note: "", roleIds: [waterId] }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["phone"] });
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
  });

  it("takes an address typed into a name-only row later — refused on its box when it is another row's — and clears it again", async () => {
    await addByHand({ name: "Ion Test", email: "ion@example.test", phone: "0712 345 679" });
    const maria = await addByHand({ name: "Maria Pop" });
    const edit = (fields: Record<string, string>) => post(actions.editVolunteerAction, form({ volunteerId: maria, name: "Maria Pop", note: "", roleIds: [waterId], email: "", phone: "", ...fields }));

    // Ion's address, spelled otherwise: the uniqueness applies once the row has an address.
    const clash = await edit({ email: " ION@Example.test " });
    expect(clash).toMatchObject({ error: "VOLUNTEER_ALREADY_LISTED", fields: ["email"] });
    expect((clash as FormOutcome).values.email?.[0]).toBe(" ION@Example.test ");
    expect(await rowOf(maria)).toMatchObject({ email: null, canonicalEmail: null, canonicalizationVersion: null });

    // A free one is saved with its identity, and the telephone with it.
    expect(await edit({ email: "maria.pop@example.test", phone: "0722 000 111" })).toBe("redirected");
    expect(await rowOf(maria)).toMatchObject({ email: "maria.pop@example.test", canonicalEmail: "maria.pop@example.test", canonicalizationVersion: 2, phone: "+40722000111" });
    // Cleared again: the row is on the list only.
    expect(await edit({})).toBe("redirected");
    expect(await rowOf(maria)).toMatchObject({ email: null, canonicalEmail: null, canonicalizationVersion: null, phone: null });
    const edited = (await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"))).map((row) => (row.metadataJson as { fields: string[] }).fields);
    expect(edited).toEqual([
      ["email", "phone"],
      ["email", "phone"],
    ]);
    // The trail names the boxes, never what was in them.
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toMatch(/maria\.pop@|\+40722/);
  });

  it("keeps the address and the telephone of a row the person typed on the public form required on «Modifică»", async () => {
    const [ana] = await db
      .insert(eventVolunteers)
      .values({ eventId, name: "Ana Public", email: "ana@example.test", canonicalEmail: "ana@example.test", canonicalizationVersion: 2, phone: "+40712345670", source: "PUBLIC", createdAt: NOW, updatedAt: NOW })
      .returning({ id: eventVolunteers.id });
    await db.insert(eventVolunteerRoleChoices).values({ volunteerId: ana.id, roleId: waterId });
    const refused = await post(actions.editVolunteerAction, form({ volunteerId: ana.id, name: "Ana Public", email: "", phone: "", note: "", roleIds: [waterId] }));
    expect(refused).toMatchObject({ error: "VALIDATION_ERROR" });
    expect([...(refused as FormOutcome).fields].sort()).toEqual(["email", "phone"]);
    expect(await rowOf(ana.id)).toMatchObject({ email: "ana@example.test", phone: "+40712345670" });
    // The service holds the rule whatever the form drew.
    await expect(
      changeVolunteer(db, admin, { kind: "edit", eventId, id: ana.id, fields: { roleIds: [waterId], name: "Ana Public", email: "", phone: "+40712345670" } }, NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["email"] });
    // A change that keeps both is a save, as before.
    expect(await post(actions.editVolunteerAction, form({ volunteerId: ana.id, name: "Ana Public", email: "ana@example.test", phone: "+40712345670", note: "Sună după 18", roleIds: [waterId] }))).toBe("redirected");
    expect((await rowOf(ana.id)).note).toBe("Sună după 18");
  });

  it("leaves the public sign-up asking an address and a telephone number: refused, naming both, nothing kept", async () => {
    const posted = { roleIds: [waterId], name: "Public Gol", email: "", phone: "", message: "", locale: "ro", consent: true, agreement: true, birthDate: aged(30), sex: "FEMALE", city: "Brașov", renderedAt: RENDERED };
    const error = await submitVolunteer(db, eventId, posted, NOW).catch((caught: unknown) => caught);
    expect(isDomainError(error) && error.code).toBe("VALIDATION_ERROR");
    expect(isDomainError(error) ? [...error.fields].sort() : []).toEqual(["email", "phone"]);
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("§865 nothing is ever queued for a person with no address", () => {
  it("queues no outbox row when roles are given, given again, taken back, changed in «Modifică», or the person is reopened", async () => {
    const id = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: id, roleId: finishId }))).not.toContain("volunteerError");
    expect(await press(actions.unassignVolunteerAction, form({ volunteerId: id, roleId: waterId }))).not.toContain("volunteerError");
    expect(await post(actions.editVolunteerAction, form({ volunteerId: id, name: "Doar Nume", email: "", phone: "", note: "", roleIds: [waterId], assignedRoleIds: [waterId, finishId] }))).toBe("redirected");
    await press(actions.setVolunteerStateAction, form({ volunteerId: id, state: "CANCELLED" }));
    await press(actions.setVolunteerStateAction, form({ volunteerId: id, state: "REGISTERED" }));
    await press(actions.setVolunteerStateAction, form({ volunteerId: id, state: "CONFIRMED" }));
    // Every verb ran — the roles stand as the last press left them …
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ roleIds: [waterId, finishId], state: "CONFIRMED" });
    expect(await trail()).toEqual(
      expect.arrayContaining(["volunteer.added", "volunteer.assigned", "volunteer.unassigned", "volunteer.edited", "volunteer.state_changed"]),
    );
    // … and not one message was queued, not even one to withdraw later.
    expect(await outbox()).toHaveLength(0);
    // The press says so: its result tells the action the row has no address, so the toast never promises an email.
    expect(await changeVolunteer(db, admin, { kind: "unassign", eventId, id, roleId: finishId }, NOW)).toEqual({ changed: true, volunteer: { id, hasAddress: false } });
    expect(await outbox()).toHaveLength(0);
  });

  it("records the agreement and the parent's consent on paper and queues no copy to anyone", async () => {
    const adult = await addByHand({ name: "Adult Fără Adresă", assignedRoleIds: [waterId] });
    await recordPaperVolunteerAgreement(db, admin, { eventId, id: adult, printed: await printedFor(adult) }, NOW);
    expect(await rowOf(adult)).toMatchObject({ agreementMethod: "PAPER", agreementRecordedByStaffUserId: admin.id });

    const minor = await addByHand({ name: "Minor Fără Adresă", assignedRoleIds: [waterId], birthDate: aged(15), guardianName: "Elena Părinte", guardianEmail: "elena@example.test" });
    expect(await rowOf(minor)).toMatchObject({ age: 15, guardianName: "Elena Părinte", guardianEmail: "elena@example.test", email: null });
    await recordPaperVolunteerAgreement(db, admin, { eventId, id: minor, printed: await printedFor(minor) }, NOW);
    await recordPaperVolunteerGuardian(db, admin, { eventId, id: minor, printed: await printedFor(minor) }, NOW);
    expect(await rowOf(minor)).toMatchObject({ agreementMethod: "PAPER", guardianMethod: "PAPER" });
    // A person with an address gets the copy, as before — the rule is the address, not the paper.
    const withAddress = await addByHand({ name: "Cu Adresă", email: "cu.adresa@example.test", assignedRoleIds: [finishId] });
    const before = (await outbox()).length;
    await recordPaperVolunteerAgreement(db, admin, { eventId, id: withAddress, printed: await printedFor(withAddress) }, NOW);
    const copies = (await outbox()).filter((row) => row.messageType === "VOLUNTEER_AGREEMENT_ACCEPTED");
    expect(copies.map((row) => row.recipientEmail)).toEqual(["cu.adresa@example.test"]);
    expect((await outbox()).length).toBe(before + 1);
    expect((await outbox()).filter((row) => (row.payloadJson as { volunteerId: string }).volunteerId !== withAddress)).toEqual([]);
  });

  it("withdraws at the send a message queued while the row still had an address, once the address is cleared, and queues nothing for the clearing", async () => {
    const id = await addByHand({ name: "Maria Test", email: "maria@example.test", assignedRoleIds: [waterId] });
    await requestVolunteerAgreement(db, admin, { eventId, id }, NOW);
    const queued = await outbox();
    expect(queued.map((row) => row.messageType).sort()).toEqual(["VOLUNTEER_AGREEMENT_REQUEST", "VOLUNTEER_ROLE_ASSIGNED"]);
    expect(await post(actions.editVolunteerAction, form({ volunteerId: id, name: "Maria Test", email: "", phone: "", note: "", roleIds: [waterId], assignedRoleIds: [waterId] }))).toBe("redirected");
    expect(await outbox()).toHaveLength(2);
    for (const row of queued) await expect(render(row), row.messageType).rejects.toThrow(/no address/);
    // No agreement link was minted for the mailbox the row no longer names.
    expect((await rowOf(id)).agreementTokenHash).toBeNull();
  });

  it("tells a person their roles once an address is typed into their row, at that address", async () => {
    const id = await addByHand({ name: "Ion Test", assignedRoleIds: [waterId] });
    expect(await outbox()).toHaveLength(0);
    expect(await post(actions.editVolunteerAction, form({ volunteerId: id, name: "Ion Test", email: "ion@example.test", phone: "", note: "", roleIds: [waterId], assignedRoleIds: [waterId] }))).toBe("redirected");
    const [told] = await outbox();
    expect(told).toMatchObject({ messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "ion@example.test", payloadJson: { eventId, volunteerId: id, roleIds: [waterId] } });
    expect((await render(told)).text).toContain("Rol: Punct de apă");
  });
});

describe("§865 the verbs that only send an email", () => {
  it("refuses the agreement's link and the parent's link for a person with no address (VOLUNTEER_NO_EMAIL), writing and queuing nothing", async () => {
    const adult = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    await expect(requestVolunteerAgreement(db, admin, { eventId, id: adult }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_NO_EMAIL" });
    expect(await press(actions.requestVolunteerAgreementAction, form({ volunteerId: adult }))).toContain("volunteerError=VOLUNTEER_NO_EMAIL");
    expect((await rowOf(adult)).agreementRequestedAt).toBeNull();

    const minor = await addByHand({ name: "Minor Doar Nume", assignedRoleIds: [waterId], birthDate: aged(15), guardianName: "Elena Părinte", guardianEmail: "elena@example.test" });
    await expect(requestVolunteerGuardian(db, admin, { eventId, id: minor }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_NO_EMAIL" });
    expect(await press(actions.requestVolunteerGuardianAction, form({ volunteerId: minor }))).toContain("volunteerError=VOLUNTEER_NO_EMAIL");
    expect((await rowOf(minor)).guardianRequestedAt).toBeNull();

    expect(await outbox()).toHaveLength(0);
    expect(await trail()).not.toEqual(expect.arrayContaining(["volunteer.agreement_requested"]));
    expect(await trail()).not.toEqual(expect.arrayContaining(["volunteer.guardian_requested"]));
    // Both sentences exist in both catalogues.
    expect(ro.Admin.errors.VOLUNTEER_NO_EMAIL).toMatch(/hârtie/);
    expect(en.Admin.errors.VOLUNTEER_NO_EMAIL).toMatch(/paper/);
  });

  it("draws neither verb for such a person and says why in one line where it would be, in both languages; a person with an address keeps both", async () => {
    const adult = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    const minor = await addByHand({ name: "Minor Doar Nume", assignedRoleIds: [waterId], birthDate: aged(15), guardianName: "Elena Părinte", guardianEmail: "elena@example.test" });
    const withAddress = await addByHand({ name: "Minor Cu Adresă", email: "minor@example.test", assignedRoleIds: [waterId], birthDate: aged(16), guardianName: "Dan Părinte", guardianEmail: "dan@example.test" });

    const adultPage = await personPage(adult);
    expect(adultPage).toContain('data-testid="volunteer-agreement-no-email"');
    expect(adultPage).toContain(ro.Admin.volunteers.agreement.noEmail);
    expect(adultPage).toContain(ro.Admin.volunteers.agreement.helpPaper);
    expect(adultPage).not.toContain('data-testid="volunteer-agreement-send-form"');
    // The paper stays: the PDF to sign and «Semnat pe hârtie».
    expect(adultPage).toContain('data-testid="volunteer-agreement-pdf"');
    expect(adultPage).toContain(ro.Admin.volunteers.agreement.paper);
    expect(await personPage(adult, "en")).toContain(en.Admin.volunteers.agreement.noEmail);

    const minorPage = await personPage(minor);
    expect(minorPage).toContain('data-testid="volunteer-guardian-volunteer-no-email"');
    expect(minorPage).toContain(ro.Admin.volunteers.guardian.volunteerNoEmail);
    expect(minorPage).not.toContain('data-testid="volunteer-guardian-send-form"');
    expect(minorPage).toContain('data-testid="volunteer-guardian-pdf-to-sign"');

    const control = await personPage(withAddress);
    expect(control).toContain('data-testid="volunteer-agreement-send-form"');
    expect(control).toContain('data-testid="volunteer-guardian-send-form"');
    expect(control).not.toContain('data-testid="volunteer-agreement-no-email"');
    expect(control).not.toContain('data-testid="volunteer-guardian-volunteer-no-email"');
  });
});

describe("§865 every display of the person draws a missing address or telephone number as nothing", () => {
  it("the person's page: no `mailto:` or `tel:` to nothing, never «null», one line that says the person is on the list only", async () => {
    const nameOnly = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    const page = await personPage(nameOnly);
    expect(page).not.toContain('data-testid="volunteer-email"');
    expect(page).not.toContain('data-testid="volunteer-phone"');
    expect(page).toContain('data-testid="volunteer-no-email"');
    expect(page).toContain(ro.Admin.volunteers.person.noEmail);
    expectNoNullShown(page);
    // «Modifică»: both boxes optional on the club's own row, each saying so — and what an empty address means.
    expect(inputNamed(page, "email")).not.toMatch(/\brequired\b/);
    expect(inputNamed(page, "phone")).not.toMatch(/\brequired\b/);
    expect(page).toContain(ro.Admin.volunteers.person.emailHelp);
    expect(page).toContain(ro.Admin.volunteers.person.phoneHelp);
    expect(await personPage(nameOnly, "en")).toContain(en.Admin.volunteers.person.emailHelp);

    // An address and no telephone: the address is a link, and there is no `tel:` at all.
    const emailOnly = await addByHand({ name: "Doar Email", email: "doar.email@example.test" });
    const emailPage = await personPage(emailOnly);
    expect(emailPage).toContain('href="mailto:doar.email@example.test"');
    expect(emailPage).not.toContain('data-testid="volunteer-phone"');
    expect(emailPage).not.toContain('data-testid="volunteer-no-email"');
    expectNoNullShown(emailPage);
  });

  it("a row the person typed on the public form keeps both boxes required in its «Modifică», with no «opțional»", async () => {
    const [ana] = await db
      .insert(eventVolunteers)
      .values({ eventId, name: "Ana Public", email: "ana@example.test", canonicalEmail: "ana@example.test", canonicalizationVersion: 2, phone: "+40712345670", source: "PUBLIC", createdAt: NOW, updatedAt: NOW })
      .returning({ id: eventVolunteers.id });
    await db.insert(eventVolunteerRoleChoices).values({ volunteerId: ana.id, roleId: waterId });
    const page = await personPage(ana.id);
    expect(inputNamed(page, "email")).toMatch(/\brequired\b/);
    expect(inputNamed(page, "phone")).toMatch(/\brequired\b/);
    expect(page).not.toContain(ro.Admin.volunteers.person.emailHelp);
    expect(page).toContain('href="tel:+40712345670"');
  });

  it("the «Voluntari» list: the row with no «null», and the add fold's boxes optional, saying what an empty address means", async () => {
    await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    const page = await listPage({ eventId });
    expect(page).toContain("Doar Nume");
    expectNoNullShown(page);
    const add = /data-testid="volunteers-add"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(add).not.toBe("");
    expect(inputNamed(add, "email")).not.toMatch(/\brequired\b/);
    expect(inputNamed(add, "phone")).not.toMatch(/\brequired\b/);
    expect(add).toContain(ro.Admin.volunteers.person.emailHelp);
  });

  it("the CSV and the Excel files, one event's and every event's: empty cells, never «null», no column moved", async () => {
    await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    await addByHand({ name: "Doar Email", email: "doar.email@example.test" });

    const csvResponse = await eventExport.GET(new Request(`https://example.test/api/admin/events/${eventId}/volunteers?lang=ro`), { params: Promise.resolve({ id: eventId }) });
    expect(csvResponse.status).toBe(200);
    const csv = new TextDecoder().decode(new Uint8Array(await csvResponse.arrayBuffer())).replace(/^﻿/, "");
    const [header, ...lines] = csv.split("\r\n");
    const columns = header.split(",");
    const email = columns.indexOf(ro.Admin.volunteers.csvColumns.email);
    const phone = columns.indexOf(ro.Admin.volunteers.csvColumns.phone);
    expect(email).toBeGreaterThan(-1);
    const nameOnlyLine = lines.find((line) => line.includes("Doar Nume"))?.split(",") ?? [];
    expect(nameOnlyLine).toHaveLength(columns.length);
    expect([nameOnlyLine[email], nameOnlyLine[phone]]).toEqual(["", ""]);
    const emailOnlyLine = lines.find((line) => line.includes("Doar Email"))?.split(",") ?? [];
    expect([emailOnlyLine[email], emailOnlyLine[phone]]).toEqual(["doar.email@example.test", ""]);
    expect(csv).not.toContain("null");

    const sheetOf = async (response: Response) => readSheet(Buffer.from(await response.arrayBuffer())).rows;
    for (const rows of [
      await sheetOf(await eventExport.GET(new Request(`https://example.test/api/admin/events/${eventId}/volunteers?format=xlsx&lang=ro`), { params: Promise.resolve({ id: eventId }) })),
      await sheetOf(await allExport.GET(new Request("https://example.test/api/admin/volunteers/export?lang=ro"))),
    ]) {
      const [head, ...people] = rows;
      const at = (column: string) => head.indexOf(column);
      const nameOnly = people.find((row) => row.includes("Doar Nume")) ?? [];
      expect(nameOnly[at(ro.Admin.volunteers.csvColumns.email)] ?? "").toBe("");
      expect(nameOnly[at(ro.Admin.volunteers.csvColumns.phone)] ?? "").toBe("");
      expect(people.flat()).not.toContain("null");
      expect(people.find((row) => row.includes("Doar Email"))?.[at(ro.Admin.volunteers.csvColumns.email)]).toBe("doar.email@example.test");
    }
  });

  it("the public list and the badges' count: a confirmed person with no address is named or counted like any other", async () => {
    const id = await addByHand({ name: "Doar Nume", assignedRoleIds: [waterId] });
    await db.update(eventVolunteers).set({ state: "CONFIRMED", listOptIn: true, listOptInNoticeVersion: 1 }).where(eq(eventVolunteers.id, id));
    const read = await readPublicVolunteersList(db, eventId, { firstListNoticeVersion: 1 });
    expect(read.list).toEqual({ count: 1, named: [{ name: "Doar Nume", roleNameRo: "Punct de apă", roleNameEn: "Water point" }], others: 0 });
    expect(await countConfirmedVolunteers(db, eventId)).toBe(1);
  });
});
