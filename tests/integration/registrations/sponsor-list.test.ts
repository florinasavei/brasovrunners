import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesPromotionalMaterialsShared } from "@/modules/legal-documents/repository";
import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { listPartnerShares } from "@/modules/audit/repository";
import { buildSponsorListCsv, promoListed, readSponsorShareGate, sponsorList, sponsorListSummary } from "@/modules/registrations/sponsor-list";
import { SPONSOR_SHEET_COLUMNS, sponsorSheetHeaders } from "@/modules/registrations/sponsor-sheet";
import { countRegistrationsForAdmin, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { readSheet } from "../../helpers/xlsx";
import { sharedWithSponsors } from "@/modules/registrations/domain/sponsor-share";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §570 — «Descarcă lista pentru sponsori»: the owner, 2026-09-29, "I need to be able to export the
 * participants list but filter out just the ones who agreed to receive marketing emails so we can
 * share it with our sponsors", on real PostgreSQL.
 *
 * What is protected:
 * - only a yes on a real, proved, standing registration is listed — never a no, a cancelled, an
 *   expired, an unproved address or a test registration;
 * - only a yes given under a notice that says the partners may receive it
 *   (`{{promotionalMaterialsShared}}`): a yes given under §562's «partenerii nu primesc adresa ta»
 *   never reaches a sponsor, even once a sharing notice is in force;
 * - never a minor on the day of the download, and never a registration without a birth date;
 * - the file is offered only while the notice in force says so — the route refuses otherwise;
 * - every download records the registrations it held and whom it was given to, and a
 *   registration's page reads that back (the notice's art. 15 and 19 promise);
 * - one query and one file for one event and for every event;
 * - the Organizer, the Administrator and the Superadministrator take it; Tehnic and the others are
 *   refused, on the server; every download leaves one audit row with the event and the count.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (arg: string | { locale: string; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? "ro" : arg.locale;
    const catalogue = (locale === "en" ? en : ro) as Record<string, object>;
    return createTranslator({ locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

const { GET: downloadSponsorList } = await import("@/app/api/admin/registrations/sponsor-list/route");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

const NOW = new Date("2026-09-29T10:00:00.000Z");
/** §562's notice: the box, and «partenerii nu primesc adresa ta». */
const V1_AT = new Date("2026-01-01T00:00:00.000Z");
/** The new template's notice: the box and the sharing. */
const V2_AT = new Date("2026-06-01T00:00:00.000Z");
const UNDER_V1 = new Date("2026-03-01T10:00:00.000Z");
const UNDER_V2 = new Date("2026-07-01T10:00:00.000Z");

const boxOnly = { sections: [{ paragraphs: ["Oferte și beneficii: doar dacă bifezi {{promotionalMaterials}}. Partenerii nu primesc adresa ta."] }] };
const sharing = {
  sections: [{ paragraphs: ["Oferte și beneficii: doar dacă bifezi {{promotionalMaterials}}.", "Lista pentru parteneri: le putem da {{promotionalMaterialsShared}}."] }],
};

let db: TestDatabase;
let close: () => Promise<void>;

async function approveNotice(version: number, body: object, effectiveAt: Date) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Notă", body: body as LegalDocumentTranslationInput["body"] },
    { locale: "en", title: "Notice", body: body as LegalDocumentTranslationInput["body"] },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

async function createEvent(slug: string, title: string) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title, slug },
    { eventId: event.id, locale: "en", title: `${title} (en)`, slug: `${slug}-en` },
  ]);
  return event;
}

let seq = 0;
async function seedRow(
  eventId: string,
  firstName: string,
  options: {
    status?: Registration["status"];
    kind?: Registration["kind"];
    promoConsent?: boolean;
    version?: number;
    at?: Date | null;
    birthDate?: string | null;
    listOptOut?: boolean;
    listSocials?: boolean;
    termsVersion?: number | null;
  } = {},
) {
  seq += 1;
  const email = `${firstName.toLowerCase()}${seq}@example.ro`;
  const identity = canonicalizeEmail(email);
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: identity.deliveryEmail, normalizedEmail: identity.normalizedEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion, defaultName: firstName })
    .returning();
  const promoConsent = options.promoConsent ?? true;
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status: options.status ?? "CONFIRMED",
      kind: options.kind ?? "REAL",
      locale: "ro",
      registeredName: `${firstName} Pop`,
      firstName,
      lastName: "Pop",
      displayName: firstName,
      birthDate: options.birthDate === undefined ? "1985-03-02" : options.birthDate,
      phone: "+40711111111",
      privacyNoticeVersion: options.version ?? 2,
      privacyAcknowledgedAt: options.at ?? UNDER_V2,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: options.listOptOut ?? true,
      listSocials: options.listSocials ?? false,
      termsVersion: options.termsVersion ?? null,
      termsAcceptedAt: options.termsVersion ? UNDER_V2 : null,
      promoConsent,
      promoConsentAt: options.at === undefined ? (promoConsent ? UNDER_V2 : null) : options.at,
    })
    .returning();
  return row;
}

async function staff(role: StaffUser["role"]): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${seq++}@dev.test`, displayName: role, role }).returning();
  return row;
}

async function refusal(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
    return undefined;
  } catch (caught) {
    if (isDomainError(caught)) return caught.code;
    throw caught;
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.cookie = undefined;
});

describe("§570 who is on the sponsor list", () => {
  it("lists a yes on a real, proved, standing registration given under a sharing notice — and nothing else", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    await approveNotice(2, sharing, V2_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");
    await seedRow(event.id, "Bogdan", { status: "PENDING_DECLARATION" });
    await seedRow(event.id, "Carmen", { status: "WAITLISTED" });
    await seedRow(event.id, "Dan", { status: "CANCELLED" });
    await seedRow(event.id, "Elena", { status: "EXPIRED" });
    await seedRow(event.id, "Florin", { status: "PENDING_EMAIL_CONFIRMATION" });
    await seedRow(event.id, "Gelu", { kind: "TEST" });
    await seedRow(event.id, "Horia", { promoConsent: false });
    // Under §562's notice, which promised the partners would receive nothing.
    await seedRow(event.id, "Ioana", { version: 1, at: UNDER_V1 });
    // Registered under the old notice, said yes later under the new one: one of the two texts said «nothing», so not listed.
    await seedRow(event.id, "Jean", { version: 1, at: UNDER_V2 });
    // A yes with no moment is no evidence of when, under which text.
    await seedRow(event.id, "Kira", { at: null });

    const organizer = await staff("MODERATOR");
    const list = await sponsorList(db, organizer, { eventId: event.id, locale: "ro", now: NOW });
    expect(list.offered).toBe(true);
    expect(list.rows.map((row) => row.firstName).sort()).toEqual(["Ana", "Bogdan", "Carmen"]);
    expect(list.rows[0]).toMatchObject({ lastName: "Pop", eventTitle: "Crosul toamnei", email: expect.stringContaining("@example.ro") });
    // The minimum a sponsor needs, and nothing a sponsor must not get.
    const csv = buildSponsorListCsv({ firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" }, list.rows);
    expect(csv).not.toContain("1985-03-02");
    expect(csv).not.toContain("+40711111111");
  });

  it("never lists a minor on the day of the download, nor a registration without a birth date; the count says the same", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");
    // Seventeen on the day of the download: the guardian's yes stays the club's, never a partner's.
    await seedRow(event.id, "Bogdan", { birthDate: "2009-09-30" });
    // Eighteen that very day: an adult now.
    await seedRow(event.id, "Carmen", { birthDate: "2008-09-29" });
    // No birth date (a registration the desk entered): left out, the safe side.
    await seedRow(event.id, "Dan", { birthDate: null });
    const admin = await staff("ADMIN");
    const list = await sponsorList(db, admin, { eventId: event.id, locale: "ro", now: NOW });
    expect(list.rows.map((row) => row.firstName).sort()).toEqual(["Ana", "Carmen"]);
    expect(await sponsorListSummary(db, admin, { eventId: event.id, now: NOW })).toEqual({ offered: true, count: 2 });
    expect(await sponsorListSummary(db, admin, { now: NOW })).toEqual({ offered: true, count: 2 });
    // A day earlier Carmen was seventeen.
    const dayBefore = new Date("2026-09-28T10:00:00.000Z");
    expect((await sponsorList(db, admin, { eventId: event.id, locale: "ro", now: dayBefore })).rows.map((row) => row.firstName)).toEqual(["Ana"]);
  });

  it("the row gate asks both notices: the one the registration recorded and the one in force at the yes", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    await approveNotice(2, sharing, V2_AT);
    const gate = await readSponsorShareGate(db);
    expect(sharedWithSponsors({ promoConsent: true, promoConsentAt: UNDER_V2, privacyNoticeVersion: 2 }, gate)).toBe(true);
    expect(sharedWithSponsors({ promoConsent: true, promoConsentAt: UNDER_V1, privacyNoticeVersion: 1 }, gate)).toBe(false);
    expect(sharedWithSponsors({ promoConsent: true, promoConsentAt: UNDER_V2, privacyNoticeVersion: 1 }, gate)).toBe(false);
    expect(sharedWithSponsors({ promoConsent: false, promoConsentAt: UNDER_V2, privacyNoticeVersion: 2 }, gate)).toBe(false);
  });

  it("is not offered, and holds nothing, while no notice describes the sharing", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana", { version: 1, at: UNDER_V2 });
    expect(await noticeDescribesPromotionalMaterialsShared(db, NOW)).toBe(false);
    const admin = await staff("ADMIN");
    const list = await sponsorList(db, admin, { eventId: event.id, locale: "ro", now: NOW });
    expect(list).toEqual({ offered: false, rows: [] });
    expect(await sponsorListSummary(db, admin, { eventId: event.id, now: NOW })).toEqual({ offered: false, count: 0 });
  });

  it("one query for one event and for every event: the same rows, the same shape", async () => {
    await approveNotice(2, sharing, V1_AT);
    const autumn = await createEvent("crosul-toamnei", "Crosul toamnei");
    const winter = await createEvent("crosul-iernii", "Crosul iernii");
    await seedRow(autumn.id, "Ana");
    await seedRow(winter.id, "Bogdan");
    const admin = await staff("ADMIN");
    const one = await sponsorList(db, admin, { eventId: autumn.id, locale: "ro", now: NOW });
    const other = await sponsorList(db, admin, { eventId: winter.id, locale: "ro", now: NOW });
    const all = await sponsorList(db, admin, { locale: "ro", now: NOW });
    expect(one.rows.map((row) => row.firstName)).toEqual(["Ana"]);
    expect(all.rows.map((row) => row.registrationId).sort()).toEqual([...one.rows, ...other.rows].map((row) => row.registrationId).sort());
    expect(Object.keys(all.rows[0]).sort()).toEqual(Object.keys(one.rows[0]).sort());
    const header = { firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" };
    expect(buildSponsorListCsv(header, one.rows).split("\r\n")[0]).toBe(buildSponsorListCsv(header, all.rows).split("\r\n")[0]);
  });

  it.each([["DEV"], ["CONTRIBUTOR"], ["COPYWRITER"], ["MEMBER"]] as const)("refuses the %s role in the read", async (role) => {
    await approveNotice(2, sharing, V1_AT);
    expect(await refusal(sponsorList(db, await staff(role), { locale: "ro", now: NOW }))).toBe("FORBIDDEN");
    expect(await refusal(sponsorListSummary(db, await staff(role), { now: NOW }))).toBe("FORBIDDEN");
  });
});

describe("§570 the route: the role on the server, the notice, the file and its audit row", () => {
  it("serves the Organizer, the Administrator and the Superadministrator; refuses Tehnic, a volunteer and a signed-out request", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");

    state.cookie = undefined;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"))).status).toBe(401);
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER"] as const) {
      state.cookie = (await staff(role)).id;
      expect((await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}`))).status, role).toBe(403);
    }
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.cookie = (await staff(role)).id;
      expect((await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}`))).status, role).toBe(200);
    }
    // Only the three that were served leave a row.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"))).toHaveLength(3);
  });

  it("writes the five columns with a BOM, names the file by the event or «toate», and records the event, the count and the registrations — never a name or an address", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    const ana = await seedRow(event.id, "Ana");
    await seedRow(event.id, "Bogdan", { promoConsent: false });
    const organizer = await staff("MODERATOR");
    state.cookie = organizer.id;

    const response = await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}&lang=ro`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="sponsori-crosul-toamnei-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(body.startsWith(CSV_BOM)).toBe(true);
    const lines = body.slice(CSV_BOM.length).split("\r\n");
    expect(lines[0]).toBe("Prenume,Nume,Email,Eveniment,Data acordului");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Ana,Pop,ana\d+@example\.ro,Crosul toamnei,2026-07-01T10:00:00\.000Z$/);

    const every = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?lang=en"));
    expect(every.headers.get("Content-Disposition")).toMatch(/filename="sponsori-toate-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(new TextDecoder().decode(await every.arrayBuffer()).split("\r\n")[0]).toContain("First name,Last name,Email,Event,Consent date");

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"));
    expect(rows.map((row) => row.metadataJson)).toEqual([
      { eventId: event.id, format: "csv", count: 1, recipient: null, registrationIds: [ana.id] },
      { eventId: null, format: "csv", count: 1, recipient: null, registrationIds: [ana.id] },
    ]);
    expect(rows.every((row) => row.actorStaffUserId === organizer.id)).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.metadataJson))).not.toContain("@");
  });

  it("keeps whom the file was given to, and a registration's page reads back which partners received it", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    const ana = await seedRow(event.id, "Ana");
    const bogdan = await seedRow(event.id, "Bogdan", { promoConsent: false });
    const organizer = await staff("MODERATOR");
    state.cookie = organizer.id;
    const url = (to: string) => `http://localhost/api/admin/registrations/sponsor-list?event=${event.id}&to=${encodeURIComponent(to)}`;
    expect((await downloadSponsorList(new Request(url(`  Sport Shop${String.fromCharCode(7)} SRL  `)))).status).toBe(200);
    expect((await downloadSponsorList(new Request(url("x".repeat(300))))).status).toBe(200);
    expect((await downloadSponsorList(new Request(url("   ")))).status).toBe(200);

    const shares = await listPartnerShares(db, ana.id);
    expect(shares.map((share) => share.recipient).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["Sport Shop SRL", "x".repeat(120), null].sort((a, b) => String(a).localeCompare(String(b))));
    expect(shares.every((share) => share.actorName === "MODERATOR")).toBe(true);
    // A registration that was in no file has no history.
    expect(await listPartnerShares(db, bogdan.id)).toEqual([]);
  });

  it("refuses the file while the notice in force does not say the list may be given to partners", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    const response = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"));
    expect(response.status).toBe(409);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"))).toHaveLength(0);
  });

  it("refuses an event id that is not one", async () => {
    await approveNotice(2, sharing, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?event=1;drop"))).status).toBe(400);
  });
});

/**
 * §581 (amending §570) — the owner, 2026-09-30: «cum pot exporta participanții, doar cei care au
 * bifat că vor datele publicate pentru parteneri? trebuie să am Excel cu toate bifele lor».
 */
describe("§581 the sponsor list as Excel, every tick in its column", () => {
  async function signDeclaration(registrationId: string, version: number) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } as LegalDocumentTranslationInput["body"] },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } as LegalDocumentTranslationInput["body"] },
    ];
    const contentSha256 = computeContentHash(translations);
    const legalDocumentId = await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version, effectiveAt: V1_AT, isApproved: true, contentSha256, translations, now: NOW });
    await db.insert(declarationAcceptances).values({ registrationId, legalDocumentId, declarationVersion: version, contentSha256, locale: "ro", typedName: "Ana Pop", acceptedAt: UNDER_V2 });
  }

  const excel = (eventId: string, lang = "ro") => new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${eventId}&lang=${lang}&format=xlsx`);
  const csv = (eventId: string) => new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${eventId}&lang=ro&format=csv`);

  it("lists the same rows as the CSV — never an older notice's yes, never a minor — with each consent's value per row, and the audit names the format", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    await approveNotice(2, sharing, V2_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    // Ticked the list and the socials, accepted the terms v3, signed the declaration v5.
    const ana = await seedRow(event.id, "Ana", { listOptOut: false, listSocials: true, termsVersion: 3 });
    // On the waiting list, the list left unticked, nothing signed.
    const bogdan = await seedRow(event.id, "Bogdan", { status: "WAITLISTED" });
    // A yes under §562's notice («partenerii nu primesc adresa ta»): in neither file.
    await seedRow(event.id, "Ioana", { version: 1, at: UNDER_V1, listOptOut: false });
    // Sixteen: the guardian's yes is the club's, never a partner's.
    await seedRow(event.id, "Mara", { birthDate: "2010-05-05", listOptOut: false });
    // Said no: in neither file.
    await seedRow(event.id, "Horia", { promoConsent: false, listOptOut: false });
    await signDeclaration(ana.id, 5);
    state.cookie = (await staff("MODERATOR")).id;

    const response = await downloadSponsorList(excel(event.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="sponsori-crosul-toamnei-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const { rows, sheetName } = readSheet(Buffer.from(await response.arrayBuffer()));
    expect(sheetName).toBe("Sponsori");
    const sheet = ro.Admin.sponsors.sheet;
    expect(rows[0]).toEqual(sponsorSheetHeaders({ sheet: sheet.name, yes: sheet.yes, no: sheet.no, columns: sheet.columns, states: sheet.states }));
    const col = (key: (typeof SPONSOR_SHEET_COLUMNS)[number]) => SPONSOR_SHEET_COLUMNS.indexOf(key);
    const byName = new Map(rows.slice(1).map((row) => [row[col("firstName")], row]));
    expect([...byName.keys()].sort()).toEqual(["Ana", "Bogdan"]);

    const csvResponse = await downloadSponsorList(csv(event.id));
    const csvLines = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await csvResponse.arrayBuffer()).slice(CSV_BOM.length).split("\r\n");
    expect(csvLines.slice(1).map((line) => line.split(",")[0]).sort()).toEqual([...byName.keys()].sort());

    const anaRow = byName.get("Ana")!;
    expect(anaRow[col("email")]).toMatch(/^ana\d+@example\.ro$/);
    expect(anaRow[col("event")]).toBe("Crosul toamnei");
    expect(anaRow[col("promoConsentedAt")]).toBeDefined();
    expect(anaRow[col("promoNotice")]).toBe("2");
    expect(anaRow[col("listPublic")]).toBe("Da");
    expect(anaRow[col("listSocials")]).toBe("Da");
    expect(anaRow[col("termsVersion")]).toBe("3");
    expect(anaRow[col("termsAcceptedAt")]).toBeDefined();
    expect(anaRow[col("declarationVersion")]).toBe("5");
    expect(anaRow[col("declarationSignedAt")]).toBeDefined();
    expect(anaRow[col("status")]).toBe("Confirmată");
    const bogdanRow = byName.get("Bogdan")!;
    expect(bogdanRow[col("listPublic")]).toBe("Nu");
    expect(bogdanRow[col("listSocials")]).toBe("Nu");
    expect(bogdanRow[col("termsVersion")]).toBeUndefined();
    expect(bogdanRow[col("declarationVersion")]).toBeUndefined();
    expect(bogdanRow[col("status")]).toBe("Pe lista de așteptare");
    // Never the birth date or the phone.
    expect(JSON.stringify(rows)).not.toMatch(/1985-03-02|\+40711111111/);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"));
    const metadata = audits.map((row) => row.metadataJson as { format: string; count: number; registrationIds: string[] });
    expect(metadata.map((entry) => entry.format).sort()).toEqual(["csv", "xlsx"]);
    for (const entry of metadata) {
      expect(entry.count).toBe(2);
      expect([...entry.registrationIds].sort()).toEqual([ana.id, bogdan.id].sort());
    }
    // The registration's page reads both downloads back as «Dată partenerilor».
    expect(await listPartnerShares(db, ana.id)).toHaveLength(2);
  });

  it("reads in English for an English reader", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana", { listOptOut: false });
    state.cookie = (await staff("ADMIN")).id;
    const { rows, sheetName } = readSheet(Buffer.from(await (await downloadSponsorList(excel(event.id, "en"))).arrayBuffer()));
    expect(sheetName).toBe("Sponsors");
    expect(rows[0][SPONSOR_SHEET_COLUMNS.indexOf("listPublic")]).toBe("Public list & results");
    expect(rows[1][SPONSOR_SHEET_COLUMNS.indexOf("listPublic")]).toBe("Yes");
    expect(rows[1][SPONSOR_SHEET_COLUMNS.indexOf("event")]).toBe("Crosul toamnei (en)");
  });

  it("serves the Organizer and the Administrator, refuses Tehnic and the others on the server, and refuses the file without a sharing notice", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER"] as const) {
      state.cookie = (await staff(role)).id;
      expect((await downloadSponsorList(excel(event.id))).status, role).toBe(403);
    }
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.cookie = (await staff(role)).id;
      expect((await downloadSponsorList(excel(event.id))).status, role).toBe(200);
    }
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"))).toHaveLength(3);

    await resetTables(db);
    await approveNotice(1, boxOnly, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?format=xlsx"))).status).toBe(409);
  });
});

describe("§581 «Doar cu oferte și beneficii» on the registrations list, and the export that follows it", () => {
  it("narrows the list to who said yes on a real, standing registration — the one condition of §570 — and the export holds the same rows", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    await approveNotice(2, sharing, V2_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    const ana = await seedRow(event.id, "Ana", { listOptOut: false });
    const bogdan = await seedRow(event.id, "Bogdan", { status: "WAITLISTED" });
    // A yes under the older notice: consented to the club, so on screen — only the sponsor file leaves it out.
    const ioana = await seedRow(event.id, "Ioana", { version: 1, at: UNDER_V1 });
    await seedRow(event.id, "Horia", { promoConsent: false });
    await seedRow(event.id, "Dan", { status: "CANCELLED" });
    await seedRow(event.id, "Gelu", { kind: "TEST" });

    const filtered = await listRegistrationsForAdmin(db, { eventId: event.id, promoConsented: true });
    expect(filtered.map((row) => row.id).sort()).toEqual([ana.id, bogdan.id, ioana.id].sort());
    expect(await countRegistrationsForAdmin(db, { eventId: event.id, promoConsented: true })).toBe(3);
    // The same rows as the club's list on «Newsletter» (§562, `promoListed`).
    const clubList = await sponsorListCandidates(event.id);
    expect(clubList.sort()).toEqual(filtered.map((row) => row.id).sort());
    // Unfiltered, the list holds everyone.
    expect((await listRegistrationsForAdmin(db, { eventId: event.id })).length).toBe(6);

    state.cookie = (await staff("MODERATOR")).id;
    const exported = async (query: string) => {
      const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${event.id}${query}`));
      expect(response.status).toBe(200);
      return (await response.text()).split("\r\n");
    };
    const [header, ...lines] = await exported("&promo=1");
    expect(lines.map((line) => line.split(",")[2]).sort()).toEqual(["Ana", "Bogdan", "Ioana"]);
    // The public-list tick in its own column beside the socials (§581).
    const at = header.split(",").indexOf("Public list & results");
    expect(header.split(",")[at - 1]).toBe("Socials on the public list");
    expect(lines.find((line) => line.startsWith("Crosul toamnei,Ana "))?.split(",")[at]).toBe("Yes");
    expect(lines.find((line) => line.startsWith("Crosul toamnei,Bogdan "))?.split(",")[at]).toBe("");
    // Without the filter, every real row (the test row is never exported, §30).
    expect((await exported("")).length - 1).toBe(5);
    // The Excel export follows the filter too.
    const workbook = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?format=xlsx&eventId=${event.id}&promo=1`));
    expect(readSheet(Buffer.from(await workbook.arrayBuffer())).rows).toHaveLength(4);
  });
});

async function sponsorListCandidates(eventId: string): Promise<string[]> {
  const rows = await db.select({ id: registrations.id }).from(registrations).where(promoListed(eventId));
  return rows.map((row) => row.id);
}
