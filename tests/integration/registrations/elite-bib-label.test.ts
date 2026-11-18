import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { ELITE_NAME_MAX, eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listDeskRegistrations } from "@/modules/registrations/admin-repository";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import { listBibs } from "@/modules/registrations/bibs";
import { addEliteEntry, listEliteEntries, listPublicEliteEntries } from "@/modules/registrations/elite-list";
import { setEliteEntryBibLabel, setRegistrationEliteBibLabel } from "@/modules/registrations/elite-label";
import { listEliteMarkedRegistrations, setRegistrationElite } from "@/modules/registrations/elite-mark";
import { resolveDisplayName } from "@/modules/registrations/names";
import { exportPersonData } from "@/modules/registrations/person-data";
import { listPublicStartList } from "@/modules/registrations/repository";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Eticheta pe BIB» (§NNN, amending §948; the owner, 2026-11-18: «în dreptul fiecăruia vreau un „BIB Label” și să fie prenumele by
 * default»; BR-REQ-038-01, BR-REQ-060-01) — the label an elite bib prints where the number goes, on a registration marked «Elită»
 * and on a line of the race's elite list. Null is the default — the first name, the line's first word. The Administrator's alone,
 * asserted in each action and again in the service; trimmed and folded; empty or the default itself back to null; too long refused
 * naming the box; one audit row with the id alone; kept across an unmark and a mark; erased with the registration; named in «Toate
 * datele unei persoane»; read by no public query. The sheet and the picture print it (`tests/unit/registrations/elite-bib-label.test.ts`
 * draws the sheet; the picture's input is read here). Read from a real database (PGlite).
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
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string } }) => `/ro${typeof href === "string" ? href : href.pathname}`,
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
vi.mock("@/modules/registrations/bib-image", async (original) => ({
  ...(await original<typeof import("@/modules/registrations/bib-image")>()),
  renderBibImage: async (input: unknown) => {
    state.drawn.push(input);
    return new Response("png", { headers: { "content-type": "image/png" } });
  },
}));

const { setRegistrationEliteAction, setRegistrationEliteBibLabelAction } = await import("@/app/[locale]/admin/registrations/actions");
const { setEliteBibLabelAction } = await import("@/app/[locale]/admin/actions");
const { GET: preview } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

const NOW = new Date("2026-11-18T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);
/** Every role that is not the Administrator's: the Organizer, Tehnic, the Redactor and a desk Volunteer. */
const REFUSED: StaffRole[] = ["MODERATOR", "DEV", "COPYWRITER", "CONTRIBUTOR"];

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
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 10, locationName: "Start" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul de probă", slug: "crosul-de-proba" },
    { eventId: event.id, locale: "en", title: "The test cross", slug: "test-cross" },
  ]);
  eventId = event.id;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A runner with the two halves of the name kept, marked «Elită» unless asked otherwise. */
async function runner(first: string, last: string, options: { status?: RegistrationStatus; bibNumber?: number | null; elite?: boolean } = {}): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.org`;
  const name = `${first} ${last}`;
  const status = options.status ?? "CONFIRMED";
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
      firstName: first,
      lastName: last,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      bibNumber: options.bibNumber === undefined ? (status === "CONFIRMED" ? 10 + serial : null) : options.bibNumber,
      elite: options.elite ?? true,
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

const storedOf = async (id: string) => (await db.select({ label: registrations.eliteBibLabel }).from(registrations).where(eq(registrations.id, id)))[0]?.label;
const lineLabelOf = async (id: string) => (await db.select({ label: eventEliteEntries.bibLabel }).from(eventEliteEntries).where(eq(eventEliteEntries.id, id)))[0]?.label;
const trail = () => db.select().from(auditLogs).orderBy(auditLogs.createdAt);
const deskLabel = async (id: string) => (await listDeskRegistrations(db, { eventId, query: "", locale: "ro" })).find((row) => row.id === id)?.eliteLabel;

describe("§NNN «Eticheta pe BIB» on a registration marked «Elită»", () => {
  it("prints the first name while none is typed, the label once typed, and the first name again once cleared or typed back", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana", "Pop");
    expect(await storedOf(ana)).toBeNull();
    expect(await deskLabel(ana)).toBe("Ana");

    expect(await setRegistrationEliteBibLabel(db, admin, ana, "  Ana   P. ", NOW)).toEqual({ changed: true, eventId });
    expect(await storedOf(ana)).toBe("Ana P.");
    expect(await deskLabel(ana)).toBe("Ana P.");
    expect((await listBibs(db, eventId, { elite: true })).map((row) => row.eliteBibLabel)).toEqual(["Ana P."]);
    expect((await listEliteMarkedRegistrations(db, admin, eventId)).map((row) => [row.bibLabel, row.defaultLabel])).toEqual([["Ana P.", "Ana"]]);

    // The same label again writes nothing and no row.
    expect(await setRegistrationEliteBibLabel(db, admin, ana, "Ana P.", later(1))).toEqual({ changed: false, eventId });
    // Empty: back to the default.
    expect(await setRegistrationEliteBibLabel(db, admin, ana, "   ", later(2))).toEqual({ changed: true, eventId });
    expect(await storedOf(ana)).toBeNull();
    expect(await deskLabel(ana)).toBe("Ana");
    // The default typed back stores nothing either.
    await setRegistrationEliteBibLabel(db, admin, ana, "ANA POP", later(3));
    expect(await setRegistrationEliteBibLabel(db, admin, ana, "Ana", later(4))).toEqual({ changed: true, eventId });
    expect(await storedOf(ana)).toBeNull();

    // One audit row a change, on the registration, with no metadata: never the label, a person's name.
    const rows = (await trail()).filter((row) => row.action === "registration.elite_bib_label_set");
    expect(rows.map((row) => [row.entityType, row.entityId, row.actorStaffUserId, row.metadataJson])).toEqual([
      ["registration", ana, admin.id, {}],
      ["registration", ana, admin.id, {}],
      ["registration", ana, admin.id, {}],
      ["registration", ana, admin.id, {}],
    ]);
    expect(JSON.stringify(await trail())).not.toMatch(/Ana|ANA/);
  });

  it("refuses a label longer than an elite bib carries, naming the box, and writes nothing", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana", "Pop");
    const refusal = await failureOf(setRegistrationEliteBibLabel(db, admin, ana, "x".repeat(ELITE_NAME_MAX + 1), NOW));
    expect(refusal).toMatchObject({ code: "ELITE_LABEL_TOO_LONG", fields: ["eliteBibLabel"] });
    expect(await storedOf(ana)).toBeNull();
    expect(await trail()).toEqual([]);
    // At the limit it is taken.
    await setRegistrationEliteBibLabel(db, admin, ana, "x".repeat(ELITE_NAME_MAX), NOW);
    expect(await storedOf(ana)).toBe("x".repeat(ELITE_NAME_MAX));
  });

  it("is the Administrator's alone: the Organizer, Tehnic, the Redactor and a desk Volunteer are refused with nothing written", async () => {
    const ana = await runner("Ana", "Pop");
    for (const role of REFUSED) {
      const actor = await staff(role);
      expect((await failureOf(setRegistrationEliteBibLabel(db, actor, ana, "Ana P.", NOW))).code, role).toBe("FORBIDDEN");
      // At the action's door too, from the desk: back to the desk with the refusal, nothing written.
      state.actor = actor;
      const target = await redirectOf(setRegistrationEliteBibLabelAction(null, form({ registrationId: ana, eliteBibLabel: "Ana P.", back: "desk", eventId })));
      expect(target, role).toContain("error=FORBIDDEN");
      expect(await redirectOf(setEliteBibLabelAction(null, form({ registrationId: ana, eventId, eliteBibLabel: "Ana P." }))), role).toContain("error=FORBIDDEN");
      // Nor may they mark one elite from the desk's fold.
      expect(await redirectOf(setRegistrationEliteAction(null, form({ registrationId: ana, elite: "0", back: "desk", eventId }))), role).toContain("error=FORBIDDEN");
    }
    expect(await storedOf(ana)).toBeNull();
    expect((await db.select({ elite: registrations.elite }).from(registrations).where(eq(registrations.id, ana)))[0].elite).toBe(true);
    expect(await trail()).toEqual([]);
  });

  it("stays while the mark is off and prints again when it is put back", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana", "Pop");
    await setRegistrationEliteBibLabel(db, admin, ana, "Ana P.", NOW);
    await setRegistrationElite(db, admin, ana, false, later(1));
    expect(await storedOf(ana)).toBe("Ana P.");
    // Unmarked, it prints on no elite sheet.
    expect(await listBibs(db, eventId, { elite: true })).toEqual([]);
    await setRegistrationElite(db, admin, ana, true, later(2));
    expect((await listBibs(db, eventId, { elite: true })).map((row) => row.eliteBibLabel)).toEqual(["Ana P."]);
    expect(await deskLabel(ana)).toBe("Ana P.");
  });

  it("comes back to the desk with its event, its search and the row, the outcome said; a label too long comes back in the row", async () => {
    state.actor = await staff("ADMIN");
    const ana = await runner("Ana", "Pop");
    const saved = await redirectOf(setRegistrationEliteBibLabelAction(null, form({ registrationId: ana, eliteBibLabel: "Ana P.", back: "desk", eventId, q: "ana" })));
    expect(saved).toMatch(/^\/ro\/admin\/checkin\?/);
    const query = new URLSearchParams(saved.slice(saved.indexOf("?") + 1).split("#")[0]);
    expect([query.get("eventId"), query.get("q"), query.get("saved")]).toEqual([eventId, "ana", "eliteLabelSaved"]);
    expect(await storedOf(ana)).toBe("Ana P.");

    const tooLong = "x".repeat(ELITE_NAME_MAX + 1);
    const refused = await setRegistrationEliteBibLabelAction(null, form({ registrationId: ana, eliteBibLabel: tooLong, back: "desk", eventId }));
    expect(refused).toMatchObject({ error: "ELITE_LABEL_TOO_LONG", fields: ["eliteBibLabel"], errorValues: { max: String(ELITE_NAME_MAX) }, values: { eliteBibLabel: [tooLong] } });
    expect(await storedOf(ana)).toBe("Ana P.");

    // The desk's mark posts the state it wants and comes back to the desk too.
    const unmarked = await redirectOf(setRegistrationEliteAction(null, form({ registrationId: ana, elite: "0", back: "desk", eventId, q: "ana" })));
    expect(unmarked).toMatch(/^\/ro\/admin\/checkin\?.*saved=eliteUnmarked/);
    expect(unmarked).toContain(`eventId=${eventId}`);
  });

  it("draws the new label in the bib's picture, and the first name with none", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana", "Pop", { bibNumber: 12 });
    const ask = () => preview(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?registration=${ana}&locale=ro`), { params: Promise.resolve({ id: eventId }) });
    expect((await ask()).status).toBe(200);
    expect(state.drawn.at(-1)).toMatchObject({ elite: { name: "Ana", bibNumber: 12 } });
    await setRegistrationEliteBibLabel(db, admin, ana, "Ana P.", NOW);
    expect((await ask()).status).toBe(200);
    expect(state.drawn.at(-1)).toMatchObject({ elite: { name: "Ana P.", bibNumber: 12 }, registeredName: "Ana Pop" });
  });

  it("is the person's data: in «Toate datele unei persoane», erased with the registration, and read by no public list", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana", "Pop");
    await setRegistrationEliteBibLabel(db, admin, ana, "Ana Fulgerul", NOW);

    const [participant] = await db
      .select({ email: participants.canonicalEmail })
      .from(participants)
      .innerJoin(registrations, eq(registrations.participantId, participants.id))
      .where(eq(registrations.id, ana));
    const person = await exportPersonData(db, admin, participant.email, NOW);
    expect(person.registrations.map((row) => row.eliteBibLabel)).toEqual(["Ana Fulgerul"]);

    // The public start list: the display name and the club, never the label.
    expect(JSON.stringify(await listPublicStartList(db, eventId))).not.toContain("Fulgerul");

    await deleteRegistrationByStaff(db, admin, ana, "cererea persoanei", later(1));
    expect(await db.select().from(registrations).where(eq(registrations.id, ana))).toEqual([]);
    expect(JSON.stringify(await db.select().from(registrations))).not.toContain("Fulgerul");
  });
});

describe("§NNN «Eticheta pe BIB» on a line of the race's elite list", () => {
  it("prints the first word while none is typed, the label once typed, and the first word again once cleared", async () => {
    const admin = await staff("ADMIN");
    const { id } = await addEliteEntry(db, admin, eventId, { name: "Mara Ionescu", bibNumber: "" }, NOW);
    expect(await lineLabelOf(id)).toBeNull();

    expect(await setEliteEntryBibLabel(db, admin, id, " MARA  I. ", later(1))).toEqual({ changed: true, eventId });
    expect(await lineLabelOf(id)).toBe("MARA I.");
    expect((await listEliteEntries(db, admin, eventId)).map((line) => line.bibLabel)).toEqual(["MARA I."]);
    // The first word typed back is the default: null.
    expect(await setEliteEntryBibLabel(db, admin, id, "Mara", later(2))).toEqual({ changed: true, eventId });
    expect(await lineLabelOf(id)).toBeNull();
    expect(await setEliteEntryBibLabel(db, admin, id, "", later(3))).toEqual({ changed: false, eventId });

    const rows = (await trail()).filter((row) => row.action === "event_elite.bib_label_set");
    expect(rows.map((row) => [row.entityType, row.entityId, row.metadataJson])).toEqual([
      ["event", eventId, { entryId: id }],
      ["event", eventId, { entryId: id }],
    ]);
    expect(JSON.stringify(await trail())).not.toMatch(/Mara|MARA/);

    const refusal = await failureOf(setEliteEntryBibLabel(db, admin, id, "x".repeat(ELITE_NAME_MAX + 1), later(4)));
    expect(refusal).toMatchObject({ code: "ELITE_LABEL_TOO_LONG", fields: ["eliteBibLabel"] });
  });

  it("is the Administrator's alone, and never on the public «Elitele cursei»", async () => {
    const admin = await staff("ADMIN");
    const { id } = await addEliteEntry(db, admin, eventId, { name: "Mara Ionescu", bibNumber: "" }, NOW);
    for (const role of REFUSED) {
      const actor = await staff(role);
      expect((await failureOf(setEliteEntryBibLabel(db, actor, id, "MARA", NOW))).code, role).toBe("FORBIDDEN");
      state.actor = actor;
      expect(await redirectOf(setEliteBibLabelAction(null, form({ entryId: id, eventId, eliteBibLabel: "MARA" }))), role).toContain("error=FORBIDDEN");
    }
    expect(await lineLabelOf(id)).toBeNull();

    // The Administrator's press comes back to the elite card, open.
    state.actor = admin;
    expect(await redirectOf(setEliteBibLabelAction(null, form({ entryId: id, eventId, eliteBibLabel: "MARA" })))).toBe(`/ro/admin/events/[id]?saved=eliteLabelSaved#bib-elite`);
    expect(await lineLabelOf(id)).toBe("MARA");
    // Shown on the site, the line is its name and its number — never the label.
    await db.update(eventEliteEntries).set({ onSite: true }).where(eq(eventEliteEntries.id, id));
    const shown = await listPublicEliteEntries(db, eventId);
    expect(shown).toEqual([{ name: "Mara Ionescu", bibNumber: null }]);
  });
});
