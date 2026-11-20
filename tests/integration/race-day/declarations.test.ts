import { createHash } from "node:crypto";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { formatDay } from "@/i18n/dates";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { readRaceDayDeclarations } from "@/modules/race-day/declarations";
import { canReadRaceDayDeclarations, type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { statementsOf } from "../../helpers/statements";

/**
 * §1018, BR-REQ-060-01, BR-REQ-037-08, BR-REQ-033-02 — «Ziua cursei» → «Declarații», read from a real database through the page:
 *
 * - the seventh and last tab, for the Organizer, the Administrator and the Superadministrator; no tab and a 404 for the Voluntar,
 *   the Redactor, Tehnic and a member, and the read refuses them;
 * - every registration of the chosen event that holds a signed declaration, its newest acceptance, in «Prezența»'s folds by state —
 *   the confirmed first and open, the others closed —, each fold with its count, «N declarații semnate» above, a test registration
 *   drawn and never counted;
 * - a row: the number as the desk shows it, the name, when, the signature in the hand — a minor's two, each named —, the version,
 *   «pe hârtie, înregistrată de …», the short fingerprint with the whole in its name, the PDF route and the registration's page;
 * - the search by a name blind to case and diacritics and by a race number; one query for the rows whatever their number;
 * - no identity document anywhere in the page, though every acceptance seeded holds one; both languages.
 *
 * The race is in 2099; the made-up people, documents and accounts are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the page asks of it: the locale's prefix and the params filled in.
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    return `/${locale}${path}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, prefetch, ...rest }: { href: Href; children?: ReactNode; prefetch?: boolean } & Record<string, unknown>) =>
      createElement("a", { href: hrefOf(state.locale, href), "data-prefetch": String(prefetch), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { default: DeclarationsPage } = await import("@/app/[locale]/admin/checkin/declaratii/page");
const { raceDayTabs } = await import("@/modules/race-day/ui/RaceDayTabs");

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
/** Race morning, on the event's clock: the desk's own list holds the race, so the page picks it with no event in the address. */
const MORNING = new Date("2099-11-21T05:30:00.000Z");
const TIME_ZONE = "Europe/Bucharest";

/** The identity documents typed at signing (§95): every one seeded, none on the page. Letters no hash or id holds, so a find is a leak. */
const DOCUMENTS = { ana: "BV 123456", anaBefore: "BV 111111", minor: "KX 654321", parent: "MZ 777888", eva: "XT 246810", dan: "XR 135791" } as const;
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let org1: StaffUser;
let eventId: string;
let documentId: string;
const people = { ana: "", stefan: "", radu: "", mara: "", eva: "", dan: "", test: "", unsigned: "", stranger: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  [org1] = await db.insert(staffUsers).values({ email: "org1@example.test", displayName: "Org1", role: "MODERATOR" }).returning();
  state.actor = staff.MODERATOR;
  eventId = await race();
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
  ];
  documentId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 3,
    effectiveAt: new Date("2099-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
    now: new Date("2099-01-01T00:00:00.000Z"),
  });
});

async function race(startsAt = START): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt, timezone: TIME_ZONE, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: START, locationName: "Start" })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  return event.id;
}

async function runner(name: string, bibNumber: number | null, more: Partial<typeof registrations.$inferInsert> = {}, onEvent = eventId): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: onEvent,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: START,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: START,
      bibNumber,
      ...more,
    })
    .returning({ id: registrations.id });
  return row.id;
}

/** One acceptance of `registrationId`, signed online unless `more` says otherwise, always with an identity document. */
async function signed(registrationId: string, typedName: string, more: Partial<typeof declarationAcceptances.$inferInsert> = {}) {
  await db.insert(declarationAcceptances).values({
    registrationId,
    legalDocumentId: documentId,
    declarationVersion: 3,
    contentSha256: "a".repeat(64),
    locale: "ro",
    typedName,
    idDocument: DOCUMENTS.ana,
    acceptedAt: new Date("2099-11-14T16:00:00.000Z"),
    textHash: hashOf(`${registrationId}-${typedName}`),
    ...more,
  });
}

/** The race's people: three signed online or on paper, a minor beside a parent, one with no number yet, one cancelled, a restart, a test row. */
async function morning() {
  people.ana = await runner("Ana Pop", 27);
  // Signed twice — a restart re-signs (§12.7): the newer row is the one listed, its version and its moment.
  await signed(people.ana, "Ana Pop", { declarationVersion: 2, acceptedAt: new Date("2099-11-10T09:00:00.000Z"), idDocument: DOCUMENTS.anaBefore });
  await signed(people.ana, "Ana Pop", { idDocument: DOCUMENTS.ana });
  people.stefan = await runner("Ștefan Tănase", 12);
  // On paper at the desk (BR-REQ-037-07): the document is on the paper, the row names who recorded it.
  await signed(people.stefan, "Ștefan Tănase", { method: "PAPER", attestedByStaffUserId: org1.id, idDocument: null, acceptedAt: new Date("2099-11-21T06:10:00.000Z") });
  people.radu = await runner("Radu Dinu", 3, { guardianName: "Maria Dinu" });
  await signed(people.radu, "Maria Dinu", { minorTypedName: "Radu Dinu", idDocument: DOCUMENTS.parent, minorIdDocument: DOCUMENTS.minor });
  people.mara = await runner("Mara Ilie", null);
  await signed(people.mara, "Mara Ilie", { textHash: null });
  people.eva = await runner("Eva Stan", 31, { status: "CANCELLED", cancelledAt: new Date("2099-11-18T10:00:00.000Z"), cancellationSource: "PARTICIPANT" });
  await signed(people.eva, "Eva Stan", { idDocument: DOCUMENTS.eva });
  // Cancelled after signing, then restarted: it owes a new signature, and its kept number shows nowhere until it is confirmed again (§548).
  people.dan = await runner("Dan Ene", 40, { status: "PENDING_DECLARATION", confirmedAt: null });
  await signed(people.dan, "Dan Ene", { idDocument: DOCUMENTS.dan });
  people.test = await runner("Test Pop", 50, { kind: "TEST" });
  await signed(people.test, "Test Pop");
  // Waiting for a signature and holding none: not on the page.
  people.unsigned = await runner("Ion Fără", null, { status: "PENDING_DECLARATION", confirmedAt: null });
  // Another race's runner — a week later, after this one on the desk's list —, the same number: never on this event's page.
  people.stranger = await runner("Zoe Manea", 27, {}, await race(new Date("2099-11-28T07:00:00.000Z")));
  await signed(people.stranger, "Zoe Manea");
}

const tree = (query: Record<string, string> = {}, withEvent = true) =>
  atTheClock(MORNING, () => DeclarationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ ...(withEvent ? { eventId } : {}), ...query }) }));
const page = async (query: Record<string, string> = {}, withEvent = true) => html(await tree(query, withEvent));

type Row = { id: string; markup: string; words: string };
/** The rows as they stand, top to bottom. */
const rowsOf = (markup: string): Row[] =>
  [...markup.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)]
    .filter((match) => match[1].includes('data-testid="race-day-declaration"'))
    .map((match) => ({ id: /data-registration="([^"]+)"/.exec(match[1])![1], markup: match[2], words: words(match[2]) }));
/** The folds: their key, their summary's words, whether drawn open, and the names of their rows in order. */
const foldsOf = (markup: string) =>
  [...markup.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)]
    .filter((match) => match[1].includes('data-testid="race-day-declarations-section-'))
    .map((match) => ({
      key: /data-testid="race-day-declarations-section-([^"]+)"/.exec(match[1])![1],
      title: words(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(match[2])?.[1] ?? ""),
      open: /\sopen=""/.test(match[1]),
      names: rowsOf(match[2]).map((row) => words(/data-testid="race-day-declaration-name"[^>]*>([^<]*)</.exec(row.markup)?.[1] ?? "")),
    }));
const countOf = (markup: string) => words(/data-testid="race-day-declarations-count"[^>]*>([\s\S]*?)<\/p>/.exec(markup)?.[1] ?? "");
const tabsOf = (markup: string) => {
  const row = /<div[^>]*data-testid="race-day-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(markup);
  return row ? [...row[1].matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({ label: words(match[2]), current: match[1].includes('aria-current="page"'), href: (/href="([^"]*)"/.exec(match[1])?.[1] ?? "").replace(/&amp;/g, "&") })) : [];
};
const rowOf = (markup: string, id: string) => rowsOf(markup).find((row) => row.id === id)!;
const signedAt = (instant: Date, locale: "ro" | "en" = "ro") => formatDay(instant, { locale, timeZone: TIME_ZONE, style: "short", withTime: true, position: "inline" });

describe("§1018 «Declarații» — who may read it", () => {
  it("opens for the Organizer, the Administrator and the Superadministrator, and is a 404 for every other role", async () => {
    await morning();
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(words(await page()), role).toContain("Declarațiile semnate");
    }
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      await expect(page(), role).rejects.toThrow("NOT_FOUND");
    }
    expect(STAFF_ROLES.filter((role) => canReadRaceDayDeclarations(role))).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
  });

  it("is refused by the read itself to every role that may not read it", async () => {
    await morning();
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      await expect(readRaceDayDeclarations(db, staff[role]!, eventId), role).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }
    expect(await readRaceDayDeclarations(db, staff.ADMIN!, eventId)).toHaveLength(7);
  });

  it("is the last tab of «Ziua cursei» for those three, current on its page and carrying the event — and drawn for nobody else", async () => {
    state.actor = staff.ADMIN;
    const own = tabsOf(await page());
    expect(own.at(-1)).toEqual({ label: "Declarații", current: true, href: `/ro/admin/checkin/declaratii?eventId=${eventId}` });
    // Right after «Jurnal», the organizers' other tab.
    expect(own.at(-2)).toEqual({ label: "Jurnal", current: false, href: `/ro/admin/checkin/jurnal?eventId=${eventId}` });
    const tabsFor = async (role: StaffRole, active: "desk" | "declarations" = "desk") => tabsOf(await html(await raceDayTabs({ locale: state.locale, active, eventId, actor: staff[role]! })));
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      expect((await tabsFor(role)).at(-1), role).toEqual({ label: "Declarații", current: false, href: `/ro/admin/checkin/declaratii?eventId=${eventId}` });
    }
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const labels = (await tabsFor(role)).map((tab) => tab.label);
      expect(labels, role).not.toContain("Declarații");
      expect(labels, role).toContain("Prezența");
    }
    // A member is no staff (§524): no row at all.
    expect(await tabsFor("MEMBER")).toEqual([]);
    state.locale = "en";
    expect((await tabsFor("MODERATOR", "declarations")).at(-1)).toEqual({ label: "Declarations", current: true, href: `/en/admin/checkin/declaratii?eventId=${eventId}` });
  });

  it("picks the desk's event when the address names none, as the desk does, and carries it on every tab", async () => {
    await morning();
    const markup = await page({}, false);
    expect(/<option value="([^"]+)" selected="">/.exec(markup)?.[1]).toBe(eventId);
    expect(tabsOf(markup).at(-1)?.href).toBe(`/ro/admin/checkin/declaratii?eventId=${eventId}`);
    expect(rowsOf(markup).map((row) => row.id)).toContain(people.ana);
  });
});

describe("§1018 «Declarații» — the folds, their counts and the rows' order", () => {
  it("draws every registration that holds a signed declaration in «Prezența»'s folds by state, the confirmed first and open, the others closed", async () => {
    await morning();
    const markup = await page();
    expect(foldsOf(markup)).toEqual([
      // Race numbers rising, the row without one after them; the test registration drawn and left out of the number (§30).
      { key: "confirmed", title: "Confirmați (4)", open: true, names: ["Radu Dinu", "Ștefan Tănase", "Ana Pop", "Test Pop", "Mara Ilie"] },
      { key: "unsigned", title: "De semnat din nou (1)", open: false, names: ["Dan Ene"] },
      { key: "voided", title: "Anulate sau expirate (1)", open: false, names: ["Eva Stan"] },
    ]);
    // Every real registration that signed, whatever its state; the one that never signed and another race's are not here.
    expect(countOf(markup)).toBe("6 declarații semnate");
    const ids = rowsOf(markup).map((row) => row.id);
    expect(ids).not.toContain(people.unsigned);
    expect(ids).not.toContain(people.stranger);
    expect(words(markup)).not.toContain("Zoe Manea");
  });

  it("names a fold only when it holds somebody, says so when nobody signed, and counts in the counted forms", async () => {
    expect(countOf(await page())).toBe("0 declarații semnate");
    expect(await page()).toContain('data-testid="race-day-declarations-empty"');
    expect(foldsOf(await page())).toEqual([]);
    people.ana = await runner("Ana Pop", 27);
    await signed(people.ana, "Ana Pop");
    expect(countOf(await page())).toBe("1 declarație semnată");
    expect(foldsOf(await page()).map((fold) => fold.key)).toEqual(["confirmed"]);
    for (let index = 0; index < 19; index += 1) await signed(await runner(`Alergător ${index}`, 100 + index), `Alergător ${index}`);
    expect(countOf(await page())).toBe("20 de declarații semnate");
  });

  it("puts each state in its own fold, as the desk does: an address to confirm, an open offer, the waiting list, an expired row", async () => {
    for (const [name, status] of [
      ["Ada Adresa", "PENDING_EMAIL_CONFIRMATION"],
      ["Oana Oferta", "WAITLIST_OFFERED"],
      ["Lia Lista", "WAITLISTED"],
      ["Xenia Expirata", "EXPIRED"],
    ] as const) {
      await signed(await runner(name, null, { status, confirmedAt: null }), name);
    }
    expect(foldsOf(await page()).map((fold) => [fold.key, fold.title, fold.open])).toEqual([
      ["addressUnconfirmed", "Adresă neconfirmată (1)", false],
      ["offered", "Ofertă de loc deschisă (1)", false],
      ["waitlisted", "Pe lista de așteptare (1)", false],
      ["voided", "Anulate sau expirate (1)", false],
    ]);
  });
});

describe("§1018 «Declarații» — a row", () => {
  it("says the number, the name, when, the signature in the hand, the version, the fingerprint and the two links", async () => {
    await morning();
    const markup = await page();
    const ana = rowOf(markup, people.ana);
    // The newest of her two acceptances: version 3, the 14th at 18:00 on the event's clock.
    expect(ana.words).toBe(`27 Ana Pop Semnată ${signedAt(new Date("2099-11-14T16:00:00.000Z"))} — Ana Pop versiunea 3 · Amprenta: ${hashOf(`${people.ana}-Ana Pop`).slice(0, 12)}… Declarația (PDF) Pagina înscrierii`);
    expect(ana.markup).toMatch(/data-testid="race-day-declaration-hand"[^>]*>Ana Pop</);
    // The whole fingerprint is the tip's own name (§556).
    expect(ana.markup).toContain(`aria-label="Amprenta: ${hashOf(`${people.ana}-Ana Pop`)}"`);
    // «Declarația (PDF)»: the existing route, which asserts the reading right and writes every download to the trail.
    expect(ana.markup).toMatch(new RegExp(`<a[^>]*href="/api/admin/registrations/${people.ana}/declaration"[^>]*target="_blank"[^>]*data-testid="race-day-declaration-pdf"`));
    expect(ana.markup).toMatch(new RegExp(`<a[^>]*href="/ro/admin/registrations/${people.ana}"[^>]*data-testid="race-day-declaration-registration"`));
    expect(ana.markup).not.toContain('data-testid="race-day-declaration-paper"');
    expect(ana.markup).not.toContain('data-testid="race-day-declaration-status"');
  });

  it("says who recorded a declaration signed on paper at the desk", async () => {
    await morning();
    const stefan = rowOf(await page(), people.stefan);
    expect(stefan.words).toContain(`Semnată ${signedAt(new Date("2099-11-21T06:10:00.000Z"))} — Ștefan Tănase`);
    expect(stefan.words).toContain("versiunea 3 · pe hârtie, înregistrată de Org1 · Amprenta:");
    expect(stefan.markup).toContain('data-testid="race-day-declaration-paper"');
    // One signed online by the link says nothing of paper, and names no colleague.
    expect(rowOf(await page(), people.ana).words).not.toMatch(/pe hârtie|Org1/);
  });

  it("names a minor's two signers, the minor's and the parent's, each in the hand", async () => {
    await morning();
    const radu = rowOf(await page(), people.radu);
    expect(radu.words).toContain("— Radu Dinu (minorul) · Maria Dinu (părintele sau tutorele) versiunea 3");
    expect(radu.markup.match(/data-testid="race-day-declaration-hand"/g)).toHaveLength(2);
    // A minor's declaration from before two signatures were asked: the parent's alone, as the registration's page draws it.
    const older = await runner("Ioana Dinu", 5, { guardianName: "Maria Dinu" });
    await signed(older, "Maria Dinu");
    const one = rowOf(await page(), older);
    expect(one.words).toContain("— Maria Dinu versiunea 3");
    expect(one.words).not.toContain("minorul");
  });

  it("writes the number as the desk does: «—» until confirmed, a row that is over keeps it and says which state, a test row says so", async () => {
    await morning();
    const markup = await page();
    expect(rowOf(markup, people.dan).words).toMatch(/^— Dan Ene Semnată/);
    expect(rowOf(markup, people.mara).words).toMatch(/^— Mara Ilie Semnată/);
    expect(rowOf(markup, people.mara).words).not.toContain("Amprenta");
    expect(rowOf(markup, people.eva).words).toMatch(/^31 Eva Stan Anulată Semnată/);
    expect(rowOf(markup, people.eva).markup).toContain('data-testid="race-day-declaration-status"');
    expect(rowOf(markup, people.test).words).toMatch(/^50 Test Pop Test Semnată/);
    await db.update(events).set({ bibDesign: { numberFormat: "pad3" } } as never);
    expect(rowOf(await page(), people.radu).words).toMatch(/^003 Radu Dinu/);
  });

  it("carries no identity document anywhere on the page, though every acceptance seeded holds one", async () => {
    await morning();
    for (const query of [{}, { q: "dinu" }, { q: "31" }] as Record<string, string>[]) {
      const markup = await page(query);
      for (const document of Object.values(DOCUMENTS)) {
        expect(markup, `${document} ${JSON.stringify(query)}`).not.toContain(document);
        expect(words(markup), `${document} ${JSON.stringify(query)}`).not.toContain(document.split(" ")[1]);
      }
    }
    state.locale = "en";
    const english = await page();
    for (const document of Object.values(DOCUMENTS)) expect(english).not.toContain(document);
  });
});

describe("§1018 «Declarații» — the search", () => {
  it("finds a name blind to case and diacritics in every fold, and a race number as the row shows it", async () => {
    await morning();
    const names = async (q: string) => foldsOf(await page({ q })).flatMap((fold) => fold.names);
    expect(await names("stefan tanase")).toEqual(["Ștefan Tănase"]);
    expect(await names("TĂNASE")).toEqual(["Ștefan Tănase"]);
    expect(await names("pop")).toEqual(["Ana Pop", "Test Pop"]);
    expect(await names("stan")).toEqual(["Eva Stan"]);
    // The parent who signed for a minor finds the minor's row: every name the row draws is searched.
    expect(await names("maria")).toEqual(["Radu Dinu"]);
    expect(await names("12")).toEqual(["Ștefan Tănase"]);
    // «012» as a padded bib prints it is the number 12.
    expect(await names("012")).toEqual(["Ștefan Tănase"]);
    // A retired number still answers (§311); a restart's kept one shows nowhere and answers to nothing.
    expect(await names("31")).toEqual(["Eva Stan"]);
    expect(await names("40")).toEqual([]);
    expect(await names("")).toHaveLength(7);
  });

  it("opens every fold it found somebody in, keeps the count of the whole event, and says when nobody matches", async () => {
    await morning();
    const found = await page({ q: "e" });
    expect(foldsOf(found).map((fold) => [fold.key, fold.open])).toEqual([
      ["confirmed", true],
      ["unsigned", true],
      ["voided", true],
    ]);
    expect(countOf(found)).toBe("6 declarații semnate");
    const nobody = await page({ q: "nimeni" });
    expect(foldsOf(nobody)).toEqual([]);
    expect(words(nobody)).toContain("Nimeni nu se potrivește.");
    expect(countOf(nobody)).toBe("6 declarații semnate");
    // What was typed stays in the box, for the next press.
    expect(nobody).toMatch(/<input[^>]*name="q"[^>]*value="nimeni"|<input[^>]*value="nimeni"[^>]*name="q"/);
  });
});

describe("§1018 «Declarații» — light", () => {
  it("sends the same statements for a race of seven declarations as for one of forty: one read for the rows, never one per row", async () => {
    await morning();
    const statements = async () => (await statementsOf(db, () => page())).filter((text) => !text.includes('from "platform_settings"'));
    const few = await statements();
    expect(few.filter((text) => text.includes('from "declaration_acceptances"'))).toHaveLength(1);
    for (let index = 0; index < 33; index += 1) {
      const id = await runner(`Alergătoare ${index}`, 200 + index, index % 3 === 0 ? { guardianName: `Părinte ${index}` } : {});
      await signed(id, `Alergătoare ${index}`, index % 3 === 0 ? { minorTypedName: `Alergătoare ${index}` } : index % 3 === 1 ? { method: "PAPER", attestedByStaffUserId: org1.id, idDocument: null } : {});
    }
    expect((await statements()).length).toBe(few.length);
  });
});

describe("§1018 «Declarații» — in English", () => {
  it("speaks English on the English page", async () => {
    await morning();
    state.locale = "en";
    const markup = await page();
    expect(words(markup)).toContain("Signed declarations");
    expect(countOf(markup)).toBe("6 signed declarations");
    expect(foldsOf(markup).map((fold) => fold.title)).toEqual(["Confirmed (4)", "To sign again (1)", "Cancelled or expired (1)"]);
    expect(rowOf(markup, people.stefan).words).toContain("version 3 · on paper, recorded by Org1 · Fingerprint:");
    expect(rowOf(markup, people.radu).words).toContain("— Radu Dinu (the minor) · Maria Dinu (the parent or guardian) version 3");
    expect(rowOf(markup, people.ana).words).toContain(`Signed ${signedAt(new Date("2099-11-14T16:00:00.000Z"), "en")} — Ana Pop`);
    expect(rowOf(markup, people.ana).words).toContain("Declaration (PDF) Registration page");
    expect(rowOf(markup, people.ana).markup).toMatch(new RegExp(`href="/en/admin/registrations/${people.ana}"`));
  });
});
