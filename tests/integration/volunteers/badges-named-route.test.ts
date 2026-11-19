import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { catalogueOf } from "@/i18n/catalogue";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §988 — «Descarcă PDF cu nume», `POST /api/admin/events/<id>/badges/named` (the hotfix of 2026-11-19, amending §764's «no name is
 * printed»; BR-REQ-050-02, BR-REQ-060-01), against the real schema on PGlite: whoever designs the badges — the Organizer, the
 * Administrator and the Superadministrator (`canDesignVolunteerBadges`) — gets the posted list printed with the event's design as a PDF
 * to save, never kept by the browser; a stranger gets a 401 and every other role a 403 whatever the page drew; an id that is no uuid
 * and an event that does not exist are a 404; a body that is not a form a 400. Nothing is stored but one audit row per download, which
 * says how many badges the file held — `{ badges: n }` — and never a name, a word or a colour.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => {
  const { catalogueOf: catalogue } = await import("@/i18n/catalogue");
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) => createTranslator({ locale, messages: catalogue(locale), namespace: namespace as "Admin" }),
  };
});
// The door as the real one answers it: no session is the domain's UNAUTHENTICATED, which the route turns into a 401.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const route = await import("@/app/api/admin/events/[id]/badges/named/route");

const UNKNOWN_EVENT = "00000000-0000-4000-8000-000000000000";
const LIST = "Fotograf; Amalia; verde\nOrganizator; Dany; albastru\nIon Pop";
const NAMES = ["Amalia", "Dany", "Ion Pop", "Fotograf", "Organizator", "verde", "albastru"];

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), acceptsVolunteers: true }).returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${eventId.slice(0, 8)}`, title: "Crosul toamnei" },
    { eventId, locale: "en", slug: `cross-${eventId.slice(0, 8)}`, title: "Autumn cross" },
  ]);
  state.actor = staff.MODERATOR;
});

/** «Descarcă PDF cu nume» as the box's plain form posts it: the list, and the page's language. */
function post(fields: Record<string, string>, id = eventId): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return route.POST(new Request(`http://localhost/api/admin/events/${id}/badges/named`, { method: "POST", body }), { params: Promise.resolve({ id }) });
}
const trail = () => db.select().from(auditLogs);
const printed = () => db.select().from(auditLogs).where(eq(auditLogs.action, "event.badges_named_printed"));
const held = async (response: Response) => /\((\d+) badges\)/.exec(Buffer.from(await response.arrayBuffer()).toString("latin1"))?.[1];

/** The words a download draws, caught on their way into pdfkit. */
async function drawn(fields: Record<string, string>): Promise<{ response: Response; words: string[] }> {
  const words: string[] = [];
  const text = PDFDocument.prototype.text;
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") words.push(args[0]);
    return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    return { response: await post(fields), words };
  } finally {
    spy.mockRestore();
  }
}

describe("§988 «Descarcă PDF cu nume» — who may print it (BR-REQ-060-01)", () => {
  it("answers 401 without a staff session, and writes nothing", async () => {
    state.actor = undefined;
    const response = await post({ locale: "ro", lines: LIST });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(await trail()).toHaveLength(0);
  });

  it.each(["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const)("refuses the %s role with a 403 whatever the page drew, before it reads the id, and writes nothing", async (role) => {
    state.actor = staff[role];
    for (const id of [eventId, UNKNOWN_EVENT, "not-an-id"]) {
      const response = await post({ locale: "ro", lines: LIST }, id);
      expect(response.status, id).toBe(403);
      expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    }
    expect(await trail()).toHaveLength(0);
  });

  it.each(["MODERATOR", "ADMIN", "SUPERADMIN"] as const)("prints for the %s, audited as theirs", async (role) => {
    state.actor = staff[role];
    const response = await post({ locale: "ro", lines: LIST });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const rows = await printed();
    expect(rows).toHaveLength(1);
    expect(rows[0].actorStaffUserId).toBe(staff[role]!.id);
  });

  it("answers 404 for an id that is no uuid and for an event that does not exist, and writes nothing", async () => {
    for (const id of ["not-an-id", `${eventId}x`, UNKNOWN_EVENT]) {
      const response = await post({ locale: "ro", lines: LIST }, id);
      expect(response.status, id).toBe(404);
      expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    }
    expect(await trail()).toHaveLength(0);
  });

  it("answers 400 to a body that is not a form, and writes nothing", async () => {
    const response = await route.POST(
      new Request(`http://localhost/api/admin/events/${eventId}/badges/named`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: LIST }) }),
      { params: Promise.resolve({ id: eventId }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "VALIDATION_ERROR" });
    expect(await trail()).toHaveLength(0);
  });

  it("is a POST only: the names travel in the body, never in an address", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});

describe("§988 «Descarcă PDF cu nume» — the file", () => {
  it("is a PDF to save — an attachment named for the event and the language, its length said, never kept: private, no-store", async () => {
    const response = await post({ locale: "ro", lines: LIST });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const file = `badges-names-${eventId.slice(0, 8)}-ro.pdf`;
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${file}"; filename*=UTF-8''${file}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // The file says how many badges it holds: one a line.
    expect(bytes.toString("latin1")).toContain("(3 badges)");
  });

  it("writes exactly one audit row a download — the event, who, and how many badges — never a name, a word or a colour", async () => {
    await post({ locale: "ro", lines: LIST });
    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "event.badges_named_printed", entityType: "event", entityId: eventId, actorStaffUserId: staff.MODERATOR!.id });
    expect(rows[0].metadataJson).toEqual({ badges: 3 });
    const kept = JSON.stringify(rows[0]);
    for (const word of NAMES) expect(kept, word).not.toContain(word);
    // A second download is a second row, with its own count.
    await post({ locale: "ro", lines: "Ana" });
    expect((await printed()).map((row) => row.metadataJson)).toEqual(expect.arrayContaining([{ badges: 3 }, { badges: 1 }]));
    expect(await trail()).toHaveLength(2);
  });

  it("prints one badge a line: its word in capitals on the band and its first name, the design's word for a line that names none, never «Nume:»", async () => {
    const { response, words } = await drawn({ locale: "ro", lines: LIST });
    expect(response.status).toBe(200);
    expect(words.filter((word) => word !== "Crosul toamnei")).toEqual(["FOTOGRAF", "Amalia", "ORGANIZATOR", "Dany", "VOLUNTAR", "Ion Pop"]);
    expect(words).toContain("Crosul toamnei");
    expect(words).not.toContain(catalogueOf("ro").Admin.badges.defaults.name);
  });

  it("prints in the language posted, and in Romanian for one that is not the site's", async () => {
    const english = await drawn({ locale: "en", lines: "Ana" });
    expect(english.words).toEqual(["Autumn cross", catalogueOf("en").Admin.badges.defaults.label.toUpperCase(), "Ana"]);
    expect(english.response.headers.get("content-disposition")).toContain(`badges-names-${eventId.slice(0, 8)}-en.pdf`);
    for (const locale of ["xx", ""]) {
      const fallback = await drawn({ locale, lines: "Ana" });
      expect(fallback.words, locale).toEqual(["Crosul toamnei", "VOLUNTAR", "Ana"]);
      expect(fallback.response.headers.get("content-disposition")).toContain(`badges-names-${eventId.slice(0, 8)}-ro.pdf`);
    }
    // No language posted at all: Romanian too.
    const none = await drawn({ lines: "Ana" });
    expect(none.words).toEqual(["Crosul toamnei", "VOLUNTAR", "Ana"]);
  });

  it("takes the club's own word from the event's design for a line that names none", async () => {
    await db.update(events).set({ badgeDesign: { ...DEFAULT_BADGE_DESIGN, labelRo: "Staff", labelEn: "Crew" } }).where(eq(events.id, eventId));
    expect((await drawn({ locale: "ro", lines: "Ana\nFotograf; Dany" })).words).toEqual(["Crosul toamnei", "STAFF", "Ana", "Crosul toamnei", "FOTOGRAF", "Dany"]);
    expect((await drawn({ locale: "en", lines: "Ana" })).words).toEqual(["Autumn cross", "CREW", "Ana"]);
  });

  it("is still a file, saying so, for an empty list — audited as none", async () => {
    const posts: Array<Record<string, string>> = [{ locale: "ro", lines: "" }, { locale: "ro", lines: " \n \n" }, { locale: "ro" }];
    for (const fields of posts) {
      const { response, words } = await drawn(fields);
      expect(response.status).toBe(200);
      expect(words).toEqual(["—"]);
    }
    expect((await printed()).map((row) => row.metadataJson)).toEqual([{ badges: 0 }, { badges: 0 }, { badges: 0 }]);
  });

  it("prints at most 300 badges and audits the number it printed", async () => {
    const lines = Array.from({ length: 305 }, (_, index) => `Voluntar; P${index + 1}`).join("\n");
    const response = await post({ locale: "ro", lines });
    expect(await held(response)).toBe("300");
    expect((await printed())[0].metadataJson).toEqual({ badges: 300 });
  }, 60_000);
});
