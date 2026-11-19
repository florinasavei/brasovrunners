import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { canTakeRaffleList } from "@/modules/volunteers/raffle-list";
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §984, BR-REQ-050-02, BR-REQ-037-08, BR-REQ-060-01 — the raffle on the organizers' and the desk's screens (the owner, 2026-11-18:
 * «Tot pentru ziua cursei vreau să am un tab de tombolă unde să văd toți participanții la tombolă», «vreau să văd în dreptul
 * fiecărei persoane dacă participă la tombolă»), read from a real database:
 *
 * - «Ziua cursei» → «Tombolă»: drawn among the tabs only for an event that holds a raffle and only for the organizers; the settings in
 *   one line, the counts, the four filters, everybody of the three groups with «Participă» and its reason, how and when they signed
 *   up in the sign-up mode, whether they were there; «Înscrie», «Scoate» / «Pune înapoi», «Șterge înscrierea» and a line's «Prezent»;
 *   the two files; a 404 for every other role; both languages;
 * - its presses, each asking its capability and coming back with the toast or the refusal's code;
 * - the desk — inside each row of its list, where a search by name or number lands, and on a scanned person's view: «Tombolă:
 *   participă / nu participă» for every desk role, and «Înscrie la tombolă» in the open sign-up mode, coming back where it was
 *   pressed; a volunteer's page and a registration's page, the same line.
 *
 * The events start in 2099, so the pages' own clock keeps the gate open; the made-up people are nobody.
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

const { default: RafflePage } = await import("@/app/[locale]/admin/checkin/tombola/page");
const actions = await import("@/app/[locale]/admin/checkin/tombola/actions");
const { default: ScannedCodePage } = await import("@/app/[locale]/admin/checkin/[code]/page");
const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { raceDayTabs } = await import("@/modules/race-day/ui/RaceDayTabs");

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

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const START = new Date("2099-11-21T07:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let eventId: string;
let roleId: string;

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
  state.actor = staff.MODERATOR;
  await approveTexts();
  ({ eventId, roleId } = await race());
});

async function approveTexts() {
  const notice: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Tombola ({{raffle}}): păstrăm înscrierea."] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["The raffle ({{raffle}}): we keep the sign-up."] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(notice), translations: notice, now: EFFECTIVE });
  const rules: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }));
  await insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(rules), translations: rules, now: EFFECTIVE });
}

/** A race in 2099 holding a raffle «Din oficiu» (switched to the sign-up mode by the tests that ask it). */
async function race(over: Partial<typeof events.$inferInsert> = {}) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: EFFECTIVE, locationName: "Parcul Noua", hasRaffle: true, ...over })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

async function runner(name: string, bibNumber: number | null, more: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
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

async function volunteer(name: string, bibNumber: number | null, more: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "CONFIRMED", source: "STAFF", roleId, bibNumber, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}

async function eliteLine(name: string, bibNumber: number | null = null): Promise<string> {
  const [row] = await db.insert(eventEliteEntries).values({ eventId, name, bibNumber }).returning({ id: eventEliteEntries.id });
  return row.id;
}

const signUpMode = () => db.update(events).set({ raffleSignUp: true, raffleSignUpOpen: true }).where(eq(events.id, eventId));

/** Each row's presses as the page hands them to the table (`rowActions`), walked, by the person's id. */
function rowActionsOf(tree: ReactNode): Map<string, ReactElement<Props>[]> {
  const table = elements(tree).find((element) => element.props.tableId === "raffle-roster");
  const rows = (table?.props.rows ?? []) as Array<{ ref: { id: string } }>;
  const draw = table?.props.rowActions as (row: unknown) => ReactNode;
  return new Map(rows.map((row) => [row.ref.id, elements(draw(row))]));
}

const tabTree = (query: Record<string, string> = {}) => RafflePage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) });
const tab = async (query: Record<string, string> = {}) => html(await tabTree(query));
/** The table's rows, once each — the table's own `<tr>`s, not the phone cards. */
const rowsOf = (page: string) => [...page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1])).filter((row) => row !== "" && !row.startsWith(ro.Admin.raffle.columns.number) && !row.startsWith(en.Admin.raffle.columns.number));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId, ...fields })) data.set(key, value);
  return data;
}
async function press(action: (form: FormData) => Promise<void>, fields: Record<string, string>) {
  state.redirected.length = 0;
  state.cookies.length = 0;
  await expect(action(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
}
const entries = () => db.select().from(eventRaffleEntries);

/** The owner's race: a runner checked in, an elite registration, a runner waiting, a volunteer, a line of the elite list. */
async function saturday() {
  const ana = await runner("Ana Popescu", 7, { checkedInAt: EFFECTIVE });
  const eliud = await runner("Eliud Kipchoge", 3, { elite: true });
  const elena = await runner("Elena Waiting", null, { status: "WAITLISTED", confirmedAt: null, waitlistedAt: EFFECTIVE });
  const ion = await volunteer("Ion Voluntar", 500);
  const zoe = await eliteLine("Zoe Elita");
  return { ana, eliud, elena, ion, zoe };
}

describe("§984 «Ziua cursei» → «Tombolă»: everybody of the three groups, and whether they take part", () => {
  it("draws the settings in one line, the counts, the four filters and every person «Din oficiu», with the two files", async () => {
    await saturday();
    const page = await tab();
    expect(words(/data-testid="raffle-settings-line"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "")).toBe("Participă: alergătorii, elitele, voluntarii · din oficiu");
    expect(words(/data-testid="raffle-counts"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "")).toBe("Participă: 4 · Alergători: 1 · Elite: 2 · Voluntari: 1 · Prezenți dintre ei: 1");
    // Every person, by the number, the numberless last: number, name, group, «Participă» and its reason, «Prezent».
    expect(rowsOf(page)).toEqual([
      expect.stringMatching(/^3 Eliud Kipchoge Elită Da Nu/),
      expect.stringMatching(/^7 Ana Popescu Alergător Da Da/),
      expect.stringMatching(/^500 Ion Voluntar Voluntar Da Nu/),
      expect.stringMatching(/^— Elena Waiting Alergător Nu · neconfirmat Nu/),
      expect.stringMatching(/^— Zoe Elita Elită Da Prezent/),
    ]);
    // «Din oficiu» asks no sign-up: no «Înscris» column, no «Înscrie», nothing to delete — the exclusion for everybody.
    expect(page).not.toContain(`>${ro.Admin.raffle.columns.how}<`);
    expect(page).not.toContain('data-testid="raffle-sign-up-form"');
    expect(page).not.toContain('data-testid="raffle-delete-form"');
    expect(page.match(/data-testid="raffle-exclusion-form"/g)?.length).toBeGreaterThanOrEqual(5);
    // The four filters, each saying how many it holds, the one in force marked.
    const tree = await tabTree();
    const pills = byTestId(tree, "raffle-filters")[0];
    const labels = elements(pills).filter((element) => typeof element.props.label === "string").map((element) => [element.props.label, element.props.active]);
    expect(labels).toEqual([
      ["Toți: 5", true],
      ["Participă: 4", false],
      ["Nu participă: 1", false],
      ["Doar prezenții: 1", false],
    ]);
    // The two files, for this event, and the page printable.
    expect(page).toContain(`href="/api/admin/events/${eventId}/raffle?lang=ro"`);
    expect(page).toContain(`href="/api/admin/events/${eventId}/raffle?present=1&amp;lang=ro"`);
    expect(page).toContain(ro.Admin.raffle.print);
  });

  it("in the sign-up mode says how and when each signed up, offers «Înscrie» to who may still, and «Șterge înscrierea» to who did", async () => {
    const people = await saturday();
    await signUpMode();
    const organizer = staff.MODERATOR!;
    const { signUpForRaffleByStaff } = await import("@/modules/volunteers/raffle-entries");
    await signUpForRaffleByStaff(db, organizer, { person: { table: "registration", id: people.ana }, accepted: true, eventId }, new Date());
    const page = await tab();
    expect(words(/data-testid="raffle-settings-line"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "")).toBe("Participă: alergătorii, elitele, voluntarii · cu înscriere separată · înscrieri deschise");
    expect(page).toContain(`>${ro.Admin.raffle.columns.how}<`);
    const rows = rowsOf(page);
    expect(rows.find((row) => row.includes("Ana Popescu"))).toMatch(/Da de organizatori · /);
    expect(rows.find((row) => row.includes("Eliud Kipchoge"))).toMatch(/Nu · nu s-a înscris/);
    // «Înscrie» for the eligible not signed up — Eliud, Ion, Zoe — never for Ana (in) or Elena (waiting); «Șterge» for Ana alone.
    const actionsOf = rowActionsOf(await tabTree());
    const holding = (testId: string) => [...actionsOf].filter(([, nodes]) => nodes.some((node) => node.props["data-testid"] === testId)).map(([id]) => id);
    expect(holding("raffle-sign-up-form").sort()).toEqual([people.eliud, people.ion, people.zoe].sort());
    expect(holding("raffle-delete-form")).toEqual([people.ana]);
    // Each «Înscrie» carries the acceptance's own tick, required; «Scoate» stands on every row.
    expect(actionsOf.get(people.ion)?.some((node) => node.props.name === "accepted" && node.props.required === true)).toBe(true);
    expect(holding("raffle-exclusion-form")).toHaveLength(5);
  });

  it("says why the sign-up is shut while the settings alone would open it, and offers nobody «Înscrie»", async () => {
    await saturday();
    await signUpMode();
    const { legalDocuments } = await import("@/db/schema/legal-documents");
    await db.update(legalDocuments).set({ withdrawnAt: EFFECTIVE }).where(eq(legalDocuments.key, "RAFFLE_RULES"));
    const page = await tab();
    expect(page).toContain("înscrieri închise");
    expect(words(/data-testid="raffle-closed-why"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "")).toBe("Închise pentru că: Regulamentul tombolei nu e aprobat încă");
    expect(page).not.toContain('data-testid="raffle-sign-up-form"');
  });

  it("filters to those taking part, those not, and those taking part who were there", async () => {
    await saturday();
    const names = async (filter: string) => rowsOf(await tab({ filter })).map((row) => row.split(" ").slice(1, 3).join(" "));
    expect(await names("in")).toEqual(["Eliud Kipchoge", "Ana Popescu", "Ion Voluntar", "Zoe Elita"]);
    expect(await names("out")).toEqual(["Elena Waiting"]);
    expect(await names("present")).toEqual(["Ana Popescu"]);
    // Anything else is everybody.
    expect(await names("nope")).toHaveLength(5);
  });

  it("is a 404 to every role but the organizers, and stands among «Ziua cursei»'s tabs only for an event that holds a raffle", async () => {
    for (const role of STAFF_ROLES) {
      state.actor = staff[role];
      if (canTakeRaffleList(role)) await expect(tabTree(), role).resolves.toBeTruthy();
      else await expect(tabTree(), role).rejects.toThrow("NOT_FOUND");
    }
    const tabsOf = async (id: string, role: StaffRole) => words(await html(await raceDayTabs({ locale: "ro", active: "desk", eventId: id, actor: staff[role]! })));
    expect(await tabsOf(eventId, "MODERATOR")).toContain("Tombolă");
    expect(await tabsOf(eventId, "CONTRIBUTOR")).not.toContain("Tombolă");
    const plain = await race({ hasRaffle: false });
    expect(await tabsOf(plain.eventId, "ADMIN")).not.toContain("Tombolă");
    // An event that holds none, opened by its address: one sentence, no table.
    state.actor = staff.ADMIN;
    const page = html(await RafflePage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: plain.eventId }) }));
    expect(await page).toContain('data-testid="raffle-none"');
  });

  it("speaks English on the English page", async () => {
    await saturday();
    state.locale = "en";
    const page = await tab();
    expect(words(/data-testid="raffle-settings-line"[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "")).toBe("Taking part: the runners, the elites, the volunteers · automatically");
    expect(rowsOf(page).find((row) => row.includes("Elena Waiting"))).toMatch(/No · not confirmed/);
    expect(page).not.toContain("Participă");
  });
});

describe("§984 BR-REQ-060-01 the tab's presses: each asks its capability and comes back with its toast or its refusal", () => {
  it("«Înscrie» records a STAFF sign-up and comes back to the row; without the acceptance, or for a desk role, it writes nothing", async () => {
    const people = await saturday();
    await signUpMode();
    expect(await press(actions.raffleSignUpAction, { table: "volunteer", personId: people.ion })).toEqual({
      to: `/ro/admin/checkin/tombola?eventId=${eventId}&error=RAFFLE_RULES_NOT_ACCEPTED#admin-alert`,
      toast: null,
    });
    state.actor = staff.CONTRIBUTOR;
    expect((await press(actions.raffleSignUpAction, { table: "volunteer", personId: people.ion, accepted: "on" })).to).toContain("error=FORBIDDEN");
    expect(await entries()).toEqual([]);
    state.actor = staff.MODERATOR;
    expect(await press(actions.raffleSignUpAction, { table: "volunteer", personId: people.ion, accepted: "on", filter: "out" })).toEqual({
      to: `/ro/admin/checkin/tombola?eventId=${eventId}&filter=out#raffle-${people.ion}`,
      toast: { kind: "success", key: "raffleSignedUp" },
    });
    expect(await press(actions.raffleSignUpAction, { table: "volunteer", personId: people.ion, accepted: "on" })).toMatchObject({ toast: { key: "raffleAlready" } });
    // From a volunteer's own page, back to it: a refusal to the page's alert (`volunteerError`), a sign-up to the raffle's line.
    const maria = await volunteer("Maria Voluntar", 501);
    expect(await press(actions.raffleSignUpAction, { table: "volunteer", personId: maria, back: "volunteer" })).toEqual({
      to: `/ro/admin/volunteers/${maria}?volunteerError=RAFFLE_RULES_NOT_ACCEPTED#admin-alert`,
      toast: null,
    });
    expect(await press(actions.raffleSignUpAction, { table: "volunteer", personId: maria, accepted: "on", back: "volunteer" })).toEqual({
      to: `/ro/admin/volunteers/${maria}#volunteer-raffle`,
      toast: { kind: "success", key: "raffleSignedUp" },
    });
    // `back=volunteer` names a volunteer's page: any other person comes back to the tab, at the row.
    expect((await press(actions.raffleSignUpAction, { table: "elite", personId: people.zoe, accepted: "on", back: "volunteer" })).to).toBe(`/ro/admin/checkin/tombola?eventId=${eventId}#raffle-${people.zoe}`);
    const eliudBack = await press(actions.raffleSignUpAction, { table: "registration", personId: people.eliud, accepted: "on" });
    expect(eliudBack.toast).toMatchObject({ key: "raffleSignedUp" });
    expect((await entries()).map((row) => row.method)).toEqual(["STAFF", "STAFF", "STAFF", "STAFF"]);
  });

  it("«Scoate» and «Pune înapoi» each kind through its own tick, and a line's «Prezent»", async () => {
    const people = await saturday();
    expect((await press(actions.raffleExclusionAction, { table: "registration", personId: people.ana, inRaffle: "0" })).toast).toMatchObject({ key: "raffleTakenOut" });
    expect((await press(actions.raffleExclusionAction, { table: "volunteer", personId: people.ion, inRaffle: "0" })).toast).toMatchObject({ key: "raffleTakenOut" });
    expect((await press(actions.raffleExclusionAction, { table: "elite", personId: people.zoe, inRaffle: "0" })).toast).toMatchObject({ key: "raffleTakenOut" });
    expect((await press(actions.raffleExclusionAction, { table: "elite", personId: people.zoe, inRaffle: "0" })).toast).toMatchObject({ key: "raffleUnchanged" });
    expect((await db.select().from(registrations).where(eq(registrations.id, people.ana)))[0].inRaffle).toBe(false);
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, people.ion)))[0].inRaffle).toBe(false);
    expect((await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.id, people.zoe)))[0].inRaffle).toBe(false);
    expect((await press(actions.raffleExclusionAction, { table: "registration", personId: people.ana, inRaffle: "1" })).toast).toMatchObject({ key: "rafflePutBack" });
    expect((await press(actions.raffleElitePresentAction, { table: "elite", personId: people.zoe, present: "1" })).toast).toMatchObject({ key: "rafflePresentOn" });
    expect((await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.id, people.zoe)))[0].present).toBe(true);
    // A forged table, or a role that does not take the raffle: refused, nothing written.
    expect((await press(actions.raffleExclusionAction, { table: "participants", personId: people.ana, inRaffle: "0" })).to).toContain("error=NOT_FOUND");
    state.actor = staff.DEV;
    expect((await press(actions.raffleElitePresentAction, { table: "elite", personId: people.zoe, present: "0" })).to).toContain("error=FORBIDDEN");
    expect((await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.id, people.zoe)))[0].present).toBe(true);
  });

  it("«Șterge înscrierea» takes the sign-up off with its toast; the desk's «Înscrie» comes back to the desk's view of the person", async () => {
    const people = await saturday();
    await signUpMode();
    state.actor = staff.CONTRIBUTOR;
    const [code] = (await db.select({ code: registrations.checkinCode }).from(registrations).where(eq(registrations.id, people.ana))).map((row) => row.code);
    expect(await press(actions.raffleDeskSignUpAction, { code: String(code), registrationId: people.ana })).toEqual({ to: `/ro/admin/checkin/${code}?error=RAFFLE_RULES_NOT_ACCEPTED#admin-alert`, toast: null });
    expect(await press(actions.raffleDeskSignUpAction, { code: String(code), registrationId: people.ana, accepted: "on" })).toEqual({ to: `/ro/admin/checkin/${code}?saved=raffleSignedUp#admin-alert`, toast: null });
    expect((await entries()).map((row) => [row.method, row.recordedByStaffUserId])).toEqual([["DESK", staff.CONTRIBUTOR!.id]]);
    // The desk role may not delete it; the organizers may.
    const [entry] = await entries();
    expect((await press(actions.raffleDeleteEntryAction, { table: "registration", personId: people.ana, entryId: entry.id })).to).toContain("error=FORBIDDEN");
    state.actor = staff.MODERATOR;
    expect((await press(actions.raffleDeleteEntryAction, { table: "registration", personId: people.ana, entryId: entry.id })).toast).toMatchObject({ key: "raffleDeleted" });
    expect(await entries()).toEqual([]);
  });
});

describe("§984 BR-REQ-037-08 beside each person: the desk's list and its view of a person, a volunteer's page, every desk role", () => {
  const codeOf = async (id: string) => String((await db.select({ code: registrations.checkinCode }).from(registrations).where(eq(registrations.id, id)))[0].code);
  const deskView = async (id: string) => ScannedCodePage({ params: Promise.resolve({ locale: state.locale, code: await codeOf(id) }), searchParams: Promise.resolve({}) });

  it("says «Tombolă: participă / nu participă» and why, to every desk role, in both modes — and nothing for an event without a raffle", async () => {
    const people = await saturday();
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV", "MODERATOR"] as const) {
      state.actor = staff[role];
      const line = byTestId(await deskView(people.ana), "desk-raffle");
      expect(line, role).toHaveLength(1);
      expect(words(await html(line[0])), role).toBe("Tombolă: participă");
    }
    await signUpMode();
    state.actor = staff.CONTRIBUTOR;
    const [line] = byTestId(await deskView(people.ana), "desk-raffle");
    expect(words(await html(line))).toMatch(/^Tombolă: nu participă De ce: nu s-a înscris/);
    // «Înscrie la tombolă», the acceptance's tick required, for the desk role too.
    const signUp = elements(line).find((element) => element.props["data-testid"] === "desk-raffle-sign-up");
    expect(signUp?.props.action).toBe(actions.raffleDeskSignUpAction);
    expect(elements(signUp).find((element) => element.props.name === "registrationId")?.props.value).toBe(people.ana);
    expect(elements(signUp).some((element) => element.props.name === "accepted" && element.props.required === true)).toBe(true);
    // English.
    state.locale = "en";
    expect(words(await html(byTestId(await deskView(people.ana), "desk-raffle")[0]))).toMatch(/^Raffle: not taking part Why: did not sign up/);
    // No raffle on the event: nothing drawn.
    state.locale = "ro";
    await db.update(events).set({ hasRaffle: false }).where(eq(events.id, eventId));
    expect(byTestId(await deskView(people.ana), "desk-raffle")).toEqual([]);
  });

  it("says «scos de organizatori» to the organizers alone — every other desk role reads «nu participă» alone — and every other reason to all (§984)", async () => {
    const people = await saturday();
    await db.update(registrations).set({ inRaffle: false }).where(eq(registrations.id, people.ana));
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(words(await html(byTestId(await deskView(people.ana), "desk-raffle")[0])), role).toBe("Tombolă: nu participă De ce: scos de organizatori");
    }
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      expect(words(await html(byTestId(await deskView(people.ana), "desk-raffle")[0])), role).toBe("Tombolă: nu participă");
      // Any other reason is said to every desk role: «nu s-a înscris» is what lets the desk offer the sign-up.
      expect(words(await html(byTestId(await deskView(people.elena), "desk-raffle")[0])), role).toBe("Tombolă: nu participă De ce: neconfirmat");
    }
    // The desk's list, the same: the organizers' exclusion said only to them.
    const deskList = async () => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, q: "Ana Popescu" }) });
    state.actor = staff.CONTRIBUTOR;
    expect(words(await html(byTestId(await deskList(), "desk-raffle")[0]))).toBe("Tombolă: nu participă");
    state.actor = staff.MODERATOR;
    expect(words(await html(byTestId(await deskList(), "desk-raffle")[0]))).toBe("Tombolă: nu participă De ce: scos de organizatori");
  });

  it("draws no raffle line for a test registration — on the desk, its view and its page — and no note on the registrations list (§984)", async () => {
    await saturday();
    const test = await runner("Test Confirmat", 70, { kind: "TEST" });
    state.actor = staff.MODERATOR;
    expect(byTestId(await deskView(test), "desk-raffle")).toEqual([]);
    const deskList = await DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, q: "Test Confirmat" }) });
    expect(byTestId(deskList, "desk-raffle")).toEqual([]);
    const { readRaffleLine, raffleReasonsFor } = await import("@/modules/volunteers/raffle-roster");
    expect(await readRaffleLine(db, { table: "registration", id: test }, new Date())).toBeNull();
    expect((await raffleReasonsFor(db, eventId, { registrationIds: [test] })).has(test)).toBe(false);
  });

  it("says it under every row of the desk's list — where a search by name lands — and its «Înscrie» comes back to the list", async () => {
    const people = await saturday();
    state.actor = staff.CONTRIBUTOR;
    const deskList = async (q: string) => DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, q }) });
    /** Each row the desk's list draws: whose it is, and the raffle line inside it, in words. */
    const rowsOf = async (q: string) =>
      Promise.all(
        elements(await deskList(q))
          .filter((element) => element.type === DeskRow)
          .map(async (element) => {
            const lines = byTestId(element.props.children as ReactNode, "desk-raffle");
            return [(element.props.row as { id: string }).id, lines.length === 1 ? words(await html(lines[0])) : `${lines.length} lines`];
          }),
      );
    // «Din oficiu»: one line inside the one row a search by name, or by the number, finds.
    expect(await rowsOf("Ana Popescu")).toEqual([[people.ana, "Tombolă: participă"]]);
    expect(await rowsOf("7")).toEqual([[people.ana, "Tombolă: participă"]]);
    // A search that finds several: a line inside each, each its own person's answer.
    expect(await rowsOf("e")).toEqual(
      expect.arrayContaining([
        [people.eliud, "Tombolă: participă"],
        [people.elena, "Tombolă: nu participă De ce: neconfirmat"],
      ]),
    );
    // «Cu înscriere separată», open: «Înscrie la tombolă» under the row, for the desk role, coming back to the list with its search.
    await signUpMode();
    const lines = byTestId(await deskList("Ana Popescu"), "desk-raffle");
    expect(words(await html(lines[0]))).toMatch(/^Tombolă: nu participă De ce: nu s-a înscris/);
    const signUp = elements(lines[0]).find((element) => element.props["data-testid"] === "desk-raffle-sign-up");
    expect(signUp?.props.action).toBe(actions.raffleDeskSignUpAction);
    const hidden = (name: string) => elements(signUp).find((element) => element.props.name === name)?.props.value;
    expect([hidden("back"), hidden("eventId"), hidden("q"), hidden("registrationId"), hidden("code")]).toEqual(["desk", eventId, "Ana Popescu", people.ana, undefined]);
    // Back to the list with the row (§1002, the desk's sections): `row=` opens the section that holds it; a refusal lands on the
    // alert, a sign-up on the row with its toast, the alert's sentence being out of sight there.
    expect(await press(actions.raffleDeskSignUpAction, { back: "desk", q: "Ana Popescu", registrationId: people.ana })).toEqual({
      to: `/ro/admin/checkin?eventId=${eventId}&q=Ana+Popescu&row=${people.ana}&error=RAFFLE_RULES_NOT_ACCEPTED#admin-alert`,
      toast: null,
    });
    expect(await press(actions.raffleDeskSignUpAction, { back: "desk", q: "Ana Popescu", registrationId: people.ana, accepted: "on" })).toEqual({
      to: `/ro/admin/checkin?eventId=${eventId}&q=Ana+Popescu&row=${people.ana}&saved=raffleSignedUp#reg-${people.ana}`,
      toast: { kind: "success", key: "raffleSignedUp" },
    });
    expect((await entries()).map((entry) => [entry.registrationId, entry.method])).toEqual([[people.ana, "DESK"]]);
    expect(words(await html(byTestId(await deskList("Ana Popescu"), "desk-raffle")[0]))).toBe("Tombolă: participă");
    // No raffle on the event: no line under any row.
    await db.update(events).set({ hasRaffle: false }).where(eq(events.id, eventId));
    expect(byTestId(await deskList("Ana Popescu"), "desk-raffle")).toEqual([]);
  });

  it("says it on a volunteer's page, with the organizers' «Înscrie la tombolă» in the open sign-up mode", async () => {
    const people = await saturday();
    const volunteerPage = async () => AdminVolunteerPage({ params: Promise.resolve({ locale: state.locale, id: people.ion }), searchParams: Promise.resolve({}) });
    let [line] = byTestId(await volunteerPage(), "volunteer-raffle");
    expect(words(await html(line))).toBe("Tombolă: participă");
    expect(elements(line).some((element) => element.props["data-testid"] === "volunteer-raffle-sign-up")).toBe(false);
    await signUpMode();
    [line] = byTestId(await volunteerPage(), "volunteer-raffle");
    const signUp = elements(line).find((element) => element.props["data-testid"] === "volunteer-raffle-sign-up");
    expect(signUp?.props.action).toBe(actions.raffleSignUpAction);
    expect(elements(signUp).find((element) => element.props.name === "back")?.props.value).toBe("volunteer");
  });
});
