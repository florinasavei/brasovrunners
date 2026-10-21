import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent } from "@/modules/content/events/service";
import { readEventConfig } from "@/modules/content/events/transfer/export";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { BADGE_COUNT_MAX, badgePrintDefault, badgePrintEntries, findEventForBadges, listBadgeRoles, readBadgeSingleStart, readPrintCounts, saveBadgeDesign, saveBadgeRoleColours } from "@/modules/volunteers/badges/badges";
import { changeVolunteerRole } from "@/modules/volunteers/volunteers";
import { DomainError } from "@/shared/errors/domain-error";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { mirrorRolesGiven } from "../../helpers/volunteer-roles";

/**
 * §764 — the volunteer badges against the real schema (migration 0150, PGlite) and through the real Server
 * Actions and routes (BR-REQ-050-02, BR-REQ-060-01): the design kept on the event and audited; each role's
 * band colour, refused below AA and only on the event's own roles; the sheet per role with its spares and
 * the badges «fără rol», as many badges as asked; the picture of one badge; the Organizer and the
 * Administrators allowed, everybody else refused on the server whatever the page drew; the event file and
 * a copy carrying the design, never a role.
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
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const actions = await import("@/app/[locale]/admin/events/[id]/badges/actions");
const sheetRoute = await import("@/app/api/admin/events/[id]/badges/route");
const previewRoute = await import("@/app/api/admin/events/[id]/badges/preview/route");

const NOW = new Date("2026-10-14T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;
let otherEventId: string;
let waterId: string;
let marshalId: string;
let otherRoleId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  await db.delete(eventVolunteerRoles);
  for (const [role, name] of [
    ["ADMIN", "Ana Admin"],
    ["SUPERADMIN", "Sorin Super"],
    ["MODERATOR", "Oana Organizator"],
    ["DEV", "Tudor Tehnic"],
    ["COPYWRITER", "Rada Redactor"],
    ["CONTRIBUTOR", "Vlad Voluntar"],
  ] as const) {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
    staff[role] = row;
  }
  const [first, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z") },
      { type: "GROUP_RUN", startsAt: new Date("2026-11-04T16:00:00.000Z") },
    ])
    .returning({ id: events.id });
  eventId = first.id;
  otherEventId = second.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul-toamnei", title: "Crosul toamnei" },
    { eventId, locale: "en", slug: "autumn-cross", title: "Autumn cross" },
    { eventId: otherEventId, locale: "ro", slug: "alergare", title: "Alergarea de miercuri" },
    { eventId: otherEventId, locale: "en", slug: "run", title: "Wednesday run" },
  ]);
  const roles = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 },
      { eventId, nameRo: "Marshal", nameEn: "Marshal", needed: 5, position: 1 },
      { eventId: otherEventId, nameRo: "Fotograf", nameEn: "Photographer", needed: 1, position: 0 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  [waterId, marshalId, otherRoleId] = roles.map((role) => role.id);
  state.actor = staff.MODERATOR;
  state.redirected.length = 0;
});

/**
 * The designer's boxes as the form posts them, the default design unless told otherwise: since §783 that is the one badge for everyone, so a case about
 * the badges per role (the print, the category's telephone) says `perRole` in its own boxes or stores it first (`storePerRole`).
 */
function designForm(fields: Record<string, string> = {}, event = eventId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", event);
  const base: Record<string, string> = {
    "badge.design.mode": "single",
    "badge.design.size": "strip90",
    "badge.design.customWidthMm": "90",
    "badge.design.customHeightMm": "35",
    "badge.design.bandColour": "",
    "badge.design.showLogo": "on",
    "badge.design.showTitle": "on",
    "badge.design.writingLine": "on",
    "badge.design.cutMarks": "on",
  };
  for (const [name, value] of Object.entries({ ...base, ...fields })) if (value !== "__off") data.set(name, value);
  return data;
}

type Stateful = (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;
async function post(action: Stateful, data: FormData): Promise<FormOutcome | "redirected" | null> {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

/** The event's design chosen as the badge per role (§764), the rest the platform's own: what a case about a role's pile or band starts from. */
const storePerRole = (id = eventId) => db.update(events).set({ badgeDesign: { ...DEFAULT_BADGE_DESIGN, mode: "perRole" } }).where(eq(events.id, id));

const stored = async (id = eventId) => (await db.select({ badgeDesign: events.badgeDesign }).from(events).where(eq(events.id, id)))[0].badgeDesign;
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action as never));

describe("§764 migration 0150 on PGlite", () => {
  it("adds a nullable design on the event and a nullable colour on a role, the colour held to a hex triplet", async () => {
    expect(await stored()).toBeNull();
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.map((role) => role.colour)).toEqual([null, null]);
    await expect(db.update(eventVolunteerRoles).set({ colour: "red" }).where(eq(eventVolunteerRoles.id, waterId))).rejects.toThrow();
    await db.update(eventVolunteerRoles).set({ colour: "#c62828" }).where(eq(eventVolunteerRoles.id, waterId));
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#c62828");
  });
});

describe("§764 «Salvează ecusonul»", () => {
  it("keeps the design on the event, audited with the settings that changed, and goes back to the page", async () => {
    const result = await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100", "badge.design.titleRo": "Crosul", "badge.design.titleEn": "The cross" }));
    expect(result).toBe("redirected");
    expect(state.redirected.at(-1)).toMatch(/\/admin\/events\/[0-9a-f-]{36}\/badges#box-badge-design$/);
    const design = readBadgeDesign(await stored());
    expect(design).toMatchObject({ size: "strip100", titleRo: "Crosul", titleEn: "The cross", showLogo: true });
    const rows = await trail("event.badge_design_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "event", entityId: eventId, actorStaffUserId: staff.MODERATOR!.id });
    expect((rows[0].metadataJson as { changed: string[] }).changed.sort()).toEqual(["size", "titleEn", "titleRo"]);
  });

  it("saves the same design again as no change, and records nothing", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100" }));
    const again = designForm({ "badge.design.size": "strip100" });
    const values = readBadgeDesignForm((name) => {
      const value = again.get(name);
      return typeof value === "string" ? value : null;
    });
    expect(await saveBadgeDesign(db, staff.ADMIN!, eventId, values, NOW)).toEqual({ changed: false });
    expect(await trail("event.badge_design_changed")).toHaveLength(1);
    // The platform's own design over a column still null writes nothing either.
    expect(await saveBadgeDesign(db, staff.ADMIN!, otherEventId, readBadgeDesignForm((name) => (designForm({}, otherEventId).get(name) as string | null) ?? null), NOW)).toEqual({ changed: false });
    expect(await stored(otherEventId)).toBeNull();
  });

  it("keeps a band colour from outside the palette that the form posts back untouched, and reads an unreadable one as the club's blue", async () => {
    // As an imported file leaves it: a readable colour that is not one of the palette's.
    await db.update(events).set({ badgeDesign: { ...readBadgeDesign(null), bandColour: "#0d47a1" } }).where(eq(events.id, eventId));
    // The designer offers it as its own selected choice, so the form posts it back with the other boxes.
    expect(await saveBadgeDesign(db, staff.ADMIN!, eventId, readBadgeDesignForm((name) => (designForm({ "badge.design.bandColour": "#0d47a1" }).get(name) as string | null) ?? null), NOW)).toEqual({
      changed: false,
    });
    expect(await trail("event.badge_design_changed")).toHaveLength(0);
    expect(readBadgeDesign(await stored()).bandColour).toBe("#0d47a1");
    // A colour no word reads on, written by hand: read as the club's blue, so the designer's «Culoarea clubului» saves as no change.
    await db.update(events).set({ badgeDesign: { ...readBadgeDesign(null), bandColour: "#777777" } }).where(eq(events.id, eventId));
    expect(readBadgeDesign(await stored()).bandColour).toBeNull();
    expect(await saveBadgeDesign(db, staff.ADMIN!, eventId, readBadgeDesignForm((name) => (designForm().get(name) as string | null) ?? null), NOW)).toEqual({ changed: false });
  });

  it.each([
    ["a text in one language only", { "badge.design.titleRo": "Crosul" }, "badge.design.titleEn", "VALIDATION_ERROR"],
    ["«VOLUNTAR» in one language only", { "badge.design.labelEn": "HELPER" }, "badge.design.labelRo", "VALIDATION_ERROR"],
    ["a custom size outside its bounds", { "badge.design.size": "custom", "badge.design.customWidthMm": "250" }, "badge.design.customWidthMm", "VALIDATION_ERROR"],
    ["a custom size that is no number", { "badge.design.size": "custom", "badge.design.customHeightMm": "" }, "badge.design.customHeightMm", "VALIDATION_ERROR"],
    ["a telephone that is not one", { "badge.design.showPhone": "on", "badge.design.phone": "call me" }, "badge.design.phone", "VALIDATION_ERROR"],
    ["a telephone typed and not one, with its tick off", { "badge.design.phone": "call me" }, "badge.design.phone", "VALIDATION_ERROR"],
    ["a band colour no word reads on", { "badge.design.bandColour": "#808080" }, "badge.design.bandColour", "BADGE_COLOUR_UNREADABLE"],
  ])("refuses %s, naming the box and keeping what was typed", async (_name, fields, box, code) => {
    const result = (await post(actions.saveBadgeDesignAction, designForm(fields))) as FormOutcome;
    expect(result).toMatchObject({ error: code });
    expect(result.fields).toContain(box);
    expect(await stored()).toBeNull();
  });

  it.each(["DEV", "COPYWRITER", "CONTRIBUTOR"] as const)("refuses the %s role on the server, whatever the page drew", async (role) => {
    state.actor = staff[role];
    const result = (await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100" }))) as FormOutcome;
    expect(result).toMatchObject({ error: "FORBIDDEN" });
    expect(await stored()).toBeNull();
  });

  it.each(["MODERATOR", "ADMIN", "SUPERADMIN"] as const)("lets the %s save", async (role) => {
    state.actor = staff[role];
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100" }))).toBe("redirected");
  });
});

describe("§764 «Culorile rolurilor»", () => {
  function coloursForm(rows: Array<[string, string, string?]>): FormData {
    const data = new FormData();
    data.set("uiLocale", "ro");
    data.set("eventId", eventId);
    for (const [roleId, choice, typed] of rows) {
      data.append("roleId", roleId);
      data.set(`role.${roleId}.colour`, choice);
      data.set(`role.${roleId}.typedColour`, typed ?? "");
    }
    return data;
  }

  it("keeps a palette colour, a typed one and the theme's, each change audited with the role and never a person", async () => {
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "#c62828"], [marshalId, "typed", "6A1B9A"]]))).toBe("redirected");
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.map((role) => role.colour)).toEqual(["#c62828", "#6a1b9a"]);
    const rows = await trail("volunteer_role.badge_colour_changed");
    expect(rows).toHaveLength(2);
    expect(rows[0].metadataJson).toMatchObject({ roleId: waterId, nameRo: "Punct de apă", from: null, to: "#c62828" });
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, ""], [marshalId, "typed", "#6a1b9a"]]))).toBe("redirected");
    expect((await listBadgeRoles(db, eventId)).map((role) => role.colour)).toEqual([null, "#6a1b9a"]);
    expect(await trail("volunteer_role.badge_colour_changed")).toHaveLength(3);
  });

  it("keeps a new colour typed while the select still shows the saved choice, never drops it without a word", async () => {
    // The theme's on the select (as saved), a colour typed: the typed one is the change.
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "", "#0d47a1"]]))).toBe("redirected");
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#0d47a1");
    // A palette colour saved, the select left on it, another typed: the typed one again.
    await saveBadgeRoleColours(db, staff.ADMIN!, eventId, [{ roleId: marshalId, choice: "#c62828", typed: "" }], NOW);
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[marshalId, "#c62828", "6a1b9a"]]))).toBe("redirected");
    expect((await listBadgeRoles(db, eventId))[1].colour).toBe("#6a1b9a");
    expect(await trail("volunteer_role.badge_colour_changed")).toHaveLength(3);
  });

  it("refuses a colour typed beside a select changed to another one, naming the select, and changes nothing", async () => {
    const both = (await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "#c62828", "#0d47a1"]]))) as FormOutcome;
    expect(both).toMatchObject({ error: "VALIDATION_ERROR", fields: [`role.${waterId}.colour`] });
    expect((await listBadgeRoles(db, eventId))[0].colour).toBeNull();
    // The typed box still holding the saved colour says nothing new: the select decides.
    await saveBadgeRoleColours(db, staff.ADMIN!, eventId, [{ roleId: waterId, choice: "typed", typed: "#0d47a1" }], NOW);
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "#c62828", "#0D47A1"]]))).toBe("redirected");
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#c62828");
  });

  it("checks only a colour that changes: one written by hand and kept as it is does not stop another role's save", async () => {
    // A stored colour no word reads on, as a hand-written row (or an old file) can leave it.
    await db.update(eventVolunteerRoles).set({ colour: "#808080" }).where(eq(eventVolunteerRoles.id, waterId));
    // The page pre-fills the box with it and selects «Altă culoare»; a new colour on the other role is saved.
    expect(await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "typed", "#808080"], [marshalId, "#c62828"]]))).toBe("redirected");
    expect((await listBadgeRoles(db, eventId)).map((role) => role.colour)).toEqual(["#808080", "#c62828"]);
    expect(await trail("volunteer_role.badge_colour_changed")).toHaveLength(1);
    // Changing that colour to another unreadable one is still refused.
    const refused = (await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "typed", "#777777"]]))) as FormOutcome;
    expect(refused).toMatchObject({ error: "BADGE_COLOUR_UNREADABLE" });
  });

  it("writes every role's colour or none: a refusal on the second row leaves the first unchanged and unaudited", async () => {
    const refused = (await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "#c62828"], [marshalId, "typed", "#808080"]]))) as FormOutcome;
    expect(refused).toMatchObject({ error: "BADGE_COLOUR_UNREADABLE" });
    expect((await listBadgeRoles(db, eventId)).map((role) => role.colour)).toEqual([null, null]);
    expect(await trail("volunteer_role.badge_colour_changed")).toHaveLength(0);
  });

  it("refuses a typed colour that is not one, or that no word reads on, naming its box", async () => {
    const notOne = (await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "typed", "rosu"]]))) as FormOutcome;
    expect(notOne).toMatchObject({ error: "VALIDATION_ERROR", fields: [`role.${waterId}.typedColour`] });
    const grey = (await post(actions.saveBadgeRoleColoursAction, coloursForm([[waterId, "typed", "#808080"]]))) as FormOutcome;
    expect(grey).toMatchObject({ error: "BADGE_COLOUR_UNREADABLE", fields: [`role.${waterId}.typedColour`] });
    expect((await listBadgeRoles(db, eventId))[0].colour).toBeNull();
  });

  it("touches only the event's own roles", async () => {
    await expect(saveBadgeRoleColours(db, staff.ADMIN!, eventId, [{ roleId: otherRoleId, choice: "#c62828", typed: "" }], NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [other] = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, otherRoleId));
    expect(other.colour).toBeNull();
  });

  it("refuses the Tehnic role on the server", async () => {
    await expect(saveBadgeRoleColours(db, staff.DEV!, eventId, [{ roleId: waterId, choice: "#c62828", typed: "" }], NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("§764 a role's colour in the role's own form («Voluntari»)", () => {
  const fields = (extra: Record<string, string> = {}) => ({ nameRo: "Start", nameEn: "Start", needed: "2", descriptionRo: "", descriptionEn: "", ...extra });

  it("adds a role with its colour, audited, and a role added without the boxes starts with the club's orange", async () => {
    const withColour = await changeVolunteerRole(db, staff.MODERATOR!, { kind: "add", eventId, fields: fields({ colourChoice: "#c62828", colourTyped: "" }) }, NOW);
    const without = await changeVolunteerRole(db, staff.MODERATOR!, { kind: "add", eventId, fields: fields({ nameRo: "Sosire", nameEn: "Finish" }) }, NOW);
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.find((role) => role.id === withColour.role.id)?.colour).toBe("#c62828");
    expect(roles.find((role) => role.id === without.role.id)?.colour).toBeNull();
    expect((await trail("volunteer_role.added"))[0].metadataJson).toMatchObject({ roleId: withColour.role.id, colour: "#c62828" });
  });

  it("changes a colour through «Salvează» — audited with the colour from and to — and leaves it alone when the form draws no boxes", async () => {
    const save = (extra: Record<string, string>) => changeVolunteerRole(db, staff.ADMIN!, { kind: "edit", eventId, id: waterId, fields: fields({ nameRo: "Punct de apă", nameEn: "Water point", needed: "3", ...extra }) }, NOW);
    expect(await save({ colourChoice: "typed", colourTyped: "#0d47a1" })).toMatchObject({ changed: true });
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#0d47a1");
    expect((await trail("volunteer_role.edited"))[0].metadataJson).toMatchObject({ fields: ["colour"], colourFrom: null, colourTo: "#0d47a1" });
    // No boxes posted: nothing changes, and nothing is recorded.
    expect(await save({})).toMatchObject({ changed: false });
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#0d47a1");
    // The same colour again changes nothing.
    expect(await save({ colourChoice: "typed", colourTyped: "#0D47A1" })).toMatchObject({ changed: false });
    expect(await trail("volunteer_role.edited")).toHaveLength(1);
  });

  it("saves the role's other fields when its stored colour is one no word reads on and is left as it is", async () => {
    await db.update(eventVolunteerRoles).set({ colour: "#808080" }).where(eq(eventVolunteerRoles.id, waterId));
    const result = await changeVolunteerRole(
      db,
      staff.ADMIN!,
      { kind: "edit", eventId, id: waterId, fields: fields({ nameRo: "Punct de apă", nameEn: "Water point", needed: "4", colourChoice: "typed", colourTyped: "#808080" }) },
      NOW,
    );
    expect(result).toMatchObject({ changed: true });
    const [role] = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, waterId));
    expect(role).toMatchObject({ needed: 4, colour: "#808080" });
  });

  it("refuses a colour no word reads on, or one that is not a colour, naming the form's own box, and writes nothing", async () => {
    await expect(changeVolunteerRole(db, staff.ADMIN!, { kind: "edit", eventId, id: waterId, fields: fields({ colourChoice: "typed", colourTyped: "#808080" }) }, NOW)).rejects.toMatchObject({
      code: "BADGE_COLOUR_UNREADABLE",
      fields: ["colourTyped"],
    });
    await expect(changeVolunteerRole(db, staff.ADMIN!, { kind: "add", eventId, fields: fields({ colourChoice: "typed", colourTyped: "rosu" }) }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["colourTyped"],
    });
    expect((await listBadgeRoles(db, eventId)).map((role) => role.colour)).toEqual([null, null]);
    expect(await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId))).toHaveLength(2);
  });
});

describe("§764 «Descarcă ecusoanele (PDF)»", () => {
  const get = (query: string, id = eventId) => sheetRoute.GET(new Request(`http://localhost/api/admin/events/${id}/badges?${query}`), { params: Promise.resolve({ id }) });
  // The badges per role (§764): since §783 the event's design must choose them; the one badge for everyone has its own describe below.
  beforeEach(async () => {
    await storePerRole();
  });

  it("starts a role that needs more than a pile holds at the most a pile prints, typed or not", () => {
    const many = { id: "a", needed: 500 };
    expect(badgePrintDefault(many)).toBe(BADGE_COUNT_MAX);
    expect(readPrintCounts(new URLSearchParams(), [many])).toMatchObject({ roles: new Map([["a", { count: BADGE_COUNT_MAX, spares: 0 }]]) });
    expect(badgePrintDefault({ needed: 3 })).toBe(3);
  });

  it("reads a box left out as its default and a box posted empty as none", () => {
    const role = { id: "a", needed: 4 };
    expect(readPrintCounts(new URLSearchParams("x.a=1"), [role])).toMatchObject({ roles: new Map([["a", { count: 4, spares: 1 }]]) });
    // «Câte ecusoane» cleared means none, not the people the role needs; the other boxes the same.
    expect(readPrintCounts(new URLSearchParams("n.a=&x.a=&none="), [role])).toMatchObject({ roles: new Map([["a", { count: 0, spares: 0 }]]), none: 0 });
    expect(readPrintCounts(new URLSearchParams("n.a=%20&none=2"), [role])).toMatchObject({ roles: new Map([["a", { count: 0, spares: 0 }]]), none: 2 });
  });

  it("says which way a form was refused: a number that is not one, or a total past the ceiling", () => {
    const role = { id: "a", needed: 4 };
    expect(readPrintCounts(new URLSearchParams("n.a=2.5"), [role])).toEqual({ refused: "number" });
    expect(readPrintCounts(new URLSearchParams(`n.a=${BADGE_COUNT_MAX + 1}`), [role])).toEqual({ refused: "number" });
    expect(readPrintCounts(new URLSearchParams("n.a=300&x.a=300&n.b=300&none=101"), [role, { id: "b", needed: 1 }])).toEqual({ refused: "total" });
    expect(readPrintCounts(new URLSearchParams("n.a=300&x.a=300&n.b=300&none=100"), [role, { id: "b", needed: 1 }])).toMatchObject({ none: 100 });
    expect(readPrintCounts(new URLSearchParams(`n.a=300&x.a=300&none=301`), [role])).toEqual({ refused: "number" });
    expect(readPrintCounts(new URLSearchParams(`n.a=300&x.a=300&none=300`), [role])).toMatchObject({ none: 300 });
    const many = Array.from({ length: 5 }, (_, index) => ({ id: String(index), needed: 300 }));
    // The page's own defaults can pass the ceiling: five roles that need 300 each.
    expect(readPrintCounts(new URLSearchParams(), many)).toEqual({ refused: "total" });
  });

  /** The badges a sheet draws: one «Nume:» (or «Name:») each, caught on its way into pdfkit. */
  async function badgesIn(query: string) {
    const words: string[] = [];
    const text = PDFDocument.prototype.text;
    const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      if (typeof args[0] === "string") words.push(args[0]);
      return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    try {
      const response = await get(query);
      return { response, words };
    } finally {
      spy.mockRestore();
    }
  }

  it("prints, by default, the people each role needs — and the spares and the badges «fără rol» asked", async () => {
    const plain = await badgesIn("locale=ro");
    expect(plain.response.status).toBe(200);
    expect(plain.response.headers.get("content-type")).toBe("application/pdf");
    expect(plain.words.filter((word) => word === "Nume:")).toHaveLength(3 + 5);
    const asked = await badgesIn(`locale=ro&n.${waterId}=2&x.${waterId}=1&n.${marshalId}=4&x.${marshalId}=2&none=3`);
    expect(asked.words.filter((word) => word === "Nume:")).toHaveLength(2 + 1 + 4 + 2 + 3);
    expect(asked.words.filter((word) => word === "PUNCT DE APĂ")).toHaveLength(3);
    expect(asked.words.filter((word) => word === "MARSHAL")).toHaveLength(6);
    // «VOLUNTAR» on every badge: small on the roles', alone on the three «fără rol».
    expect(asked.words.filter((word) => word === "VOLUNTAR")).toHaveLength(12);
    expect(asked.words).toContain("Crosul toamnei");
  });

  it("prints in the language chosen, the roles' names and the words in it", async () => {
    const english = await badgesIn(`locale=en&n.${marshalId}=0&none=0`);
    expect(english.words.filter((word) => word === "Name:")).toHaveLength(3);
    expect(english.words).toContain("WATER POINT");
    expect(english.words).toContain("VOLUNTEER");
    expect(english.words).toContain("Autumn cross");
  });

  it("refuses a number that is not one, and a total past the sheet's ceiling", async () => {
    expect((await get(`locale=ro&n.${waterId}=-1`)).status).toBe(400);
    expect((await get(`locale=ro&n.${waterId}=2.5`)).status).toBe(400);
    expect((await get(`locale=ro&none=300&n.${waterId}=300&n.${marshalId}=300&x.${marshalId}=300`)).status).toBe(400);
    expect((await get("locale=xx")).status).toBe(400);
  });

  it("sends a refusal from the page's own form back to the page, with the reason, and a script still gets the 400", async () => {
    const over = `none=300&n.${waterId}=300&n.${marshalId}=300&x.${marshalId}=300`;
    const total = await get(`locale=en&from=ro&${over}`);
    expect(total.status).toBe(303);
    expect(total.headers.get("location")).toBe(`/ro/admin/events/${eventId}/badges?refused=total`);
    const number = await get(`locale=ro&from=en&n.${waterId}=-1`);
    expect(number.status).toBe(303);
    expect(number.headers.get("location")).toBe(`/en/admin/events/${eventId}/badges?refused=number`);
    // A page that is not a language of the site is not a place to send anyone.
    expect((await get(`locale=ro&from=//elsewhere&${over}`)).status).toBe(400);
    expect((await get(`locale=ro&${over}`)).status).toBe(400);
  });

  it("prints nothing of a role whose «Câte ecusoane» was cleared", async () => {
    const cleared = await badgesIn(`locale=ro&n.${waterId}=&n.${marshalId}=2&none=`);
    expect(cleared.words.filter((word) => word === "Nume:")).toHaveLength(2);
    expect(cleared.words).not.toContain("PUNCT DE APĂ");
  });

  it.each(["DEV", "COPYWRITER", "CONTRIBUTOR"] as const)("refuses the %s role, and a stranger", async (role) => {
    state.actor = staff[role];
    expect((await get("locale=ro")).status).toBe(403);
    state.actor = undefined;
    expect((await get("locale=ro")).status).toBe(401);
  });

  it("answers NOT_FOUND for an event that does not exist or a malformed id", async () => {
    expect((await get("locale=ro", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("locale=ro", "not-an-id")).status).toBe(404);
  });
});

describe("§764 one badge's picture", () => {
  const get = (query: string, id = eventId) => previewRoute.GET(new Request(`http://localhost/api/admin/events/${id}/badges/preview?${query}`), { params: Promise.resolve({ id }) });

  it("draws a role's badge as saved, kept an hour, and the designer's sample unsaved, never kept", async () => {
    const saved = await get(`locale=ro&role=${waterId}&v=abc`);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-type")).toBe("image/png");
    expect(saved.headers.get("cache-control")).toBe("private, max-age=3600");
    const sample = await get("locale=ro&role=none&sample=1&size=strip100");
    expect(sample.status).toBe(200);
    expect(sample.headers.get("cache-control")).toBe("private, no-store");
  }, 60_000);

  it("refuses another event's role and a malformed role", async () => {
    expect((await get(`locale=ro&role=${otherRoleId}`)).status).toBe(404);
    expect((await get("locale=ro&role=nope")).status).toBe(400);
  });

  it.each(["DEV", "COPYWRITER", "CONTRIBUTOR"] as const)("refuses the %s role, and a stranger (BR-REQ-060-01)", async (role) => {
    state.actor = staff[role];
    expect((await get(`locale=ro&role=${waterId}`)).status).toBe(403);
    expect((await get("locale=ro&role=none&sample=1")).status).toBe(403);
    state.actor = undefined;
    expect((await get(`locale=ro&role=${waterId}`)).status).toBe(401);
  });
});

describe("§764 the badge design travels with the event, never a role", () => {
  it("is in the event's file as `readBadgeDesign` answers, and the file names no role", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100", "badge.design.cutMarks": "__off" }));
    const read = await readEventConfig(db, eventId);
    expect(read!.config.badges.design).toMatchObject({ size: "strip100", cutMarks: false });
    expect(JSON.stringify(read!.config)).not.toContain("Punct de apă");
  });

  it("goes with a copy of the event, whose roles do not", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ "badge.design.size": "strip100" }));
    const copy = await duplicateEvent(db, { actor: staff.ADMIN!, eventId, now: NOW });
    expect(readBadgeDesign(await stored(copy.id))).toMatchObject({ size: "strip100" });
    expect(await listBadgeRoles(db, copy.id)).toEqual([]);
  });

  it("reads an event that never had one as the platform's own", async () => {
    const read = await readEventConfig(db, otherEventId);
    expect(read!.config.badges.design).toEqual(DEFAULT_BADGE_DESIGN);
  });
});

describe("§776 the free-text line and the marker area", () => {
  const BOTH = {
    "badge.design.showFreeText": "on",
    "badge.design.freeTextRo": "Bea apă la fiecare punct",
    "badge.design.freeTextEn": "Drink water at every point",
    "badge.design.showMarker": "on",
    "badge.design.markerLabelRo": "Tură",
    "badge.design.markerLabelEn": "Shift",
  };

  it("keeps both on the event, audited with the settings that changed, and carries them in the event's file and a copy", async () => {
    expect(await post(actions.saveBadgeDesignAction, designForm(BOTH))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({
      showFreeText: true,
      freeTextRo: "Bea apă la fiecare punct",
      freeTextEn: "Drink water at every point",
      showMarker: true,
      markerLabelRo: "Tură",
      markerLabelEn: "Shift",
    });
    const rows = await trail("event.badge_design_changed");
    expect((rows[0].metadataJson as { changed: string[] }).changed.sort()).toEqual(["freeTextEn", "freeTextRo", "markerLabelEn", "markerLabelRo", "showFreeText", "showMarker"]);
    expect((await readEventConfig(db, eventId))!.config.badges.design).toMatchObject({ showFreeText: true, showMarker: true, markerLabelEn: "Shift" });
    const copy = await duplicateEvent(db, { actor: staff.ADMIN!, eventId, now: NOW });
    expect(readBadgeDesign(await stored(copy.id))).toMatchObject({ showFreeText: true, freeTextRo: "Bea apă la fiecare punct", showMarker: true });
  });

  it("reads a design stored before them as it always drew: both off, and saves the same form as no change", async () => {
    // A design as the column held it before this release: none of the six keys.
    const old: Record<string, unknown> = { ...readBadgeDesign(null) };
    for (const key of ["showFreeText", "freeTextRo", "freeTextEn", "showMarker", "markerLabelRo", "markerLabelEn"]) delete old[key];
    await db.update(events).set({ badgeDesign: old }).where(eq(events.id, eventId));
    expect(readBadgeDesign(await stored())).toMatchObject({ showFreeText: false, showMarker: false, freeTextRo: "", markerLabelEn: "" });
    expect(await saveBadgeDesign(db, staff.ADMIN!, eventId, readBadgeDesignForm((name) => (designForm().get(name) as string | null) ?? null), NOW)).toEqual({ changed: false });
  });

  it("drops an unreadable stored value as the platform's own, and the page is told which", async () => {
    await db.update(events).set({ badgeDesign: { ...readBadgeDesign(null), showFreeText: "yes", freeTextRo: 7 } }).where(eq(events.id, eventId));
    const event = await findEventForBadges(db, eventId, "ro");
    expect(event!.design).toMatchObject({ showFreeText: false, freeTextRo: "" });
    expect([...event!.dropped].sort()).toEqual(["freeTextRo", "showFreeText"]);
    expect((await findEventForBadges(db, otherEventId, "ro"))!.dropped).toEqual([]);
  });

  it("writes the design as read when a stored value was dropped, even with the boxes unchanged, so the note goes", async () => {
    await db.update(events).set({ badgeDesign: { ...readBadgeDesign(null), showFreeText: "yes" } }).where(eq(events.id, eventId));
    expect((await findEventForBadges(db, eventId, "ro"))!.dropped).toEqual(["showFreeText"]);
    expect(await post(actions.saveBadgeDesignAction, designForm({}))).toBe("redirected");
    expect((await stored()) as Record<string, unknown>).toMatchObject({ showFreeText: false });
    expect((await findEventForBadges(db, eventId, "ro"))!.dropped).toEqual([]);
  });

  it.each([
    ["a free text in one language only", { "badge.design.showFreeText": "on", "badge.design.freeTextRo": "Bea apă" }, "badge.design.freeTextEn"],
    ["a free text in English only", { "badge.design.showFreeText": "on", "badge.design.freeTextEn": "Drink" }, "badge.design.freeTextRo"],
    ["the free text ticked with nothing written", { "badge.design.showFreeText": "on" }, "badge.design.freeTextRo"],
    ["the free text ticked with nothing written, English too", { "badge.design.showFreeText": "on" }, "badge.design.freeTextEn"],
    ["the free text ticked with only what the font cannot draw", { "badge.design.showFreeText": "on", "badge.design.freeTextRo": "😀", "badge.design.freeTextEn": "😀" }, "badge.design.freeTextRo"],
    ["a free text with an emoji only in one language", { "badge.design.showFreeText": "on", "badge.design.freeTextRo": "😀", "badge.design.freeTextEn": "Drink" }, "badge.design.freeTextRo"],
    ["a marker label with an emoji only in one language", { "badge.design.showMarker": "on", "badge.design.markerLabelRo": "😀", "badge.design.markerLabelEn": "Shift" }, "badge.design.markerLabelRo"],
    ["the marker's label in one language only", { "badge.design.showMarker": "on", "badge.design.markerLabelRo": "Tură" }, "badge.design.markerLabelEn"],
  ])("refuses %s, naming the box and keeping what was typed", async (_name, fields, box) => {
    const result = (await post(actions.saveBadgeDesignAction, designForm(fields))) as FormOutcome;
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(result.fields).toContain(box);
    expect(await stored()).toBeNull();
  });

  it("keeps the marker's area ticked with no label at all, and a text written while its tick is off", async () => {
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.showMarker": "on", "badge.design.freeTextRo": "Bea apă", "badge.design.freeTextEn": "Drink" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ showMarker: true, markerLabelRo: "", showFreeText: false, freeTextRo: "Bea apă" });
  });

  it("refuses a size with no room for everything ticked, in words that name what, the size and the height that would", async () => {
    const fields = { ...BOTH, "badge.design.size": "custom", "badge.design.customWidthMm": "60", "badge.design.customHeightMm": "30", "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678" };
    const result = (await post(actions.saveBadgeDesignAction, designForm(fields))) as FormOutcome;
    expect(result).toMatchObject({
      error: "BADGE_SIZE_TOO_SMALL",
      fields: ["badge.design.customHeightMm"],
      errorValues: { what: "linia de text liber, telefonul coordonatorului", width: "60", height: "30", minHeight: "34" },
    });
    expect(await stored()).toBeNull();
    // The sentence, in each language, with the numbers in it.
    const sentence = (locale: "ro" | "en") => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Admin.errors" })("BADGE_SIZE_TOO_SMALL", result.errorValues!);
    expect(sentence("ro")).toContain("60 × 30 mm");
    expect(sentence("ro")).toContain("linia de text liber, telefonul coordonatorului");
    expect(sentence("ro")).toContain("34 mm");
    expect(sentence("en")).toContain("60 × 30 mm");
    expect(sentence("en")).toContain("at least 34 mm");
    // The same ticks on the height the sentence named save.
    expect(await post(actions.saveBadgeDesignAction, designForm({ ...fields, "badge.design.customHeightMm": "34" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ size: "custom", customHeightMm: 34, showFreeText: true, showPhone: true });
  });

  it("prints the free line and the marker's label on every badge of the sheet, in the badge's language", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ ...BOTH, "badge.design.mode": "perRole" }));
    const words: string[] = [];
    const text = PDFDocument.prototype.text;
    const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      if (typeof args[0] === "string") words.push(args[0]);
      return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    try {
      const ro = await sheetRoute.GET(new Request(`http://localhost/api/admin/events/${eventId}/badges?locale=ro`), { params: Promise.resolve({ id: eventId }) });
      expect(ro.status).toBe(200);
      expect(words.filter((word) => word === "Bea apă la fiecare punct")).toHaveLength(3 + 5);
      expect(words.filter((word) => word === "Tură:")).toHaveLength(3 + 5);
      words.length = 0;
      await sheetRoute.GET(new Request(`http://localhost/api/admin/events/${eventId}/badges?locale=en&n.${marshalId}=0&none=0`), { params: Promise.resolve({ id: eventId }) });
      expect(words.filter((word) => word === "Drink water at every point")).toHaveLength(3);
      expect(words.filter((word) => word === "Shift:")).toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("draws the designer's unsaved sample with both, from the address", async () => {
    const query = new URLSearchParams({ locale: "ro", role: "none", sample: "1", showFreeText: "1", showMarker: "1", freeTextRo: "Bea apă", freeTextEn: "Drink", markerLabelRo: "Tură", markerLabelEn: "Shift" });
    const sample = await previewRoute.GET(new Request(`http://localhost/api/admin/events/${eventId}/badges/preview?${query.toString()}`), { params: Promise.resolve({ id: eventId }) });
    expect(sample.status).toBe(200);
    expect(sample.headers.get("content-type")).toBe("image/png");
  }, 60_000);
});

describe("§784 «Câte ecusoane» for a role without a number", () => {
  const person = (roleId: string, name: string, state: "REGISTERED" | "CONFIRMED" | "CANCELLED") => ({
    eventId,
    roleId,
    name,
    email: `${name.toLowerCase()}@example.test`,
    canonicalEmail: `${name.toLowerCase()}@example.test`,
    canonicalizationVersion: 1,
    phone: "+40712345678",
    state,
    source: "PUBLIC" as const,
  });

  it("starts it at the people the organizers gave the role — never the cancelled — where a numbered role starts at its number", async () => {
    const [free] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Ajutoare", nameEn: "Helpers", needed: null, position: 2 }).returning({ id: eventVolunteerRoles.id });
    await db.insert(eventVolunteers).values([person(free.id, "Ana", "CONFIRMED"), person(free.id, "Bogdan", "REGISTERED"), person(free.id, "Cora", "CANCELLED"), person(waterId, "Dan", "CONFIRMED")]);
    await mirrorRolesGiven(db);
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.map((role) => [role.nameRo, role.needed, role.assigned])).toEqual([
      ["Punct de apă", 3, 1],
      ["Marshal", 5, 0],
      ["Ajutoare", null, 2],
    ]);
    const counts = readPrintCounts(new URLSearchParams(), roles);
    if ("refused" in counts) throw new Error("the defaults are never a refusal");
    expect([...counts.roles.values()].map((entry) => entry.count)).toEqual([3, 5, 2]);
    expect(badgePrintDefault(roles[2])).toBe(2);
    // The sheet's piles: what each role starts at, so a press without a change prints 3 + 5 + 2 badges.
    expect(badgePrintEntries(roles, counts, "ro").map((entry) => entry.count)).toEqual([3, 5, 2]);
    // The box is the club's to change: a typed number replaces the start.
    const typed = readPrintCounts(new URLSearchParams(`n.${free.id}=12`), roles);
    if ("refused" in typed) throw new Error("a number in range is no refusal");
    expect(typed.roles.get(free.id)).toEqual({ count: 12, spares: 0 });
  });

  it("starts at nothing while nobody has been given the role, and says so in the sheet", async () => {
    await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Ajutoare", nameEn: "Helpers", needed: null, position: 2 });
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.at(-1)).toMatchObject({ needed: null, assigned: 0 });
    expect(badgePrintDefault(roles.at(-1)!)).toBe(0);
  });
});

describe("§783 one badge for everyone, no role — the default", () => {
  const sheet = (query: string, id = eventId) => sheetRoute.GET(new Request(`http://localhost/api/admin/events/${id}/badges?${query}`), { params: Promise.resolve({ id }) });
  const picture = (query: string, id = eventId) => previewRoute.GET(new Request(`http://localhost/api/admin/events/${id}/badges/preview?${query}`), { params: Promise.resolve({ id }) });
  const held = async (response: Response) => /\((\d+) badges\)/.exec(Buffer.from(await response.arrayBuffer()).toString("latin1"))?.[1];

  /** A sign-up of the event in a state, given a role or none: the people the one badge's default counts are the confirmed ones. */
  const volunteer = async (n: number, state: "REGISTERED" | "CONFIRMED" | "CANCELLED", event = eventId, roleId: string | null = null) => {
    await db.insert(eventVolunteers).values({
      eventId: event,
      roleId,
      name: `Voluntar ${n}`,
      email: `v${n}@example.test`,
      canonicalEmail: `v${n}@example.test`,
      canonicalizationVersion: 1,
      phone: "+40712345678",
      locale: "ro",
      state,
      source: "STAFF",
    });
    await mirrorRolesGiven(db);
  };

  it("reads an event that never chose, and a design saved before the choice, as the one badge for everyone", async () => {
    expect((await findEventForBadges(db, eventId, "ro"))!.design).toMatchObject({ mode: "single", singleColour: null });
    // A column as it was before this release: every key it had, none of the two new ones.
    const old: Record<string, unknown> = { ...DEFAULT_BADGE_DESIGN, size: "strip100", bandColour: "#c62828" };
    delete old.mode;
    delete old.singleColour;
    await db.update(events).set({ badgeDesign: old }).where(eq(events.id, eventId));
    const read = await findEventForBadges(db, eventId, "ro");
    expect(read!.design).toMatchObject({ mode: "single", size: "strip100", bandColour: "#c62828" });
    expect(read!.dropped).toEqual([]);
    // The designer's form, saved over it as it stands, is no change at all: nothing written, nothing audited.
    expect(await saveBadgeDesign(db, staff.ADMIN!, eventId, readBadgeDesignForm((name) => (designForm({ "badge.design.size": "strip100", "badge.design.bandColour": "#c62828" }).get(name) as string | null) ?? null), NOW)).toEqual({ changed: false });
    expect(await trail("event.badge_design_changed")).toHaveLength(0);
  });

  it("keeps the choice and the one badge's colour on the event, audited by name, and carries both in the event's file and a copy", async () => {
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.mode": "perRole", "badge.design.singleColourChoice": "#c62828" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ mode: "perRole", singleColour: "#c62828" });
    const rows = await trail("event.badge_design_changed");
    expect((rows[0].metadataJson as { changed: string[] }).changed.sort()).toEqual(["mode", "singleColour"]);
    expect((await readEventConfig(db, eventId))!.config.badges.design).toMatchObject({ mode: "perRole", singleColour: "#c62828" });
    const copy = await duplicateEvent(db, { actor: staff.ADMIN!, eventId, now: NOW });
    expect(readBadgeDesign(await stored(copy.id))).toMatchObject({ mode: "perRole", singleColour: "#c62828" });
    // And back: the one badge, the colour kept for the day the badges go per role again.
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.mode": "single", "badge.design.singleColourChoice": "#c62828" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ mode: "single", singleColour: "#c62828" });
  });

  it("keeps a colour typed beside «Altă culoare», in lower case, and the club's orange for the empty choice", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ "badge.design.singleColourChoice": "typed", "badge.design.singleColourTyped": "#6A1B9A" }));
    expect(readBadgeDesign(await stored()).singleColour).toBe("#6a1b9a");
    await post(actions.saveBadgeDesignAction, designForm({ "badge.design.singleColourChoice": "", "badge.design.singleColourTyped": "#6a1b9a" }));
    expect(readBadgeDesign(await stored()).singleColour).toBeNull();
  });

  it.each([
    ["a choice that is neither of the two", { "badge.design.mode": "everyone" }, "badge.design.mode", "VALIDATION_ERROR"],
    ["a mode left out of the form", { "badge.design.mode": "__off" }, "badge.design.mode", "VALIDATION_ERROR"],
    ["a typed colour that is no colour", { "badge.design.singleColourChoice": "typed", "badge.design.singleColourTyped": "green" }, "badge.design.singleColourTyped", "VALIDATION_ERROR"],
    ["a typed colour no word reads on", { "badge.design.singleColourChoice": "typed", "badge.design.singleColourTyped": "#808080" }, "badge.design.singleColourTyped", "BADGE_COLOUR_UNREADABLE"],
    ["a chosen colour no word reads on (the palette's green)", { "badge.design.singleColourChoice": "#1b8a3a" }, "badge.design.singleColourChoice", "BADGE_COLOUR_UNREADABLE"],
    ["a choice that is no option", { "badge.design.singleColourChoice": "pink" }, "badge.design.singleColourChoice", "VALIDATION_ERROR"],
    ["the telephone ticked on the one badge with no number typed", { "badge.design.showPhone": "on" }, "badge.design.phone", "VALIDATION_ERROR"],
  ])("refuses %s, naming the box and keeping what was typed", async (_name, fields, box, code) => {
    const result = (await post(actions.saveBadgeDesignAction, designForm(fields))) as FormOutcome;
    expect(result).toMatchObject({ error: code });
    expect(result.fields).toContain(box);
    expect(await stored()).toBeNull();
  });

  it("does not refuse a colour the club hid by choosing a badge per role: typed text that is no colour, or one no word reads on, saves the club's orange", async () => {
    for (const typed of ["green", "#808080"]) {
      expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.mode": "perRole", "badge.design.singleColourChoice": "typed", "badge.design.singleColourTyped": typed }))).toBe("redirected");
      expect(readBadgeDesign(await stored())).toMatchObject({ mode: "perRole", singleColour: null });
    }
  });

  it("allows the telephone ticked with no number on the badges per role (§774), and with the number typed on the one badge", async () => {
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.mode": "perRole", "badge.design.showPhone": "on" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ mode: "perRole", showPhone: true, phone: "" });
    expect(await post(actions.saveBadgeDesignAction, designForm({ "badge.design.mode": "single", "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678" }))).toBe("redirected");
    expect(readBadgeDesign(await stored())).toMatchObject({ mode: "single", showPhone: true, phone: "0712 345 678" });
  });

  it("prints, by default, as many badges as the event has confirmed volunteers — never the unconfirmed or the cancelled", async () => {
    await volunteer(1, "CONFIRMED");
    await volunteer(2, "CONFIRMED");
    await volunteer(3, "CONFIRMED");
    await volunteer(4, "REGISTERED");
    await volunteer(5, "CANCELLED");
    await volunteer(6, "CONFIRMED", otherEventId);
    const response = await sheet("locale=ro");
    expect(response.status).toBe(200);
    expect(await held(response)).toBe("3");
    // «Câte ecusoane» typed, and the spares; the roles' boxes and «Ecusoane fără rol» are not read.
    expect(await held(await sheet(`locale=ro&all=40&allx=5&n.${waterId}=9&none=7`))).toBe("45");
    expect(await held(await sheet("locale=ro&all=&allx=2"))).toBe("2");
  });

  it("starts at what the roles need together when nobody is confirmed yet, and at ten when no role needs anyone", async () => {
    // «Punct de apă» 3 and «Marshal» 5.
    expect(await held(await sheet("locale=ro"))).toBe("8");
    await db.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId));
    expect(await held(await sheet("locale=ro"))).toBe("10");
  });

  it("meets a role without a number (§784): its people join the sum of the roles' needs, finite and never a hole, and the confirmed volunteers still come first", async () => {
    // «Punct de apă» needs 3 and «Marshal» 5; «Ajutoare» has no number, so no need to add up.
    const [free] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Ajutoare", nameEn: "Helpers", needed: null, position: 2 }).returning({ id: eventVolunteerRoles.id });
    const start = async () => readBadgeSingleStart(db, eventId, await listBadgeRoles(db, eventId));
    // Nobody given it yet: it adds nothing, so the sum is the numbered roles' own — a number, never NaN.
    expect(await start()).toEqual({ count: 8, basis: "neededNoNumber" });
    // Three people given it, one cancelled: 3 + 5 + 3 = 11 — not the ten of the fallback, and the sheet's route prints the same.
    for (const [n, state] of [[1, "REGISTERED"], [2, "REGISTERED"], [3, "REGISTERED"], [4, "CANCELLED"]] as const) await volunteer(n, state, eventId, free.id);
    const sum = await start();
    expect(sum).toEqual({ count: 11, basis: "neededNoNumber" });
    expect(Number.isFinite(sum.count)).toBe(true);
    expect(await held(await sheet("locale=ro"))).toBe("11");
    // The club's own «Câte ecusoane» replaces it, as it does everywhere.
    expect(await held(await sheet("locale=ro&all=4"))).toBe("4");
    // One confirmed volunteer: theirs is the count now, whatever the roles' sum.
    await volunteer(5, "CONFIRMED", eventId, free.id);
    expect(await start()).toEqual({ count: 1, basis: "confirmed" });
    expect(await held(await sheet("locale=ro"))).toBe("1");
    // Only a role without a number, nobody given it and nobody confirmed: the ten of the fallback — not nothing.
    await db.delete(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    await db.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, waterId));
    await db.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, marshalId));
    expect(await start()).toEqual({ count: 10, basis: "fallback" });
    expect(await held(await sheet("locale=ro"))).toBe("10");
  });

  it("refuses a number that is not one, or a total past the file's ceiling, as the page's form sends it back", async () => {
    expect((await sheet("locale=ro&all=-1")).status).toBe(400);
    expect((await sheet("locale=ro&all=1.5")).status).toBe(400);
    expect((await sheet("locale=ro&all=1001")).status).toBe(400);
    expect((await sheet("locale=ro&all=1000&allx=1")).status).toBe(400);
    const back = await sheet("locale=ro&from=ro&all=1000&allx=1");
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe(`/ro/admin/events/${eventId}/badges?refused=total`);
    // Up to a file's worth is the one pile of a race with many volunteers.
    expect(await held(await sheet("locale=ro&all=1000"))).toBe("1000");
  }, 120_000);

  it("prints «VOLUNTAR» alone on every badge, no role's name, the free-text line and the marker's area as ticked", async () => {
    await post(actions.saveBadgeDesignAction, designForm({ ...{ "badge.design.showFreeText": "on", "badge.design.freeTextRo": "Bea apă", "badge.design.freeTextEn": "Drink", "badge.design.showMarker": "on", "badge.design.markerLabelRo": "Tură", "badge.design.markerLabelEn": "Shift" } }));
    const words: string[] = [];
    const text = PDFDocument.prototype.text;
    const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      if (typeof args[0] === "string") words.push(args[0]);
      return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    try {
      expect((await sheet("locale=ro&all=6&allx=2")).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(words.filter((word) => word === "VOLUNTAR")).toHaveLength(8);
    expect(words.filter((word) => word === "Nume:")).toHaveLength(8);
    expect(words.filter((word) => word === "Bea apă")).toHaveLength(8);
    expect(words.filter((word) => word === "Tură:")).toHaveLength(8);
    expect(words).not.toContain("PUNCT DE APĂ");
    expect(words).not.toContain("MARSHAL");
  });

  it("draws the one badge whatever role the address names — the designer's sample keeps asking for the first role — and a role's own badge in `perRole`", async () => {
    const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());
    const none = await bytes(await picture("locale=ro&role=none&v=a"));
    const named = await bytes(await picture(`locale=ro&role=${waterId}&v=b`));
    expect(named.equals(none)).toBe(true);
    // The unsaved sample follows the mode in its own address: per role, the role's name is drawn, so the picture differs.
    const sampleSingle = await bytes(await picture(`locale=ro&role=${waterId}&sample=1&mode=single`));
    const samplePerRole = await bytes(await picture(`locale=ro&role=${waterId}&sample=1&mode=perRole`));
    expect(sampleSingle.equals(samplePerRole)).toBe(false);
    expect(sampleSingle.equals(none)).toBe(true);
    // A role of another event is still not found, in either mode.
    expect((await picture(`locale=ro&role=${otherRoleId}`)).status).toBe(404);
  }, 120_000);

  it("keeps the badges per role as they were once the design chooses them: a pile per role, the band of each", async () => {
    await storePerRole();
    expect(await held(await sheet("locale=ro"))).toBe("8");
    expect(await held(await sheet(`locale=ro&n.${waterId}=2&x.${waterId}=1&n.${marshalId}=4&none=3`))).toBe("10");
    // The one badge's boxes are not read there.
    expect(await held(await sheet(`locale=ro&all=50&n.${waterId}=1&n.${marshalId}=1`))).toBe("2");
  });
});
