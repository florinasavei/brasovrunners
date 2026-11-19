import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listDeskRegistrations } from "@/modules/registrations/admin-repository";
import { hasOneBib, oneBibFileName, oneBibHref } from "@/modules/registrations/domain/one-bib";
import { resolveDisplayName } from "@/modules/registrations/names";
import { STAFF_ROLES, canReadRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * One person's race number, downloaded on its own (§980; the owner, 2026-11-18: «eu trebuie să pot descărca un BIB doar
 * pentru o persoană»; BR-REQ-038-01, BR-REQ-060-01):
 *
 * - the sheet's route with `registrationId` prints exactly that registration's bib in its own style — the elite bib with
 *   its label where the number goes, the members' design, the ordinary bib — one to a page, whatever else the query says,
 *   named `bib-<number>.pdf` (`-elite`; the event's slug with no number), for the Organizer and the Administrators alone,
 *   writing nothing; another event's, an unknown, a malformed id and a test row are 404, no bib yet is 409 `NO_BIB_NUMBER`;
 * - «Descarcă BIB-ul (PDF)» on the registration's page, in the desk row's BIB fold and in the list's «⋮» exactly where the
 *   route prints a bib, for a role that reads the registrations, in a new tab, a 44-pixel target.
 *
 * Read from a real database (PGlite); the pages are Server Components, called and their element trees walked.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "string" ? state.locale : arg.locale;
    const namespace = typeof arg === "string" ? arg : arg.namespace;
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
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  createRegistrationAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationEliteBibLabelAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  setRegistrationRaffleAction: vi.fn(),
  deleteSponsorListRecordAction: vi.fn(),
  turnRunnerIntoVolunteerAction: vi.fn(),
  turnVolunteerIntoRunnerAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  undoCheckInAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { GET: sheet } = await import("@/app/api/admin/events/[id]/bibs/route");
const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");

type Props = Record<string, unknown> & { children?: ReactNode };
type MenuItem = { kind: string; label: string; icon: string; href?: string; newTab?: boolean };

/** Every element under `node`, depth first, through `children` only — what the page itself wrote. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

const NOW = new Date("2026-11-18T10:00:00.000Z");
const MEMBER_LABEL = "Club members";
const READERS = STAFF_ROLES.filter((role) => canReadRegistrations(role));
const OTHERS = STAFF_ROLES.filter((role) => !canReadRegistrations(role));

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  eventId = await race();
});

async function race(slug = "crosul-tampei"): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      locationName: "Start",
      bibDesign: { member: { enabled: true, bandColour: "#6a1b9a", label: MEMBER_LABEL } },
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${slug}-${serial}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: "The cross" },
  ]);
  return event.id;
}

/** A runner of an event: confirmed with the given number unless told otherwise. */
async function runner(
  name: string,
  options: Partial<typeof registrations.$inferInsert> & { at?: string } = {},
): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  const { at, ...row } = options;
  const status = row.status ?? "CONFIRMED";
  const [created] = await db
    .insert(registrations)
    .values({
      eventId: at ?? eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      firstName: name.split(" ")[0],
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...row,
      status,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function as(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  state.actor = user;
  return user;
}

const get = (query: string, event = eventId) =>
  sheet(new Request(`http://localhost/api/admin/events/${event}/bibs?${query}`), { params: Promise.resolve({ id: event }) });

/** Every string the sheet hands pdfkit's `text`, with the box it was given — an elite name is set with no width. */
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

/** The route's answer and what it drew. */
async function download(query: string, event = eventId) {
  let response: Response | undefined;
  const drawn = await drawnTexts(async () => {
    response = await get(query, event);
  });
  const pdf = response?.status === 200 ? Buffer.from(await response.arrayBuffer()) : null;
  return { response: response as Response, drawn: drawn.map((run) => run.text), runs: drawn, pdf };
}

describe("§980 the route prints one registration's bib in its own style", () => {
  it("prints an ordinary bib alone — its number and its name — one A5 on its own A4, named by its number", async () => {
    await as("MODERATOR");
    const ion = await runner("Ion Ionescu", { bibNumber: 12 });
    await runner("Maria Pop", { bibNumber: 13 });
    const { response, drawn, runs, pdf } = await download(`locale=ro&registrationId=${ion}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain('filename="bib-12.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(pages(pdf!)).toBe(1);
    expect(drawn).toContain("12");
    expect(runs.find((run) => run.text === "Ion Ionescu")?.width).toBeGreaterThan(0);
    // Nobody else's bib, and not the members' design.
    expect(drawn).not.toContain("13");
    expect(drawn).not.toContain("Maria Pop");
    expect(drawn).not.toContain(MEMBER_LABEL);
  });

  it("prints a member's bib in the members' design (§681, §972)", async () => {
    await as("ADMIN");
    const member = await runner("Ana Pop", { bibNumber: 14, clubMemberDeclared: true });
    const { response, drawn } = await download(`locale=ro&registrationId=${member}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="bib-14.pdf"');
    expect(drawn).toContain(MEMBER_LABEL);
    expect(drawn).toContain("14");
  });

  it("prints an elite registration's elite bib — its label where the number goes, never the number — named «-elite»", async () => {
    await as("ADMIN");
    // A member too: the elite mark wins, never the members' design (§897).
    const elite = await runner("Dana Radu", { bibNumber: 15, elite: true, clubMemberDeclared: true });
    const { response, runs, drawn, pdf } = await download(`locale=ro&registrationId=${elite}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="bib-15-elite.pdf"');
    expect(pages(pdf!)).toBe(1);
    // The first name alone by default (§948), set with no width as an elite name is.
    expect(runs.filter((run) => run.text === "Dana")).toEqual([{ text: "Dana", width: undefined }]);
    expect(drawn).not.toContain("15");
    expect(drawn).not.toContain("Dana Radu");
    expect(drawn).not.toContain(MEMBER_LABEL);

    // The label the Administrator typed (§975), when there is one.
    await db.update(registrations).set({ eliteBibLabel: "D. RADU" }).where(eq(registrations.id, elite));
    const labelled = await download(`locale=ro&registrationId=${elite}`);
    expect(labelled.drawn).toContain("D. RADU");
    expect(labelled.drawn).not.toContain("Dana");
  });

  it("prints an elite registration with no number yet, named by the event's slug", async () => {
    await as("ADMIN");
    const elite = await runner("Dana Radu", { elite: true, bibNumber: null });
    const { response, drawn } = await download(`locale=ro&registrationId=${elite}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/filename="bib-crosul-tampei-\d+-elite\.pdf"/);
    expect(drawn).toContain("Dana");
  });

  it("writes the number as the event writes it (§735)", async () => {
    await as("ADMIN");
    await db.update(events).set({ bibDesign: { numberFormat: "pad3" } }).where(eq(events.id, eventId));
    const ion = await runner("Ion Ionescu", { bibNumber: 7 });
    const { response, drawn } = await download(`locale=en&registrationId=${ion}`);
    expect(response.headers.get("content-disposition")).toContain('filename="bib-007.pdf"');
    expect(drawn).toContain("007");
  });

  it("ignores whatever else the query says: still that one bib, one to a page, the same name", async () => {
    await as("ADMIN");
    const ion = await runner("Ion Ionescu", { bibNumber: 12 });
    await runner("Maria Pop", { bibNumber: 13 });
    for (const extra of ["elite=1", "spares=1&from=1&to=50", "blank=3", "only=unprinted&part=others&layout=two", "from=abc&blank=99999"]) {
      const { response, drawn, pdf } = await download(`locale=ro&${extra}&registrationId=${ion}`);
      expect(response.status, extra).toBe(200);
      expect(response.headers.get("content-disposition"), extra).toContain('filename="bib-12.pdf"');
      expect(pages(pdf!), extra).toBe(1);
      expect(drawn, extra).toContain("Ion Ionescu");
      expect(drawn, extra).not.toContain("13");
    }
  });

  it("writes nothing — no printed mark, no state, no trail", async () => {
    await as("ADMIN");
    const ion = await runner("Ion Ionescu", { bibNumber: 12 });
    const elite = await runner("Dana Radu", { bibNumber: 15, elite: true });
    const before = await db.select().from(registrations);
    for (const id of [ion, elite]) expect((await get(`locale=ro&registrationId=${id}`)).status).toBe(200);
    expect(await db.select().from(registrations)).toEqual(before);
    expect(before.every((row) => row.bibPrintedAt === null)).toBe(true);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });
});

describe("§980 the route's refusals", () => {
  it("is not found for another event's registration, an unknown id, a malformed one and a test row — as JSON", async () => {
    await as("ADMIN");
    const elsewhere = await runner("Ion Ionescu", { bibNumber: 12, at: await race("alta") });
    const test = await runner("Test Runner", { bibNumber: 20, kind: "TEST" });
    for (const id of [elsewhere, "00000000-0000-4000-8000-000000000000", "not-a-uuid", "", test]) {
      const { response, drawn } = await download(`locale=ro&registrationId=${id}`);
      expect(response.status, id).toBe(404);
      expect(await response.json()).toEqual({ error: "NOT_FOUND" });
      expect(drawn, id).toEqual([]);
    }
  });

  it("is a conflict for a registration with no bib yet: no number and no elite mark, or not confirmed", async () => {
    await as("ADMIN");
    const unnumbered = await runner("Ion Ionescu", { bibNumber: null });
    const waiting = await runner("Maria Pop", { status: "WAITLISTED", elite: true });
    const cancelled = await runner("Radu Stan", { status: "CANCELLED", bibNumber: 9 });
    for (const id of [unnumbered, waiting, cancelled]) {
      const { response, drawn } = await download(`locale=ro&registrationId=${id}`);
      expect(response.status, id).toBe(409);
      expect(await response.json()).toEqual({ error: "NO_BIB_NUMBER" });
      expect(drawn, id).toEqual([]);
    }
  });

  it("answers the Organizer and the Administrators, and refuses every other role as the sheet does (BR-REQ-060-01)", async () => {
    const ion = await runner("Ion Ionescu", { bibNumber: 12 });
    for (const role of READERS) {
      await as(role);
      expect((await get(`locale=ro&registrationId=${ion}`)).status, role).toBe(200);
    }
    expect(OTHERS.length).toBeGreaterThan(0);
    for (const role of OTHERS) {
      await as(role);
      const { response, drawn } = await download(`locale=ro&registrationId=${ion}`);
      expect(response.status, role).toBe(403);
      expect(drawn, role).toEqual([]);
    }
  });
});

describe("§980 where the bib is drawn and named, decided once", () => {
  it("has a bib exactly when the route prints one", () => {
    const base = { status: "CONFIRMED" as const, kind: "REAL" as const, bibNumber: 12, elite: false };
    expect(hasOneBib(base)).toBe(true);
    expect(hasOneBib({ ...base, bibNumber: null })).toBe(false);
    expect(hasOneBib({ ...base, bibNumber: null, elite: true })).toBe(true);
    expect(hasOneBib({ ...base, kind: "TEST" })).toBe(false);
    expect(hasOneBib({ ...base, status: "CANCELLED" })).toBe(false);
    expect(hasOneBib({ ...base, status: "WAITLISTED", elite: true })).toBe(false);
    expect(oneBibHref("e", "r", "en")).toBe("/api/admin/events/e/bibs?locale=en&registrationId=r");
    expect(oneBibFileName({ bibNumber: 42, elite: false }, { slug: "s", numberFormat: "pad4" })).toBe("bib-0042.pdf");
    expect(oneBibFileName({ bibNumber: null, elite: true }, { slug: "crosul", numberFormat: "plain" })).toBe("bib-crosul-elite.pdf");
  });
});

/** The download button on a tree: the element with its test id. */
const buttons = (all: ReactElement<Props>[]) => all.filter((element) => element.props["data-testid"] === "one-bib-download");

function expectButton(found: ReactElement<Props>[], registrationId: string, label: string) {
  expect(found).toHaveLength(1);
  const [button] = found;
  expect(button.props.href).toBe(oneBibHref(eventId, registrationId, "ro"));
  expect(button.props.icon).toBe("download");
  expect(button.props.target).toBe("_blank");
  expect(button.props.rel).toBe("noopener");
  expect((button.props.sx as { minHeight?: number }).minHeight).toBe(44);
  expect(button.props.children).toBe(label);
}

describe("§980 «Descarcă BIB-ul (PDF)» on the registration's page", () => {
  const detailPage = async (id: string) =>
    elements(await RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never));

  it("sits beside the race number for every role that reads the page, only where the route prints a bib", async () => {
    const numbered = await runner("Ion Ionescu", { bibNumber: 12 });
    const elite = await runner("Dana Radu", { elite: true, bibNumber: null });
    const unnumbered = await runner("Maria Pop", { bibNumber: null });
    const test = await runner("Test Runner", { bibNumber: 20, kind: "TEST" });
    const cancelled = await runner("Radu Stan", { status: "CANCELLED", bibNumber: 9 });
    for (const role of READERS) {
      await as(role);
      expectButton(buttons(await detailPage(numbered)), numbered, ro.Admin.registrations.oneBib.download);
      expectButton(buttons(await detailPage(elite)), elite, ro.Admin.registrations.oneBib.download);
      for (const id of [unnumbered, test, cancelled]) expect(buttons(await detailPage(id)), `${role} ${id}`).toHaveLength(0);
    }
    // The range of one it replaced is gone.
    const all = await detailPage(numbered);
    expect(all.some((element) => String(element.props.href ?? "").includes("&from="))).toBe(false);
    state.locale = "en";
    expect(buttons(await detailPage(numbered))[0].props.children).toBe(en.Admin.registrations.oneBib.download);
  });
});

describe("§980 «Descarcă BIB-ul (PDF)» in the desk row's BIB fold", () => {
  const deskRow = async (id: string, role?: StaffRole) => {
    const row = (await listDeskRegistrations(db, { eventId, query: "", locale: "ro" })).find((candidate) => candidate.id === id);
    expect(row, id).toBeDefined();
    return elements(await DeskRow({ row: row!, locale: "ro", back: "desk", eventId, minorSigns: { ro: false, en: false }, ...(role ? { role } : {}) }));
  };
  const pictures = (all: ReactElement<Props>[]) => all.filter((element) => element.type === "img");

  it("is beside the picture for a role that reads the registrations; the desk's other roles see the picture alone", async () => {
    const numbered = await runner("Ion Ionescu", { bibNumber: 12 });
    const elite = await runner("Dana Radu", { bibNumber: 15, elite: true });
    for (const role of READERS) {
      for (const id of [numbered, elite]) {
        const all = await deskRow(id, role);
        expect(pictures(all), role).toHaveLength(1);
        expectButton(buttons(all), id, ro.Admin.registrations.oneBib.download);
      }
    }
    for (const role of OTHERS) {
      const all = await deskRow(numbered, role);
      expect(pictures(all), role).toHaveLength(1);
      expect(buttons(all), role).toHaveLength(0);
    }
    // No role given: the row as it always was.
    expect(buttons(await deskRow(numbered))).toHaveLength(0);
  });

  it("is not drawn where there is no fold: no number yet, an elite mark included", async () => {
    await as("ADMIN");
    const unnumbered = await runner("Maria Pop", { bibNumber: null });
    const eliteUnnumbered = await runner("Dana Radu", { elite: true, bibNumber: null });
    for (const id of [unnumbered, eliteUnnumbered]) expect(buttons(await deskRow(id, "ADMIN")), id).toHaveLength(0);
  });
});

describe("§980 «Descarcă BIB-ul» in the registrations list's «⋮»", () => {
  const listPage = async () =>
    AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId }) } as never);
  const menuItems = (tree: ReactNode, id: string) => {
    const table = elements(tree).find((element) => element.type === AdminTable);
    const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
    const cell = row ? elements((table?.props.rowActions as (row: { id: string }) => ReactNode)(row)) : [];
    return (cell.find((element) => Array.isArray(element.props.items))?.props.items ?? []) as MenuItem[];
  };
  const bibItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.icon === "download");

  it("offers the row's bib, in a new tab, for every role that reads the list — only on a row the route prints", async () => {
    const numbered = await runner("Ion Ionescu", { bibNumber: 12 });
    const elite = await runner("Dana Radu", { elite: true, bibNumber: null });
    const unnumbered = await runner("Maria Pop", { bibNumber: null });
    const waiting = await runner("Ana Pop", { status: "WAITLISTED", elite: true });
    const test = await runner("Test Runner", { bibNumber: 20, kind: "TEST" });
    for (const role of READERS) {
      await as(role);
      const tree = await listPage();
      for (const id of [numbered, elite]) {
        expect(bibItems(tree, id), `${role} ${id}`).toEqual([
          { kind: "link", icon: "download", label: ro.Admin.registrations.oneBib.menu, href: oneBibHref(eventId, id, "ro"), newTab: true },
        ]);
      }
      for (const id of [unnumbered, waiting, test]) expect(bibItems(tree, id), `${role} ${id}`).toEqual([]);
    }
    state.locale = "en";
    await as("ADMIN");
    expect(bibItems(await listPage(), numbered)[0]?.label).toBe(en.Admin.registrations.oneBib.menu);
  });
});

/**
 * §995 — the identity document on the desk row (the owner, 2026-11-19: «Nu e ok că afișăm info din buletin (codul de buletin)
 * pentru voluntari»): drawn for a role that reads the registrations — the Organizer and the Administrators — and for no other
 * desk role, nor for a row drawn with no role; a minor's two documents the same way. The row is a Server Component, so the
 * document is absent from what the other roles' browsers receive.
 */
describe("§995 the desk row's identity document, by role", () => {
  const deskRowWith = async (id: string, documents: { idDocument: string | null; minorIdDocument?: string | null; guardianName?: string | null }, role?: StaffRole) => {
    const row = (await listDeskRegistrations(db, { eventId, query: "", locale: "ro" })).find((candidate) => candidate.id === id);
    expect(row, id).toBeDefined();
    return elements(await DeskRow({ row: { ...row!, ...documents }, locale: "ro", back: "desk", eventId, minorSigns: { ro: false, en: false }, ...(role ? { role } : {}) }));
  };
  const textOf = (all: ReactElement<Props>[]) =>
    all
      .flatMap((element) => (Array.isArray(element.props.children) ? element.props.children : [element.props.children]))
      .filter((child): child is string => typeof child === "string")
      .join(" ");

  it("says the document to the Organizer and the Administrators, and to no other desk role", async () => {
    const adult = await runner("Ion Ionescu", { bibNumber: 12 });
    for (const role of READERS) {
      const said = textOf(await deskRowWith(adult, { idDocument: "BV 654321" }, role));
      expect(said, role).toContain(ro.Admin.desk.idDocument);
      expect(said, role).toContain("BV 654321");
    }
    for (const role of OTHERS) {
      const said = textOf(await deskRowWith(adult, { idDocument: "BV 654321" }, role));
      expect(said, role).not.toContain("BV 654321");
      expect(said, role).not.toContain(ro.Admin.desk.idDocument);
    }
    // No role given: nothing.
    expect(textOf(await deskRowWith(adult, { idDocument: "BV 654321" }))).not.toContain("BV 654321");
    // The desk's volunteers are among the others.
    expect(OTHERS).toContain("CONTRIBUTOR");
  });

  it("says a minor's two documents to a reader alone", async () => {
    const minor = await runner("Maria Popescu", { bibNumber: 13 });
    const documents = { idDocument: "BV 654321", minorIdDocument: "MP 123456", guardianName: "Ion Popescu" };
    const reader = textOf(await deskRowWith(minor, documents, "MODERATOR"));
    expect(reader).toContain("MP 123456");
    expect(reader).toContain("BV 654321");
    for (const role of OTHERS) {
      const said = textOf(await deskRowWith(minor, documents, role));
      expect(said, role).not.toContain("MP 123456");
      expect(said, role).not.toContain("BV 654321");
    }
  });
});
