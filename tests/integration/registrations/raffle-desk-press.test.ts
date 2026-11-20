import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { countKits } from "@/modules/registrations/admin-repository";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { setRegistrationInRaffleAtDesk } from "@/modules/registrations/raffle-mark";
import { countOccupied } from "@/modules/registrations/repository";
import { canSetRaffleMarkAtDesk, type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { exportRaffleList } from "@/modules/volunteers/raffle-list";
import { readRaffleLine } from "@/modules/volunteers/raffle-roster";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §1020 (amending §949 and §953 for the desk), BR-REQ-037-08, BR-REQ-060-01, BR-REQ-050-02 — «Scoate de la tombolă» / «Pune înapoi la
 * tombolă» on the race-day desk's raffle line (the owner, 2026-11-20: «ar trebui să pot să-l scot de la tombolă ca și voluntar dar
 * să fie cu extra confirmare și cu logarea în aplicație cu ce voluntar a decis că X nu participă la tombolă»), read from a real
 * database (PGlite) through the press and the pages:
 *
 * - every desk role — the Voluntar, the Redactor, Tehnic, the Organizer and the Administrator — takes a runner out and puts them
 *   back, from the scanned person's view and from a row of the desk's list; each press one trail row, the staff member its actor and
 *   the desk's door beside the new value, a second press writing nothing; the line then says «— scos de la tombolă» to every desk
 *   role, with «Pune înapoi la tombolă»;
 * - the press is a form that asks first: the question names the person and the number, «Anulează» and «Da, scoate de la tombolă»,
 *   red, and says nobody is emailed; never on a row the race is over for, nor where no line is drawn;
 * - refused to a member, at an event that holds no raffle, for a test registration and for anything that is not a registration —
 *   a line of the elite list and a volunteer keep the organizers' ticks —, nothing written;
 * - an elite registration is a desk row like any other, and «Cine poate participa» still takes every elite out at once;
 * - nothing else moves: no state, place, number, count, kit or email; the file for the draw drops the number and takes it back.
 *
 * The race starts in 2099; the made-up people are nobody.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  cookies: [] as Array<[string, string]>,
}));

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
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf(state.locale, href), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { raffleDeskExclusionAction } = await import("@/app/[locale]/admin/checkin/raffle-actions");
const { raffleDeskSignUpAction } = await import("@/app/[locale]/admin/checkin/tombola/actions");
const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");
const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { raffleDeskLine } = await import("@/modules/volunteers/ui/RaffleLines");

type Props = Record<string, unknown> & { children?: ReactNode };

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
const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id);

/**
 * A tree as the server streams it, Suspense settled; Emotion's styles, React's separators and the inline script React writes beside a
 * form posting to a Server Action (its replay of a submit made before hydration) out of the way.
 */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text())
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-11-21T07:30:00.000Z");
/** The desk roles the owner named, in the words «Echipa» gives them: Voluntar, Redactor, Tehnic, Organizator, Administrator. */
const DESK_ROLES = ["CONTRIBUTOR", "COPYWRITER", "DEV", "MODERATOR", "ADMIN"] as const;

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  state.cookies.length = 0;
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.CONTRIBUTOR;
  eventId = await race();
});

/** A race in 2099 holding a raffle «Din oficiu», every group ticked. */
async function race(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: EFFECTIVE, locationName: "Parcul Noua", hasRaffle: true, capacity: 50, kitShirt: true, ...over })
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
      privacyAcknowledgedAt: EFFECTIVE,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: EFFECTIVE,
      bibNumber,
      checkinCode: newCheckinCode(),
      ...more,
    })
    .returning({ id: registrations.id });
  return row.id;
}

const codeOf = async (id: string) => String((await db.select({ code: registrations.checkinCode }).from(registrations).where(eq(registrations.id, id)))[0].code);
const inRaffleOf = async (id: string) => (await db.select({ inRaffle: registrations.inRaffle }).from(registrations).where(eq(registrations.id, id)))[0].inRaffle;
const rowOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];
/** The raffle's trail rows alone: the scanned page records its scans beside them. */
const raffleTrail = () => db.select().from(auditLogs).where(inArray(auditLogs.action, ["registration.raffle_excluded", "registration.raffle_included"]));

/** The scanned person's view, as the press lands on it (`saved=` — so no scan is recorded) or as a code first opens it. */
const deskView = async (id: string, query: Record<string, string> = {}) =>
  ScannedCodePage({ params: Promise.resolve({ locale: state.locale, code: await codeOf(id) }), searchParams: Promise.resolve(query) });
const deskList = (q: string) => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, q }) });
/** The desk's raffle line under the row, in words. */
const lineWords = async (tree: ReactNode) => {
  const lines = byTestId(tree, "desk-raffle");
  return lines.length === 1 ? words(await html(lines[0])) : `${lines.length} lines`;
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: state.locale, ...fields })) data.set(key, value);
  return data;
}
/** One press of the desk's form, as `ActionForm` posts it once the question was answered: where it lands, and its toast. */
async function press(fields: Record<string, string>) {
  state.redirected.length = 0;
  state.cookies.length = 0;
  await expect(raffleDeskExclusionAction(null, form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
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

const OUT_LINE = "Tombolă: nu participă — scos de la tombolă Pune înapoi la tombolă";
const IN_LINE = "Tombolă: participă Scoate de la tombolă";

describe("§1020 BR-REQ-037-08 «Scoate de la tombolă» / «Pune înapoi la tombolă» at the desk, every desk role", () => {
  it.each(DESK_ROLES)("%s takes a runner out and puts them back from the scanned view: one trail row each, with who and the desk's door", async (role) => {
    const ana = await runner("Ana Popescu", 7);
    const code = await codeOf(ana);
    state.actor = staff[role];
    expect(canSetRaffleMarkAtDesk(role)).toBe(true);
    // The line before: in, with the press that takes the person out.
    expect(await lineWords(await deskView(ana)), role).toBe(IN_LINE);

    expect(await press({ back: "code", code, registrationId: ana, inRaffle: "0" })).toEqual({ to: `/ro/admin/checkin/${code}?saved=raffleTakenOut#admin-alert`, toast: null });
    expect(await inRaffleOf(ana)).toBe(false);
    let rows = await raffleTrail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "registration.raffle_excluded", actorStaffUserId: staff[role]!.id, entityType: "registration", entityId: ana });
    // The new value and the door: never a name or a number.
    expect(rows[0].metadataJson).toEqual({ inRaffle: false, door: "desk" });
    // The page it lands on says it, and the line now offers the way back — for the one who pressed.
    const landed = await deskView(ana, { saved: "raffleTakenOut" });
    expect(words(await html(landed))).toContain(ro.Admin.desk.saved.raffleTakenOut);
    expect(await lineWords(landed), role).toBe(OUT_LINE);

    // A second press — the same phone twice, a colleague's — saves the same and writes nothing.
    expect((await press({ back: "code", code, registrationId: ana, inRaffle: "0" })).to).toBe(`/ro/admin/checkin/${code}?saved=raffleUnchanged#admin-alert`);
    expect(await raffleTrail()).toHaveLength(1);

    expect((await press({ back: "code", code, registrationId: ana, inRaffle: "1" })).to).toBe(`/ro/admin/checkin/${code}?saved=rafflePutBack#admin-alert`);
    expect(await inRaffleOf(ana)).toBe(true);
    rows = await raffleTrail();
    expect(rows.map((row) => [row.action, row.actorStaffUserId, row.metadataJson]).sort()).toEqual(
      [
        ["registration.raffle_excluded", staff[role]!.id, { inRaffle: false, door: "desk" }],
        ["registration.raffle_included", staff[role]!.id, { inRaffle: true, door: "desk" }],
      ].sort(),
    );
    expect(await lineWords(await deskView(ana, { saved: "rafflePutBack" })), role).toBe(IN_LINE);
  });

  it("says «— scos de la tombolă» to every desk role once a runner is out, and every other reason as before (§1020, amending §984)", async () => {
    const ana = await runner("Ana Popescu", 7);
    const elena = await runner("Elena Waiting", null, { status: "WAITLISTED", confirmedAt: null, waitlistedAt: EFFECTIVE });
    await setRegistrationInRaffleAtDesk(db, staff.CONTRIBUTOR!, ana, false, NOW);
    for (const role of STAFF_ROLES.filter((one) => canSetRaffleMarkAtDesk(one))) {
      state.actor = staff[role];
      expect(await lineWords(await deskView(ana, { saved: "raffleTakenOut" })), role).toBe(OUT_LINE);
      // A reason that is not an exclusion offers no press: neither the mark's nor the sign-up's.
      expect(await lineWords(await deskView(elena, { saved: "raffleTakenOut" })), role).toBe("Tombolă: nu participă De ce: neconfirmat");
    }
    // The same on the desk's list, under the row a search finds.
    state.actor = staff.CONTRIBUTOR;
    expect(await lineWords(await deskList("Ana Popescu"))).toBe(OUT_LINE);
    // English.
    state.locale = "en";
    expect(await lineWords(await deskView(ana, { saved: "raffleTakenOut" }))).toBe("Raffle: not taking part — taken out of the raffle Put back in the raffle");
  });

  it("comes back to the desk's list at the row, with its search and its toast — a refusal at the alert", async () => {
    const ana = await runner("Ana Popescu", 7);
    state.actor = staff.CONTRIBUTOR;
    const line = byTestId(await deskList("Ana Popescu"), "desk-raffle")[0];
    const asked = elements(line).find((element) => element.type === ActionForm);
    expect(asked?.props.action).toBe(raffleDeskExclusionAction);
    const hidden = (name: string) => elements(asked).find((element) => element.props.name === name)?.props.value;
    expect([hidden("back"), hidden("eventId"), hidden("q"), hidden("registrationId"), hidden("inRaffle"), hidden("code")]).toEqual(["desk", eventId, "Ana Popescu", ana, "0", undefined]);

    expect(await press({ back: "desk", eventId, q: "Ana Popescu", registrationId: ana, inRaffle: "0" })).toEqual({
      to: `/ro/admin/checkin?eventId=${eventId}&q=Ana+Popescu&row=${ana}&saved=raffleTakenOut#reg-${ana}`,
      toast: { kind: "success", key: "raffleTakenOut" },
    });
    expect(await lineWords(await deskList("Ana Popescu"))).toBe(OUT_LINE);
    expect(await press({ back: "desk", eventId, q: "Ana Popescu", registrationId: ana, inRaffle: "1" })).toEqual({
      to: `/ro/admin/checkin?eventId=${eventId}&q=Ana+Popescu&row=${ana}&saved=rafflePutBack#reg-${ana}`,
      toast: { kind: "success", key: "rafflePutBack" },
    });
    // A refusal lands on the alert, the row still opened, no toast.
    state.actor = staff.MEMBER;
    expect(await press({ back: "desk", eventId, q: "Ana Popescu", registrationId: ana, inRaffle: "0" })).toEqual({
      to: `/ro/admin/checkin?eventId=${eventId}&q=Ana+Popescu&row=${ana}&error=FORBIDDEN#admin-alert`,
      toast: null,
    });
    expect(await inRaffleOf(ana)).toBe(true);
  });

  it("asks first: the question names the person and the number, «Anulează» and «Da, scoate de la tombolă», and nobody is emailed", async () => {
    const ana = await runner("Ana Popescu", 7, {}, await race({ bibDesign: { numberFormat: "pad3" } }));
    const code = await codeOf(ana);
    const askedOf = async () => elements(byTestId(await deskView(ana, { saved: "x" }), "desk-raffle")[0]).find((element) => element.type === ActionForm);
    let asked = await askedOf();
    expect(asked?.props.action).toBe(raffleDeskExclusionAction);
    expect(asked?.props["data-testid"]).toBe("desk-raffle-take-out");
    // The number as the event writes it (§735): «007» when the bib says «007».
    expect(asked?.props.confirm).toEqual({
      title: "Scoți pe Ana Popescu (nr. 007) de la tombolă?",
      body: "Numărul lui nu mai intră la tragere. Rămâne scris cine a decis.",
      email: "Nu pleacă niciun email către Ana Popescu.",
      confirmLabel: "Da, scoate de la tombolă",
      cancelLabel: "Anulează",
      destructive: true,
    });
    const hidden = (name: string) => elements(asked).find((element) => element.props.name === name)?.props.value;
    expect([hidden("back"), hidden("code"), hidden("registrationId"), hidden("inRaffle"), hidden("uiLocale")]).toEqual(["code", code, ana, "0", "ro"]);
    // The button: its words, an accessible name that starts with them and names the person, a thumb's 44 pixels.
    const button = elements(asked).find((element) => element.props.type === "submit");
    expect(button?.props.children).toBe("Scoate de la tombolă");
    expect(button?.props["aria-label"]).toBe("Scoate de la tombolă: Ana Popescu");
    expect(button?.props.sx).toMatchObject({ minHeight: 44 });

    await setRegistrationInRaffleAtDesk(db, staff.ADMIN!, ana, false, NOW);
    asked = await askedOf();
    expect(asked?.props["data-testid"]).toBe("desk-raffle-put-back");
    expect(asked?.props.confirm).toMatchObject({
      title: "Pui înapoi pe Ana Popescu (nr. 007) la tombolă?",
      body: "Numărul lui intră din nou la tragere. Rămâne scris cine a decis.",
      confirmLabel: "Da, pune înapoi la tombolă",
      cancelLabel: "Anulează",
      destructive: false,
    });
    expect(elements(asked).find((element) => element.props.name === "inRaffle")?.props.value).toBe("1");
    // English.
    state.locale = "en";
    expect((await askedOf())?.props.confirm).toMatchObject({ title: "Put Ana Popescu (no. 007) back in the raffle?", confirmLabel: "Yes, put back in the raffle", cancelLabel: "Cancel" });
  });

  it("is drawn only where the line is: no raffle, a test registration, a person waiting — and never on a row the race is over for", async () => {
    const ana = await runner("Ana Popescu", 7);
    const test = await runner("Test Confirmat", 70, { kind: "TEST" });
    expect(byTestId(await deskView(test, { saved: "x" }), "desk-raffle")).toEqual([]);
    // A row the desk draws read-only (§82): the line reads, and offers no press.
    const line = await readRaffleLine(db, { table: "registration", id: ana }, NOW);
    const drawn = await raffleDeskLine({ line: line!, locale: "ro", back: { to: "desk", eventId }, registrationId: ana, name: "Ana Popescu", number: "7", action: raffleDeskSignUpAction, exclusionAction: raffleDeskExclusionAction, readOnly: true });
    expect(words(await html(drawn))).toBe("Tombolă: participă");
    expect(elements(drawn).some((element) => element.type === ActionForm)).toBe(false);
    // No raffle on the event: no line, no press.
    await db.update(events).set({ hasRaffle: false }).where(eq(events.id, eventId));
    expect(byTestId(await deskView(ana, { saved: "x" }), "desk-raffle")).toEqual([]);
  });
});

describe("§1020 BR-REQ-060-01 the press asserts its own predicate, and the line's two conditions, again on the server", () => {
  it("refuses a member at the door and in the writer, writing nothing", async () => {
    const ana = await runner("Ana Popescu", 7);
    const code = await codeOf(ana);
    state.actor = staff.MEMBER;
    expect(await press({ back: "code", code, registrationId: ana, inRaffle: "0" })).toEqual({ to: `/ro/admin/checkin/${code}?error=FORBIDDEN#admin-alert`, toast: null });
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, staff.MEMBER!, ana, false, NOW))).code).toBe("FORBIDDEN");
    expect(await inRaffleOf(ana)).toBe(true);
    expect(await raffleTrail()).toEqual([]);
  });

  it("refuses an event that holds no raffle, a test registration and anything that is not a registration, writing nothing", async () => {
    const plain = await race({ hasRaffle: false });
    const dan = await runner("Dan Ene", 9, {}, plain);
    const test = await runner("Test Confirmat", 70, { kind: "TEST" });
    const desk = staff.CONTRIBUTOR!;
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, dan, false, NOW))).code).toBe("RAFFLE_NOT_HELD");
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, test, false, NOW))).code).toBe("RAFFLE_NOT_ELIGIBLE");
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, "11111111-1111-4111-8111-111111111111", false, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, "not-an-id", false, NOW))).code).toBe("NOT_FOUND");
    // The press says the event's own refusal, in words, where it was pressed.
    const code = await codeOf(dan);
    state.actor = desk;
    expect((await press({ back: "code", code, registrationId: dan, inRaffle: "0" })).to).toBe(`/ro/admin/checkin/${code}?error=RAFFLE_NOT_HELD#admin-alert`);
    expect(words(await html(await deskView(dan, { error: "RAFFLE_NOT_HELD" })))).toContain(ro.Admin.errors.RAFFLE_NOT_HELD);
    // A line of the elite list and a volunteer are not at the desk: their ids name no registration, and their ticks stay theirs.
    const [line] = await db.insert(eventEliteEntries).values({ eventId, name: "Zoe Elita", bibNumber: 777 }).returning({ id: eventEliteEntries.id });
    const [helper] = await db.insert(eventVolunteers).values({ eventId, name: "Ion Voluntar", state: "CONFIRMED", source: "STAFF" }).returning({ id: eventVolunteers.id });
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, line.id, false, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(setRegistrationInRaffleAtDesk(db, desk, helper.id, false, NOW))).code).toBe("NOT_FOUND");
    expect((await db.select({ inRaffle: eventEliteEntries.inRaffle }).from(eventEliteEntries).where(eq(eventEliteEntries.id, line.id)))[0].inRaffle).toBe(true);
    expect((await db.select({ inRaffle: eventVolunteers.inRaffle }).from(eventVolunteers).where(eq(eventVolunteers.id, helper.id)))[0].inRaffle).toBe(true);
    expect(await inRaffleOf(dan)).toBe(true);
    expect(await inRaffleOf(test)).toBe(true);
    expect(await raffleTrail()).toEqual([]);
  });
});

describe("§1020 the elites, and what does not move", () => {
  it("takes an elite registration out like any other runner; «Cine poate participa» still takes every elite out at once", async () => {
    const eliud = await runner("Eliud Kipchoge", 3, { elite: true });
    state.actor = staff.CONTRIBUTOR;
    expect(await lineWords(await deskView(eliud, { saved: "x" }))).toBe(IN_LINE);
    expect((await press({ back: "code", code: await codeOf(eliud), registrationId: eliud, inRaffle: "0" })).to).toContain("saved=raffleTakenOut");
    expect(await lineWords(await deskView(eliud, { saved: "x" }))).toBe(OUT_LINE);
    await setRegistrationInRaffleAtDesk(db, staff.CONTRIBUTOR!, eliud, true, NOW);
    // The editor's «Elitele» unticked: the group first, no press — the organizers' setting, not the desk's.
    await db.update(events).set({ raffleElites: false }).where(eq(events.id, eventId));
    expect(await lineWords(await deskView(eliud, { saved: "x" }))).toBe("Tombolă: nu participă De ce: grupa nu e bifată");
  });

  it("moves no state, place, number, count or kit, sends no email — and the file for the draw drops the number and takes it back", async () => {
    const ana = await runner("Ana Popescu", 7, { tshirtSize: "M" });
    await runner("Dan Ene", 8);
    const before = await rowOf(ana);
    const [occupied, kits] = [await countOccupied(db, eventId, NOW), await countKits(db, eventId, NOW)];
    const numbers = async () => (await exportRaffleList(db, staff.MODERATOR!, eventId, NOW)).rows.map((row) => row.number);
    expect(await numbers()).toEqual([7, 8]);

    expect(await setRegistrationInRaffleAtDesk(db, staff.CONTRIBUTOR!, ana, false, NOW)).toEqual({ changed: true });
    const after = await rowOf(ana);
    expect({ ...after, inRaffle: true, updatedAt: before.updatedAt }).toEqual(before);
    expect(await countOccupied(db, eventId, NOW)).toEqual(occupied);
    expect(await countKits(db, eventId, NOW)).toEqual(kits);
    expect(await numbers()).toEqual([8]);
    expect(await setRegistrationInRaffleAtDesk(db, staff.CONTRIBUTOR!, ana, true, NOW)).toEqual({ changed: true });
    expect(await numbers()).toEqual([7, 8]);
    // Nobody is told (§949): no email for the person, none for the club.
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });
});
