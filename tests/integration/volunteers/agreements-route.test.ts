import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { listVolunteerIdsByName } from "@/modules/volunteers/admin-list";
import type { AgreementFacts } from "@/modules/volunteers/agreement";
import { eventAgreementsFileName } from "@/modules/volunteers/agreement-pdf";
import { DomainError } from "@/shared/errors/domain-error";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { type DrawnRun, drawnRuns } from "../../helpers/pdf-drawn";
import { pdfContentDigest } from "../../helpers/pdf-content";
import { roleDescription } from "../../helpers/role-description";

/**
 * §966 — every volunteer agreement of an event in one PDF, for the desk (the owner, 2026-11-17, four days before the race:
 * «și vreau să pot printa și contractul de voluntariat, să am la fața locului»): «Contractele (PDF)» and «De semnat pe hârtie
 * (PDF)» on the «Voluntari» list, `GET /api/admin/events/[id]/volunteers/agreements`.
 *
 * - the gate is the one-person file's (`canManageVolunteers`, BR-REQ-060-01): four roles refused, nothing audited; a malformed
 *   or unknown event is NOT_FOUND, and an event's file never holds another event's people;
 * - the file holds each volunteer who is not cancelled, by name as the list orders them, each from a new page with exactly the
 *   pages of their own file — the accepted copies, the sheets to sign, a minor's parent's sheet while that consent is to come;
 *   `?only=unsigned` the sheets alone; nobody with nothing accepted while no agreement is in force;
 * - one audit row per download, its counts and `only`, never a name;
 * - and the one-person file is byte for byte what it was before its drawing learned to share a document (§758, §768).
 *
 * The PDF's words are read as `drawnRuns` catches them; the people are fixed rows, every printed value pinned, so the
 * one-person files' digests hold from one run to the next.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const one = await import("@/app/api/admin/events/[id]/volunteers/[volunteerId]/agreement/route");
const all = await import("@/app/api/admin/events/[id]/volunteers/agreements/route");

const NOW = new Date("2026-11-17T09:00:00.000Z");
const RACE_AT = new Date("2026-11-21T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;
let otherEventId: string;
let agreementId: string;
const people: Record<"ana" | "bogdan" | "cezar" | "dan" | "ioana" | "john" | "radu" | "zara", string> = {
  ana: "",
  bogdan: "",
  cezar: "",
  dan: "",
  ioana: "",
  john: "",
  radu: "",
  zara: "",
};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

/** A fixed SHA-256, so a fingerprint printed under a signature is the same on every run. */
const digest = (seed: string) => createHash("sha256").update(seed, "utf8").digest("hex");

/**
 * The agreement as a club approved it — the test's own words rather than the platform's template, which a later change may
 * reword — with every blank the PDF fills, a heading per clause, bullets, and the minors' clause; long enough that one
 * person's agreement runs onto a second page, so each page's footer and count are drawn too.
 */
function agreementText(locale: "ro" | "en"): LegalDocumentTranslationInput {
  const ro = locale === "ro";
  const duties = ro
    ? [
        "• Voluntarul își desfășoară activitatea fără plată, în condițiile Legii nr. 78/2014 privind reglementarea activității de voluntariat în România.",
        "• Organizatorul îi explică voluntarului sarcinile, îi dă echipamentul necesar și îi spune cui se adresează în ziua evenimentului.",
        "• Voluntarul respectă indicațiile organizatorului, păstrează confidențialitatea datelor participanților și anunță din timp dacă nu mai poate veni.",
      ]
    : [
        "• The volunteer works without pay, under Romanian Law no. 78/2014 on volunteering.",
        "• The organiser explains the tasks to the volunteer, gives them the equipment they need and tells them whom to ask on the day of the event.",
        "• The volunteer follows the organiser's instructions, keeps the participants' data confidential and says in good time if they can no longer come.",
      ];
  const clauses = Array.from({ length: 7 }, (_, index) => ({
    heading: ro ? `${index + 4}. Obligații, partea ${index + 1}` : `${index + 4}. Obligations, part ${index + 1}`,
    paragraphs: duties,
  }));
  return {
    locale,
    title: ro ? "Contract de voluntariat" : "Volunteer agreement",
    body: {
      sections: [
        {
          heading: ro ? "1. Părțile" : "1. The parties",
          paragraphs: [ro ? "Clubul, ca organizator, și {{volunteer}}, ca voluntar, încheie prezentul contract." : "The club, as organiser, and {{volunteer}}, as volunteer, make this agreement."],
        },
        {
          heading: ro ? "2. Activitatea" : "2. The activity",
          paragraphs: ro
            ? [
                "Voluntarul ajută la {{event}}, care are loc {{eventDate}}, în {{eventLocation}}, în rolul {{volunteerRole}}.",
                "Ce presupune rolul: {{volunteerTasks}}.",
                "Rolurile pentru care s-a oferit: {{volunteerRoleChoices}}.",
              ]
            : [
                "The volunteer helps at {{event}}, which takes place on {{eventDate}}, at {{eventLocation}}, in the role {{volunteerRole}}.",
                "What the role asks: {{volunteerTasks}}.",
                "The roles they offered for: {{volunteerRoleChoices}}.",
              ],
        },
        {
          heading: ro ? "3. Vârsta" : "3. Age",
          paragraphs: ro
            ? ["Voluntarul declară că are cel puțin {{minimumAge}}.", "Voluntarul fiind minor, părintele sau tutorele său, {{volunteerGuardian}}, își dă acordul pentru prezentul contract."]
            : ["The volunteer declares they are at least {{minimumAge}}.", "The volunteer being a minor, their parent or guardian, {{volunteerGuardian}}, consents to this agreement."],
        },
        ...clauses,
      ],
    },
  };
}

/** The blanks an acceptance kept on its row, as `agreement.ts` writes them: the values its fingerprint was taken over. */
function facts(over: Partial<AgreementFacts> & Pick<AgreementFacts, "volunteer" | "signedAt">): AgreementFacts {
  return {
    volunteerRole: "Punct de apă",
    volunteerTasks: "Împarte apă la kilometrul 5",
    volunteerRoleChoices: "",
    volunteerChoiceTasks: "",
    volunteerGuardian: "",
    event: "Crosul",
    eventDate: "sâmbătă, 21 noiembrie 2026",
    eventLocation: "Parcul central",
    minimumAge: "14 ani",
    ...over,
  };
}

type VolunteerRow = typeof eventVolunteers.$inferInsert;

/** One volunteer as the form, the link or the desk left the row — every printed value fixed, the roles given and offered. */
async function volunteer(row: Omit<VolunteerRow, "eventId" | "email" | "canonicalEmail" | "canonicalizationVersion" | "phone"> & { eventId?: string }, roles: { given?: string[]; chosen?: string[] } = {}) {
  const email = `${row.name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, ".")}@example.test`;
  const [inserted] = await db
    .insert(eventVolunteers)
    .values({ eventId, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", createdAt: NOW, updatedAt: NOW, ...row })
    .returning({ id: eventVolunteers.id });
  if (roles.given?.length) await db.insert(eventVolunteerRoleAssignments).values(roles.given.map((roleId) => ({ volunteerId: inserted.id, roleId })));
  if (roles.chosen?.length) await db.insert(eventVolunteerRoleChoices).values(roles.chosen.map((roleId) => ({ volunteerId: inserted.id, roleId })));
  return inserted.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.actor = undefined;
  for (const [role, name] of [
    ["ADMIN", "Ana Admin"],
    ["MODERATOR", "Oana Organizator"],
    ["DEV", "Tudor Tehnic"],
    ["COPYWRITER", "Rada Redactor"],
    ["CONTRIBUTOR", "Vlad Voluntar"],
    ["MEMBER", "Membru Club"],
  ] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  }
  const translations = [agreementText("ro"), agreementText("en")];
  agreementId = await insertLegalDocumentVersion(db, {
    key: "VOLUNTEER_AGREEMENT",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
  const [race, other] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: RACE_AT, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
      { type: "RACE", startsAt: new Date("2026-12-12T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  eventId = race.id;
  otherEventId = other.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul-toamnei", title: "Crosul", locationName: "Parcul central" },
    { eventId, locale: "en", slug: "autumn-cross", title: "The cross", locationName: "Central park" },
    { eventId: otherEventId, locale: "ro", slug: "crosul-iernii", title: "Crosul iernii", locationName: "Poiana" },
    { eventId: otherEventId, locale: "en", slug: "winter-cross", title: "The winter cross", locationName: "The glade" },
  ]);
  const [{ id: water }, { id: finish }] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0, ...roleDescription("Împarte apă la kilometrul 5", "Hands out water at kilometre 5") },
      { eventId, nameRo: "Sosire", nameEn: "Finish", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  const [{ id: otherRole }] = await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "Masă", nameEn: "Desk", needed: 1 }).returning({ id: eventVolunteerRoles.id });

  // Written in an order that is not the names': the file follows the list's order, by name.
  // Radu, fifteen: his own acceptance on paper at the desk, then his father's from the link (§768) — two entries.
  people.radu = await volunteer(
    {
      name: "Radu Tânăr",
      source: "STAFF",
      state: "CONFIRMED",
      age: 15,
      guardianName: "Mihai Tânăr",
      guardianEmail: "mihai.tanar@example.test",
      agreementDocumentId: agreementId,
      agreementAcceptedAt: new Date("2026-11-12T09:00:00.000Z"),
      agreementMethod: "PAPER",
      agreementLocale: "ro",
      agreementTextHash: digest("radu"),
      agreementFacts: facts({ volunteer: "Radu Tânăr", volunteerGuardian: "Mihai Tânăr", signedAt: "joi, 12 nov. 2026, la 11:00" }),
      agreementRecordedByStaffUserId: staff.ADMIN!.id,
      guardianDocumentId: agreementId,
      guardianAcceptedAt: new Date("2026-11-13T19:30:00.000Z"),
      guardianMethod: "LINK",
      guardianLocale: "ro",
      guardianTextHash: digest("mihai"),
      guardianFacts: facts({ volunteer: "Radu Tânăr", volunteerGuardian: "Mihai Tânăr", signedAt: "vineri, 13 nov. 2026, la 21:30" }),
      guardianTypedName: "Mihai Tânăr",
      guardianIp: "203.0.113.20",
      guardianUserAgent: "Mozilla/5.0 (Android 14) Firefox/131.0",
      createdAt: new Date("2026-11-01T10:00:00.000Z"),
    },
    { given: [water] },
  );
  // John, an adult entered by hand in English, who has not accepted: the sheet to sign at the desk, in his language.
  people.john = await volunteer({ name: "John Smith", source: "STAFF", locale: "en", createdAt: new Date("2026-11-02T10:00:00.000Z") }, { given: [finish] });
  // Ana, an adult who accepted on the form, with the press's trace (§771).
  people.ana = await volunteer(
    {
      name: "Ana Pop",
      source: "PUBLIC",
      state: "CONFIRMED",
      agreementDocumentId: agreementId,
      agreementAcceptedAt: new Date("2026-11-10T18:15:00.000Z"),
      agreementMethod: "FORM",
      agreementLocale: "ro",
      agreementTextHash: digest("ana"),
      agreementFacts: facts({ volunteer: "Ana Pop", signedAt: "marți, 10 nov. 2026, la 20:15" }),
      agreementIp: "203.0.113.9",
      agreementUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
      declaredAdult: true,
      createdAt: new Date("2026-11-03T10:00:00.000Z"),
    },
    { given: [water], chosen: [water] },
  );
  // Ioana, sixteen: she accepted from her link; her mother's consent is still to come.
  people.ioana = await volunteer(
    {
      name: "Ioana Mică",
      source: "PUBLIC",
      age: 16,
      guardianName: "Elena Mică",
      guardianEmail: "elena.mica@example.test",
      agreementDocumentId: agreementId,
      agreementAcceptedAt: new Date("2026-11-11T10:00:00.000Z"),
      agreementMethod: "LINK",
      agreementLocale: "ro",
      agreementTextHash: digest("ioana"),
      agreementFacts: facts({ volunteer: "Ioana Mică", volunteerGuardian: "Elena Mică", signedAt: "miercuri, 11 nov. 2026, la 12:00" }),
      agreementIp: "203.0.113.10",
      agreementUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
      createdAt: new Date("2026-11-04T10:00:00.000Z"),
    },
    { chosen: [water, finish] },
  );
  // Dan, fifteen, entered by hand: nothing accepted yet — his sheet has his line and his mother's.
  people.dan = await volunteer({ name: "Dan Tânărul", source: "STAFF", age: 15, guardianName: "Maria Popescu", createdAt: new Date("2026-11-05T10:00:00.000Z") }, { given: [water] });
  // Bogdan accepted, then withdrew: never in the file.
  people.bogdan = await volunteer(
    {
      name: "Bogdan Anulat",
      source: "PUBLIC",
      state: "CANCELLED",
      agreementDocumentId: agreementId,
      agreementAcceptedAt: new Date("2026-11-06T10:00:00.000Z"),
      agreementMethod: "FORM",
      agreementLocale: "ro",
      agreementTextHash: digest("bogdan"),
      agreementFacts: facts({ volunteer: "Bogdan Anulat", signedAt: "vineri, 6 nov. 2026, la 12:00" }),
      declaredAdult: true,
      createdAt: new Date("2026-11-06T10:00:00.000Z"),
    },
    { given: [finish] },
  );
  // cezar typed his name in lower case: the list sorts him by «c», between Bogdan and Dan, and so does the file.
  people.cezar = await volunteer({ name: "cezar Dobre", source: "PUBLIC", createdAt: new Date("2026-11-07T10:00:00.000Z") }, { chosen: [finish] });
  // Another event's volunteer: never in this event's file.
  people.zara = await volunteer({ eventId: otherEventId, name: "Zara Altundeva", source: "STAFF", createdAt: new Date("2026-11-08T10:00:00.000Z") }, { given: [otherRole] });
});

/** The one-person route's answer (§758), at the fixture's instant: what «PDF contract» or «PDF de semnat» on a person's page downloads. */
async function onePerson(person: string, query = "") {
  state.actor = staff.ADMIN;
  return atTheClock(NOW, () =>
    one.GET(new Request(`https://example.test/api/admin/events/${eventId}/volunteers/${person}/agreement${query}`), { params: Promise.resolve({ id: eventId, volunteerId: person }) }),
  );
}

describe("§966 the one-person agreement's file is what it was before every agreement could be printed at once", () => {
  /*
    The digests of the files the one-person route answered with, captured from the code as it stood before the drawing of one
    person's agreement learned to draw into a document it is handed (§966): an accepted adult, an adult who has not accepted
    (his sheet, in English), and the minors — not accepted (the sheet with the parent's line), accepted with the parent's
    consent to come (the copy that says so, and `?for=guardian`'s sheet for the parent) and accepted by both (two entries).
    `pdfContentDigest` is the file with its streams inflated, so the same digest is the same file byte for byte on any one
    machine's zlib. A deliberate change of the agreement's PDF captures them again; the bundle's refactor changed none.
  */
  const GOLDEN = {
    acceptedAdult: "0706f8da395cacfd1ba9c2dab87a49c6cb98d8d6e9ce677d2b517227f6686239",
    notAcceptedAdult: "4dc6ab3a55cdce683a317cd78052c97d3d0e95b340a7ea13afcfe8c21712edfc",
    minorNotAccepted: "4135c87a2838b0b608e4bc474dfef35acb22e2b27d964c66d6a21b023a62c739",
    minorGuardianPending: "cd42682de1dd2c57298f50114da536571e293e0b5689d39b5f01634abdb8d3b1",
    minorGuardianSheet: "f6051accbd8d4af9f6f8d3e97c6a5d18fecb474fa31d2c3b7d8e75823cffab46",
    minorBothAccepted: "3b167e177344cfb101ad502ee0e06340b7b17697986f8278f8ad0cabc689fc78",
  };

  it("is byte for byte the same file for an accepted adult, an adult who has not accepted, and a minor in each of the parent's states", async () => {
    const cases: Array<[keyof typeof GOLDEN, string, string]> = [
      ["acceptedAdult", people.ana, ""],
      ["notAcceptedAdult", people.john, ""],
      ["minorNotAccepted", people.dan, ""],
      ["minorGuardianPending", people.ioana, ""],
      ["minorGuardianSheet", people.ioana, "?for=guardian"],
      ["minorBothAccepted", people.radu, ""],
    ];
    const seen: Record<string, string> = {};
    for (const [name, person, query] of cases) {
      const response = await onePerson(person, query);
      expect(response.status, name).toBe(200);
      seen[name] = pdfContentDigest(Buffer.from(await response.arrayBuffer()));
    }
    expect(seen, "the one-person agreement's file changed: when the change is deliberate, the digests received here are the new GOLDEN").toEqual(GOLDEN);
  });
});

/** The event's file, at the fixture's instant: «Contractele (PDF)», or with `?only=unsigned` «De semnat pe hârtie (PDF)». */
async function eventFile(actor: StaffUser | undefined, query = "", id = eventId) {
  state.actor = actor;
  return atTheClock(NOW, () => all.GET(new Request(`https://example.test/api/admin/events/${id}/volunteers/agreements${query}`), { params: Promise.resolve({ id }) }));
}

/** One page of a file as it was drawn: every `text()` call on it, in order — the words, where, how wide and how big. */
type Page = Array<Omit<DrawnRun, "page">>;

/** What a route's file draws, page by page (`drawnRuns`: pdfkit writes glyph ids, so the words are caught on their way in). */
async function pagesOf(answer: () => Promise<Response>): Promise<{ response: Response; pages: Page[] }> {
  let response: Response | undefined;
  const runs = await drawnRuns(async () => {
    response = await answer();
  });
  const pages: Page[] = [];
  for (const { page, ...run } of runs) (pages[page] ??= []).push(run);
  return { response: response!, pages };
}

/** A file's people: each person counts their own pages, so a person begins on every page whose footer says «Pagina 1 din …». */
function peopleOf(pages: Page[]): Page[][] {
  const found: Page[][] = [];
  for (const page of pages) {
    if (page.some((run) => /^(Pagina 1 din|Page 1 of) \d+$/.test(run.text))) found.push([page]);
    else found.at(-1)?.push(page);
  }
  return found;
}

/** Everything a person's pages say, one string. */
const wordsOf = (pages: Page[]) =>
  pages
    .flat()
    .map((run) => run.text)
    .join(" ");

const downloads = () => db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.agreements_downloaded"));

/** Everyone the fixture names, the cancelled and another event's person included: none of it may reach an audit row. */
const EVERY_NAME = ["Ana Pop", "Bogdan Anulat", "cezar Dobre", "Dan Tânărul", "Maria Popescu", "Ioana Mică", "Elena Mică", "John Smith", "Radu Tânăr", "Mihai Tânăr", "Zara Altundeva"];

describe("§966 every agreement of an event in one PDF (BR-REQ-060-01)", () => {
  it("refuses the Tehnic role, a Redactor, a volunteer at the desk and a member with a 403 and a stranger with a 401, auditing nothing", async () => {
    for (const key of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      expect((await eventFile(staff[key]!)).status, key).toBe(403);
      expect((await eventFile(staff[key]!, "?only=unsigned")).status, key).toBe(403);
    }
    expect((await eventFile(undefined)).status).toBe(401);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("answers 404 for a malformed or an unknown event, auditing nothing, and an event's file never holds another event's people", async () => {
    expect((await eventFile(staff.ADMIN!, "", "not-an-id")).status).toBe(404);
    expect((await eventFile(staff.ADMIN!, "", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await db.select().from(auditLogs)).toEqual([]);
    const other = peopleOf((await pagesOf(() => eventFile(staff.ADMIN!, "", otherEventId))).pages).map(wordsOf);
    expect(other).toHaveLength(1);
    expect(other[0]).toContain("Zara Altundeva");
    expect(other[0]).not.toMatch(/Ana Pop|Dan Tânărul|John Smith|Radu Tânăr/);
  });

  it("gives the Organizer and an Administrator the file, named after the event and the club's day in the reader's language, kept out of shared caches", async () => {
    for (const key of ["MODERATOR", "ADMIN"] as const) {
      const response = await eventFile(staff[key]!, "?lang=ro");
      expect(response.status, key).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toContain('attachment; filename="contracte-voluntariat-crosul-toamnei-2026-11-17.pdf"');
      expect(Buffer.from(await response.arrayBuffer()).toString("latin1").startsWith("%PDF-1.")).toBe(true);
    }
    const sheets = await eventFile(staff.ADMIN!, "?only=unsigned&lang=en");
    expect(sheets.headers.get("content-disposition")).toContain('filename="contracte-de-semnat-autumn-cross-2026-11-17.pdf"');
    // A slug is cut to what a header carries; an event with none in the language is still named.
    expect(eventAgreementsFileName("Crosul Toamnei 2026!", "2026-11-17", "all")).toBe("contracte-voluntariat-crosul-toamnei-2026-2026-11-17.pdf");
    expect(eventAgreementsFileName(null, "2026-11-17", "unsigned")).toBe("contracte-de-semnat-eveniment-2026-11-17.pdf");
  });

  it("holds one agreement per volunteer who is not cancelled, by name as the list orders them, each from a new page: the accepted copies and the sheets to sign", async () => {
    const { response, pages } = await pagesOf(() => eventFile(staff.ADMIN!));
    expect(response.status).toBe(200);
    const found = peopleOf(pages);
    // The list's own order by «Nume»: A to Z without regard to case — «cezar» between «Ana» and «Dan».
    const order = ["Ana Pop", "cezar Dobre", "Dan Tânărul", "Ioana Mică", "John Smith", "Radu Tânăr"];
    expect(found).toHaveLength(order.length);
    found.forEach((person, index) => {
      // A new page each: the first thing drawn on a person's first page is their agreement's title.
      expect(person[0][0].text, order[index]).toMatch(/^(CONTRACT DE VOLUNTARIAT|VOLUNTEER AGREEMENT)$/);
      expect(wordsOf(person)).toContain(order[index]);
      for (const other of order.filter((name) => name !== order[index])) expect(wordsOf(person), order[index]).not.toContain(other);
    });
    expect(await listVolunteerIdsByName(db, eventId)).toEqual([people.ana, people.cezar, people.dan, people.ioana, people.john, people.radu]);
    // The cancelled and another event's person are never in it.
    expect(wordsOf(pages)).not.toMatch(/Bogdan Anulat|Zara Altundeva/);

    const [ana, cezar, dan, ioana, john, radu] = found.map(wordsOf);
    // Accepted: the copies — how and when, and once the parent agreed, the parent's entry beside the volunteer's.
    expect(ana).toContain("Acceptat electronic");
    expect(radu).toContain("Semnat pe hârtie, la organizatori; înregistrat de Ana Admin");
    expect(radu).toContain("Acordul părintelui sau tutorelui, Mihai Tânăr, acceptat electronic");
    // The rest: the sheets, each in the person's own language — the organizer's line beside an adult's, the parent's beside a minor's.
    expect(cezar).toContain("Pentru organizator (nume și semnătură):");
    expect(john).toContain("For the organiser (name and signature):");
    expect(dan).toContain("Semnătura părintelui sau tutorelui:");
    // Ioana accepted her own and her mother's consent is still to come: the mother's sheet, as her page's «Acordul părintelui pe hârtie».
    expect(ioana).toContain("Semnătura părintelui sau tutorelui:");
    expect(ioana).toContain("Elena Mică");
    for (const sheet of [cezar, dan, ioana, john]) expect(sheet).not.toMatch(/Acceptat electronic|Accepted electronically|Semnat pe hârtie|încă neprimit/);
  });

  it("gives each person exactly the pages of their own file — the parent's sheet for a minor whose parent has not agreed yet", async () => {
    const found = peopleOf((await pagesOf(() => eventFile(staff.ADMIN!))).pages);
    const own: Array<[string, string]> = [
      [people.ana, ""],
      [people.cezar, ""],
      [people.dan, ""],
      [people.ioana, "?for=guardian"],
      [people.john, ""],
      [people.radu, ""],
    ];
    expect(found).toHaveLength(own.length);
    for (const [index, [person, query]] of own.entries()) {
      const alone = (await pagesOf(() => onePerson(person, query))).pages;
      expect(found[index]).toEqual(alone);
    }
  });

  it("holds the sheets to sign alone with `only=unsigned`: who has not accepted, and the parent's sheet still to sign", async () => {
    const found = peopleOf((await pagesOf(() => eventFile(staff.ADMIN!, "?only=unsigned"))).pages).map(wordsOf);
    const order = ["cezar Dobre", "Dan Tânărul", "Ioana Mică", "John Smith"];
    expect(found).toHaveLength(order.length);
    found.forEach((sheet, index) => {
      expect(sheet).toContain(order[index]);
      expect(sheet).toMatch(/Semnătura voluntarului:|Volunteer's signature:/);
    });
    expect(found.join(" ")).not.toMatch(/Ana Pop|Radu Tânăr|Acceptat electronic|Semnat pe hârtie/);
  });

  it("records each download once — the event, how many agreements, accepted and to sign, and `only` — never a name, and writes nothing else", async () => {
    const before = await db.select().from(eventVolunteers);
    await eventFile(staff.MODERATOR!);
    await eventFile(staff.ADMIN!, "?only=unsigned");
    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.actorStaffUserId === staff.MODERATOR!.id)).toMatchObject({
      action: "volunteer.agreements_downloaded",
      entityType: "event",
      entityId: eventId,
      metadataJson: { only: null, agreements: 6, accepted: 2, toSign: 4 },
    });
    expect(rows.find((row) => row.actorStaffUserId === staff.ADMIN!.id)).toMatchObject({ entityId: eventId, metadataJson: { only: "unsigned", agreements: 4, accepted: 0, toSign: 4 } });
    const said = JSON.stringify(rows.map((row) => row.metadataJson));
    for (const name of EVERY_NAME) expect(said).not.toContain(name);
    // A GET: the people are as they were.
    expect(await db.select().from(eventVolunteers)).toEqual(before);
  });

  it("leaves out whoever has nothing accepted while no agreement is in force — the accepted copies stay, and a minor's own copy stands in for the parent's sheet", async () => {
    await db.update(legalDocuments).set({ withdrawnAt: new Date("2026-11-15T00:00:00.000Z") }).where(eq(legalDocuments.id, agreementId));
    const found = peopleOf((await pagesOf(() => eventFile(staff.ADMIN!))).pages).map(wordsOf);
    expect(found).toHaveLength(3);
    expect(found[0]).toContain("Ana Pop");
    // No text to print Elena's sheet on: Ioana's own copy, which says her mother's consent is still to come.
    expect(found[1]).toContain("Ioana Mică");
    expect(found[1]).toContain("Acordul părintelui sau tutorelui, Elena Mică: încă neprimit.");
    expect(found[2]).toContain("Radu Tânăr");
    expect(found.join(" ")).not.toMatch(/cezar Dobre|Dan Tânărul|John Smith/);
    // Nothing to sign can be printed: the sheets' file is the one page that says so.
    const { pages } = await pagesOf(() => eventFile(staff.ADMIN!, "?only=unsigned"));
    expect(pages).toHaveLength(1);
    expect(pages[0].map((run) => run.text)).toContain("—");
    expect((await downloads()).map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { only: null, agreements: 3, accepted: 3, toSign: 0 },
        { only: "unsigned", agreements: 0, accepted: 0, toSign: 0 },
      ]),
    );
  });
});
