import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { CLUB_NAME } from "@/theme/brand";
import { readSheet, startListRows } from "../../helpers/xlsx";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §787 (amends §172 and §581; BR-REQ-060-01, BR-REQ-037-03) — «the Excel should have a statistics footer so that I
 * can show „how many Brașov Runners”, how many active, etc., grouped by category» (the owner, 2026-10-15), from a
 * real database and through the export route itself: the footer counts the rows the file carries — the filters
 * apply (§581), a test registration is never in them (§30) — in the reader's language, per event for a file of
 * several, and the CSV beside it stays rows only.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string, startsAt: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date(startsAt),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${event.id}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${event.id}-en`, title },
  ]);
  return event;
}

let serial = 0;
/** A registration of `eventId`; `age` on the race day (the races are in 2099: the birth date is that year minus the age, in January). */
async function register(eventId: string, status: (typeof registrations.$inferInsert)["status"], row: Partial<typeof registrations.$inferInsert> & { age?: number; email?: string } = {}) {
  serial += 1;
  const { age, email: typed, ...rest } = row;
  const email = canonicalizeEmail(typed ?? `runner${serial}@example.org`);
  const name = `Alergător ${serial}`;
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email.deliveryEmail,
      normalizedEmail: email.normalizedEmail,
      canonicalEmail: email.canonicalEmail,
      canonicalizationVersion: email.canonicalizationVersion,
      defaultName: name,
      preferredLocale: "ro",
    })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date(),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status,
    birthDate: age === undefined ? null : `${2099 - age}-01-01`,
    ...rest,
  });
}

async function staff(role: StaffRole, email = `${role.toLowerCase()}@dev.test`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: email, role }).returning();
  return user;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  state.db = db;
  await resetTables(db);
  state.actor = await staff("ADMIN", "reader@dev.test");
});

/** One race: every state, the club by each of its three signals and not, two sexes, and a test registration that is the club's, confirmed and female. */
async function seedRace(title = "Crosul Cifrelor", startsAt = "2099-11-21T08:00:00.000Z") {
  const race = await createRace(title, startsAt);
  await staff("MEMBER", "membru@example.org");
  // Confirmed: the ticked box, a member account's address, a typed club, and a stranger (serials 1 to 4).
  await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 25, clubMemberDeclared: true });
  await register(race.id, "CONFIRMED", { sex: "MALE", age: 35, email: "membru@example.org" });
  await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 26, clubName: "Runners Brașov" });
  await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 27, clubName: "Alt Club" });
  // The others, one of each state.
  await register(race.id, "PENDING_EMAIL_CONFIRMATION", { sex: "MALE", age: 16, clubMemberDeclared: true });
  await register(race.id, "PENDING_DECLARATION", { sex: "FEMALE", age: 61 });
  await register(race.id, "WAITLISTED", { sex: "MALE" });
  await register(race.id, "WAITLIST_OFFERED", { sex: "FEMALE", age: 28, clubName: "BVR" });
  await register(race.id, "CANCELLED", { sex: "MALE", age: 35 });
  await register(race.id, "EXPIRED", { sex: "FEMALE", age: 41 });
  // A test registration behaves like a real one and is in no count the club is given (§30).
  await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 25, clubMemberDeclared: true, kind: "TEST" });
  return race;
}

const url = (extra: string) => `http://localhost/api/admin/registrations/export?${extra}`;

async function download(extra: string) {
  const response = await exportRegistrations(new Request(url(extra)));
  expect(response.status).toBe(200);
  return readSheet(Buffer.from(await response.arrayBuffer())).rows;
}

/** The footer from its title on, the empty rows kept as `[]`. */
function footerOf(rows: (string | undefined)[][], title = "Statistici") {
  const at = rows.findIndex((row) => row?.[0] === title);
  expect(at, `the «${title}» row`).toBeGreaterThan(0);
  return Array.from({ length: rows.length - at }, (_, index) => rows[at + index] ?? []);
}

describe("§787 the footer, through the route", () => {
  it("counts the rows of the file by state, club and category, and never a test registration", async () => {
    const race = await seedRace();
    const rows = await download(`eventId=${race.id}&format=xlsx`);
    // Ten real registrations in the table (the test one is not there), and the footer under them after one empty row.
    expect(startListRows(rows)).toHaveLength(1 + 10);
    expect(rows[11]).toBeUndefined();
    expect(rows[12]).toEqual(["Statistici"]);
    const footer = footerOf(rows);
    expect(footer.slice(0, 15)).toEqual([
      ["Statistici"],
      ["Total", "10"],
      ["Confirmați (activi)", "4"],
      ["Așteaptă confirmarea adresei", "1"],
      ["Așteaptă semnarea declarației", "1"],
      ["Pe lista de așteptare", "1"],
      ["Au o ofertă de loc", "1"],
      ["Anulați", "1"],
      ["Expirați", "1"],
      [CLUB_NAME, "5"],
      [`${CLUB_NAME}, confirmați`, "3"],
      [`Alții, nu ${CLUB_NAME}`, "5"],
      // Nobody on «Lista de invitați speciali» in this race: the confirmed part of the places line is all the confirmed (§643, §615).
      ["Invitați speciali", "0"],
      ["Invitați speciali, confirmați", "0"],
      ["Confirmați care ocupă un loc", "4"],
    ]);
    const at = footer.findIndex((row) => row[0] === "Categorie");
    expect(footer.slice(at, at + 9)).toEqual([
      ["Categorie", "Total", "Confirmați (activi)", CLUB_NAME, `${CLUB_NAME}, confirmați`],
      ["Feminin, 18-29 ani", "4", "3", "3", "2"],
      ["Feminin, 40-49 ani", "1", "0", "0", "0"],
      ["Feminin, 60+ ani", "1", "0", "0", "0"],
      ["Masculin, sub 18 ani", "1", "0", "1", "0"],
      ["Masculin, 30-39 ani", "2", "1", "1", "1"],
      ["Fără categorie", "1", "0", "0", "0"],
      [],
      ["Activi sunt cei confirmați: au declarația semnată; cei care ocupă un loc sunt la «Confirmați care ocupă un loc»."],
    ]);
  });

  it("is the rows on screen: a filter narrows the footer with the table", async () => {
    const race = await seedRace();
    const confirmed = footerOf(await download(`eventId=${race.id}&format=xlsx&status=CONFIRMED`));
    expect(confirmed.slice(1, 4)).toEqual([["Total", "4"], ["Confirmați (activi)", "4"], ["Așteaptă confirmarea adresei", "0"]]);
    const members = footerOf(await download(`eventId=${race.id}&format=xlsx&clubMember=1`));
    // The box ticked (twice: one confirmed, one pending) and the member account's address; a typed club is not the filter's.
    expect(members.slice(1, 3)).toEqual([["Total", "3"], ["Confirmați (activi)", "2"]]);
    const [cancelled] = await db.select({ name: registrations.registeredName }).from(registrations).where(eq(registrations.status, "CANCELLED"));
    const searched = footerOf(await download(`eventId=${race.id}&format=xlsx&q=${encodeURIComponent(cancelled.name)}`));
    expect(searched.slice(1, 3)).toEqual([["Total", "1"], ["Confirmați (activi)", "0"]]);
  });

  it("names the special guests on lines of their own: inside «Total» and their state, and out of the places line's confirmed part (§643, §615)", async () => {
    const race = await createRace("Crosul Invitaților", "2099-11-21T08:00:00.000Z");
    await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 25 });
    await register(race.id, "CONFIRMED", { sex: "MALE", age: 35, outsideCapacity: true });
    await register(race.id, "CONFIRMED", { sex: "MALE", age: 36, outsideCapacity: true, clubMemberDeclared: true });
    await register(race.id, "WAITLISTED", { sex: "FEMALE", age: 30, outsideCapacity: true });
    // A test registration is in no count, a guest or not (§30).
    await register(race.id, "CONFIRMED", { sex: "FEMALE", age: 30, outsideCapacity: true, kind: "TEST" });
    const rows = await download(`eventId=${race.id}&format=xlsx`);
    const footer = footerOf(rows);
    expect(footer.slice(0, 15)).toEqual([
      ["Statistici"],
      ["Total", "4"],
      ["Confirmați (activi)", "3"],
      ["Așteaptă confirmarea adresei", "0"],
      ["Așteaptă semnarea declarației", "0"],
      ["Pe lista de așteptare", "1"],
      ["Au o ofertă de loc", "0"],
      ["Anulați", "0"],
      ["Expirați", "0"],
      [CLUB_NAME, "1"],
      [`${CLUB_NAME}, confirmați`, "1"],
      [`Alții, nu ${CLUB_NAME}`, "3"],
      ["Invitați speciali", "3"],
      ["Invitați speciali, confirmați", "2"],
      ["Confirmați care ocupă un loc", "1"],
    ]);
    // The note says it in a sentence, and the English file says it in English.
    expect(footer.map((row) => row[0])).toContain("Invitații speciali, puși de un administrator pe «Lista de invitați speciali», nu ocupă un loc; sunt numărați la «Total» și la starea lor.");
    const english = footerOf(await download(`eventId=${race.id}&format=xlsx&lang=en`), "Statistics");
    expect(english.slice(12, 15)).toEqual([["Special guests", "3"], ["Special guests, confirmed", "2"], ["Confirmed who take a place", "1"]]);
    // The column the formulas read is the sheet's own, filled from the registration's «outside the capacity» flag.
    const header = rows[0] as string[];
    // Last but for «Note interne» (§785), which an Administrator's file carries after it.
    expect(header.slice(-2)).toEqual(["Special guest", "Note interne"]);
    expect(startListRows(rows).slice(1).map((row) => row[header.indexOf("Special guest")]).sort()).toEqual(["0", "1", "1", "1"]);
  });

  it("is in the reader's language with ?lang=en, and Română for any other", async () => {
    const race = await seedRace();
    const english = footerOf(await download(`eventId=${race.id}&format=xlsx&lang=en`), "Statistics");
    expect(english.slice(0, 4)).toEqual([["Statistics"], ["Total", "10"], ["Confirmed (active)", "4"], ["Waiting for the address to be confirmed", "1"]]);
    expect(english.find((row) => row[0] === "Category")).toEqual(["Category", "Total", "Confirmed (active)", CLUB_NAME, `${CLUB_NAME}, confirmed`]);
    expect(english.map((row) => row[0])).toContain("Female, 18-29");
    const fallback = await download(`eventId=${race.id}&format=xlsx&lang=xx`);
    expect(fallback.some((row) => row?.[0] === "Statistici")).toBe(true);
  });

  it("counts per event first and all of them at the end when the file holds several events", async () => {
    await seedRace("Prima Cursă", "2099-11-21T08:00:00.000Z");
    const second = await createRace("A Doua Cursă", "2099-12-05T08:00:00.000Z");
    await register(second.id, "CONFIRMED", { sex: "MALE", age: 45, clubName: "Brașov Runners" });
    await register(second.id, "WAITLISTED", { sex: "MALE", age: 45 });
    await register(second.id, "CONFIRMED", { sex: "FEMALE", age: 22, kind: "TEST" });

    const rows = await download("eventId=all&format=xlsx");
    expect(startListRows(rows)).toHaveLength(1 + 10 + 2);
    const footer = footerOf(rows);
    const labels = footer.map((row) => row[0]);
    expect(labels.filter((label) => label === "Statistici")).toHaveLength(1);
    const at = (label: string) => labels.indexOf(label);
    // Each event's label is its title and its day on its own clock.
    expect([at("Prima Cursă · 21.11.2099"), at("A Doua Cursă · 05.12.2099"), at("Toate evenimentele")].every((index) => index > 0)).toBe(true);
    expect(at("Prima Cursă · 21.11.2099")).toBeLessThan(at("A Doua Cursă · 05.12.2099"));
    expect(at("A Doua Cursă · 05.12.2099")).toBeLessThan(at("Toate evenimentele"));
    const secondAt = at("A Doua Cursă · 05.12.2099");
    expect(footer.slice(secondAt, secondAt + 4)).toEqual([["A Doua Cursă · 05.12.2099"], ["Total", "2"], ["Confirmați (activi)", "1"], ["Așteaptă confirmarea adresei", "0"]]);
    // The categories of that event are inside its block: the two men of 40 to 49.
    expect(footer.slice(secondAt, at("Toate evenimentele")).find((row) => row[0] === "Masculin, 40-49 ani")).toEqual(["Masculin, 40-49 ani", "2", "1", "1", "1"]);
    const allAt = at("Toate evenimentele");
    expect(footer.slice(allAt, allAt + 3)).toEqual([["Toate evenimentele"], ["Total", "12"], ["Confirmați (activi)", "5"]]);
  });

  it("keeps two events with one title apart, each with its own day", async () => {
    const monday = await createRace("Alergarea de luni", "2099-11-02T16:00:00.000Z");
    const next = await createRace("Alergarea de luni", "2099-11-09T16:00:00.000Z");
    await register(monday.id, "CONFIRMED", { sex: "FEMALE", age: 30 });
    await register(next.id, "CONFIRMED", { sex: "FEMALE", age: 30 });
    await register(next.id, "CONFIRMED", { sex: "MALE", age: 30 });
    const footer = footerOf(await download("eventId=all&format=xlsx"));
    const labels = footer.map((row) => row[0]);
    expect(labels).toContain("Alergarea de luni · 02.11.2099");
    expect(labels).toContain("Alergarea de luni · 09.11.2099");
    expect(footer[labels.indexOf("Alergarea de luni · 02.11.2099") + 1]).toEqual(["Total", "1"]);
    expect(footer[labels.indexOf("Alergarea de luni · 09.11.2099") + 1]).toEqual(["Total", "2"]);
  });

  it("tells two events with one title on one day apart by their start time, and never prints an id", async () => {
    const morning = await createRace("Alergarea dublă", "2099-11-02T08:00:00.000Z");
    const noon = await createRace("Alergarea dublă", "2099-11-02T12:00:00.000Z");
    const [untitled] = await db
      .insert(events)
      .values({ type: "RACE", surface: "ASPHALT", startsAt: new Date("2099-11-03T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 10, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
      .returning();
    await register(morning.id, "CONFIRMED", { sex: "FEMALE", age: 30 });
    await register(noon.id, "CONFIRMED", { sex: "FEMALE", age: 30 });
    await register(untitled.id, "CONFIRMED", { sex: "FEMALE", age: 30 });
    const labels = footerOf(await download("eventId=all&format=xlsx")).map((row) => row[0]);
    expect(labels).toContain("Alergarea dublă · 02.11.2099 · 10:00");
    expect(labels).toContain("Alergarea dublă · 02.11.2099 · 14:00");
    expect(labels).toContain("Eveniment fără titlu · 03.11.2099");
    expect(labels.some((label) => label?.includes(untitled.id))).toBe(false);
  });

  it("is never in the CSV, whose file stays the rows", async () => {
    const race = await seedRace();
    const csv = await (await exportRegistrations(new Request(url(`eventId=${race.id}`)))).text();
    expect(csv).not.toMatch(/Statistici|Statistics|Categorie|Activi sunt/);
    expect(csv).not.toContain(`Alții, nu ${CLUB_NAME}`);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(1 + 10);
  });

  it.each<StaffRole>(["MODERATOR", "ADMIN", "SUPERADMIN"])("%s may read the export and gets the footer", async (role) => {
    const race = await seedRace();
    state.actor = await staff(role, `lector-${role.toLowerCase()}@dev.test`);
    expect(footerOf(await download(`eventId=${race.id}&format=xlsx`))[1]).toEqual(["Total", "10"]);
  });

  it.each<StaffRole>(["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"])("%s gets no file at all, so no footer", async (role) => {
    const race = await seedRace();
    state.actor = await staff(role, `fara-${role.toLowerCase()}@dev.test`);
    const response = await exportRegistrations(new Request(url(`eventId=${race.id}&format=xlsx`)));
    expect(response.status).toBe(403);
  });
});
