import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { countDesk } from "@/modules/registrations/admin-repository";
import { CHECKIN_CODE_ALPHABET } from "@/modules/registrations/checkin-code";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { type FoldOpenWhen, opensByItself } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-08 (criteria 3, 4, 8), `DECISIONS.md` §1002 — the desk's list in folding sections, one per state (the owner,
 * 2026-11-19: «Pe ziua cursei trebuie să fac secțiuni collapsible în funcție de status»), as the server draws the page on a
 * real database (PGlite): the seven sections in the table's working order, each a level-3 fold whose summary says its words and
 * the count of its real rows, open or closed as decided, the empty ones absent, each section's rows in the list's own order; every
 * row of a race bigger than a screenful, none cut by name, so the sections' numbers add up to the counters; a search drawing only
 * the sections it found somebody in, each open; a typed code drawing its one runner alone; the counters above the list as they
 * were; a race that is over folding the same, with no verb; and both languages.
 *
 * And the way back, through the real actions: each press on a row — «Marchează prezent», «Anulează prezența», «Salvează nr.»,
 * «Confirmă pe hârtie», «Elită și BIB», and the walk-in's «Adaugă înscrierea» — comes back with the row in the address (`row=`)
 * and lands on it (`#reg-<id>`), and the page drawn for that address holds the row in the section its new state put it in,
 * open — a check-in in «Prezenți», a paper confirmation on a full race in «Pe lista de așteptare».
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", flashed: [] as unknown[], overEvent: null as unknown }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "string" ? state.locale : arg.locale;
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  getMessages: async () => (state.locale === "ro" ? ro : en),
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    const { DomainError } = await import("@/shared/errors/domain-error");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
// The toast each press writes: recorded, since a test has no response to carry the cookie.
vi.mock("@/shared/feedback/flash", () => ({
  flashOutcome: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
  flash: async (notice: unknown) => {
    state.flashed.push(notice);
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
/*
  The desk's event select lists the events still SCHEDULED, which a race marked over (§82) is not: the page's closed branch is
  drawn for a chosen event that is over, so the closed desk's test hands the page that race through the reader the select uses.
  Every other test reads the real list.
*/
vi.mock("@/modules/registrations/admin-repository", async (original) => {
  const actual = await original<typeof import("@/modules/registrations/admin-repository")>();
  return {
    ...actual,
    listEventsAcceptingRegistrations: async (...args: Parameters<typeof actual.listEventsAcceptingRegistrations>) => {
      const listed = await actual.listEventsAcceptingRegistrations(...args);
      const over = state.overEvent as Awaited<ReturnType<typeof actual.listEventsAcceptingRegistrations>>[number] | null;
      return over ? [over, ...listed] : listed;
    },
  };
});

const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");
const { checkInAction, confirmRegistrationNowAction, createRegistrationAction, setBibNumberAction, setRegistrationEliteAction } = await import(
  "@/app/[locale]/admin/registrations/actions"
);

const NOW = new Date("2026-11-19T10:00:00.000Z");
const FAR = new Date("2099-11-01T10:00:00.000Z");
const HERE = new Date("2026-11-19T09:30:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
let eventId: string;

async function approveDocuments() {
  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await approveDocuments();
  state.locale = "ro";
  state.flashed = [];
  state.overEvent = null;
  state.actor = await staff("CONTRIBUTOR");
  eventId = await race();
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@example.test`, displayName: `Ana ${role}`, role }).returning();
  return user;
}

/** A race far ahead, taking entries on the site: the desk falls back to every event taking entries and picks it. */
async function race(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: FAR,
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Start",
      capacity: 50,
      bibStartNumber: 1,
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  return event.id;
}

/** A desk code from the desk's alphabet (no 0/O/1/I), one per runner — 1024 of them, so a race of a few hundred has one each. */
const deskCode = (n: number) => `DESKRUNR${CHECKIN_CODE_ALPHABET[Math.floor(n / 32) % 32]}${CHECKIN_CODE_ALPHABET[n % 32]}`;

/**
 * Registrations of the event, one per name, each on its own address, in the state asked, with the columns that state carries:
 * two statements however many — a race bigger than a screenful is a few hundred rows. `over(index)` adds the columns of one.
 */
async function registerMany(
  names: readonly string[],
  status: RegistrationStatus,
  over: (index: number) => Partial<typeof registrations.$inferInsert> = () => ({}),
): Promise<string[]> {
  const people = names.map((name) => {
    serial += 1;
    return { name, n: serial, email: `runner${serial}@example.org` };
  });
  const addresses = await db
    .insert(participants)
    .values(
      people.map(({ name, email }): typeof participants.$inferInsert => ({
        deliveryEmail: email,
        normalizedEmail: email,
        canonicalEmail: email,
        canonicalizationVersion: 2,
        defaultName: name,
        preferredLocale: "ro",
      })),
    )
    .returning({ id: participants.id, email: participants.deliveryEmail });
  const addressOf = new Map(addresses.map((address) => [address.email, address.id]));
  const rows = await db
    .insert(registrations)
    .values(
      people.map(({ name, n, email }, index): typeof registrations.$inferInsert => {
        const [first, ...rest] = name.split(" ");
        return {
          eventId,
          participantId: addressOf.get(email) as string,
          kind: "REAL",
          locale: "ro",
          registeredName: name,
          firstName: first,
          lastName: rest.join(" "),
          displayName: resolveDisplayName({ legalName: name }),
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          status,
          emailConfirmedAt: status === "PENDING_EMAIL_CONFIRMATION" ? null : NOW,
          confirmedAt: status === "CONFIRMED" ? NOW : null,
          checkinCode: status === "CONFIRMED" ? deskCode(n) : null,
          waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? NOW : null,
          holdExpiresAt: status === "WAITLIST_OFFERED" || status === "PENDING_DECLARATION" ? FAR : null,
          cancelledAt: status === "CANCELLED" ? NOW : null,
          cancellationSource: status === "CANCELLED" ? "ADMIN" : null,
          expiredAt: status === "EXPIRED" ? NOW : null,
          expiryReason: status === "EXPIRED" ? "EVENT_STARTED" : null,
          ...over(index),
        };
      }),
    )
    .returning({ id: registrations.id, name: registrations.registeredName });
  const idOf = new Map(rows.map((row) => [row.name, row.id]));
  return names.map((name) => idOf.get(name) as string);
}

/** One registration of the event, in the state asked, with the columns that state carries. */
async function register(name: string, status: RegistrationStatus, over: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  const [id] = await registerMany([name], status, () => over);
  return id;
}

/** `count` names that sort in their own order: «Zeno Ridică 001» … «Zeno Ridică 100». */
const numbered = (name: string, count: number) => Array.from({ length: count }, (_, index) => `${name} ${String(index + 1).padStart(3, "0")}`);

/** One of each state, named so a list by name would interleave them; the confirmed ones numbered 1, 2, 3 in that order. */
async function saturday() {
  return {
    ana: await register("Ana Pop", "CONFIRMED", { bibNumber: 1 }),
    bogdan: await register("Bogdan Pop", "CONFIRMED", { bibNumber: 2 }),
    cristina: await register("Cristina Ionescu", "PENDING_DECLARATION"),
    dan: await register("Dan Pop", "CONFIRMED", { bibNumber: 3, checkedInAt: HERE }),
    elena: await register("Elena Marin", "PENDING_EMAIL_CONFIRMATION"),
    florin: await register("Florin Stan", "WAITLIST_OFFERED"),
    gina: await register("Gina Pop", "WAITLISTED"),
    horia: await register("Horia Dobre", "WAITLISTED"),
    // Over, wearing a number: on the list only when that number is typed (criterion 8).
    ion: await register("Ion Retras", "CANCELLED", { bibNumber: 9 }),
  };
}

type Props = Record<string, unknown> & { children?: ReactNode };

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

const desk = async (query: Record<string, string> = {}) => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) } as never);

const panels = (tree: ReactNode) => elements(tree).filter((element) => element.type === Panel && String(element.props["data-testid"] ?? "").startsWith("desk-section-"));

/** The sections as the page drew them: the key, the summary's words, whether the fold is open, the names of its rows. */
const sectionsOf = (tree: ReactNode) =>
  panels(tree).map((panel) => ({
    key: String(panel.props["data-testid"]).slice("desk-section-".length),
    title: panel.props.title as string,
    open: opensByItself(panel.props.openWhen as FoldOpenWhen),
    rows: elements(panel.props.children).filter((element) => element.type === DeskRow).map((element) => (element.props.row as { registeredName: string }).registeredName),
  }));

const deskRows = (tree: ReactNode) => elements(tree).filter((element) => element.type === DeskRow);

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

/** The address a press redirected to. */
async function redirectedTo(pressed: Promise<unknown>): Promise<URL> {
  try {
    await pressed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT ")) return new URL(message.slice("REDIRECT ".length), "https://example.test");
    throw error;
  }
  throw new Error("the press returned a state instead of redirecting");
}

/** The desk drawn for the address a press came back to. */
const deskAt = (to: URL) => desk(Object.fromEntries(to.searchParams));

/** Came back to the desk, its event, its search, the row in the address and the fragment on the row. */
function expectBackOnTheRow(to: URL, id: string, saved: string, q?: string) {
  expect(to.pathname).toBe("/ro/admin/checkin");
  expect(to.hash).toBe(`#reg-${id}`);
  expect(Object.fromEntries(to.searchParams)).toEqual({ eventId, ...(q ? { q } : {}), row: id, saved });
}

describe("§1002 BR-REQ-037-08 the desk's list in sections, one per state", () => {
  it("draws the sections in the table's working order, «<words> (N)», open or closed as decided, each section's rows by race number, the rows without one by name", async () => {
    await saturday();
    expect(sectionsOf(await desk())).toEqual([
      { key: "toPickUp", title: "De ridicat numărul (2)", open: true, rows: ["Ana Pop", "Bogdan Pop"] },
      { key: "unsigned", title: "Fără declarație semnată (1)", open: true, rows: ["Cristina Ionescu"] },
      { key: "checkedIn", title: "Prezenți (1)", open: false, rows: ["Dan Pop"] },
      { key: "addressUnconfirmed", title: "Adresă neconfirmată (1)", open: false, rows: ["Elena Marin"] },
      { key: "offered", title: "Ofertă de loc deschisă (1)", open: false, rows: ["Florin Stan"] },
      { key: "waitlisted", title: "Pe lista de așteptare (2)", open: false, rows: ["Gina Pop", "Horia Dobre"] },
    ]);
  });

  it("draws each section as the house's fold: a level-3 heading with its glyph in a 44-pixel summary, `open` on the `<details>` as decided", async () => {
    await saturday();
    const tree = await desk();
    const raw = (key: string) => {
      const panel = panels(tree).find((element) => element.props["data-testid"] === `desk-section-${key}`) as ReactElement<Props>;
      // The rows are async Server Components a synchronous render cannot draw: the fold alone, with an empty list.
      return renderToStaticMarkup(withClientWords(cloneElement(panel, {}, createElement("ul")), "ro"));
    };
    /** The markup without Emotion's style tags, whose CSS would otherwise stand between the elements. */
    const drawn = (key: string) => raw(key).replace(/<style[\s\S]*?<\/style>/g, "");
    const pickUp = drawn("toPickUp");
    expect(pickUp).toMatch(/<details[^>]* id="desk-section-toPickUp"[^>]*open=""/);
    expect(pickUp).toMatch(/<summary[^>]*><h3[^>]*><svg[^>]*aria-hidden="true"[^>]*data-testid="ConfirmationNumberIcon"[^>]*>[\s\S]*?<\/svg>De ridicat numărul \(2\)<\/h3><\/summary>/);
    // The summary is a thumb's target (BR-REQ-041-01 criterion 6): the boxed fold's 44 pixels.
    expect(raw("toPickUp")).toMatch(/>summary\{[^}]*min-height:44px/);
    // A closed one carries no `open`, and each wears its state's picture.
    const present = drawn("checkedIn");
    expect(present).not.toMatch(/<details[^>]*open=""/);
    expect(present).toContain('data-testid="HowToRegIcon"');
    expect(drawn("unsigned")).toContain('data-testid="DrawIcon"');
    expect(drawn("addressUnconfirmed")).toContain('data-testid="MailIcon"');
    expect(drawn("offered")).toContain('data-testid="EventSeatIcon"');
    expect(drawn("waitlisted")).toContain('data-testid="HourglassTopIcon"');
  });

  it("leaves out a section with no rows: a race of runners still to pick up and the present draws those two alone", async () => {
    await register("Ana Pop", "CONFIRMED", { bibNumber: 1 });
    await register("Dan Pop", "CONFIRMED", { bibNumber: 3, checkedInAt: HERE });
    expect(sectionsOf(await desk()).map((section) => [section.key, section.title, section.open])).toEqual([
      ["toPickUp", "De ridicat numărul (1)", true],
      ["checkedIn", "Prezenți (1)", false],
    ]);
    // Nobody at all: the sentence it always said, and no section.
    await db.delete(registrations);
    const empty = await desk();
    expect(panels(empty)).toEqual([]);
    expect(elements(empty).some((element) => element.props.children === ro.Admin.desk.nobody)).toBe(true);
  });

  it("counts the real rows only, as the counters above do (§30): a test registration is drawn in its section and not counted", async () => {
    await saturday();
    await register("Ana Test", "CONFIRMED", { bibNumber: 20, kind: "TEST" });
    const tree = await desk();
    // By race number (§1013): Ana 1, Bogdan 2, the test row 20.
    expect(sectionsOf(tree)[0]).toEqual({ key: "toPickUp", title: "De ridicat numărul (2)", open: true, rows: ["Ana Pop", "Bogdan Pop", "Ana Test"] });
    // The counters stand above the list as they were: the event's real rows, whatever the list folds.
    const counts = await countDesk(db, eventId);
    expect(counts).toEqual({ confirmed: 3, checkedIn: 1, withoutBib: 0, pending: 5 });
    const labels = elements(tree).map((element) => element.props.label).filter((label): label is string => typeof label === "string");
    expect(labels).toEqual(expect.arrayContaining(["Confirmați: 3", "Prezenți: 1", "Neconfirmați: 5"]));
  });

  it("lists the elites first, then the partners' runners with their partner's name, then everybody else — each by race number, the rows without one by name (§1013)", async () => {
    // Numbers that a list by number alone would put in another order: the elite wears 50, the partner's runners 30 and 7.
    await register("Zoe Elita", "CONFIRMED", { bibNumber: 50, elite: true });
    await register("Radu Partener", "CONFIRMED", { bibNumber: 30, partnerName: "Onlypus" });
    await register("Ilie Partener", "CONFIRMED", { bibNumber: 7, partnerName: "Regalina" });
    await register("Ana Obisnuit", "CONFIRMED", { bibNumber: 3 });
    await register("Bogdan Obisnuit", "CONFIRMED", { bibNumber: 12 });
    const tree = await desk();
    expect(sectionsOf(tree)[0]).toEqual({
      key: "toPickUp",
      title: "De ridicat numărul (5)",
      open: true,
      rows: ["Zoe Elita", "Ilie Partener", "Radu Partener", "Ana Obisnuit", "Bogdan Obisnuit"],
    });
    // The partner's name on the row, as the registrations list says it; nobody else's row has a partner chip.
    const rows = deskRows(tree);
    const chipOf = (name: string) => {
      const row = rows.find((element) => (element.props.row as { registeredName: string }).registeredName === name);
      return (row?.props.row as { partnerName: string | null }).partnerName;
    };
    expect(chipOf("Radu Partener")).toBe("Onlypus");
    expect(chipOf("Ilie Partener")).toBe("Regalina");
    expect(chipOf("Ana Obisnuit")).toBeNull();
  });

  it("draws every row of a race bigger than a screenful, none cut by name: «De ridicat numărul (N)» and «Prezenți (N)» add up to «Confirmați»", async () => {
    // A full race — 110 confirmed, four declarations' holds and two open offers on its 116 places — with three addresses still
    // to confirm and 120 waiting: 239 rows not over. By name the runners still to pick up come last: the cut at 200 rows by name
    // the list had took 39 of them out of «De ridicat numărul» and said «(61)».
    await db.update(events).set({ capacity: 116 }).where(eq(events.id, eventId));
    await registerMany(numbered("Ana Așteaptă", 120), "WAITLISTED");
    await registerMany(numbered("Bianca Semnează", 4), "PENDING_DECLARATION");
    await registerMany(numbered("Corina Adresă", 3), "PENDING_EMAIL_CONFIRMATION");
    await registerMany(numbered("Dora Ofertă", 2), "WAITLIST_OFFERED");
    await registerMany(numbered("Mara Prezentă", 10), "CONFIRMED", (index) => ({ bibNumber: 1 + index, checkedInAt: HERE }));
    await registerMany(numbered("Zeno Ridică", 100), "CONFIRMED", (index) => ({ bibNumber: 11 + index }));
    const tree = await desk();
    const sections = sectionsOf(tree);
    expect(sections.map((section) => [section.key, section.title, section.open, section.rows.length])).toEqual([
      ["toPickUp", "De ridicat numărul (100)", true, 100],
      ["unsigned", "Fără declarație semnată (4)", true, 4],
      ["checkedIn", "Prezenți (10)", false, 10],
      ["addressUnconfirmed", "Adresă neconfirmată (3)", false, 3],
      ["offered", "Ofertă de loc deschisă (2)", false, 2],
      ["waitlisted", "Pe lista de așteptare (120)", false, 120],
    ]);
    // The name that sorts last of the race is there, at the end of its section; every row is drawn once.
    expect(sections[0].rows.at(-1)).toBe("Zeno Ridică 100");
    expect(deskRows(tree)).toHaveLength(239);
    // What the sections say is what the counters above the list say (§30): the confirmed are the ones to pick up and the present,
    // the unconfirmed the four sections of those not confirmed yet.
    const counts = await countDesk(db, eventId);
    expect(counts).toEqual({ confirmed: 110, checkedIn: 10, withoutBib: 0, pending: 129 });
    const labels = elements(tree).map((element) => element.props.label).filter((label): label is string => typeof label === "string");
    expect(labels).toEqual(expect.arrayContaining(["Confirmați: 110", "Prezenți: 10", "Neconfirmați: 129"]));
    const said = (key: string) => Number(/\((\d+)\)$/.exec(sections.find((section) => section.key === key)?.title ?? "")?.[1]);
    expect(said("toPickUp") + said("checkedIn")).toBe(counts.confirmed);
    expect(said("checkedIn")).toBe(counts.checkedIn);
    expect(said("unsigned") + said("addressUnconfirmed") + said("offered") + said("waitlisted")).toBe(counts.pending);
  });

  it("says it in English too", async () => {
    await saturday();
    state.locale = "en";
    expect(sectionsOf(await desk()).map((section) => section.title)).toEqual([
      "To pick up (2)",
      "Declaration not signed (1)",
      "Present (1)",
      "Address not confirmed (1)",
      "Place offered (1)",
      "On the waiting list (2)",
    ]);
  });
});

describe("§1002 BR-REQ-037-08 criterion 4 a search opens the sections it found somebody in; a code draws its runner alone", () => {
  it("a name fragment: only the sections holding a match, each open, the rows in the desk's order", async () => {
    await saturday();
    expect(sectionsOf(await desk({ q: "pop" }))).toEqual([
      { key: "toPickUp", title: "De ridicat numărul (2)", open: true, rows: ["Ana Pop", "Bogdan Pop"] },
      { key: "checkedIn", title: "Prezenți (1)", open: true, rows: ["Dan Pop"] },
      { key: "waitlisted", title: "Pe lista de așteptare (1)", open: true, rows: ["Gina Pop"] },
    ]);
    // The search's results are what they were: the same rows, every one of them drawn.
    expect(deskRows(await desk({ q: "pop" })).map((element) => (element.props.row as { registeredName: string }).registeredName)).toEqual(["Ana Pop", "Bogdan Pop", "Dan Pop", "Gina Pop"]);
  });

  it("a race number: the one runner wearing it, a confirmed one in its section, a cancelled one in «Anulate sau expirate», open (criterion 8)", async () => {
    await saturday();
    expect(sectionsOf(await desk({ q: "3" }))).toEqual([{ key: "checkedIn", title: "Prezenți (1)", open: true, rows: ["Dan Pop"] }]);
    expect(sectionsOf(await desk({ q: "9" }))).toEqual([{ key: "voided", title: "Anulate sau expirate (1)", open: true, rows: ["Ion Retras"] }]);
    // Without its number the cancelled runner is on no section of the list, as before.
    expect(sectionsOf(await desk()).flatMap((section) => section.rows)).not.toContain("Ion Retras");
  });

  it("a typed code: the one runner, no section — as the desk always drew it", async () => {
    await saturday();
    const [{ code }] = await db.select({ code: registrations.checkinCode }).from(registrations).where(eq(registrations.registeredName, "Dan Pop"));
    const tree = await desk({ q: String(code) });
    expect(panels(tree)).toEqual([]);
    expect(deskRows(tree).map((element) => (element.props.row as { registeredName: string }).registeredName)).toEqual(["Dan Pop"]);
    expect(deskRows(tree)[0].props.showEvent).toBe(true);
  });
});

describe("§1002 BR-REQ-037-08 the scanned page is as it was: one runner, no section, its presses back to it", () => {
  it("draws the scanned runner alone, and a press there comes back to the scanned page's alert, with no row in the address", async () => {
    const people = await saturday();
    const [{ code }] = await db.select({ code: registrations.checkinCode }).from(registrations).where(eq(registrations.id, people.ana));
    const tree = await ScannedCodePage({ params: Promise.resolve({ locale: "ro", code: String(code) }), searchParams: Promise.resolve({}) } as never);
    expect(panels(tree)).toEqual([]);
    expect(deskRows(tree).map((element) => [(element.props.row as { registeredName: string }).registeredName, element.props.back])).toEqual([["Ana Pop", "code"]]);
    const to = await redirectedTo(checkInAction(null, form({ registrationId: people.ana, back: "code", code: String(code), direction: "in" })));
    expect(`${to.pathname}${to.search}${to.hash}`).toBe(`/ro/admin/checkin/${code}?saved=checkedIn#admin-alert`);
  });
});

describe("§1002 BR-REQ-037-08 a race that is over folds the same, and offers no verb", () => {
  it("draws the sections, each row read-only", async () => {
    await saturday();
    await db.update(events).set({ eventStatus: "COMPLETED" }).where(eq(events.id, eventId));
    state.overEvent = { id: eventId, title: "Crosul", startsAt: FAR, timezone: "Europe/Bucharest", minAge: 14 };
    const tree = await desk();
    expect(sectionsOf(tree).map((section) => [section.key, section.open])).toEqual([
      ["toPickUp", true],
      ["unsigned", true],
      ["checkedIn", false],
      ["addressUnconfirmed", false],
      ["offered", false],
      ["waitlisted", false],
    ]);
    expect(deskRows(tree).length).toBe(8);
    expect(deskRows(tree).every((element) => element.props.readOnly === true)).toBe(true);
    expect(elements(tree).some((element) => element.props.children === ro.Admin.desk.closed)).toBe(true);
  });
});

describe("§1002 BR-REQ-037-08 the way back: each press comes back to its row, in the section that holds it now, drawn open", () => {
  it("«Marchează prezent»: the row in «Prezenți», opened; «Anulează prezența»: back in «De ridicat numărul»", async () => {
    const people = await saturday();
    const checkedIn = await redirectedTo(checkInAction(null, form({ registrationId: people.ana, back: "desk", eventId, direction: "in" })));
    expectBackOnTheRow(checkedIn, people.ana, "checkedIn");
    expect(state.flashed).toEqual([{ saved: "checkedIn" }]);
    const after = sectionsOf(await deskAt(checkedIn));
    expect(after.find((section) => section.key === "checkedIn")).toEqual({ key: "checkedIn", title: "Prezenți (2)", open: true, rows: ["Ana Pop", "Dan Pop"] });
    expect(after.find((section) => section.key === "toPickUp")).toEqual({ key: "toPickUp", title: "De ridicat numărul (1)", open: true, rows: ["Bogdan Pop"] });
    // Nothing else opened: the waiting list stays shut.
    expect(after.find((section) => section.key === "waitlisted")?.open).toBe(false);

    const undone = await redirectedTo(checkInAction(null, form({ registrationId: people.ana, back: "desk", eventId, direction: "undo" })));
    expectBackOnTheRow(undone, people.ana, "checkinUndone");
    const back = sectionsOf(await deskAt(undone));
    expect(back.find((section) => section.key === "toPickUp")).toEqual({ key: "toPickUp", title: "De ridicat numărul (2)", open: true, rows: ["Ana Pop", "Bogdan Pop"] });
    // «Prezenți» holds nobody the press touched now: closed again.
    expect(back.find((section) => section.key === "checkedIn")).toEqual({ key: "checkedIn", title: "Prezenți (1)", open: false, rows: ["Dan Pop"] });
  });

  it("keeps the desk's search on the way back, the row's section open among the ones the search opened", async () => {
    const people = await saturday();
    const to = await redirectedTo(checkInAction(null, form({ registrationId: people.bogdan, back: "desk", eventId, q: "pop", direction: "in" })));
    expectBackOnTheRow(to, people.bogdan, "checkedIn", "pop");
    expect(sectionsOf(await deskAt(to)).map((section) => [section.key, section.open, section.rows])).toEqual([
      ["toPickUp", true, ["Ana Pop"]],
      ["checkedIn", true, ["Bogdan Pop", "Dan Pop"]],
      ["waitlisted", true, ["Gina Pop"]],
    ]);
  });

  it("«Salvează nr.»: a runner already here and without a number keeps «Prezenți», opened, wearing the number", async () => {
    await saturday();
    const late = await register("Mara Fără Număr", "CONFIRMED", { bibNumber: null, checkedInAt: HERE });
    const to = await redirectedTo(setBibNumberAction(null, form({ registrationId: late, back: "desk", eventId, bibNumber: "42" })));
    expectBackOnTheRow(to, late, "bibSet");
    const present = sectionsOf(await deskAt(to)).find((section) => section.key === "checkedIn");
    expect(present).toEqual({ key: "checkedIn", title: "Prezenți (2)", open: true, rows: ["Dan Pop", "Mara Fără Număr"] });
    expect((await db.select({ bib: registrations.bibNumber }).from(registrations).where(eq(registrations.id, late)))[0].bib).toBe(42);
  });

  it("«Confirmă pe hârtie» with a place free: the row confirmed into «De ridicat numărul», out of «Adresă neconfirmată»", async () => {
    const people = await saturday();
    const confirmed = await redirectedTo(confirmRegistrationNowAction(null, form({ registrationId: people.elena, back: "desk", eventId })));
    expectBackOnTheRow(confirmed, people.elena, "registrationConfirmed");
    const after = sectionsOf(await deskAt(confirmed));
    expect(after.find((section) => section.key === "toPickUp")).toEqual({ key: "toPickUp", title: "De ridicat numărul (3)", open: true, rows: ["Ana Pop", "Bogdan Pop", "Elena Marin"] });
    expect(after.some((section) => section.key === "addressUnconfirmed")).toBe(false);
  });

  it("«Confirmă pe hârtie» on a full race: the row onto the waiting list, and «Pe lista de așteptare» — shut by default — comes back open", async () => {
    const people = await saturday();
    // Full: the three confirmed, the declaration's hold and the open offer take the five places; two wait.
    await db.update(events).set({ capacity: 5 }).where(eq(events.id, eventId));
    const waitlisted = await redirectedTo(confirmRegistrationNowAction(null, form({ registrationId: people.elena, back: "desk", eventId })));
    expectBackOnTheRow(waitlisted, people.elena, "registrationWaitlisted");
    expect((await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, people.elena)))[0].status).toBe("WAITLISTED");
    const after = sectionsOf(await deskAt(waitlisted));
    expect(after.find((section) => section.key === "waitlisted")).toEqual({ key: "waitlisted", title: "Pe lista de așteptare (3)", open: true, rows: ["Elena Marin", "Gina Pop", "Horia Dobre"] });
    // The other shut sections stay shut.
    expect(after.filter((section) => !section.open).map((section) => section.key)).toEqual(["checkedIn", "offered"]);
  });

  it("«Elită și BIB»: the Administrator's mark comes back to its row, its section open", async () => {
    const people = await saturday();
    state.actor = await staff("ADMIN");
    const to = await redirectedTo(setRegistrationEliteAction(null, form({ registrationId: people.dan, back: "desk", eventId, elite: "1" })));
    expectBackOnTheRow(to, people.dan, "eliteMarked");
    expect(sectionsOf(await deskAt(to)).find((section) => section.key === "checkedIn")?.open).toBe(true);
  });

  it("the walk-in's «Adaugă înscrierea» from the desk: back on the new row, in the section its state put it in, opened", async () => {
    await saturday();
    const to = await redirectedTo(
      createRegistrationAction(
        null,
        form({
          back: "desk",
          eventId,
          firstName: "Radu",
          lastName: "Venit",
          email: "radu-venit@example.org",
          participantLocale: "ro",
          relayedByParticipantRequest: "on",
        }),
      ),
    );
    const [created] = await db.select({ id: registrations.id, status: registrations.status }).from(registrations).where(eq(registrations.registeredName, "Radu Venit"));
    // Entered without the fast track: the address is still to confirm.
    expect(created.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(to.pathname).toBe("/ro/admin/checkin");
    expect(to.hash).toBe(`#reg-${created.id}`);
    expect(Object.fromEntries(to.searchParams)).toEqual({ eventId, row: created.id, saved: "registrationCreated" });
    expect(sectionsOf(await deskAt(to)).find((section) => section.key === "addressUnconfirmed")).toEqual({
      key: "addressUnconfirmed",
      title: "Adresă neconfirmată (2)",
      open: true,
      rows: ["Elena Marin", "Radu Venit"],
    });
  });

  it("a refused press lands on the alert with its refusal, the row's section opened all the same; a forged row opens nothing", async () => {
    const people = await saturday();
    // The waiting list's runner is not confirmed: the check-in is refused, nothing written.
    const refused = await redirectedTo(checkInAction(null, form({ registrationId: people.gina, back: "desk", eventId, direction: "in" })));
    expect(refused.hash).toBe("#admin-alert");
    expect(refused.searchParams.get("row")).toBe(people.gina);
    expect(refused.searchParams.get("error")).not.toBeNull();
    expect(sectionsOf(await deskAt(refused)).find((section) => section.key === "waitlisted")?.open).toBe(true);
    // A `row` that is no registration's id, or nobody's on the list, opens nothing beyond the defaults.
    for (const row of ["not-an-id", "00000000-0000-4000-8000-000000000000"]) {
      expect(sectionsOf(await desk({ row })).map((section) => section.open), row).toEqual([true, true, false, false, false, false]);
    }
  });
});
