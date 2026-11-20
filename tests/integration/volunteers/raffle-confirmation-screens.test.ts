import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { type StaffRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { confirmVolunteerForRaffle } from "@/modules/volunteers/raffle-confirmation";
import { DomainError } from "@/shared/errors/domain-error";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §1028 (amending §984 and §1023), BR-REQ-060-01, BR-REQ-071-01, BR-REQ-041-01 — «Confirmă pentru tombolă» on the screens, read from a
 * real database:
 *
 * - «Ziua cursei» → «Tombolă»: on the row of a volunteer who is not confirmed — where it read «Nu · neconfirmat» — the organizers'
 *   press, asked first by the house's dialog naming the person; for a minor the form holds the way the parent agreed (the three
 *   ways) and the dialog the box «Părintele sau tutorele a fost de acord să participe la tombolă»; «Cu înscriere separată» the
 *   acceptance's tick. No press is drawn for the desk's Voluntar, the Redactor or Tehnic, who read the same table. Once confirmed,
 *   the row says «Da · confirmat doar pentru tombolă» with the parent's way — a raffle's confirmation, never a volunteer's;
 * - the volunteer's own page: the same press, and the same words once confirmed;
 * - «Ziua cursei» → «Jurnal»: who decided, when, how the parent agreed, counted per account and filtered by its kind;
 * - both languages.
 *
 * The race is in 2099; the made-up people are nobody.
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
    Link: ({ href, children, prefetch, ...rest }: { href: Href; children?: ReactNode; prefetch?: boolean } & Record<string, unknown>) =>
      createElement("a", { href: hrefOf(state.locale, href), "data-prefetch": String(prefetch), ...rest }, children),
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
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { default: JournalPage } = await import("@/app/[locale]/admin/checkin/jurnal/page");
const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");

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
/** 08:30:00 on the event's clock, the race's own day. */
const PRESSED = new Date("2099-11-21T06:30:00.000Z");

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
  for (const role of STAFF_ROLES) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-screens@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, timezone: "Europe/Bucharest", registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: EFFECTIVE, locationName: "Parcul Noua", hasRaffle: true })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-ecranelor-${serial}`, title: `Crosul ${serial}` },
    { eventId, locale: "en", slug: `the-screens-cross-${serial}`, title: `The cross ${serial}` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 9, position: 0 }).returning({ id: eventVolunteerRoles.id });
  roleId = role.id;
});

async function volunteer(name: string, more: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `screens-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "REGISTERED", source: "STAFF", roleId, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}
const maria = () => volunteer("Maria Minoră", { age: 17, dateOfBirth: "2082-05-01", guardianName: "Elena Minoră", guardianEmail: "elena-parent@example.test", guardianRequestedAt: EFFECTIVE });

const tabTree = (query: Record<string, string> = {}) => RafflePage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) });
const rowsOf = (page: string) =>
  [...page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => words(match[1])).filter((row) => row !== "" && !row.startsWith(ro.Admin.raffle.columns.number) && !row.startsWith(en.Admin.raffle.columns.number));
/** The press's form of each row, as the page hands it to the table, by the person's id. */
function confirmFormsOf(tree: ReactNode): Map<string, ReactElement<Props>> {
  const table = elements(tree).find((element) => element.props.tableId === "raffle-roster");
  const rows = (table?.props.rows ?? []) as Array<{ ref: { id: string } }>;
  const draw = table?.props.rowActions as ((row: unknown) => ReactNode) | undefined;
  const forms = new Map<string, ReactElement<Props>>();
  for (const row of rows) {
    const form = draw ? elements(draw(row)).find((element) => element.props["data-testid"] === "raffle-confirm-form") : undefined;
    if (form) forms.set(row.ref.id, form);
  }
  return forms;
}

async function approveTexts() {
  const notice: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Tombola ({{raffle}}): păstrăm înscrierea."] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["The raffle ({{raffle}}): we keep the sign-up."] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(notice), translations: notice, now: EFFECTIVE });
  const rules: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }));
  await insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(rules), translations: rules, now: EFFECTIVE });
}

describe("§1028 «Tombolă»: «Confirmă pentru tombolă» on the row of a volunteer not confirmed, for the organizers alone", () => {
  it("asks first, naming the person; a minor's form holds the three ways and the dialog the parent's box", async () => {
    const minor = await maria();
    const adult = await volunteer("Adrian Adult", { age: 30 });
    const tree = await tabTree();
    const page = await html(tree);
    expect(rowsOf(page)).toEqual([expect.stringMatching(/^— Adrian Adult Voluntar Nu · neconfirmat Nu/), expect.stringMatching(/^— Maria Minoră Voluntar Nu · neconfirmat Nu/)]);

    const forms = confirmFormsOf(tree);
    const minorSpec = forms.get(minor)?.props.confirm as ConfirmSpec;
    expect(minorSpec).toMatchObject({
      title: "Confirmi pe Maria Minoră pentru tombolă?",
      body: "Maria Minoră are sub 18 ani: participă doar cu acordul părintelui sau al tutorelui, dat {raffleGuardianWay}. Ca voluntar rămâne neconfirmat, fără acordul pentru voluntariat. Rămâne scris cine a decis.",
      email: "Nu pleacă niciun email către Maria Minoră.",
      tick: { field: "raffleGuardianAgreed", label: "Părintele sau tutorele a fost de acord să participe la tombolă" },
      fillFromChosen: ["raffleGuardianWay"],
      confirmLabel: "Da, confirmă pentru tombolă",
      cancelLabel: "Anulează",
    });
    expect(minorSpec.destructive).toBeUndefined();
    const adultSpec = forms.get(adult)?.props.confirm as ConfirmSpec;
    expect(adultSpec).toMatchObject({ title: "Confirmi pe Adrian Adult pentru tombolă?", body: ro.Admin.raffle.confirm.body, email: "Nu pleacă niciun email către Adrian Adult." });
    expect(adultSpec.tick).toBeUndefined();
    expect(adultSpec.fillFromChosen).toBeUndefined();

    // The minor's form: the way to choose, required, its three answers; the box the dialog fills, posted empty as drawn.
    const minorForm = await html(forms.get(minor)!);
    expect(minorForm).toMatch(/<select[^>]*name="raffleGuardianWay"[^>]*required=""|<select[^>]*required=""[^>]*name="raffleGuardianWay"/);
    expect([...minorForm.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => [match[1], match[2]])).toEqual([
      ["", "Alege cum"],
      ["PHONE", "telefonic"],
      ["IN_PERSON", "la fața locului"],
      ["WRITING", "în scris"],
    ]);
    expect(minorForm).toMatch(/<input type="hidden" name="raffleGuardianAgreed" value=""/);
    expect(minorForm).toContain('aria-label="Confirmă pentru tombolă: Maria Minoră"');
    expect(minorForm).toContain('<input type="hidden" name="back" value="raffle"/>');
    // «Din oficiu» signs nobody up: no acceptance's tick.
    expect(minorForm).not.toContain('name="accepted"');
    const adultForm = await html(forms.get(adult)!);
    expect(adultForm).not.toContain('name="raffleGuardianWay"');
    expect(adultForm).not.toContain('name="raffleGuardianAgreed"');
  });

  it("holds the acceptance's tick «Cu înscriere separată», where the press signs the person up", async () => {
    await approveTexts();
    await db.update(events).set({ raffleSignUp: true, raffleSignUpOpen: true }).where(eq(events.id, eventId));
    const minor = await maria();
    const form = await html(confirmFormsOf(await tabTree()).get(minor)!);
    expect(form).toMatch(/name="accepted"[^>]*required=""|required=""[^>]*name="accepted"/);
    expect(words(form)).toContain(ro.Admin.raffle.accepted);
  });

  it("is drawn for nobody else: the desk's Voluntar, the Redactor and Tehnic read the same row without it", async () => {
    await maria();
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      const tree = await tabTree();
      expect(confirmFormsOf(tree).size, role).toBe(0);
      const page = await html(tree);
      expect(page, role).not.toContain("raffle-confirm");
      expect(page, role).not.toContain(ro.Admin.raffle.confirm.button);
      expect(rowsOf(page), role).toEqual([expect.stringMatching(/^— Maria Minoră Voluntar Nu · neconfirmat Nu/)]);
    }
  });

  it("is not offered to a volunteer confirmed, taken out, confirmed for the raffle already, or of a raffle without the volunteers", async () => {
    const confirmed = await volunteer("Ioana Confirmată", { state: "CONFIRMED", volunteerNumber: 1 });
    const out = await volunteer("Oana Scoasă", { inRaffle: false });
    const done = await volunteer("Dan Gata");
    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: done, guardianAgreed: false, guardianWay: "", accepted: false }, PRESSED);
    const forms = confirmFormsOf(await tabTree());
    for (const id of [confirmed, out, done]) expect(forms.has(id)).toBe(false);
    const still = await volunteer("Vlad Așteaptă");
    expect(confirmFormsOf(await tabTree()).has(still)).toBe(true);
    await db.update(events).set({ raffleVolunteers: false }).where(eq(events.id, eventId));
    expect(confirmFormsOf(await tabTree()).size).toBe(0);
  });

  it("once confirmed says it is a raffle's confirmation — «Da · confirmat doar pentru tombolă» and the parent's way — in both languages", async () => {
    const minor = await maria();
    const adult = await volunteer("Adrian Adult", { age: 30 });
    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: minor, guardianAgreed: true, guardianWay: "PHONE", accepted: false }, PRESSED);
    await confirmVolunteerForRaffle(db, staff.ADMIN!, { eventId, volunteerId: adult, guardianAgreed: false, guardianWay: "", accepted: false }, PRESSED);
    expect(rowsOf(await html(await tabTree()))).toEqual([
      expect.stringMatching(/^V001 Maria Minoră Voluntar Da · confirmat doar pentru tombolă · acordul părintelui: telefonic Nu/),
      expect.stringMatching(/^V002 Adrian Adult Voluntar Da · confirmat doar pentru tombolă Nu/),
    ]);
    // Every desk role reads it so: a confirmation for the raffle, not a volunteer's.
    state.actor = staff.CONTRIBUTOR;
    expect(rowsOf(await html(await tabTree()))[0]).toMatch(/^V001 Maria Minoră Voluntar Da · confirmat doar pentru tombolă · acordul părintelui: telefonic/);
    state.actor = staff.MODERATOR;
    state.locale = "en";
    expect(rowsOf(await html(await tabTree()))[0]).toMatch(/^V001 Maria Minoră Volunteer Yes · confirmed for the raffle only · parent's consent: by phone/);
  });
});

describe("§1028 the volunteer's page: the same press, and the same words once confirmed", () => {
  const volunteerPage = (id: string) => AdminVolunteerPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) });

  it("offers «Confirmă pentru tombolă» beside «Tombolă: nu participă», coming back to the page, then says what was recorded", async () => {
    const minor = await maria();
    let [line] = byTestId(await volunteerPage(minor), "volunteer-raffle");
    expect(words(await html(line))).toContain("Tombolă: nu participă De ce: neconfirmat");
    const [form] = elements(line).filter((element) => element.props["data-testid"] === "volunteer-raffle-confirm-form");
    expect((form.props.confirm as ConfirmSpec).title).toBe("Confirmi pe Maria Minoră pentru tombolă?");
    const markup = await html(form);
    expect(markup).toContain('<input type="hidden" name="back" value="volunteer"/>');
    expect(markup).toContain('name="raffleGuardianWay"');

    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: minor, guardianAgreed: true, guardianWay: "WRITING", accepted: false }, PRESSED);
    [line] = byTestId(await volunteerPage(minor), "volunteer-raffle");
    expect(words(await html(line))).toBe("Tombolă: participă Confirmat doar pentru tombolă, nu ca voluntar · acordul părintelui: în scris");
    expect(elements(line).some((element) => element.props["data-testid"] === "volunteer-raffle-confirm-form")).toBe(false);
    // The volunteer's own state is untouched: still «Înscris».
    const chip = elements(await volunteerPage(minor)).find((element) => element.props.testId === "volunteer-state");
    expect(chip?.props.label).toBe(ro.Admin.volunteers.states.REGISTERED);
  });
});

describe("§1028 the «Voluntari» list's «Tombolă» column", () => {
  it("says a volunteer who takes part without being «Confirmat» is confirmed for the raffle alone", async () => {
    const minor = await maria();
    const waiting = await volunteer("Vlad Așteaptă");
    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: minor, guardianAgreed: true, guardianWay: "PHONE", accepted: false }, PRESSED);
    const page = await html(await AdminVolunteersPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId }) }));
    const standing = (id: string) =>
      [...page.matchAll(/<form[^>]*data-testid="volunteer-raffle-form"[\s\S]*?<\/form>/g)]
        .map((match) => match[0])
        .filter((one) => one.includes(`value="${id}"`))
        .map((one) => words(/data-testid="raffle-standing"[^>]*>([^<]*)</.exec(one)?.[1] ?? ""));
    expect(new Set(standing(minor))).toEqual(new Set(["Da · confirmat doar pentru tombolă"]));
    expect(new Set(standing(waiting))).toEqual(new Set(["Nu · neconfirmat"]));
  });
});

describe("§1028 «Jurnal»: who decided, when, and how the parent agreed", () => {
  const journal = (query: Record<string, string> = {}) =>
    atTheClock(new Date("2099-11-21T08:00:00.000Z"), async () => html(await JournalPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) })));
  const linesOf = (markup: string) => [...markup.matchAll(/<li[^>]*data-testid="race-day-journal-line"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => words(match[1]));
  const summaryOf = (markup: string) => [...markup.matchAll(/<li[^>]*data-testid="race-day-journal-account-line"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => words(match[1]));

  it("reads the confirmation beside the raffle's other lines, counted per account and filtered by its kind", async () => {
    const minor = await maria();
    const adult = await volunteer("Adrian Adult", { age: 30 });
    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: minor, guardianAgreed: true, guardianWay: "PHONE", accepted: false }, PRESSED);
    await confirmVolunteerForRaffle(db, staff.MODERATOR!, { eventId, volunteerId: adult, guardianAgreed: false, guardianWay: "", accepted: false }, new Date("2099-11-21T06:31:00.000Z"));

    const page = await journal();
    expect(linesOf(page)).toEqual([
      "08:31:00 Coleg MODERATOR a confirmat pentru tombolă Adrian Adult (voluntar)",
      "08:30:00 Coleg MODERATOR a confirmat pentru tombolă Maria Minoră (voluntar) · acordul părintelui: telefonic",
    ]);
    expect(summaryOf(page)).toEqual(["Coleg MODERATOR : 2 confirmați pentru tombolă"]);
    // Its own kind in the filter, and the lines it keeps.
    expect(page).toContain(`<option value="raffleConfirmed">${ro.Admin.raceDay.journal.kinds.raffleConfirmed}</option>`);
    expect(linesOf(await journal({ kind: "raffleConfirmed" }))).toHaveLength(2);
    expect(linesOf(await journal({ kind: "volunteerPresent" }))).toEqual([]);
    expect(linesOf(await journal({ kind: "raffleConfirmed", account: staff.MODERATOR!.id }))).toHaveLength(2);
    state.locale = "en";
    expect(linesOf(await journal())[1]).toBe("08:30:00 Coleg MODERATOR confirmed for the raffle Maria Minoră (volunteer) · parent's consent: by phone");
  });
});
