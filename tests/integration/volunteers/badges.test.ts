import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerRoles } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent } from "@/modules/content/events/service";
import { readEventConfig } from "@/modules/content/events/transfer/export";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { listBadgeRoles, saveBadgeDesign, saveBadgeRoleColours } from "@/modules/volunteers/badges/badges";
import { DomainError } from "@/shared/errors/domain-error";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the volunteer badges against the real schema (migration 0150, PGlite) and through the real Server
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

/** The designer's boxes as the form posts them, the default design unless told otherwise. */
function designForm(fields: Record<string, string> = {}, event = eventId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", event);
  const base: Record<string, string> = {
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

const stored = async (id = eventId) => (await db.select({ badgeDesign: events.badgeDesign }).from(events).where(eq(events.id, id)))[0].badgeDesign;
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action as never));

describe("§NNN migration 0150 on PGlite", () => {
  it("adds a nullable design on the event and a nullable colour on a role, the colour held to a hex triplet", async () => {
    expect(await stored()).toBeNull();
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.map((role) => role.colour)).toEqual([null, null]);
    await expect(db.update(eventVolunteerRoles).set({ colour: "red" }).where(eq(eventVolunteerRoles.id, waterId))).rejects.toThrow();
    await db.update(eventVolunteerRoles).set({ colour: "#c62828" }).where(eq(eventVolunteerRoles.id, waterId));
    expect((await listBadgeRoles(db, eventId))[0].colour).toBe("#c62828");
  });
});

describe("§NNN «Salvează ecusonul»", () => {
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

  it.each([
    ["a text in one language only", { "badge.design.titleRo": "Crosul" }, "badge.design.titleEn", "VALIDATION_ERROR"],
    ["«VOLUNTAR» in one language only", { "badge.design.labelEn": "HELPER" }, "badge.design.labelRo", "VALIDATION_ERROR"],
    ["a custom size outside its bounds", { "badge.design.size": "custom", "badge.design.customWidthMm": "250" }, "badge.design.customWidthMm", "VALIDATION_ERROR"],
    ["a custom size that is no number", { "badge.design.size": "custom", "badge.design.customHeightMm": "" }, "badge.design.customHeightMm", "VALIDATION_ERROR"],
    ["a telephone that is not one", { "badge.design.showPhone": "on", "badge.design.phone": "call me" }, "badge.design.phone", "VALIDATION_ERROR"],
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

describe("§NNN «Culorile rolurilor»", () => {
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

describe("§NNN «Descarcă ecusoanele (PDF)»", () => {
  const get = (query: string, id = eventId) => sheetRoute.GET(new Request(`http://localhost/api/admin/events/${id}/badges?${query}`), { params: Promise.resolve({ id }) });

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

describe("§NNN one badge's picture", () => {
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

  it("refuses another event's role, a malformed role and the Tehnic role", async () => {
    expect((await get(`locale=ro&role=${otherRoleId}`)).status).toBe(404);
    expect((await get("locale=ro&role=nope")).status).toBe(400);
    state.actor = staff.DEV;
    expect((await get(`locale=ro&role=${waterId}`)).status).toBe(403);
  });
});

describe("§NNN the badge design travels with the event, never a role", () => {
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
