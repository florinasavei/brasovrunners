import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { changeRaceDayItem } from "@/modules/race-day/items";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { type Recall, RecallProvider } from "@/shared/forms/recall";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §979, §984, §986 — «Ziua cursei» as the server draws it (BR-REQ-037-07, BR-REQ-060-01, BR-REQ-041-01 criterion 6): the tabs on the
 * desk, «Lucruri de adus», «Cronometrare» and «Clasament» — the current one marked, the event carried, «Clasament» not drawn for a
 * role that cannot open it, «Cronometrare» for every role that works the desk, its short word for a phone, and the organizers'
 * «Tombolă» fourth of five for an event that holds a raffle, in a row that scrolls rather than one that fits —; the «Lucruri de adus»
 * page by role; the desk's line of free spares (§444) as ranges, and its two other states; and the walk-in's «Numărul dat acum» as a
 * select of the free spares, the lowest chosen.
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
  getMessages: async () => (state.locale === "ro" ? ro : en),
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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  createRegistrationAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  undoCheckInAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/checkin/lucruri/actions", () => ({
  addRaceDayItemAction: vi.fn(),
  editRaceDayItemAction: vi.fn(),
  removeRaceDayItemAction: vi.fn(),
  setRaceDayItemBroughtAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/events/[id]/results/actions", () => ({
  saveEventResultsAction: vi.fn(),
  deleteEventResultAction: vi.fn(),
  setResultsPublishedAction: vi.fn(),
  setResultAgeBandsAction: vi.fn(),
  setResultAwardsAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/checkin/cronometrare/actions", () => ({
  recordFinishPressAction: vi.fn(),
  undoFinishPressAction: vi.fn(),
  recordFinishFormAction: vi.fn(),
  undoFinishFormAction: vi.fn(),
  setRaceGunAction: vi.fn(),
  readFinishClockAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: DeskPage } = await import("@/app/[locale]/admin/checkin/page");
const { default: ItemsPage } = await import("@/app/[locale]/admin/checkin/lucruri/page");
const { default: ResultsPage } = await import("@/app/[locale]/admin/events/[id]/results/page");
const { default: TimingPage } = await import("@/app/[locale]/admin/checkin/cronometrare/page");
const { default: NewRegistrationPage } = await import("@/app/[locale]/admin/registrations/new/page");
const { StaffEventScope, StaffHandedBibField } = await import("@/modules/registrations/ui/StaffEventBirthDate");
const { raceDayTabs } = await import("@/modules/race-day/ui/RaceDayTabs");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"] as const) {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Ana ${role}`, role }).returning();
    staff[role] = row;
  }
  state.actor = staff.ADMIN;
});

async function race(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Start",
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  return event.id;
}

/** A confirmed runner wearing `bib`. */
async function runner(eventId: string, bib: number): Promise<void> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: "Ana Pop",
    displayName: "Ana Pop",
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date("2026-11-01T10:00:00.000Z"),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    bibNumber: bib,
    confirmedAt: new Date("2026-11-02T10:00:00.000Z"),
  });
}

/** The markup without Emotion's style tags, whose CSS would otherwise read as words. */
const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const text = (html: string) => strip(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (element: unknown) => strip(renderToStaticMarkup(withClientWords(element as never, state.locale)));

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

/**
 * The desk, as its parts: its tree holds an async island (`PaperConfirmationTip`) a synchronous render cannot draw, so the
 * tabs and the spares' line are found by their test id and drawn alone, in the order the page wrote them.
 */
async function desk(eventId?: string): Promise<string> {
  const tree = await DeskPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(eventId ? { eventId } : {}) } as never);
  return elements(tree)
    .filter((element) => element.props["data-testid"] === "race-day-tabs" || element.props["data-testid"] === "desk-spares" || element.props.variant === "h2")
    .map((element) => render(element))
    .join("\n");
}
const items = async (eventId?: string, error?: string) =>
  render(await ItemsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ ...(eventId ? { eventId } : {}), ...(error ? { error } : {}) }) } as never));
const results = async (id: string) => render(await ResultsPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never));
const timing = async (eventId?: string) => render(await TimingPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(eventId ? { eventId } : {}) } as never));
const walkIn = async (eventId: string, back = "desk") =>
  render(await NewRegistrationPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, back }) } as never));

/** The tabs' row: each link's address, words and whether it is the current one. */
function tabs(html: string): Array<{ href: string; label: string; current: boolean }> {
  const row = /<div[^>]*data-testid="race-day-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  if (!row) return [];
  return [...row[1].matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: (/href="([^"]*)"/.exec(match[1])?.[1] ?? "").replace(/&amp;/g, "&"),
    label: text(match[2]).trim(),
    current: match[1].includes('aria-current="page"'),
  }));
}

describe("§979 the tabs of «Ziua cursei»", () => {
  it("stand on the desk, «Prezența» current and the title under them unchanged, each carrying the chosen event", async () => {
    const id = await race();
    const html = await desk(id);
    expect(tabs(html)).toEqual([
      { href: `/ro/admin/checkin?eventId=${id}`, label: "Prezența", current: true },
      { href: `/ro/admin/events/${id}/results`, label: "Clasament", current: false },
      { href: `/ro/admin/checkin/cronometrare?eventId=${id}`, label: "Cronometrare Sosiri", current: false },
      { href: `/ro/admin/checkin/lucruri?eventId=${id}`, label: "Lucruri de adus Lucruri", current: false },
    ]);
    expect(html.indexOf('data-testid="race-day-tabs"')).toBeLessThan(html.indexOf("Masa de ridicare a numerelor"));
    // Never on paper.
    expect(html).toMatch(/data-testid="race-day-tabs"/);
  });

  it("stand on «Lucruri de adus», current, on «Clasament» for the page's own event, and on «Cronometrare» (§986), current", async () => {
    const id = await race();
    expect(tabs(await items(id)).map((tab) => [tab.label, tab.current])).toEqual([
      ["Prezența", false],
      ["Clasament", false],
      ["Cronometrare Sosiri", false],
      ["Lucruri de adus Lucruri", true],
    ]);
    expect(tabs(await results(id))).toEqual([
      { href: `/ro/admin/checkin?eventId=${id}`, label: "Prezența", current: false },
      { href: `/ro/admin/events/${id}/results`, label: "Clasament", current: true },
      { href: `/ro/admin/checkin/cronometrare?eventId=${id}`, label: "Cronometrare Sosiri", current: false },
      { href: `/ro/admin/checkin/lucruri?eventId=${id}`, label: "Lucruri de adus Lucruri", current: false },
    ]);
    expect(tabs(await timing(id)).map((tab) => [tab.label, tab.current])).toEqual([
      ["Prezența", false],
      ["Clasament", false],
      ["Cronometrare Sosiri", true],
      ["Lucruri de adus Lucruri", false],
    ]);
  });

  it("draw no glyph below `sm` (`compact`), so a role's row of three fits a 320-pixel phone, and every glyph from `sm` up", async () => {
    const id = await race();
    const raw = renderToStaticMarkup(withClientWords(await raceDayTabs({ locale: "ro", active: "timing", eventId: id, actor: staff.ADMIN! }), "ro"));
    // Four glyph wrappers, each `display: none` below `sm` and inline-flex from it.
    expect(strip(raw).match(/<span[^>]*aria-hidden="true"[^>]*><svg/g)).toHaveLength(4);
    expect(raw).toMatch(/@media \(min-width:600px\)\{[^}]*display:inline-flex/);
  });

  it("stand five for the organizers of an event that holds a raffle — «Tombolă» fourth, before «Lucruri de adus» — in a row that scrolls (§984)", async () => {
    const id = await race({ hasRaffle: true });
    for (const role of ["MODERATOR", "ADMIN"] as const) {
      state.actor = staff[role];
      expect(tabs(await desk(id)), role).toEqual([
        { href: `/ro/admin/checkin?eventId=${id}`, label: "Prezența", current: true },
        { href: `/ro/admin/events/${id}/results`, label: "Clasament", current: false },
        { href: `/ro/admin/checkin/cronometrare?eventId=${id}`, label: "Cronometrare Sosiri", current: false },
        { href: `/ro/admin/checkin/tombola?eventId=${id}`, label: "Tombolă", current: false },
        { href: `/ro/admin/checkin/lucruri?eventId=${id}`, label: "Lucruri de adus Lucruri", current: false },
      ]);
    }
    expect(tabs(await timing(id)).map((tab) => [tab.label, tab.current])).toEqual([
      ["Prezența", false],
      ["Clasament", false],
      ["Cronometrare Sosiri", true],
      ["Tombolă", false],
      ["Lucruri de adus Lucruri", false],
    ]);
    // Five are wider than a phone: the row carries the scroller that brings the current entry into view (`SubNavCurrent`, its hidden
    // span), scrolls inside itself, and still draws its glyphs from `sm` up only.
    const raw = renderToStaticMarkup(withClientWords(await raceDayTabs({ locale: "ro", active: "items", eventId: id, actor: staff.ADMIN! }), "ro"));
    expect(raw).toMatch(/<span hidden=""><\/span>/);
    expect(raw).toMatch(/overflow-x:auto/);
    expect(strip(raw).match(/<span[^>]*aria-hidden="true"[^>]*><svg/g)).toHaveLength(5);
    // The desk's other roles keep their three, «Tombolă» being the organizers'.
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      expect(tabs(await desk(id)).map((tab) => tab.label), role).toEqual(["Prezența", "Cronometrare Sosiri", "Lucruri de adus Lucruri"]);
    }
    state.actor = staff.MODERATOR;
    state.locale = "en";
    expect(tabs(await desk(id)).map((tab) => tab.label)).toEqual(["Attendance", "Results", "Timing Timing", "Raffle", "Things to bring Things"]);
  });

  it("draw no «Clasament» for a role that cannot open the results — «Cronometrare» for every desk role — and say the tabs in English too", async () => {
    const id = await race();
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      expect(tabs(await desk(id)).map((tab) => tab.label), role).toEqual(["Prezența", "Cronometrare Sosiri", "Lucruri de adus Lucruri"]);
    }
    state.actor = staff.MODERATOR;
    state.locale = "en";
    expect(tabs(await desk(id)).map((tab) => tab.label)).toEqual(["Attendance", "Results", "Timing Timing", "Things to bring Things"]);
  });

  it("carry no event, and draw no «Clasament», when no event takes entries", async () => {
    const html = await desk();
    expect(tabs(html)).toEqual([
      { href: "/ro/admin/checkin", label: "Prezența", current: true },
      { href: "/ro/admin/checkin/cronometrare", label: "Cronometrare Sosiri", current: false },
      { href: "/ro/admin/checkin/lucruri", label: "Lucruri de adus Lucruri", current: false },
    ]);
  });
});

describe("§979 «Lucruri de adus»", () => {
  it("counts, draws a row a thing with its tick form, its note and who brought it when — and the writer's pencil and «Șterge»", async () => {
    const id = await race();
    const { item: cords } = await changeRaceDayItem(db, staff.ADMIN!, { kind: "add", eventId: id, label: "Prelungitoare", note: "3 bucăți" }, new Date());
    await changeRaceDayItem(db, staff.ADMIN!, { kind: "add", eventId: id, label: "Markere", note: "" }, new Date());
    await changeRaceDayItem(db, staff.CONTRIBUTOR!, { kind: "setBrought", eventId: id, id: cords.id, brought: true }, new Date("2026-11-21T05:45:00.000Z"));

    const html = await items(id);
    expect(text(/data-testid="race-day-items-counts"[^>]*>([^<]*)</.exec(html)![1])).toBe("2 lucruri · 1 adus");
    const rows = [...html.matchAll(/data-testid="race-day-item" data-brought="(\d)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["1", "0"]);
    expect(html.match(/data-testid="race-day-item-tick-form"/g)).toHaveLength(2);
    // The tick posts the state it wants: the brought row asks to be unticked, the other to be ticked; 44 pixels, a checkbox.
    expect(html).toMatch(/name="itemId" value="[^"]+"\/><input type="hidden" name="brought" value="0"\/>/);
    expect(html).toMatch(/name="brought" value="1"/);
    expect(html).toContain('role="checkbox" aria-checked="true"');
    expect(text(html)).toContain("3 bucăți");
    expect(text(html)).toContain("adus · Ana CONTRIBUTOR · 07:45");
    expect(html.match(/data-testid="race-day-item-edit"/g)).toHaveLength(2);
    expect(html.match(/data-testid="race-day-item-remove-form"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="race-day-items-add-form"');
    // On paper: the checklist, one box ticked and one empty.
    const paper = /data-testid="race-day-items-paper"[^>]*>([\s\S]*?)<\/ul>/.exec(html)![1];
    expect(text(paper)).toContain("☑ Prelungitoare — 3 bucăți");
    expect(text(paper)).toContain("☐ Markere");
    // The add fold stays shut while the list has things.
    expect(html).not.toMatch(/<details[^>]*open=""[^>]*data-testid="race-day-items-add"/);
  });

  it("gives the desk's other roles the ticks only — no pencil, no «Șterge», no «Adaugă un lucru»", async () => {
    const id = await race();
    await changeRaceDayItem(db, staff.ADMIN!, { kind: "add", eventId: id, label: "Masă", note: "" }, new Date());
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      state.actor = staff[role];
      const html = await items(id);
      expect(html.match(/data-testid="race-day-item-tick-form"/g), role).toHaveLength(1);
      expect(html, role).not.toContain('data-testid="race-day-item-edit"');
      expect(html, role).not.toContain('data-testid="race-day-item-remove-form"');
      expect(html, role).not.toContain('data-testid="race-day-items-add"');
      expect(text(html), role).toContain("Lista o scriu Organizatorul și Administratorii.");
    }
    state.actor = staff.MODERATOR;
    expect(await items(id)).toContain('data-testid="race-day-item-edit"');
  });

  it("says an empty list, with «Adaugă un lucru» open by itself for the writer, and the alert of a refused press", async () => {
    const id = await race();
    const html = await items(id, "NOT_FOUND");
    expect(text(/data-testid="race-day-items-counts"[^>]*>([^<]*)</.exec(html)![1])).toBe("0 lucruri · 0 aduse");
    expect(text(html)).toContain("Lista e goală. Adaugă mai jos primul lucru de adus.");
    expect(html).toMatch(/<details[^>]*open=""[^>]*data-testid="race-day-items-add"/);
    expect(html).not.toContain('data-testid="race-day-items-paper"');
    expect(text(html)).toContain("Lucrul nu mai e pe listă");
    state.actor = staff.CONTRIBUTOR;
    expect(text(await items(id))).toContain("Lista e goală. Organizatorul sau un administrator adaugă lucrurile.");
  });

  it("is the 404 of an unknown page for a member", async () => {
    const [member] = await db.insert(staffUsers).values({ email: "member@example.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    state.actor = member;
    await expect(items()).rejects.toThrow("NOT_FOUND");
  });
});

describe("§979 the free spares on the desk", () => {
  const line = (html: string) => {
    const match = /data-testid="desk-spares"[^>]*>([^<]*)</.exec(html);
    return match ? text(match[1]).trim() : null;
  };

  it("says the free ones as ranges, as the event's bibs print them", async () => {
    const id = await race({ walkInBibStart: 155, walkInBibCount: 9 });
    expect(line(await desk(id))).toBe("Numere de rezervă libere (9): 155–163");
    await runner(id, 157);
    await runner(id, 161);
    expect(line(await desk(id))).toBe("Numere de rezervă libere (7): 155–156, 158–160, 162–163");
    const padded = await race({ walkInBibStart: 5, walkInBibCount: 3, bibDesign: { numberFormat: "pad3" } });
    expect(line(await desk(padded))).toBe("Numere de rezervă libere (3): 005–007");
  });

  it("says when none were reserved, and when every one was given", async () => {
    const none = await race();
    expect(line(await desk(none))).toBe("Nu sunt numere de rezervă pentru această cursă: un Administrator le tipărește din „Alocare și tipărire”.");
    const out = await race({ walkInBibStart: 300, walkInBibCount: 1 });
    await runner(out, 300);
    expect(line(await desk(out))).toBe(ro.Admin.desk.sparesOut);
    const one = await race({ walkInBibStart: 400, walkInBibCount: 1 });
    expect(line(await desk(one))).toBe("Număr de rezervă liber (1): 400");
  });
});

describe("§979 the walk-in's «Numărul dat acum»", () => {
  const select = (html: string) => /<select[^>]*name="bibNumber"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1];
  const options = (inner: string) => [...inner.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((match) => ({ value: match[1], selected: Boolean(match[2]), label: match[3] }));

  it("is a select of the free spares from the desk, lowest first and chosen, then «Alt număr…» and «Fără număr acum», under the spares' line", async () => {
    const id = await race({ walkInBibStart: 155, walkInBibCount: 4 });
    await runner(id, 155);
    const html = await walkIn(id);
    expect(options(select(html)!)).toEqual([
      { value: "156", selected: true, label: "156" },
      { value: "157", selected: false, label: "157" },
      { value: "158", selected: false, label: "158" },
      { value: "other", selected: false, label: "Alt număr…" },
      { value: "", selected: false, label: "Fără număr acum" },
    ]);
    expect(html).not.toMatch(/<input[^>]*name="bibNumber"/);
    expect(text(/data-testid="desk-spares"[^>]*>([^<]*)</.exec(html)![1])).toBe("Numere de rezervă libere (3): 156–158");
  });

  it("is the box as before without spares, all given, or from the list", async () => {
    const none = await race();
    for (const html of [await walkIn(none)]) {
      expect(select(html)).toBeUndefined();
      expect(html).toMatch(/<input[^>]*name="bibNumber"[^>]*type="number"|<input[^>]*type="number"[^>]*name="bibNumber"/);
    }
    const out = await race({ walkInBibStart: 300, walkInBibCount: 1 });
    await runner(out, 300);
    expect(select(await walkIn(out))).toBeUndefined();
    const spared = await race({ walkInBibStart: 500, walkInBibCount: 2 });
    const fromList = await walkIn(spared, "list");
    expect(select(fromList)).toBeUndefined();
    expect(fromList).not.toContain('data-testid="desk-spares"');
  });

  it("comes back after a refusal holding what was posted: a spare, «Fără număr acum», or «Alt număr…» with the typed box", async () => {
    const spares = { e1: { kind: "free" as const, options: [100, 101].map((number) => ({ number, label: String(number) })) } };
    const words = { pickHelp: "p", otherLabel: "Numărul de pe BIB", otherHelp: "o", noSpareHelp: "n", outHelp: "x", otherOption: "Alt număr…", noneOption: "Fără număr acum" };
    const draw = (posted: string | undefined) =>
      render(
        createElement(
          RecallProvider,
          {
            value: { values: posted === undefined ? null : { bibNumber: [posted] }, fields: posted === undefined ? [] : ["bibNumber"], generation: 1, fieldError: "Verifică" } as Recall,
          } as ComponentProps<typeof RecallProvider>,
          createElement(
            StaffEventScope,
            { eventDays: {}, initialEventId: "e1", today: "2026-11-18", earliest: "1906-11-18" } as ComponentProps<typeof StaffEventScope>,
            createElement(StaffHandedBibField, { label: "Numărul dat acum", words, spares }),
          ),
        ),
      );
    const chosen = (html: string) => options(/<select[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]).find((option) => option.selected)?.value;
    expect(chosen(draw(undefined))).toBe("100");
    expect(chosen(draw("101"))).toBe("101");
    expect(chosen(draw(""))).toBe("");
    const other = draw("900");
    expect(chosen(other)).toBe("other");
    // The select is unnamed then, and the typed box carries the number.
    expect(other).not.toMatch(/<select[^>]*name="bibNumber"/);
    expect(other).toMatch(/<input[^>]*name="bibNumber"[^>]*value="900"|<input[^>]*value="900"[^>]*name="bibNumber"/);
  });
});

describe("§979 the top nav on «Lucruri de adus»", () => {
  it("keeps «Ziua cursei» lit: the page's path is under the desk's, and the results keep their place", async () => {
    const { activeAdminTabHref } = await import("@/modules/staff-identity/domain/admin-tab-match");
    const nav = [{ href: "/ro/admin" }, { href: "/ro/admin/checkin" }, { href: "/ro/admin/registrations" }];
    expect(activeAdminTabHref(nav, "/ro/admin/checkin/lucruri")).toBe("/ro/admin/checkin");
    // «Cronometrare» (§986) the same: under the desk's path.
    expect(activeAdminTabHref(nav, "/ro/admin/checkin/cronometrare")).toBe("/ro/admin/checkin");
    expect(activeAdminTabHref(nav, "/ro/admin/events/0b6c1e7e-6f6a-4c55-9a43-2f6f3c5b8a10/results")).toBe("/ro/admin");
  });
});
