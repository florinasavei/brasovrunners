import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToReadableStream } from "react-dom/server";
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
import { readSponsorRegister, SPONSOR_RECIPIENT_SUGGESTIONS, SPONSOR_REGISTER_LIMIT } from "@/modules/registrations/sponsor-register";
import { SPONSOR_SHEET_COLUMNS, sponsorSheetHeaders } from "@/modules/registrations/sponsor-sheet";
import { countRegistrationsForAdmin, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { readSheet, startListRows } from "../../helpers/xlsx";
import { sharedWithSponsors } from "@/modules/registrations/domain/sponsor-share";
import { isDomainError } from "@/shared/errors/domain-error";
import { atTheClock } from "../../helpers/clock";
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
 * - since §NNN a download names its recipient or is refused, and the lists given are read back as
 *   «Liste date sponsorilor» — the list, never its people;
 * - one query and one file for one event and for every event;
 * - the Organizer, the Administrator and the Superadministrator take it; Tehnic and the others are
 *   refused, on the server; every download leaves one audit row with the event and the count.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined, locale: "ro" as "ro" | "en" }));

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
    // A namespace asked by name is answered in the language of the request: the test's own, Romanian unless it says otherwise.
    const locale = typeof arg === "string" ? state.locale : arg.locale;
    const catalogue = (locale === "en" ? en : ro) as Record<string, object>;
    return createTranslator({ locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));

const { GET: downloadSponsorListNow } = await import("@/app/api/admin/registrations/sponsor-list/route");
/**
 * The route asks the real clock who is an adult today: it is called at NOW, so the sixteen-year-old
 * of the fixture stays a minor whatever day this runs (§712).
 */
const downloadSponsorList = (...args: Parameters<typeof downloadSponsorListNow>) => atTheClock(NOW, () => downloadSponsorListNow(...args));
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");
const { default: SponsorListButton } = await import("@/modules/registrations/ui/SponsorListButton");
const { default: SponsorListRegister } = await import("@/modules/registrations/ui/SponsorListRegister");

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
  state.locale = "ro";
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
    await seedRow(event.id, "Felix", { status: "PENDING_EMAIL_CONFIRMATION" });
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
      expect((await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}&to=Sport+Shop`))).status, role).toBe(200);
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

    const response = await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}&lang=ro&to=Sport+Shop`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="sponsori-crosul-toamnei-\d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''/);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(body.startsWith(CSV_BOM)).toBe(true);
    const lines = body.slice(CSV_BOM.length).split("\r\n");
    expect(lines[0]).toBe("Prenume,Nume,Email,Eveniment,Data acordului");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Ana,Pop,ana\d+@example\.ro,Crosul toamnei,2026-07-01T10:00:00\.000Z$/);

    const every = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?lang=en&to=Decathlon"));
    expect(every.headers.get("Content-Disposition")).toMatch(/filename="sponsori-toate-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(new TextDecoder().decode(await every.arrayBuffer()).split("\r\n")[0]).toContain("First name,Last name,Email,Event,Consent date");

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"));
    expect(rows.map((row) => row.metadataJson)).toEqual([
      { eventId: event.id, format: "csv", count: 1, recipient: "Sport Shop", registrationIds: [ana.id] },
      { eventId: null, format: "csv", count: 1, recipient: "Decathlon", registrationIds: [ana.id] },
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

    const shares = await listPartnerShares(db, ana.id);
    expect(shares.map((share) => share.recipient).sort()).toEqual(["Sport Shop SRL", "x".repeat(120)].sort());
    expect(shares.every((share) => share.actorName === "MODERATOR")).toBe(true);
    // A registration that was in no file has no history.
    expect(await listPartnerShares(db, bogdan.id)).toEqual([]);
  });

  it("refuses the file while the notice in force does not say the list may be given to partners", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    const response = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?to=Sport+Shop"));
    expect(response.status).toBe(409);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"))).toHaveLength(0);
  });

  it("refuses an event id that is not one", async () => {
    await approveNotice(2, sharing, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    const response = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?event=1;drop&to=Sport+Shop"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "VALIDATION_ERROR" });
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

  const excel = (eventId: string, lang = "ro") => new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${eventId}&lang=${lang}&format=xlsx&to=Sport+Shop`);
  const csv = (eventId: string) => new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${eventId}&lang=ro&format=csv&to=Sport+Shop`);

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
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="sponsori-crosul-toamnei-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
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
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?format=xlsx&to=Sport+Shop"))).status).toBe(409);
  });

  it("an event whose slug and title carry diacritics still downloads: 200, a header Headers accepts (§779)", async () => {
    await approveNotice(1, boxOnly, V1_AT);
    await approveNotice(2, sharing, V2_AT);
    const event = await createEvent("crosul-brașov-ediția-2026", "CROSUL BRAȘOV – EDIȚIA A II-A");
    await seedRow(event.id, "Ștefan", { listOptOut: false });
    state.cookie = (await staff("ADMIN")).id;
    for (const request of [excel(event.id), csv(event.id)]) {
      const response = await downloadSponsorList(request);
      expect(response.status).toBe(200);
      const header = response.headers.get("Content-Disposition")!;
      expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
      expect(header).toMatch(/^attachment; filename="sponsori-crosul-bra-ov-edi-ia-2026-\d{4}-\d{2}-\d{2}\.(xlsx|csv)"; filename\*=UTF-8''/);
    }
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
    // The start list alone: the statistics footer under it (§787) is `statistics-footer.test.ts`'s to read.
    expect(startListRows(readSheet(Buffer.from(await workbook.arrayBuffer())).rows)).toHaveLength(4);
  });
});

async function sponsorListCandidates(eventId: string): Promise<string[]> {
  const rows = await db.select({ id: registrations.id }).from(registrations).where(promoListed(eventId));
  return rows.map((row) => row.id);
}

/**
 * §NNN (amending §570 and §581) — the owner, 2026-11-10, of «Descarcă lista pentru sponsori»: «trebuie să
 * gestionez mai bine asta, cu trimiterea către sponsori»; asked what he wants to be able to do, he chose the
 * register of the lists given, with «Cui dai lista» required and its earlier names suggested.
 */
describe("BR-REQ-071-01 §NNN «Cui dai lista» is required", () => {
  it("refuses a download that names nobody — either file, spaces alone too — and writes nothing", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");
    state.cookie = (await staff("ADMIN")).id;
    const base = `http://localhost/api/admin/registrations/sponsor-list?event=${event.id}`;
    for (const query of ["", "&format=xlsx", "&format=csv", "&to=", "&to=%20%20%20", `&format=xlsx&to=${encodeURIComponent(String.fromCharCode(7))}`]) {
      const response = await downloadSponsorList(new Request(`${base}${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toEqual({ error: "RECIPIENT_REQUIRED" });
      expect(response.headers.get("Content-Disposition"), query).toBeNull();
    }
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"))).toHaveLength(0);
    // Named, the same request is served, in either file.
    expect((await downloadSponsorList(new Request(`${base}&to=Sport+Shop`))).status).toBe(200);
    expect((await downloadSponsorList(new Request(`${base}&format=xlsx&to=club`))).status).toBe(200);
  });

  it("BR-REQ-060-01 asks who is asking first: a signed-out request and a role that may not take the list are refused as before", async () => {
    await approveNotice(2, sharing, V1_AT);
    state.cookie = undefined;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"))).status).toBe(401);
    state.cookie = (await staff("DEV")).id;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"))).status).toBe(403);
  });

  it("checks the event id first: a nameless download of an event id that is not one is VALIDATION_ERROR", async () => {
    await approveNotice(2, sharing, V1_AT);
    state.cookie = (await staff("ADMIN")).id;
    const response = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?event=1;drop"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "VALIDATION_ERROR" });
  });

  it("is refused before anything is read: RECIPIENT_REQUIRED even while no notice describes the sharing, and the database hears only who is asking", async () => {
    // In force, and it does not describe the sharing: a named download is 409.
    await approveNotice(1, boxOnly, V1_AT);
    const admin = await staff("ADMIN");
    const tehnic = await staff("DEV");
    state.cookie = admin.id;
    expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?to=Sport+Shop"))).status).toBe(409);
    const nameless = await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"));
    expect(nameless.status).toBe(400);
    expect(await nameless.json()).toEqual({ error: "RECIPIENT_REQUIRED" });

    // Nothing read: the database hears from a nameless request exactly what it hears from a refused role's — the sign-in.
    const asked: string[] = [];
    state.db = new Proxy(db as object, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        if (typeof value !== "function") return value;
        if (typeof key === "string") asked.push(key);
        return (value as (...args: unknown[]) => unknown).bind(target);
      },
    });
    try {
      state.cookie = tehnic.id;
      expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list"))).status).toBe(403);
      const signIn = [...asked];
      expect(signIn.length).toBeGreaterThan(0);
      asked.length = 0;
      state.cookie = admin.id;
      expect((await downloadSponsorList(new Request("http://localhost/api/admin/registrations/sponsor-list?format=xlsx&to=%20"))).status).toBe(400);
      expect(asked).toEqual(signIn);
    } finally {
      state.db = db;
    }
  });

  it("serves a name cut at its limit through an emoji: the file leaves and the audit row keeps the name without the half", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await seedRow(event.id, "Ana");
    state.cookie = (await staff("ADMIN")).id;
    const name = `${"x".repeat(119)}😀`;
    const response = await downloadSponsorList(new Request(`http://localhost/api/admin/registrations/sponsor-list?event=${event.id}&to=${encodeURIComponent(name)}`));
    expect(response.status).toBe(200);
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.sponsor_list_exported"));
    expect((row.metadataJson as { recipient: string }).recipient).toBe("x".repeat(119));
  });
});

describe("BR-REQ-071-01 §NNN «Liste date sponsorilor»: the lists given, read back from the trail", () => {
  /** A download at its own moment, as the route records it. */
  const download = (when: string, query: string) =>
    atTheClock(new Date(when), () => downloadSponsorListNow(new Request(`http://localhost/api/admin/registrations/sponsor-list?${query}`)));

  /** Two events, three people, four lists: two for the autumn race, one for every event, one for the winter race. */
  async function fourLists() {
    await approveNotice(2, sharing, V1_AT);
    const autumn = await createEvent("crosul-toamnei", "Crosul toamnei");
    const winter = await createEvent("crosul-iernii", "Crosul iernii");
    const people = [await seedRow(autumn.id, "Ana"), await seedRow(autumn.id, "Bogdan"), await seedRow(winter.id, "Carmen")];
    const organizer = await staff("MODERATOR");
    const admin = await staff("ADMIN");
    state.cookie = organizer.id;
    expect((await download("2026-09-10T09:00:00.000Z", `event=${autumn.id}&format=csv&to=Sport+Shop+SRL`)).status).toBe(200);
    expect((await download("2026-09-12T09:00:00.000Z", `event=${autumn.id}&format=xlsx&to=club`)).status).toBe(200);
    state.cookie = admin.id;
    expect((await download("2026-09-20T09:00:00.000Z", "to=Decathlon")).status).toBe(200);
    expect((await download("2026-09-25T09:00:00.000Z", `event=${winter.id}&to=sport+shop+srl`)).status).toBe(200);
    return { autumn, winter, people, organizer, admin };
  }

  /** The block as the server sends it, Emotion's styles and React's separators out of the way. */
  async function draw(props: Parameters<typeof SponsorListButton>[0]): Promise<string> {
    const stream = await renderToReadableStream(await SponsorListButton(props), { onError: () => {} });
    await stream.allReady;
    return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
  }
  const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  it("reads each list — whom, when, the event, how many, which file, who, the day the club's copy goes — newest first; an event's door holds its own lists and every event's", async () => {
    const { autumn, winter, people, organizer, admin } = await fourLists();

    const autumnDoor = await readSponsorRegister(db, organizer, { eventId: autumn.id, locale: "ro" });
    expect(autumnDoor.lists.map(({ id, ...list }) => ({ ...list, id: typeof id }))).toEqual([
      // Made for every event: it held this race's people too.
      { id: "string", at: new Date("2026-09-20T09:00:00.000Z"), eventId: null, eventTitle: null, recipient: "Decathlon", count: 3, format: "csv", actorName: "ADMIN", deleteBy: new Date("2026-10-20T09:00:00.000Z") },
      { id: "string", at: new Date("2026-09-12T09:00:00.000Z"), eventId: autumn.id, eventTitle: "Crosul toamnei", recipient: "club", count: 2, format: "xlsx", actorName: "MODERATOR", deleteBy: new Date("2026-10-12T09:00:00.000Z") },
      { id: "string", at: new Date("2026-09-10T09:00:00.000Z"), eventId: autumn.id, eventTitle: "Crosul toamnei", recipient: "Sport Shop SRL", count: 2, format: "csv", actorName: "MODERATOR", deleteBy: new Date("2026-10-10T09:00:00.000Z") },
    ]);
    // The other race's door: its own list and the one made for every event — never the autumn race's.
    const winterDoor = await readSponsorRegister(db, admin, { eventId: winter.id, locale: "ro" });
    expect(winterDoor.lists.map((list) => [list.recipient, list.eventTitle, list.count])).toEqual([
      ["sport shop srl", "Crosul iernii", 1],
      ["Decathlon", null, 3],
    ]);
    // «Newsletter»: every list, the event named in the reader's language.
    const every = await readSponsorRegister(db, admin, { locale: "en" });
    expect(every.lists.map((list) => [list.recipient, list.eventTitle])).toEqual([
      ["sport shop srl", "Crosul iernii (en)"],
      ["Decathlon", null],
      ["club", "Crosul toamnei (en)"],
      ["Sport Shop SRL", "Crosul toamnei (en)"],
    ]);
    // The suggestions: every door offers every recipient written before, each once whatever its capitals, newest first.
    for (const door of [autumnDoor, winterDoor, every]) expect(door.recipients).toEqual(["sport shop srl", "Decathlon", "club"]);
    // The list, never its people: no registration's id, name or address reaches the register.
    const read = JSON.stringify([autumnDoor, winterDoor, every]);
    for (const person of people) expect(read).not.toContain(person.id);
    expect(read).not.toMatch(/@example\.ro|Ana|Bogdan|Carmen/);
    expect(Object.keys(every.lists[0]).sort()).toEqual(["actorName", "at", "count", "deleteBy", "eventId", "eventTitle", "format", "id", "recipient"]);
  });

  it("reads a download older than the rule as it was made: no recipient, the CSV, and an account or an event that is gone", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    const gone = randomUUID();
    await db.insert(auditLogs).values([
      // Before §581 the row named no file; before §NNN it could name nobody. Its account was removed since.
      { action: "registrations.sponsor_list_exported", entityType: "event", entityId: event.id, metadataJson: { eventId: event.id, count: 7, recipient: null, registrationIds: [randomUUID()] }, createdAt: new Date("2026-08-01T08:00:00.000Z") },
      // Its event was erased since: the list stays, without a title.
      { action: "registrations.sponsor_list_exported", entityType: "event", entityId: gone, metadataJson: { eventId: gone, format: "xlsx", count: 2, recipient: "Sport Shop", registrationIds: [] }, createdAt: new Date("2026-08-02T08:00:00.000Z") },
      // Another export about the same event is not a list for sponsors.
      { action: "registrations.exported", entityType: "event", entityId: event.id, metadataJson: { count: 40, recipient: "nobody" }, createdAt: new Date("2026-08-03T08:00:00.000Z") },
    ]);
    const admin = await staff("ADMIN");
    const register = await readSponsorRegister(db, admin, { locale: "ro" });
    expect(register.lists.map(({ at, eventId, eventTitle, recipient, count, format, actorName }) => ({ at, eventId, eventTitle, recipient, count, format, actorName }))).toEqual([
      { at: new Date("2026-08-02T08:00:00.000Z"), eventId: gone, eventTitle: null, recipient: "Sport Shop", count: 2, format: "xlsx", actorName: null },
      { at: new Date("2026-08-01T08:00:00.000Z"), eventId: event.id, eventTitle: "Crosul toamnei", recipient: null, count: 7, format: "csv", actorName: null },
    ]);
    expect(register.recipients).toEqual(["Sport Shop"]);
    // The event's own door never shows another event's list.
    expect((await readSponsorRegister(db, admin, { eventId: event.id, locale: "ro" })).lists.map((list) => list.count)).toEqual([7]);
    // No list yet for anybody: nothing, and nothing to suggest.
    await resetTables(db);
    expect(await readSponsorRegister(db, await staff("ADMIN"), { locale: "ro" })).toEqual({ lists: [], recipients: [] });
  });

  it.each([["DEV"], ["CONTRIBUTOR"], ["COPYWRITER"], ["MEMBER"]] as const)("BR-REQ-060-01 refuses the %s role in the read", async (role) => {
    await fourLists();
    expect(await refusal(readSponsorRegister(db, await staff(role), { locale: "ro" }))).toBe("FORBIDDEN");
  });

  it.each([["MODERATOR"], ["ADMIN"], ["SUPERADMIN"]] as const)("BR-REQ-060-01 serves the %s role, who may take the list", async (role) => {
    await fourLists();
    expect((await readSponsorRegister(db, await staff(role), { locale: "ro" })).lists).toHaveLength(4);
  });

  it("draws the box required, with the earlier recipients as its suggestions, and the register as a closed fold under the captions", async () => {
    const { autumn, organizer } = await fourLists();
    const register = await readSponsorRegister(db, organizer, { eventId: autumn.id, locale: "ro" });
    const html = await draw({ locale: "ro", eventId: autumn.id, list: { offered: true, count: 2 }, register, now: new Date("2026-10-15T09:00:00.000Z"), registerLevel: 2 });

    // The box: required, never spaces alone, its suggestions the names written before.
    const [box] = html.match(/<input[^>]*name="to"[^>]*>/) ?? [""];
    expect(box).toMatch(/\srequired=""/);
    expect(box).toContain('pattern=".*\\S.*"');
    expect(box).toContain('title="Scrie cui dai lista."');
    expect(box).toContain('list="sponsor-list-recipients"');
    // The browser's own memory of the box is off: the suggestions are the register's, one spelling for one sponsor.
    expect(box).toMatch(/\sautocomplete="off"/i);
    expect(html).toMatch(/<datalist id="sponsor-list-recipients"[^>]*><option value="sport shop srl"><\/option><option value="Decathlon"><\/option><option value="club"><\/option><\/datalist>/);
    expect(words(html)).toContain("Cui dai lista");
    expect(html).not.toContain("opțional");

    // The register: after the captions, a fold that waits closed, its line saying how many and the latest.
    expect(html.indexOf('data-testid="sponsor-register"')).toBeGreaterThan(html.indexOf('data-testid="sponsor-list-help-excel"'));
    expect(html).toMatch(/<details[^>]*data-testid="sponsor-register"/);
    expect(html).not.toMatch(/<details[^>]*data-testid="sponsor-register"[^>]*\sopen/);
    const fold = html.slice(html.indexOf('data-testid="sponsor-register"'));
    expect(fold).toMatch(/<h2[^>]*>[\s\S]*?Liste date sponsorilor/);
    expect(words(fold)).toContain("3 liste · ultima: Decathlon, dum., 20 sept. 2026");

    // The table: a heading per fact, a row per list, newest first.
    const table = fold.slice(fold.indexOf('data-testid="sponsor-register-table"'), fold.indexOf("</table>"));
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])).toEqual(["Cui", "Când", "Eveniment", "Persoane", "Fișier", "Descărcată de", "Ștergi copia până la"]);
    const rows = [...table.matchAll(/<tr[^>]*data-testid="sponsor-register-row"[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1]));
    expect(rows).toEqual([
      "Decathlon dum., 20 sept. 2026, la 12:00 toate evenimentele 3 CSV ADMIN mar., 20 oct. 2026",
      // Past their thirty days on 15 October: said in words.
      "club sâm., 12 sept. 2026, la 12:00 Crosul toamnei 2 Excel MODERATOR lun., 12 oct. 2026 · termen trecut",
      "Sport Shop SRL joi, 10 sept. 2026, la 12:00 Crosul toamnei 2 CSV MODERATOR sâm., 10 oct. 2026 · termen trecut",
    ]);
    // The phone's lines: the same lists, a line per fact under the recipient.
    const lines = fold.slice(fold.indexOf('data-testid="sponsor-register-lines"'));
    expect(lines.match(/<li/g)).toHaveLength(3);
    expect(words(lines)).toContain("Decathlon Când dum., 20 sept. 2026, la 12:00 Eveniment toate evenimentele Persoane 3 Fișier CSV Descărcată de ADMIN Ștergi copia până la mar., 20 oct. 2026");
    // Never a participant in it.
    expect(html).not.toMatch(/@example\.ro|Ana|Bogdan/);
  });

  it("draws the register inside a card a level down, says «destinatar nenotat» and «cont șters» on an older list, and nothing before the first list", async () => {
    await approveNotice(2, sharing, V1_AT);
    const event = await createEvent("crosul-toamnei", "Crosul toamnei");
    await db.insert(auditLogs).values({ action: "registrations.sponsor_list_exported", entityType: "event", entityId: event.id, metadataJson: { eventId: event.id, count: 1, recipient: null, registrationIds: [] }, createdAt: new Date("2026-08-01T08:00:00.000Z") });
    const admin = await staff("ADMIN");
    const register = await readSponsorRegister(db, admin, { locale: "ro" });
    const html = await draw({ locale: "ro", eventId: null, list: { offered: true, count: 0 }, register, now: new Date("2026-08-05T08:00:00.000Z"), registerLevel: 3 });
    const fold = html.slice(html.indexOf('data-testid="sponsor-register"'));
    expect(fold).toMatch(/<h3[^>]*>[\s\S]*?Liste date sponsorilor/);
    expect(words(fold)).toContain("1 listă · ultima: destinatar nenotat, sâm., 1 aug. 2026");
    const [row] = [...fold.matchAll(/<tr[^>]*data-testid="sponsor-register-row"[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1]));
    expect(row).toBe("destinatar nenotat sâm., 1 aug. 2026, la 11:00 Crosul toamnei 1 CSV cont șters lun., 31 aug. 2026");
    expect(html).not.toContain('data-testid="sponsor-register-overdue"');
    // Nothing to suggest: the box has an empty list, and still asks for a name.
    expect(html).toMatch(/<datalist id="sponsor-list-recipients"[^>]*><\/datalist>/);

    const none = await draw({ locale: "ro", eventId: event.id, list: { offered: true, count: 0 }, register: { lists: [], recipients: [] }, now: new Date("2026-08-05T08:00:00.000Z"), registerLevel: 2 });
    expect(none).toContain('data-testid="sponsor-list-recipient"');
    expect(none).not.toContain('data-testid="sponsor-register"');
  });

  it("keeps the register in sight while the notice in force switches the button off: what was given stays given", async () => {
    const { autumn, organizer } = await fourLists();
    const register = await readSponsorRegister(db, organizer, { eventId: autumn.id, locale: "ro" });
    const html = await draw({ locale: "ro", eventId: autumn.id, list: { offered: false, count: 0 }, register, now: new Date("2026-10-15T09:00:00.000Z"), registerLevel: 2 });
    expect(html).not.toContain('name="to"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="sponsor-list-button"|<button[^>]*data-testid="sponsor-list-button"[^>]*disabled=""/);
    expect(words(html)).toContain("Nota de confidențialitate în vigoare nu spune că lista poate fi dată partenerilor.");
    expect(html.match(/data-testid="sponsor-register-row"/g)).toHaveLength(3);
  });

  /** One list in the trail, as the download writes it. */
  const given = (at: string, eventId: string | null, recipient: string, more: { format?: "csv" | "xlsx"; count?: number; actor?: string | null } = {}) => ({
    action: "registrations.sponsor_list_exported" as const,
    entityType: "event",
    entityId: eventId,
    actorStaffUserId: more.actor ?? null,
    metadataJson: { eventId, format: more.format ?? "csv", count: more.count ?? 1, recipient, registrationIds: [] },
    createdAt: new Date(at),
  });
  const rowsOf = (html: string) => [...html.matchAll(/<tr[^>]*data-testid="sponsor-register-row"[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1]));

  it("says the days on the club's clock: a list downloaded after midnight in Brașov is the new day's, and so is its thirty-day term", async () => {
    // 22:30 UTC on the 20th is 01:30 on the 21st in Brașov.
    await db.insert(auditLogs).values(given("2026-09-20T22:30:00.000Z", null, "Sport Shop", { count: 4 }));
    const register = await readSponsorRegister(db, await staff("ADMIN"), { locale: "ro" });
    const html = await draw({ locale: "ro", eventId: null, list: { offered: true, count: 0 }, register, now: new Date("2026-09-25T09:00:00.000Z"), registerLevel: 3 });
    const fold = html.slice(html.indexOf('data-testid="sponsor-register"'));
    expect(words(fold)).toContain("1 listă · ultima: Sport Shop, lun., 21 sept. 2026");
    expect(rowsOf(fold)).toEqual(["Sport Shop lun., 21 sept. 2026, la 01:30 toate evenimentele 4 CSV cont șters mie., 21 oct. 2026"]);
  });

  it("says «termen trecut» from the day after the one the cell names — never during that day, whatever the hour the file was made at", async () => {
    // Downloaded on 12 September at 12:00 in Brașov: the cell names 12 October.
    await db.insert(auditLogs).values(given("2026-09-12T09:00:00.000Z", null, "Sport Shop"));
    const register = await readSponsorRegister(db, await staff("ADMIN"), { locale: "ro" });
    const at = (now: string) => draw({ locale: "ro", eventId: null, list: { offered: true, count: 0 }, register, now: new Date(now), registerLevel: 3 });
    // The named day, six hours after the download's hour and at its last minute: still in time.
    for (const sameDay of ["2026-10-12T15:00:00.000Z", "2026-10-12T20:59:00.000Z"]) {
      const html = await at(sameDay);
      expect(rowsOf(html), sameDay).toEqual(["Sport Shop sâm., 12 sept. 2026, la 12:00 toate evenimentele 1 CSV cont șters lun., 12 oct. 2026"]);
      expect(html, sameDay).not.toContain('data-testid="sponsor-register-overdue"');
    }
    // Midnight in Brașov: the day named has passed.
    const nextDay = await at("2026-10-12T21:00:00.000Z");
    expect(rowsOf(nextDay)).toEqual(["Sport Shop sâm., 12 sept. 2026, la 12:00 toate evenimentele 1 CSV cont șters lun., 12 oct. 2026 · termen trecut"]);
    // The phone's lines say it too.
    expect(nextDay.match(/data-testid="sponsor-register-overdue"/g)).toHaveLength(2);
  });

  it("draws «—» for a list whose event was erased since — never «toate evenimentele», which is another list", async () => {
    const gone = randomUUID();
    await db.insert(auditLogs).values(given("2026-08-02T08:00:00.000Z", gone, "Sport Shop", { format: "xlsx", count: 2 }));
    const register = await readSponsorRegister(db, await staff("ADMIN"), { locale: "ro" });
    const html = await draw({ locale: "ro", eventId: null, list: { offered: true, count: 0 }, register, now: new Date("2026-08-05T08:00:00.000Z"), registerLevel: 3 });
    expect(rowsOf(html)).toEqual(["Sport Shop dum., 2 aug. 2026, la 11:00 — 2 Excel cont șters mar., 1 sept. 2026"]);
    expect(words(html)).not.toContain("toate evenimentele");
  });

  it("draws the block in English for an English reader: the words, the days and the plural", async () => {
    state.locale = "en";
    const autumn = await createEvent("crosul-toamnei", "Crosul toamnei");
    const organizer = await staff("MODERATOR");
    await db.insert(auditLogs).values([
      given("2026-09-10T09:00:00.000Z", autumn.id, "Sport Shop SRL", { count: 2, actor: organizer.id }),
      given("2026-09-12T09:00:00.000Z", autumn.id, "club", { format: "xlsx", count: 2, actor: organizer.id }),
      given("2026-09-20T09:00:00.000Z", null, "Decathlon", { count: 3 }),
    ]);
    const register = await readSponsorRegister(db, organizer, { eventId: autumn.id, locale: "en" });
    const html = await draw({ locale: "en", eventId: autumn.id, list: { offered: true, count: 2 }, register, now: new Date("2026-10-15T09:00:00.000Z"), registerLevel: 2 });
    const [box] = html.match(/<input[^>]*name="to"[^>]*>/) ?? [""];
    expect(box).toContain('title="Write who receives the list."');
    expect(words(html)).toContain("Who receives the list");
    expect(html).not.toMatch(/optional/i);
    const fold = html.slice(html.indexOf('data-testid="sponsor-register"'));
    expect(fold).toMatch(/<h2[^>]*>[\s\S]*?Lists given to sponsors/);
    expect(words(fold)).toContain("3 lists · latest: Decathlon, Sun, 20 Sept 2026");
    const table = fold.slice(fold.indexOf('data-testid="sponsor-register-table"'), fold.indexOf("</table>"));
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])).toEqual(["To whom", "When", "Event", "People", "File", "Downloaded by", "Delete your copy by"]);
    expect(rowsOf(table)).toEqual([
      "Decathlon Sun, 20 Sept 2026, at 12:00 every event 3 CSV account removed Tue, 20 Oct 2026",
      "club Sat, 12 Sept 2026, at 12:00 Crosul toamnei (en) 2 Excel MODERATOR Mon, 12 Oct 2026 · past due",
      "Sport Shop SRL Thu, 10 Sept 2026, at 12:00 Crosul toamnei (en) 2 CSV MODERATOR Sat, 10 Oct 2026 · past due",
    ]);
  });

  it("reads the newest 500 lists and no more, and suggests the newest 50 recipients of them", async () => {
    const admin = await staff("ADMIN");
    const first = Date.parse("2026-01-01T00:00:00.000Z");
    await db.insert(auditLogs).values(Array.from({ length: 501 }, (_, index) => given(new Date(first + index * 60_000).toISOString(), null, `Sponsor ${index}`, { count: index })));
    const register = await readSponsorRegister(db, admin, { locale: "ro" });
    expect(SPONSOR_REGISTER_LIMIT).toBe(500);
    expect(register.lists).toHaveLength(500);
    // The newest first; the oldest of the 501 is the one left out.
    expect(register.lists[0].count).toBe(500);
    expect(register.lists.at(-1)?.count).toBe(1);
    expect(SPONSOR_RECIPIENT_SUGGESTIONS).toBe(50);
    expect(register.recipients).toHaveLength(50);
    expect(register.recipients[0]).toBe("Sponsor 500");
    expect(register.recipients.at(-1)).toBe("Sponsor 451");
  });

  it("lets the fold's closed line wrap a recipient written without a space: an address there must not push a phone's page sideways", async () => {
    await db.insert(auditLogs).values(given("2026-09-12T09:00:00.000Z", null, "marketing.parteneriate@sportshopbrasov.ro"));
    const register = await readSponsorRegister(db, await staff("ADMIN"), { locale: "ro" });
    const fold = (await SponsorListRegister({ locale: "ro", lists: register.lists, now: new Date("2026-09-15T09:00:00.000Z"), level: 2 })) as unknown as { props: { aside: { props: { sx: object; children: string } } } };
    expect(fold.props.aside.props.children).toBe("1 listă · ultima: marketing.parteneriate@sportshopbrasov.ro, sâm., 12 sept. 2026");
    expect(fold.props.aside.props.sx).toEqual({ overflowWrap: "anywhere" });
  });
});
