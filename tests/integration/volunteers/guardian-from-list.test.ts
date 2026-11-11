import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { recordPaperVolunteerGuardian } from "@/modules/volunteers/guardian";
import { agreementRolesStamp, guardianAllowsConfirm, guardianAskOf } from "@/modules/volunteers/domain/volunteer";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Confirmarea minorilor din lista de voluntari» (amends §768; the owner, 2026-11-11: «as vrea sa pot confirma si voluntarele minore»):
 * on the «Voluntari» list a volunteer under eighteen whose parent has not agreed wears the person's block's own chips and is offered its
 * own verbs in place of «Confirmă» — the link to the parent, the sheet to print, the paper record — under the block's own conditions;
 * the server's rule is as it was.
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

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");

const NOW = new Date("2026-10-21T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<"ADMIN" | "MODERATOR" | "DEV", StaffUser>> = {};
let raceId: string;
let waterId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function staffMember(role: "ADMIN" | "MODERATOR" | "DEV", name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

/** The notice and the agreement in force in both languages, the minors' words in them (`volunteerMinorsOpen`). */
async function approveMinorsTexts() {
  const marker = "{{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}, {{volunteerMinors}}";
  const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari (${marker}): ${text}`] }] });
  const notice: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
    { locale: "en", title: "Privacy", body: body("we keep the name") },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(notice),
    translations: notice,
    now: NOW,
  });
  const agreement: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
  await insertLegalDocumentVersion(db, {
    key: "VOLUNTEER_AGREEMENT",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(agreement),
    translations: agreement,
    now: NOW,
  });
}

type Made = {
  name: string;
  age?: number | null;
  state?: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  email?: string | null;
  guardianName?: string | null;
  guardianEmail?: string | null;
  linkSent?: boolean;
};

/** A volunteer as the form or the card writes one, with a role given; made-up people only. */
async function volunteer(over: Made): Promise<string> {
  const slug = over.name.toLowerCase().replace(/[^a-z]+/g, ".");
  const withAddress = over.email !== null;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: raceId,
      name: over.name,
      email: withAddress ? (over.email ?? `${slug}@example.test`) : null,
      canonicalEmail: withAddress ? (over.email ?? `${slug}@example.test`) : null,
      canonicalizationVersion: withAddress ? 1 : null,
      phone: withAddress ? "0700000000" : null,
      source: withAddress ? "PUBLIC" : "STAFF",
      state: over.state ?? "REGISTERED",
      age: over.age === undefined ? 15 : over.age,
      guardianName: over.guardianName === undefined ? "Părinte Test" : over.guardianName,
      guardianEmail: over.guardianEmail === undefined ? `parinte.${slug}@example.test` : over.guardianEmail,
      guardianRequestedAt: over.linkSent ? NOW : null,
      guardianTokenHash: over.linkSent ? "a".repeat(64) : null,
      guardianTokenExpiresAt: over.linkSent ? new Date(Date.now() + 3 * 24 * 60 * 60_000) : null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleChoices).values({ volunteerId: row.id, roleId: waterId });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: waterId });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  staff.ADMIN = await staffMember("ADMIN", "Ana Admin");
  staff.MODERATOR = await staffMember("MODERATOR", "Oana Organizator");
  staff.DEV = await staffMember("DEV", "Tudor Tehnic");
  state.actor = staff.MODERATOR;
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2027-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") })
    .returning({ id: events.id });
  raceId = race.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 }).returning({ id: eventVolunteerRoles.id });
  waterId = water.id;
});

async function html(page: ReactElement): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  // The apostrophe of an English sentence is `&#x27;` in markup: read it as a person does.
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
}

/** The list searched down to one person, so every count below is that one row — drawn twice, the table and the phone's block. */
const listOf = async (name: string, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return html(await AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId, q: name }) }));
};
const count = (page: string, testId: string) => (page.match(new RegExp(`data-testid="${testId}"`, "g")) ?? []).length;
const returnTos = (page: string) => [...page.matchAll(/<input type="hidden" name="returnTo" value="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
const own = (name: string) => `/ro/admin/volunteers?eventId=${raceId}&q=${encodeURIComponent(name).replace(/%20/g, "+")}`;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", raceId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function press(action: (form: FormData) => Promise<unknown>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

const stateOf = async (id: string) => (await db.select({ state: eventVolunteers.state, accepted: eventVolunteers.guardianAcceptedAt }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];

describe("the rule both screens share", () => {
  const base = { age: 15, state: "REGISTERED" as const, email: "a@example.test", guardianName: "P", guardianEmail: "p@example.test", guardianAcceptedAt: null, guardianTokenExpiresAt: null, guardianRequestedAt: null };
  it("decides the offer once: ask, no name, texts not in force, nothing", () => {
    expect(guardianAskOf(base, true, NOW)).toEqual({ kind: "ask", sent: false, send: "ok" });
    expect(guardianAskOf({ ...base, guardianRequestedAt: NOW }, true, NOW)).toEqual({ kind: "ask", sent: true, send: "ok" });
    expect(guardianAskOf({ ...base, guardianEmail: null }, true, NOW)).toEqual({ kind: "ask", sent: false, send: "guardianNoEmail" });
    expect(guardianAskOf({ ...base, email: null }, true, NOW)).toEqual({ kind: "ask", sent: false, send: "volunteerNoEmail" });
    expect(guardianAskOf({ ...base, guardianName: null }, true, NOW).kind).toBe("noName");
    expect(guardianAskOf(base, false, NOW).kind).toBe("closed");
    expect(guardianAskOf({ ...base, age: 30 }, true, NOW).kind).toBe("none");
    expect(guardianAskOf({ ...base, age: null }, true, NOW).kind).toBe("none");
    expect(guardianAskOf({ ...base, guardianAcceptedAt: NOW }, true, NOW).kind).toBe("none");
    expect(guardianAskOf({ ...base, state: "CANCELLED" }, true, NOW).kind).toBe("none");
    // «Confirmă» is drawn exactly when the server would take it.
    expect(guardianAllowsConfirm({ age: 15, guardianAcceptedAt: null })).toBe(false);
    expect(guardianAllowsConfirm({ age: 15, guardianAcceptedAt: NOW })).toBe(true);
  });
});

describe("a row of the list", () => {
  beforeEach(async () => approveMinorsTexts());

  it("is as before for an adult: «Confirmă», no parent's chip, no parent's verbs", async () => {
    await volunteer({ name: "Adult Test", age: null, guardianName: null, guardianEmail: null });
    const page = await listOf("Adult Test");
    expect(count(page, "volunteer-confirmed-form")).toBe(2);
    expect(count(page, "volunteer-cancelled-form")).toBe(2);
    expect(count(page, "volunteer-guardian-state")).toBe(0);
    expect(count(page, "volunteer-guardian")).toBe(0);
  });

  it("offers a minor whose parent has not agreed the block's chip and verbs, never «Confirmă», and keeps «Anulează»", async () => {
    await volunteer({ name: "Minor Test" });
    const page = await listOf("Minor Test");
    expect(count(page, "volunteer-confirmed-form")).toBe(0);
    expect(count(page, "volunteer-cancelled-form")).toBe(2);
    expect(count(page, "volunteer-guardian-state")).toBe(2);
    expect(page).toContain("Acordul părintelui lipsește");
    expect(count(page, "volunteer-guardian-link")).toBe(0);
    expect(count(page, "volunteer-guardian-send-form")).toBe(2);
    expect(page).toContain("Trimite linkul părintelui");
    expect(page).not.toContain("Trimite din nou linkul părintelui");
    expect(count(page, "volunteer-guardian-pdf-to-sign")).toBe(2);
    expect(page).toContain("PDF de semnat de părinte");
    expect(page).toContain("Acordul părintelui pe hârtie");
    expect(page).toContain("?for=guardian");
    // Every form of both copies comes back to this very address.
    expect(new Set(returnTos(page))).toEqual(new Set([own("Minor Test")]));
    expect(page).toContain(`value="${raceId}"`);
  });

  it("says «Link trimis părintelui» and offers the resend once a link was sent", async () => {
    await volunteer({ name: "Minor Sent", linkSent: true });
    const page = await listOf("Minor Sent");
    expect(count(page, "volunteer-guardian-link")).toBe(2);
    expect(page).toContain("Link trimis părintelui");
    expect(page).toContain("Trimite din nou linkul părintelui");
    expect(page).toContain("Ultimul link trimis părintelui");
    expect(count(page, "volunteer-confirmed-form")).toBe(0);
  });

  it("draws the link's press only where both addresses exist; the sheet and the paper stay", async () => {
    await volunteer({ name: "Minor NoParentMail", guardianEmail: null });
    const noParent = await listOf("Minor NoParentMail");
    expect(count(noParent, "volunteer-guardian-send-form")).toBe(0);
    expect(count(noParent, "volunteer-guardian-no-email")).toBe(2);
    expect(count(noParent, "volunteer-guardian-pdf-to-sign")).toBe(2);
    expect(noParent).toContain("Acordul părintelui pe hârtie");

    await volunteer({ name: "Minor NoOwnMail", email: null });
    const noOwn = await listOf("Minor NoOwnMail");
    expect(count(noOwn, "volunteer-guardian-send-form")).toBe(0);
    expect(count(noOwn, "volunteer-guardian-volunteer-no-email")).toBe(2);
    expect(count(noOwn, "volunteer-guardian-pdf-to-sign")).toBe(2);
    expect(noOwn).toContain("Acordul părintelui pe hârtie");
  });

  it("says in one sentence, with the way to the person's page, that a minor has no parent's name — and draws no verb", async () => {
    const id = await volunteer({ name: "Minor NoName", guardianName: null, guardianEmail: null });
    const page = await listOf("Minor NoName");
    expect(count(page, "volunteer-guardian-no-name")).toBe(2);
    expect(page).toContain("Numele părintelui lipsește");
    expect(page).toContain(`href="/ro/admin/volunteers/${id}" style="display:inline-flex;align-items:center;min-height:44px" data-testid="volunteer-guardian-no-name-link"`);
    expect(count(page, "volunteer-guardian")).toBe(0);
    expect(count(page, "volunteer-confirmed-form")).toBe(0);
    expect(count(page, "volunteer-cancelled-form")).toBe(2);
  });

  it("draws neither «Confirmă» nor a parent's verb while the texts do not describe minors", async () => {
    await resetTables(db);
    staff.MODERATOR = await staffMember("MODERATOR", "Oana Organizator");
    state.actor = staff.MODERATOR;
    const [race] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2027-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true }).returning({ id: events.id });
    raceId = race.id;
    const [water] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3 }).returning({ id: eventVolunteerRoles.id });
    waterId = water.id;
    await volunteer({ name: "Minor Closed" });
    const page = await listOf("Minor Closed");
    expect(count(page, "volunteer-guardian-state")).toBe(2);
    expect(count(page, "volunteer-guardian")).toBe(0);
    expect(count(page, "volunteer-confirmed-form")).toBe(0);
    expect(count(page, "volunteer-cancelled-form")).toBe(2);
  });

  it("is as before once the parent agreed: «Confirmă», no parent's chip or verbs", async () => {
    const id = await volunteer({ name: "Minor Agreed" });
    const document = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", "ro", new Date());
    await recordPaperVolunteerGuardian(db, staff.MODERATOR as StaffUser, { eventId: raceId, id, printed: { documentId: document?.id ?? "", roles: agreementRolesStamp([waterId], [waterId]) } }, new Date());
    const page = await listOf("Minor Agreed");
    expect(count(page, "volunteer-confirmed-form")).toBe(2);
    expect(count(page, "volunteer-guardian-state")).toBe(0);
    expect(count(page, "volunteer-guardian")).toBe(0);
  });

  it("speaks English with the same words as the person's block", async () => {
    await volunteer({ name: "Minor Test" });
    const page = await listOf("Minor Test", "en");
    expect(page).toContain(en.Admin.volunteers.guardian.missing);
    expect(page).toContain(en.Admin.volunteers.guardian.send);
    expect(page).toContain(en.Admin.volunteers.guardian.paper);
  });
});

describe("a press on such a row, through the real actions", () => {
  beforeEach(async () => approveMinorsTexts());

  it("queues the parent's email and comes back to the same list address", async () => {
    const id = await volunteer({ name: "Minor Test" });
    const back = own("Minor Test");
    expect(await press(actions.requestVolunteerGuardianAction, form({ volunteerId: id, returnTo: back }))).toBe(back);
    const queued = await db.select({ type: emailOutbox.messageType, to: emailOutbox.recipientEmail }).from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_GUARDIAN_REQUEST"));
    expect(queued).toEqual([{ type: "VOLUNTEER_GUARDIAN_REQUEST", to: "parinte.minor.test@example.test" }]);
    // The row now says a link went, and offers the resend.
    const page = await listOf("Minor Test");
    expect(page).toContain("Trimite din nou linkul părintelui");
  });

  it("records the paper agreement, after which «Confirmă» is drawn and confirms", async () => {
    const id = await volunteer({ name: "Minor Test" });
    const back = own("Minor Test");
    const page = await listOf("Minor Test");
    const documentId = page.match(/name="agreementDocumentId" value="([0-9a-f-]{36})"/)?.[1];
    const stamp = page.match(/name="agreementRoles" value="([^"]*)"/)?.[1];
    expect(documentId).toBe((await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", "ro", new Date()))?.id);
    expect(stamp).toBe(agreementRolesStamp([waterId], [waterId]));

    expect(await press((data) => actions.recordPaperVolunteerGuardianAction(null, data), form({ volunteerId: id, agreementDocumentId: documentId ?? "", agreementRoles: stamp ?? "", returnTo: back }))).toBe(back);
    expect((await stateOf(id)).accepted).not.toBeNull();

    const after = await listOf("Minor Test");
    expect(count(after, "volunteer-confirmed-form")).toBe(2);
    expect(count(after, "volunteer-guardian")).toBe(0);
    expect(await press(actions.setVolunteerStateAction, form({ volunteerId: id, state: "CONFIRMED", returnTo: back }))).toBe(back);
    expect((await stateOf(id)).state).toBe("CONFIRMED");
  });

  it("refuses a sheet that is not the one in force: the paper verb keeps its refusal", async () => {
    const id = await volunteer({ name: "Minor Test" });
    const back = own("Minor Test");
    const refused = await press(
      (data) => actions.recordPaperVolunteerGuardianAction(null, data),
      form({ volunteerId: id, agreementDocumentId: "00000000-0000-4000-8000-000000000000", agreementRoles: agreementRolesStamp([waterId], [waterId]), returnTo: back }),
    );
    expect(refused).toBe(`${back}&volunteerError=VOLUNTEER_AGREEMENT_REPRINT`);
    expect((await stateOf(id)).accepted).toBeNull();
  });

  it("refuses a forged «Confirmă» for a minor before the agreement, and writes nothing", async () => {
    const id = await volunteer({ name: "Minor Test" });
    const back = own("Minor Test");
    expect(await press(actions.setVolunteerStateAction, form({ volunteerId: id, state: "CONFIRMED", returnTo: back }))).toBe(`${back}&volunteerError=VOLUNTEER_GUARDIAN_MISSING`);
    expect((await stateOf(id)).state).toBe("REGISTERED");
  });

  it("refuses a role that may not manage volunteers, on every press", async () => {
    const id = await volunteer({ name: "Minor Test" });
    const back = own("Minor Test");
    state.actor = staff.DEV;
    expect(await press(actions.requestVolunteerGuardianAction, form({ volunteerId: id, returnTo: back }))).toBe(`${back}&volunteerError=FORBIDDEN`);
    expect(
      await press(
        (data) => actions.recordPaperVolunteerGuardianAction(null, data),
        form({ volunteerId: id, agreementDocumentId: "00000000-0000-4000-8000-000000000000", agreementRoles: "", returnTo: back }),
      ),
    ).toBe(`${back}&volunteerError=FORBIDDEN`);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect((await stateOf(id)).accepted).toBeNull();
  });
});
