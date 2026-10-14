import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { readAgreementFacts } from "@/modules/volunteers/agreement";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { changeVolunteerRole, listVolunteerRoles, listVolunteers, readPublicVolunteerRoles, submitVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §765 — what a volunteer says about themselves (age, sex, city, «am mai fost voluntar», the club's group, the
 * T-shirt's size), the role's «Descrierea rolului» as a document, and the event's tick «Oferim tricouri
 * voluntarilor» (BR-REQ-031-01, BR-REQ-050-02, BR-REQ-053-01, BR-REQ-060-01).
 *
 * The public form asks the answers only while the privacy notice in force names them (`{{volunteerProfile}}`): until
 * then it is §758's form, with its tick «Am cel puțin 18 ani», and whatever else a post carries is dropped, never
 * kept. The organizers' own entry takes the same answers, all optional, and refuses an age under the platform's
 * minimum. The size is stored only while the event gives T-shirts. A role's description is its document and its plain
 * words per language, both languages or neither, audited by the names of the fields only.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
    createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");
const exportRoute = await import("@/app/api/admin/events/[id]/volunteers/route");

const NOW = new Date("2026-10-13T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

/** The notice in force, in both languages; `profile` makes it name `{{volunteerProfile}}` too (§765). */
async function approveNotice(profile: boolean, version = 1) {
  const marker = profile ? "Voluntari ({{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}})" : "Voluntari ({{volunteers}}, {{volunteerAgreement}})";
  const body = (text: string) => ({ sections: [{ paragraphs: [`${marker}: ${text}`] }] });
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
    { locale: "en", title: "Privacy", body: body("we keep the name") },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

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
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  staff.DEV = await person("DEV", "Tudor Tehnic");
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(NOW.getTime() + 30 * DAY),
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(NOW.getTime() - DAY),
      acceptsVolunteers: true,
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "cursa", title: "Cursa" },
    { eventId, locale: "en", slug: "the-race", title: "The race" },
  ]);
  state.actor = staff.ADMIN;
  state.redirected.length = 0;
});

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
async function post(action: Stateful, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}
async function press(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const docOf = (...lines: string[]) => JSON.stringify({ type: "doc", content: lines.map(paragraph) });
const ROLE = { nameRo: "Punct de apă", nameEn: "Water point", needed: "4" };
const PERSON = { name: "Maria Test", email: "maria@example.test", phone: "0712 345 678", note: "" };
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(auditLogs.createdAt);

async function addRole(fields: Record<string, string> = {}) {
  expect(await post(actions.addVolunteerRoleAction, form({ ...ROLE, ...fields }))).toBe("redirected");
  const roles = await listVolunteerRoles(db, eventId);
  return roles[roles.length - 1];
}

describe("§765 the organizers' entry: what the person said about themselves", () => {
  // The organizers' boxes are drawn and kept only while the notice in force names them (§765).
  beforeEach(async () => {
    await approveNotice(true);
  });

  it("adds a person with age, sex, city and the two ticks, shows them on the list, and audits the names of the fields, never a value", async () => {
    const role = await addRole();
    const outcome = await post(
      actions.addVolunteerAction,
      form({ ...PERSON, roleIds: [role.id], assignedRoleId: "", age: " 34 ", sex: "FEMALE", city: "  Brașov ", volunteeredBefore: "on", clubMember: "on" }),
    );
    expect(outcome).toBe("redirected");
    const [maria] = await listVolunteers(db, eventId);
    expect(maria).toMatchObject({ age: 34, sex: "FEMALE", city: "Brașov", volunteeredBefore: true, clubMember: true, shirtSize: null });
    const [added] = (await trail()).filter((row) => row.action === "volunteer.added");
    expect(JSON.stringify(added.metadataJson)).not.toMatch(/Brașov|FEMALE|"age"|"city"/);
  });

  it("takes a person with none of it: every box is optional here, and the ticks read as «nu»", async () => {
    const role = await addRole();
    await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "" }));
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ age: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null });
  });

  it("refuses an age under the minimum, a sex that is no answer and a city past the bound — naming the box, keeping what was typed, writing nothing", async () => {
    const role = await addRole();
    for (const [fields, box] of [
      [{ age: "17" }, "age"],
      [{ age: "abc" }, "age"],
      [{ sex: "UNSPECIFIED" }, "sex"],
      [{ city: "x".repeat(81) }, "city"],
    ] as const) {
      const outcome = await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "", ...fields }));
      expect(outcome, box).toMatchObject({ error: "VALIDATION_ERROR", fields: [box] });
      expect((outcome as FormOutcome).values.name?.[0]).toBe(PERSON.name);
    }
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
  });

  it("changes the answers on an edit, audits only the names of the fields changed, and a press that changes nothing writes nothing", async () => {
    const role = await addRole();
    await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "", age: "34", sex: "FEMALE", city: "Brașov" }));
    const [maria] = await listVolunteers(db, eventId);
    const same = form({ ...PERSON, volunteerId: maria.id, roleIds: [role.id], assignedRoleId: "", age: "34", sex: "FEMALE", city: "Brașov" });
    expect(await post(actions.editVolunteerAction, same)).toBe("redirected");
    expect((await trail()).filter((row) => row.action === "volunteer.edited")).toHaveLength(0);
    await post(
      actions.editVolunteerAction,
      form({ ...PERSON, volunteerId: maria.id, roleIds: [role.id], assignedRoleId: "", age: "35", sex: "", city: "Râșnov", volunteeredBefore: "on" }),
    );
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ age: 35, sex: null, city: "Râșnov", volunteeredBefore: true, clubMember: false });
    const [edited] = (await trail()).filter((row) => row.action === "volunteer.edited");
    expect((edited.metadataJson as { fields: string[] }).fields.sort()).toEqual(["age", "city", "sex", "volunteeredBefore"]);
    expect(JSON.stringify(edited.metadataJson)).not.toMatch(/Râșnov|"age":/);
  });

  it("reads the retired «Prefer să nu spun» as no answer: leaving the sex empty on a row that has it is no change", async () => {
    const role = await addRole();
    await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "" }));
    await db.update(eventVolunteers).set({ sex: "UNSPECIFIED" });
    expect((await listVolunteers(db, eventId))[0].sex).toBeNull();
    const [maria] = await listVolunteers(db, eventId);
    await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [role.id], assignedRoleId: "", sex: "" }));
    expect((await trail()).filter((row) => row.action === "volunteer.edited")).toHaveLength(0);
  });
});

describe("§765 the organizers' entry is gated by the notice too (the §562 / §613 pattern)", () => {
  it("refuses an answer an organizer types while the notice in force does not name them, naming the boxes, and writes nothing", async () => {
    await approveNotice(false);
    const role = await addRole();
    const outcome = await post(
      actions.addVolunteerAction,
      form({ ...PERSON, roleIds: [role.id], assignedRoleId: "", age: "34", sex: "FEMALE", city: "Brașov", volunteeredBefore: "on", clubMember: "on" }),
    );
    expect(outcome).toMatchObject({ error: "VALIDATION_ERROR" });
    expect([...(outcome as FormOutcome).fields].sort()).toEqual(["age", "city", "clubMember", "sex", "volunteeredBefore"]);
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
    // The person themselves, without a word of it, is entered as ever.
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "" }))).toBe("redirected");
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ age: null, sex: null, city: null, volunteeredBefore: false, clubMember: false });
  });

  it("refuses an edit that sets one, and an edit that posts none leaves what the row holds as it was", async () => {
    await approveNotice(true);
    const role = await addRole();
    await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: "", age: "34", sex: "FEMALE", city: "Brașov", volunteeredBefore: "on" }));
    const [maria] = await listVolunteers(db, eventId);
    // A notice that does not name them takes over (a new version without the marker).
    await approveNotice(false, 2);
    const edit = { ...PERSON, volunteerId: maria.id, roleIds: [role.id], assignedRoleId: "" };
    expect(await post(actions.editVolunteerAction, form({ ...edit, age: "40", sex: "FEMALE", city: "Brașov", volunteeredBefore: "on" }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["age"] });
    // The card draws no boxes then: a post without them changes the name and nothing else.
    expect(await post(actions.editVolunteerAction, form({ ...edit, name: "Maria Nouă" }))).toBe("redirected");
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ name: "Maria Nouă", age: 34, sex: "FEMALE", city: "Brașov", volunteeredBefore: true });
  });
});

describe("§765 «Oferim tricouri voluntarilor»", () => {
  beforeEach(async () => {
    await approveNotice(true);
  });

  it("is off by default, switched by the card's own form, audited once per change and never on the event's version", async () => {
    const [before] = await db.select().from(events).where(eq(events.id, eventId));
    expect(before.volunteersShirts).toBe(false);
    expect(await press(actions.switchVolunteersShirtsAction, form({ on: "1" }))).not.toContain("volunteerError");
    const [on] = await db.select().from(events).where(eq(events.id, eventId));
    expect(on.volunteersShirts).toBe(true);
    expect(on.version).toBe(before.version);
    // A repeat changes nothing and records nothing; an unticked box posts nothing, which is «off».
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    await press(actions.switchVolunteersShirtsAction, form({}));
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].volunteersShirts).toBe(false);
    expect((await trail()).filter((row) => row.action === "event.volunteers_shirts_switched").map((row) => row.metadataJson)).toEqual([{ on: true }, { on: false }]);
    // It never touches the other tick.
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].acceptsVolunteers).toBe(true);
  });

  it("is asserted by the service: the Tehnic role is refused whatever the card drew", async () => {
    state.actor = staff.DEV;
    expect(await press(actions.switchVolunteersShirtsAction, form({ on: "1" }))).toContain("volunteerError=FORBIDDEN");
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].volunteersShirts).toBe(false);
    state.actor = staff.MODERATOR;
    expect(await press(actions.switchVolunteersShirtsAction, form({ on: "1" }))).not.toContain("volunteerError");
  });

  it("keeps a size only while the event gives shirts: stored then, ignored when off, and kept — shown nowhere — when it is switched off", async () => {
    const role = await addRole();
    const entry = { ...PERSON, roleIds: [role.id], assignedRoleId: "", shirtSize: "L" };
    await post(actions.addVolunteerAction, form(entry));
    expect((await listVolunteers(db, eventId))[0].shirtSize).toBeNull();
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    const [maria] = await listVolunteers(db, eventId);
    await post(actions.editVolunteerAction, form({ ...entry, volunteerId: maria.id, shirtSize: "XL" }));
    expect((await listVolunteers(db, eventId))[0].shirtSize).toBe("XL");
    // The kit's «Fără tricou» is none, and a size outside the kit is refused.
    expect(await post(actions.editVolunteerAction, form({ ...entry, volunteerId: maria.id, shirtSize: "XXXL" }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["shirtSize"] });
    // Switched off: the form no longer draws the box, so an edit posting none leaves the size as it was.
    await press(actions.switchVolunteersShirtsAction, form({}));
    const { shirtSize: _unused, ...withoutSize } = entry;
    void _unused;
    await post(actions.editVolunteerAction, form({ ...withoutSize, volunteerId: maria.id, city: "Brașov" }));
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ shirtSize: "XL", city: "Brașov" });
  });

  it("is in the public read, with nothing of a person", async () => {
    await addRole();
    expect(await readPublicVolunteerRoles(db, eventId)).toMatchObject({ acceptsVolunteers: true, shirts: false });
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    expect(await readPublicVolunteerRoles(db, eventId)).toMatchObject({ acceptsVolunteers: true, shirts: true });
  });
});

describe("§765 «Descrierea rolului», a document per language", () => {
  it("adds a role with the editor's two documents, keeps each with its plain words and audits the names of the fields", async () => {
    const role = await addRole({
      descriptionRoBody: docOf("Stai la km 5.", "Dai apă de la 9:00."),
      descriptionEnBody: docOf("Stand at km 5.", "Hand out water from 9:00."),
    });
    expect(role).toMatchObject({ descriptionRo: "Stai la km 5.\nDai apă de la 9:00.", descriptionEn: "Stand at km 5.\nHand out water from 9:00." });
    expect(role.descriptionRoJson?.content).toHaveLength(2);
    const [row] = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, role.id));
    expect(row).toMatchObject({ descriptionWordsRo: "Stai la km 5.\nDai apă de la 9:00.", descriptionWordsEn: "Stand at km 5.\nHand out water from 9:00." });
    // The old one-line columns are left as they were: nothing reads or writes them any more.
    expect(row).toMatchObject({ descriptionRo: null, descriptionEn: null });
    const [added] = (await trail()).filter((entry) => entry.action === "volunteer_role.added");
    expect(JSON.stringify(added.metadataJson)).not.toMatch(/Stai la km/);
  });

  it("refuses one language alone, naming the empty editor, and writes nothing", async () => {
    const outcome = await post(actions.addVolunteerRoleAction, form({ ...ROLE, descriptionRoBody: docOf("Dai apă."), descriptionEnBody: docOf() }));
    expect(outcome).toMatchObject({ error: "VALIDATION_ERROR", fields: ["descriptionEnBody"] });
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(0);
  });

  it("reads the plain boxes of a caller without the editor as paragraphs, and takes a role with no description", async () => {
    const plain = await addRole({ descriptionRo: "Linia 1\nLinia 2", descriptionEn: "Line 1\nLine 2" });
    expect(plain).toMatchObject({ descriptionRo: "Linia 1\nLinia 2" });
    expect(plain.descriptionRoJson?.content).toHaveLength(2);
    const none = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    expect(none).toMatchObject({ descriptionRo: null, descriptionEn: null, descriptionRoJson: null, descriptionEnJson: null });
  });

  it("changes a description on an edit — the field named in the trail — and a press that changes nothing writes nothing, whatever order the database gives the keys in", async () => {
    const role = await addRole({ descriptionRoBody: docOf("Dai apă."), descriptionEnBody: docOf("Hand out water.") });
    const edit = (fields: Record<string, string>) => post(actions.editVolunteerRoleAction, form({ ...ROLE, roleId: role.id, ...fields }));
    expect(await edit({ descriptionRoBody: docOf("Dai apă."), descriptionEnBody: docOf("Hand out water.") })).toBe("redirected");
    expect((await trail()).filter((row) => row.action === "volunteer_role.edited")).toHaveLength(0);
    expect(await edit({ descriptionRoBody: docOf("Dai apă și fructe."), descriptionEnBody: docOf("Hand out water.") })).toBe("redirected");
    const [edited] = (await trail()).filter((row) => row.action === "volunteer_role.edited");
    expect((edited.metadataJson as { fields: string[] }).fields).toEqual(["descriptionRo"]);
    expect((await listVolunteerRoles(db, eventId))[0].descriptionRo).toBe("Dai apă și fructe.");
    // Clearing both takes the description away.
    await edit({ descriptionRoBody: docOf(), descriptionEnBody: docOf() });
    expect((await listVolunteerRoles(db, eventId))[0]).toMatchObject({ descriptionRo: null, descriptionRoJson: null, descriptionEnJson: null });
  });

  it("puts the description's plain words in the agreement a person accepts — one sentence, the last full stop gone", async () => {
    await approveNotice(true);
    await approveAgreement();
    const role = await addRole({ descriptionRoBody: docOf("Stai la km 5.", "Dai apă."), descriptionEnBody: docOf("Stand at km 5.", "Hand out water.") });
    await submitVolunteer(db, eventId, publicForm([role.id], ANSWERS), NOW);
    const [row] = await db.select().from(eventVolunteers);
    expect(readAgreementFacts(row.agreementFacts)?.volunteerChoiceTasks).toBe("Punct de apă — Stai la km 5. Dai apă");
  });
});

/** A public post: §758's ticks, and the person's answers as the form posts them. */
function publicForm(roleIds: string[], extra: Record<string, unknown> = {}) {
  return {
    roleIds,
    name: "Maria Test",
    email: "maria@example.test",
    phone: "+40712345678",
    message: "",
    locale: "ro",
    consent: true,
    agreement: true,
    renderedAt: RENDERED,
    ...extra,
  };
}
const ANSWERS = { age: "34", sex: "FEMALE", city: " Brașov ", volunteeredBefore: true, clubMember: true, shirtSize: "L" };

describe("§765 the public form: asked while the notice names it, §758's tick until then", () => {
  beforeEach(async () => {
    await approveAgreement();
  });

  it("keeps age, sex, city and the two ticks while the notice names them — no tick «Am cel puțin 18 ani» needed, the age answers it — and the size not at all while the event gives no shirt", async () => {
    await approveNotice(true);
    const role = await addRole();
    expect(await submitVolunteer(db, eventId, publicForm([role.id], ANSWERS), NOW)).toEqual({ outcome: "done" });
    const [row] = await db.select().from(eventVolunteers);
    expect(row).toMatchObject({ age: 34, sex: "FEMALE", city: "Brașov", volunteeredBefore: true, clubMember: true, shirtSize: null, declaredAdult: true, source: "PUBLIC" });
    expect(row.agreementDocumentId).not.toBeNull();
  });

  it("keeps the size while the event gives T-shirts, and «Fără tricou» as none", async () => {
    await approveNotice(true);
    const role = await addRole();
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    await submitVolunteer(db, eventId, publicForm([role.id], ANSWERS), NOW);
    await submitVolunteer(db, eventId, publicForm([role.id], { ...ANSWERS, email: "ion@example.test", shirtSize: "" }), NOW);
    const rows = await db.select().from(eventVolunteers).orderBy(eventVolunteers.createdAt);
    expect(rows.map((row) => row.shirtSize).sort()).toEqual(["L", null]);
  });

  it("refuses an age under 18, a missing age, sex or city — naming each box — and keeps nothing", async () => {
    await approveNotice(true);
    const role = await addRole();
    for (const [extra, boxes] of [
      [{ ...ANSWERS, age: "17" }, ["age"]],
      [{ ...ANSWERS, age: "" }, ["age"]],
      [{ ...ANSWERS, age: "thirty" }, ["age"]],
      [{ ...ANSWERS, sex: "" }, ["sex"]],
      [{ ...ANSWERS, sex: "UNSPECIFIED" }, ["sex"]],
      [{ ...ANSWERS, city: "  " }, ["city"]],
      [{ ...ANSWERS, age: "", sex: "", city: "" }, ["age", "sex", "city"]],
      [{ ...ANSWERS, shirtSize: "XXXL" }, ["shirtSize"]],
    ] as const) {
      const error = await submitVolunteer(db, eventId, publicForm([role.id], extra), NOW).catch((caught: unknown) => caught);
      expect(isDomainError(error) && error.code, JSON.stringify(extra)).toBe("VALIDATION_ERROR");
      if (isDomainError(error)) expect([...error.fields].sort(), JSON.stringify(extra)).toEqual([...boxes].sort());
    }
    expect(await db.select().from(eventVolunteers)).toHaveLength(0);
  });

  it("takes the optional ticks as «nu» when they are not posted", async () => {
    await approveNotice(true);
    const role = await addRole();
    await submitVolunteer(db, eventId, publicForm([role.id], { age: "40", sex: "MALE", city: "Săcele" }), NOW);
    expect((await db.select().from(eventVolunteers))[0]).toMatchObject({ volunteeredBefore: false, clubMember: false, age: 40, sex: "MALE" });
  });

  it("is §758's form while the notice does not name them: the tick is required, and an age, sex or city posted anyway is dropped — never kept", async () => {
    await approveNotice(false);
    const role = await addRole();
    const withoutTick = await submitVolunteer(db, eventId, publicForm([role.id], ANSWERS), NOW).catch((caught: unknown) => caught);
    expect(isDomainError(withoutTick) && withoutTick.fields).toEqual(["adult"]);
    expect(await db.select().from(eventVolunteers)).toHaveLength(0);
    await submitVolunteer(db, eventId, publicForm([role.id], { ...ANSWERS, adult: true }), NOW);
    expect((await db.select().from(eventVolunteers))[0]).toMatchObject({ age: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, declaredAdult: true });
  });

  it("follows the notice the day a new one is approved: the same post is then read as the profile's form", async () => {
    await approveNotice(false);
    const role = await addRole();
    const before = await submitVolunteer(db, eventId, publicForm([role.id], { age: "34", sex: "FEMALE", city: "Brașov" }), NOW).catch((caught: unknown) => caught);
    expect(isDomainError(before)).toBe(true);
    await approveNotice(true, 2);
    expect(await submitVolunteer(db, eventId, publicForm([role.id], { age: "34", sex: "FEMALE", city: "Brașov" }), NOW)).toEqual({ outcome: "done" });
    expect((await db.select().from(eventVolunteers))[0]).toMatchObject({ age: 34, city: "Brașov" });
  });

  it("answers a repeat of the same address as it answers a new one and keeps the first answers", async () => {
    await approveNotice(true);
    const role = await addRole();
    await submitVolunteer(db, eventId, publicForm([role.id], ANSWERS), NOW);
    expect(await submitVolunteer(db, eventId, publicForm([role.id], { ...ANSWERS, age: "60", city: "Altul" }), NOW)).toEqual({ outcome: "done" });
    const rows = await db.select().from(eventVolunteers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ age: 34, city: "Brașov" });
  });
});

describe("§765 the CSV and the card's list carry the answers", () => {
  beforeEach(async () => {
    await approveNotice(true);
  });

  async function get(lang = "ro") {
    state.actor = staff.MODERATOR;
    return exportRoute.GET(new Request(`https://example.test/api/admin/events/${eventId}/volunteers?lang=${lang}`), { params: Promise.resolve({ id: eventId }) });
  }

  it("adds six columns after the moment — age, sex, city, the two claims as the reader's yes and no, the size — empty where the person said nothing", async () => {
    const role = await addRole();
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    await post(
      actions.addVolunteerAction,
      form({ ...PERSON, roleIds: [role.id], assignedRoleId: role.id, age: "34", sex: "FEMALE", city: "Brașov, centru", volunteeredBefore: "on", shirtSize: "M" }),
    );
    await post(actions.addVolunteerAction, form({ ...PERSON, name: "Ion Test", email: "ion@example.test", roleIds: [role.id], assignedRoleId: role.id }));
    const text = await (await get()).text();
    const lines = text.split("\r\n");
    expect(lines[0].endsWith("Data,Vârsta,Sex,Orașul,A mai fost voluntar,Din grupul clubului,Mărime tricou")).toBe(true);
    const maria = lines.find((line) => line.includes("Maria Test")) ?? "";
    expect(maria).toMatch(/,34,Female,"Brașov, centru",Da,Nu,M$/);
    const ion = lines.find((line) => line.includes("Ion Test")) ?? "";
    expect(ion).toMatch(/,,,,Nu,Nu,$/);
    expect(await (await get("en")).text()).toMatch(/,34,Female,"Brașov, centru",Yes,No,M/);
  });

  it("leaves the size out while the event gives no shirt, even for a row that has one", async () => {
    const role = await addRole();
    await press(actions.switchVolunteersShirtsAction, form({ on: "1" }));
    await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], assignedRoleId: role.id, shirtSize: "M" }));
    await press(actions.switchVolunteersShirtsAction, form({}));
    expect(await (await get()).text()).not.toMatch(/,M\r?\n?$/m);
    // The row keeps it for the day the club gives T-shirts again.
    expect((await listVolunteers(db, eventId))[0].shirtSize).toBe("M");
  });
});

describe("§765 the role service refuses a role no one may touch", () => {
  it("asserts the role for a description too", async () => {
    await expect(changeVolunteerRole(db, staff.DEV!, { kind: "add", eventId, fields: { ...ROLE, descriptionRoBody: docOf("x"), descriptionEnBody: docOf("y") } }, NOW)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
