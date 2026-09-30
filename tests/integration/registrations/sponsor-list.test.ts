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
import { buildSponsorListCsv, readSponsorShareGate, sponsorList, sponsorListSummary } from "@/modules/registrations/sponsor-list";
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
  options: { status?: Registration["status"]; kind?: Registration["kind"]; promoConsent?: boolean; version?: number; at?: Date | null; birthDate?: string | null } = {},
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
      listOptOut: true,
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
      { eventId: event.id, count: 1, recipient: null, registrationIds: [ana.id] },
      { eventId: null, count: 1, recipient: null, registrationIds: [ana.id] },
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
