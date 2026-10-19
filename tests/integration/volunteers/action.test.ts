import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerInvitations } from "@/db/schema/event-volunteer-invitations";
import { eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { generateTokenSecret, hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §754 — «Mă ofer voluntar»'s one Server Action, `submitVolunteerAction` (BR-REQ-031-01), on the real clock
 * as the action reads it, with Next's redirect caught where the browser would follow it and the cookie jar
 * held in memory. What the service's own suite cannot see: Cloudflare's refusal answered before the service
 * is asked (no row, no email, what was typed kept), the address each answer goes back to — `?volunteer=`,
 * `&vfields=` the boxes by name, `&since=` the render the corrected form is timed from, the box's anchor —, a
 * closed form sent to the plain page, and the draft cleared after a kept offer. Every address is made up.
 */

let db: TestDatabase;
let close: () => Promise<void>;

type Set = { name: string; value: string; options: { path?: string; maxAge?: number } };
const jar = new Map<string, string>();
const sets: Set[] = [];
let turnstile: { on: boolean; verdict: string } = { on: false, verdict: "not_configured" };
/** The members' zone's account reading the request (§820): null is a stranger. */
const viewer: { current: null | { email: string; displayName: string } } = { current: null };

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Set["options"] = {}) => {
      sets.push({ name, value, options });
      jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("@/modules/events/members-only", () => ({ membersViewer: async () => viewer.current }));
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => turnstile.on, honeypotIsOn: async () => true }));
vi.mock("@/modules/registrations/turnstile", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyTurnstile: async () => turnstile.verdict,
}));

const { submitVolunteerAction } = await import("@/app/[locale]/events/[slug]/volunteers/actions");
const { openFormDraft } = await import("@/modules/registrations/form-draft");

const DAY = 24 * 60 * 60_000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

let slug: string;
let roleId: string;
let eventId: string;

/** An event ahead that takes volunteers, published in both languages, with one role needing `needed`. */
async function seedEvent(acceptsVolunteers: boolean, needed = 2) {
  const now = Date.now();
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(now + 30 * DAY), editorialStatus: "PUBLISHED", publishedAt: new Date(now - DAY), acceptsVolunteers })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed }).returning();
  eventId = event.id;
  slug = `crosul-${event.id.slice(0, 8)}`;
  roleId = role.id;
}

beforeEach(async () => {
  await resetTables(db);
  jar.clear();
  sets.length = 0;
  turnstile = { on: false, verdict: "not_configured" };
  viewer.current = null;
  await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Admin", role: "ADMIN" });
  // The notice in force names `{{volunteers}}` and `{{volunteerAgreement}}` (§758) in both languages: the form is open.
  const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}): ${text}`] }] });
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
    { locale: "en", title: "Privacy", body: body("we keep the name") },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date(Date.now() - DAY),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: new Date(),
  });
  // The volunteer agreement in force (§758), from the platform's template: the form's fourth condition.
  const agreement: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
  await insertLegalDocumentVersion(db, {
    key: "VOLUNTEER_AGREEMENT",
    version: 1,
    effectiveAt: new Date(Date.now() - DAY),
    isApproved: true,
    contentSha256: computeContentHash(agreement),
    translations: agreement,
    now: new Date(),
  });
});

/** A post as the page's form makes it, rendered a minute before the press; a list is the boxes ticked under one name (§761). */
function post(fields: Record<string, string | readonly string[]> = {}): FormData {
  const form = new FormData();
  const all: Record<string, string | readonly string[]> = {
    locale: "ro",
    slug,
    roleIds: [roleId],
    name: "Maria Test",
    email: "maria@example.test",
    phoneCountry: "RO",
    phone: "0712 345 678",
    message: "Pot toată ziua",
    consent: "on",
    // The volunteer agreement and the age (§758), ticked as a person ticks them.
    agreement: "on",
    adult: "on",
    honeypot: "",
    renderedAt: new Date(Date.now() - 60_000).toISOString(),
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) {
    if (typeof value === "string") form.append(name, value);
    else for (const item of value) form.append(name, item);
  }
  return form;
}

/** Where the action sent the browser. */
async function pressed(form: FormData): Promise<URL> {
  try {
    await submitVolunteerAction(form);
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to) return new URL(to, "http://club.test");
    throw error;
  }
  throw new Error("the action returned without a redirect");
}

const lastDraft = () => sets.filter((set) => set.name === "br_form_draft").at(-1);
const people = () => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
const outbox = () => db.select().from(emailOutbox);

describe("§754 submitVolunteerAction's redirects", () => {
  it("answers Cloudflare's refusal before the service is asked: ?volunteer=captcha with ?since=, no row, no email, what was typed kept", async () => {
    await seedEvent(true);
    turnstile = { on: true, verdict: "failed" };
    const renderedAt = new Date(Date.now() - 60_000).toISOString();
    const url = await pressed(post({ renderedAt }));
    // §768: the form is the volunteers' own page now, and every answer comes back to it.
    expect(url.pathname.endsWith(`/${slug}/voluntari`)).toBe(true);
    expect(url.searchParams.get("volunteer")).toBe("captcha");
    expect(url.searchParams.get("since")).toBe(renderedAt);
    expect(url.hash).toBe("#volunteers");
    expect(await people()).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);

    const draft = lastDraft();
    expect(draft?.options.path).toBe(url.pathname);
    const kept = openFormDraft(draft?.value ?? "");
    expect(kept).toMatchObject({ name: "Maria Test", email: "maria@example.test", phoneCountry: "RO", phone: "0712 345 678", roleIds: roleId, message: "Pot toată ziua" });
    // Never the consent tick (the person's own act each time), the trap or the clock.
    expect(kept).not.toHaveProperty("consent");
    expect(kept).not.toHaveProperty("honeypot");
    expect(kept).not.toHaveProperty("renderedAt");
  });

  it("lets a passed check through to the service", async () => {
    await seedEvent(true);
    turnstile = { on: true, verdict: "passed" };
    const url = await pressed(post());
    expect(url.searchParams.get("volunteer")).toBe("1");
    expect(await people()).toHaveLength(1);
  });

  it("sends a post to a form that is closed (CONFLICT) to the event's own page, where the box is gone — never to the volunteers' page, which would answer 404", async () => {
    await seedEvent(false);
    const url = await pressed(post());
    expect(url.pathname.endsWith(`/${slug}`)).toBe(true);
    expect(url.pathname).not.toContain("voluntari");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(await people()).toHaveLength(0);
  });

  it("names a malformed address as the box to fix: ?volunteer=invalid&vfields=email, the address in the draft and never in the URL", async () => {
    await seedEvent(true);
    const url = await pressed(post({ email: "maria-at-example" }));
    expect(url.searchParams.get("volunteer")).toBe("invalid");
    expect(url.searchParams.get("vfields")).toBe("email");
    expect(url.pathname.endsWith(`/${slug}/voluntari`)).toBe(true);
    expect(url.hash).toBe("#volunteers");
    expect(url.toString()).not.toContain("maria-at-example");
    expect(openFormDraft(lastDraft()?.value ?? "")).toMatchObject({ email: "maria-at-example" });
    expect(await people()).toHaveLength(0);
  });

  it("answers a role that filled while the form was open with ?volunteer=full, keeping what was typed", async () => {
    await seedEvent(true, 1);
    await db.insert(eventVolunteers).values({
      eventId,
      roleId,
      name: "Ion Primul",
      email: "ion@example.test",
      canonicalEmail: "ion@example.test",
      canonicalizationVersion: 1,
      phone: "+40712345679",
      locale: "ro",
      state: "REGISTERED",
      source: "STAFF",
    });
    const url = await pressed(post());
    expect(url.searchParams.get("volunteer")).toBe("full");
    expect(url.hash).toBe("#volunteers");
    expect(openFormDraft(lastDraft()?.value ?? "")).toMatchObject({ name: "Maria Test" });
    expect(await people()).toHaveLength(1);
  });

  it("§761 keeps every role ticked as the person's choices, and names the box when none is ticked — the ticks kept in the draft, never in the URL", async () => {
    await seedEvent(true);
    const [finish] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Sosire", nameEn: "Finish", needed: 1, position: 1 }).returning();
    const none = await pressed(post({ roleIds: [] }));
    expect(none.searchParams.get("volunteer")).toBe("invalid");
    expect(none.searchParams.get("vfields")).toBe("roleIds");
    expect(await people()).toHaveLength(0);
    // A refusal on another box keeps both ticks, as one string of ids, in the sealed draft.
    const typo = await pressed(post({ roleIds: [roleId, finish.id], email: "maria-at-example" }));
    expect(typo.toString()).not.toContain(finish.id);
    expect(openFormDraft(lastDraft()?.value ?? "")).toMatchObject({ roleIds: `${roleId},${finish.id}` });
    const url = await pressed(post({ roleIds: [finish.id, roleId] }));
    expect(url.searchParams.get("volunteer")).toBe("1");
    const [row] = await people();
    expect(row.roleId).toBeNull();
    const chosen = await db.select().from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, row.id));
    expect(chosen.map((choice) => choice.roleId).sort()).toEqual([roleId, finish.id].sort());
  });

  it("thanks a kept offer with ?volunteer=1 and clears the draft", async () => {
    await seedEvent(true);
    const url = await pressed(post());
    // The thank-you is on the volunteers' page (§768), said twice the house's way (§427): the banner the address asks for and the flash toast.
    expect(url.pathname.endsWith(`/${slug}/voluntari`)).toBe(true);
    expect(url.searchParams.get("volunteer")).toBe("1");
    expect(url.hash).toBe("#volunteers");
    const flash = sets.find((set) => set.name === "br-flash");
    expect(flash).toBeDefined();
    expect(decodeURIComponent(flash?.value ?? "")).toContain("volunteerSent");
    const [row] = await people();
    expect(row).toMatchObject({ name: "Maria Test", phone: "+40712345678", source: "PUBLIC" });
    expect(lastDraft()?.options.maxAge).toBe(0);
  });

  it("keeps the first name and the address for the thank-you, in the registration's facts cookie on the volunteers' own path — never in the address", async () => {
    await seedEvent(true);
    const url = await pressed(post());
    const facts = sets.find((set) => set.name === "br_submitted_to");
    expect(facts).toBeDefined();
    // Its own path, ten minutes: the registration's screen at another path never reads it.
    expect(facts?.options.path?.endsWith(`/${slug}/voluntari`)).toBe(true);
    expect(facts?.options.maxAge).toBe(600);
    const opened = openFormDraft(facts?.value ?? "");
    expect(opened).toMatchObject({ email: "maria@example.test", firstName: "Maria" });
    // No hour and no state of the email: a repeat or a lost race queues none, and the screen cannot tell them from a first offer.
    expect(opened).not.toHaveProperty("leavesAt");
    expect(opened).not.toHaveProperty("submittedAt");
    // Nothing typed rides in the address (§14.5).
    expect(url.search).toBe("?volunteer=1");
    // A refused send keeps no thank-you facts.
    sets.length = 0;
    await pressed(post({ name: "" }));
    expect(sets.find((set) => set.name === "br_submitted_to")).toBeUndefined();
  });
});

/*
  §820 — who may offer (BR-REQ-060-01), through the action that reads the session and the form's hidden `invite`: the server asks the
  door again, so a hidden form is not a permission. A wrong condition at the action (reading the session when a link came, or the
  other way round) would refuse every member or let every stranger in while the service's own suite stays green.
*/
describe("§820 submitVolunteerAction and «Cine se poate oferi»", () => {
  async function chooseAccess(access: "ANYONE" | "MEMBERS" | "INVITED") {
    await db.update(events).set({ volunteersAccess: access }).where(eq(events.id, eventId));
  }
  async function invitation(address = "ioana@example.test") {
    const secret = generateTokenSecret();
    await db.insert(eventVolunteerInvitations).values({
      eventId,
      deliveryEmail: address,
      canonicalEmail: address,
      canonicalizationVersion: 2,
      tokenHash: hashTokenSecret(secret),
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    });
    return secret;
  }

  it("«Doar membrii»: a stranger's post lands back on the volunteers' page with no row; a member's is kept with the account's address", async () => {
    await seedEvent(true);
    await chooseAccess("MEMBERS");
    viewer.current = null;
    const refused = await pressed(post());
    expect(refused.pathname.endsWith(`/${slug}/voluntari`)).toBe(true);
    expect(refused.search).toBe("");
    expect(await people()).toHaveLength(0);
    viewer.current = { email: "membru@example.test", displayName: "Maria Membra" };
    // Somebody else's address from a signed-in member is a forged post: refused as the stranger's is, nothing written.
    const forged = await pressed(post({ email: "alta@example.test" }));
    expect(forged.search).toBe("");
    expect(await people()).toHaveLength(0);
    const kept = await pressed(post({ email: "Membru@Example.test" }));
    expect(kept.searchParams.get("volunteer")).toBe("1");
    expect((await people())[0]).toMatchObject({ canonicalEmail: "membru@example.test", source: "PUBLIC" });
  });

  it("«Doar cu invitație»: no link, no row; the link's secret posted back is spent, and a link that no longer works goes back to the page naming it", async () => {
    await seedEvent(true);
    await chooseAccess("INVITED");
    viewer.current = { email: "membru@example.test", displayName: "Maria Membra" };
    expect((await pressed(post())).search).toBe("");
    expect(await people()).toHaveLength(0);
    const secret = await invitation();
    // A refusal of the form keeps the secret in the address, so the form is drawn again with its link.
    const invalid = await pressed(post({ invite: secret, name: "" }));
    expect(invalid.searchParams.get("volunteer")).toBe("invalid");
    expect(invalid.searchParams.get("invite")).toBe(secret);
    expect(await people()).toHaveLength(0);
    const done = await pressed(post({ invite: secret, email: "oricine@example.test" }));
    expect(done.searchParams.get("volunteer")).toBe("1");
    // The thank-you carries no secret; the invited address is the one kept, whatever was posted.
    expect(done.searchParams.has("invite")).toBe(false);
    expect((await people())[0]).toMatchObject({ canonicalEmail: "ioana@example.test" });
    // The same link again: spent, so the page is asked to say so.
    const again = await pressed(post({ invite: secret }));
    expect(again.searchParams.get("invite")).toBe(secret);
    expect(again.searchParams.has("volunteer")).toBe(false);
    expect(await people()).toHaveLength(1);
  });
});
