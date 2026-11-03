import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { countKits, countRegistrationsForAdmin, readPlaceOutlook, summariseRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { countBibs, countUnverifiedMemberBibs, listBibs } from "@/modules/registrations/bibs";
import { addEliteEntry } from "@/modules/registrations/elite-list";
import { setRegistrationElite } from "@/modules/registrations/elite-mark";
import { resolveDisplayName } from "@/modules/registrations/names";
import { countOccupied } from "@/modules/registrations/repository";
import { STAFF_ROLES, canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Marchează ca elită» / «Nu mai e elită» (§897; the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită
 * oricând», choosing «Rămâne înscris»; BR-REQ-060-01) — an Administrator marks a registration elite at any time and in
 * any state, and its bib prints elite-style (§895's drawing): the name where the number goes, its own number under it
 * only with «Număr pe BIB-urile de elită». Nothing else of the registration moves — no state, place, number, count or
 * email — and the trail holds the registration's id and the new value alone. Read from a real database (PGlite).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, drawn: [] as unknown[] }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations" }));
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
// The picture's input is what this file reads of the preview route; the drawing itself is `elite-bibs.test.ts`'s.
vi.mock("@/modules/registrations/bib-image", async (original) => ({
  ...(await original<typeof import("@/modules/registrations/bib-image")>()),
  renderBibImage: async (input: unknown) => {
    state.drawn.push(input);
    return new Response("png", { headers: { "content-type": "image/png" } });
  },
}));

const { setRegistrationEliteAction } = await import("@/app/[locale]/admin/registrations/actions");
const { GET: sheet } = await import("@/app/api/admin/events/[id]/bibs/route");
const { GET: preview } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

const NOW = new Date("2026-11-03T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.drawn = [];
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 3, kitShirt: true, locationName: "Start" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
  eventId = event.id;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function as(role: StaffRole): Promise<StaffUser> {
  const user = await staff(role);
  state.actor = user;
  return user;
}

/** A runner in the given state, with a number when confirmed — the shapes the CHECKs ask of each state. */
async function runner(name: string, status: RegistrationStatus, bibNumber: number | null = null): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      bibNumber,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
    })
    .returning({ id: registrations.id });
  return row.id;
}

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

const eliteOf = async (id: string) => (await db.select({ elite: registrations.elite }).from(registrations).where(eq(registrations.id, id)))[0].elite;

describe("§897 the elite mark on a registration", () => {
  it("is off on every registration until an Administrator marks it, and comes off as freely", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await eliteOf(ana)).toBe(false);

    expect(await setRegistrationElite(db, admin, ana, true, NOW)).toEqual({ changed: true });
    expect(await eliteOf(ana)).toBe(true);
    expect(await setRegistrationElite(db, admin, ana, false, later(1))).toEqual({ changed: true });
    expect(await eliteOf(ana)).toBe(false);

    // The trail: one row a change, on the registration, holding the new value and nothing else.
    const trail = await db.select().from(auditLogs).orderBy(auditLogs.createdAt);
    expect(trail.map((row) => [row.action, row.entityType, row.entityId, row.actorStaffUserId, row.metadataJson])).toEqual([
      ["registration.elite_marked", "registration", ana, admin.id, { elite: true }],
      ["registration.elite_unmarked", "registration", ana, admin.id, { elite: false }],
    ]);
    expect(JSON.stringify(trail)).not.toContain("Ana");
  });

  it("asks no date and no state: every state is marked, a cancelled row and a race after its start too", async () => {
    const admin = await staff("ADMIN");
    // The race already started: the mark is how a bib prints, and a bib may be reprinted on the day.
    await db.update(events).set({ startsAt: new Date("2026-11-01T08:00:00.000Z") }).where(eq(events.id, eventId));
    const states: RegistrationStatus[] = ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "CONFIRMED", "CANCELLED", "EXPIRED"];
    for (const [index, status] of states.entries()) {
      const id = await runner(`Runner ${status}`, status, status === "CONFIRMED" ? 5 : null);
      await setRegistrationElite(db, admin, id, true, later(index));
      expect(await eliteOf(id), status).toBe(true);
      const [row] = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, id));
      expect(row.status, status).toBe(status);
    }
  });

  it("is the Administrator's alone: the Organizer, Tehnic and every other role are refused and nothing is written", async () => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canManageRegistrations(role)) continue;
      expect((await failureOf(setRegistrationElite(db, actor, ana, true, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(await eliteOf(ana)).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    // The two the brief names, by name.
    expect(canManageRegistrations("MODERATOR")).toBe(false);
    expect(canManageRegistrations("DEV")).toBe(false);
  });

  it("writes nothing for a press that finds the mark already as asked, and refuses an unknown registration", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await setRegistrationElite(db, admin, ana, false, NOW)).toEqual({ changed: false });
    await setRegistrationElite(db, admin, ana, true, NOW);
    expect(await setRegistrationElite(db, admin, ana, true, later(1))).toEqual({ changed: false });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
    expect((await failureOf(setRegistrationElite(db, admin, "00000000-0000-4000-8000-000000000000", true, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(setRegistrationElite(db, admin, "not-an-id", true, NOW))).code).toBe("NOT_FOUND");
  });

  it("changes no state, place, race number, count or kit, and sends no email", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const ion = await runner("Ion Ionescu", "CONFIRMED", 13);
    const mara = await runner("Mara Dima", "CONFIRMED", 14);
    const waiting = await runner("Radu Stan", "WAITLISTED");

    const snapshot = async () => ({
      occupied: await countOccupied(db, eventId, NOW),
      kits: await countKits(db, eventId, NOW),
      summary: await summariseRegistrationsForAdmin(db, { eventId }),
      places: await readPlaceOutlook(db, eventId, NOW),
      bibs: await countBibs(db, eventId),
      numbers: (await listBibs(db, eventId)).map((row) => [row.id, row.bibNumber, row.registeredName]),
      rows: (await db.select({ id: registrations.id, status: registrations.status, bibNumber: registrations.bibNumber, outside: registrations.outsideCapacity, printed: registrations.bibPrintedAt }).from(registrations)).sort((a, b) => a.id.localeCompare(b.id)),
    });
    const before = await snapshot();
    expect(before.occupied.confirmed).toBe(3);

    for (const [index, id] of [ana, ion, mara, waiting].entries()) await setRegistrationElite(db, admin, id, true, later(index));
    expect(await snapshot()).toEqual(before);
    await setRegistrationElite(db, admin, ion, false, later(9));
    expect(await snapshot()).toEqual(before);

    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe("§897 «Marchează ca elită» from the list's «⋮»", () => {
  it("marks and unmarks for the Administrator and comes back to the list as it stood", async () => {
    await as("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const marked = await redirectOf(setRegistrationEliteAction(null, form({ registrationId: ana, elite: "1", listQuery: `eventId=${eventId}&page=2` })));
    expect(marked).toBe(`/ro/admin/registrations?eventId=${eventId}&page=2&saved=eliteMarked#admin-alert`);
    expect(await eliteOf(ana)).toBe(true);
    const unmarked = await redirectOf(setRegistrationEliteAction(null, form({ registrationId: ana, elite: "0", listQuery: `eventId=${eventId}` })));
    expect(unmarked).toBe(`/ro/admin/registrations?eventId=${eventId}&saved=eliteUnmarked#admin-alert`);
    expect(await eliteOf(ana)).toBe(false);
    expect((await db.select().from(auditLogs)).map((row) => row.action).sort()).toEqual(["registration.elite_marked", "registration.elite_unmarked"]);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it.each<StaffRole>(["MODERATOR", "DEV"])("refuses %s at the door: no mark, no row in the trail", async (role) => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await as(role);
    const refused = await redirectOf(setRegistrationEliteAction(null, form({ registrationId: ana, elite: "1", listQuery: `eventId=${eventId}` })));
    expect(refused).toBe(`/ro/admin/registrations?eventId=${eventId}&error=FORBIDDEN#admin-alert`);
    expect(await eliteOf(ana)).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});

/** Every string the sheet hands pdfkit's `text`, with the box it was given — an elite line is set with no width. */
async function drawnTexts(run: () => Promise<unknown>): Promise<{ text: string; width: number | undefined }[]> {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await run();
    return text.mock.calls.map(([string, , , options]) => ({ text: String(string), width: (options as { width?: number } | undefined)?.width }));
  } finally {
    text.mockRestore();
  }
}

const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

describe("§897 a marked registration's bib", () => {
  const get = (query: string) => sheet(new Request(`http://localhost/api/admin/events/${eventId}/bibs?${query}`), { params: Promise.resolve({ id: eventId }) });

  it("prints elite-style on the ordinary sheet — its name in the number's place, its number only with «Număr pe BIB-urile de elită»", async () => {
    const admin = await as("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await runner("Ion Ionescu", "CONFIRMED", 13);
    await setRegistrationElite(db, admin, ana, true, NOW);

    let drawn: { text: string; width: number | undefined }[] = [];
    let response: Response | undefined;
    drawn = await drawnTexts(async () => {
      response = await get("locale=ro");
    });
    expect(response?.status).toBe(200);
    // Ion's bib as ever: his number, his name in its strip (a width to centre in).
    expect(drawn.map((run) => run.text)).toContain("13");
    expect(drawn.find((run) => run.text === "Ion Ionescu")?.width).toBeGreaterThan(0);
    // Ana's: her name set as the elite layout sets it (no width: centred by hand, never cut), no number by default.
    expect(drawn.filter((run) => run.text === "Ana Pop").map((run) => run.width)).toEqual([undefined]);
    expect(drawn.map((run) => run.text)).not.toContain("12");

    // Ticked, her own number prints under her name — the race number she keeps.
    const [event] = await db.select({ design: events.bibDesign }).from(events).where(eq(events.id, eventId));
    await db.update(events).set({ bibDesign: { ...((event.design as object) ?? {}), eliteNumber: true } }).where(eq(events.id, eventId));
    drawn = await drawnTexts(() => get("locale=ro"));
    expect(drawn.map((run) => run.text)).toContain("12");
    expect(drawn.filter((run) => run.text === "Ana Pop").map((run) => run.width)).toEqual([undefined]);
    const [row] = await db.select({ bibNumber: registrations.bibNumber, status: registrations.status }).from(registrations).where(eq(registrations.id, ana));
    expect(row).toEqual({ bibNumber: 12, status: "CONFIRMED" });
  });

  it("is on the elite sheet after the list's names, so one download is every elite bib", async () => {
    const admin = await staff("ADMIN");
    // The Organizer downloads the sheet (§289); the Administrator marked the runners.
    await as("MODERATOR");
    await addEliteEntry(db, admin, eventId, { name: "Eliud Kipchoge", bibNumber: "" }, NOW);
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await runner("Ion Ionescu", "CONFIRMED", 13);
    const mara = await runner("Mara Dima", "CONFIRMED", 14);
    // Marked but not confirmed: no bib exists to print yet.
    const waiting = await runner("Radu Stan", "WAITLISTED");
    for (const id of [ana, mara, waiting]) await setRegistrationElite(db, admin, id, true, NOW);

    let response: Response | undefined;
    const drawn = await drawnTexts(async () => {
      response = await get("locale=ro&elite=1");
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-disposition")).toMatch(/-elite\.pdf/);
    // The list first, in the order typed, then the marked registrations by number — each as an elite bib.
    const names = drawn.filter((run) => ["Eliud Kipchoge", "Ana Pop", "Mara Dima", "Ion Ionescu", "Radu Stan"].includes(run.text));
    expect(names).toEqual([
      { text: "Eliud Kipchoge", width: undefined },
      { text: "Ana Pop", width: undefined },
      { text: "Mara Dima", width: undefined },
    ]);
    // Three elite bibs, two to a page; one per page when asked.
    expect(pages(Buffer.from(await (await get("locale=ro&elite=1")).arrayBuffer()))).toBe(2);
    expect(pages(Buffer.from(await (await get("locale=ro&elite=1&layout=one")).arrayBuffer()))).toBe(3);
    // The ordinary sheet still prints all three confirmed runners, the marked two elite-style.
    expect(pages(Buffer.from(await (await get("locale=ro")).arrayBuffer()))).toBe(2);
  });

  it("leaves the bibs page's «unverified members» line and the list it links to: an elite bib is never the ordinary one", async () => {
    const admin = await as("ADMIN");
    await db.update(events).set({ bibDesign: { member: { enabled: true, bandColour: "#6a1b9a", label: "Membru BVR" } } }).where(eq(events.id, eventId));
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await runner("Ion Ionescu", "CONFIRMED", 13);
    await db.update(registrations).set({ memberBibWanted: true });
    const askedFilter = { eventId, memberBibAsked: true };
    expect(await countUnverifiedMemberBibs(db, eventId)).toBe(2);
    expect(await countRegistrationsForAdmin(db, askedFilter)).toBe(2);

    await setRegistrationElite(db, admin, ana, true, NOW);
    expect(await countUnverifiedMemberBibs(db, eventId)).toBe(1);
    expect(await countRegistrationsForAdmin(db, askedFilter)).toBe(1);
    await setRegistrationElite(db, admin, ana, false, later(1));
    expect(await countUnverifiedMemberBibs(db, eventId)).toBe(2);
  });

  it("draws the registration's picture elite-style, never the members' design, under its own picture address", async () => {
    const admin = await as("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const ask = () => preview(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?registration=${ana}&locale=ro`), { params: Promise.resolve({ id: eventId }) });

    expect((await ask()).status).toBe(200);
    expect(state.drawn.at(-1)).not.toHaveProperty("elite");
    await setRegistrationElite(db, admin, ana, true, NOW);
    expect((await ask()).status).toBe(200);
    expect(state.drawn.at(-1)).toMatchObject({ elite: { name: "Ana Pop", bibNumber: 12 }, member: false, bibNumber: 12 });
  });
});
