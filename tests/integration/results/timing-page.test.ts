import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { asksBeforeAgain, type FinishLineState } from "@/modules/results/domain/finish-line";
import type { FinishLineWords } from "@/modules/results/ui/FinishLine";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { ConfirmDialogActions } from "@/shared/feedback/ConfirmDialog";
import { TOAST_MAX_CHARACTERS } from "@/shared/feedback/mail-line";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §986 — «Cronometrare» as the server draws it (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01 criterion 6), in both languages: the
 * fourth tab of «Ziua cursei» current; the gun's line, and «Start» for whoever enters results only; the elites' buttons first, by
 * label, 56 pixels and more, the numberless one disabled with what to do and a finished one with its time; the number box with the
 * numeric keypad; «Ultimii sosiți» with who entered each and «Anulează» on the viewer's own press at the line — or, the number pressed
 * again since, the sentence that «Clasament» corrects it; the sentence a plain press comes back with; a group run's one alert; a
 * member's 404. And the old «Sosire» sending its reader on with the event, and «Clasament» saying who wrote each line, folding
 * «Istoricul sosirilor» and linking «Cronometrare».
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/checkin/cronometrare/actions", () => ({
  recordFinishPressAction: async () => ({ kind: "session" }),
  undoFinishPressAction: async () => ({ kind: "session" }),
  recordFinishFormAction: async () => {},
  undoFinishFormAction: async () => {},
  setRaceGunAction: async () => {},
  readFinishClockAction: async () => ({ kind: "session" }),
  giveEliteNumberFormAction: async () => {},
}));
vi.mock("@/app/[locale]/admin/events/[id]/results/actions", () => ({
  saveEventResultsAction: async () => null,
  deleteEventResultAction: async () => null,
  setResultsPublishedAction: async () => null,
  setResultAgeBandsAction: async () => null,
  setResultAwardsAction: async () => null,
  resetEventResultsAction: async () => null,
  chooseRecordedTimeAction: async () => null,
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getMessages: async () => messages[language],
  getTranslations: async (arg?: string | { locale?: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "object" && arg.locale ? arg.locale : language;
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: namespace as never });
  },
}));

const { default: TimingPage } = await import("@/app/[locale]/admin/checkin/cronometrare/page");
const { default: FinishPage } = await import("@/app/[locale]/admin/events/[id]/results/sosire/page");
const { default: ResultsPage } = await import("@/app/[locale]/admin/events/[id]/results/page");
const { recordFinish, saveEventResults, setRaceGun } = await import("@/modules/results/results");
const { eliteAgainQuestion, finishToastSentence } = await import("@/modules/results/ui/FinishLine");
const { giveEliteLineNumber } = await import("@/modules/registrations/elite-list");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const GUN = RACE_STARTS_AT;
const at = (minutes: number, seconds = 0) => new Date(GUN.getTime() + minutes * 60_000 + seconds * 1000);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  state.actor = staff.ADMIN;
});

type Search = { eventId?: string; ok?: string; dup?: string; s?: string; t?: string; refused?: string; bib?: string; undone?: string; gun?: string; numbered?: string };
/** The page's markup with Emotion's styles in it (`raw`), or without them, whose CSS would otherwise read as words. */
async function timing(search: Search = { eventId: raceId }, now = at(50), locale: "ro" | "en" = language, raw = false) {
  language = locale;
  const element = await atTheClock(now, () => TimingPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(search) }));
  const html = renderToStaticMarkup(withClientWords(element, locale));
  return raw ? html : html.replace(/<style[\s\S]*?<\/style>/g, "");
}
async function results(now = at(50)) {
  const element = await atTheClock(now, () => ResultsPage({ params: Promise.resolve({ locale: language, id: raceId }), searchParams: Promise.resolve({}) }));
  return renderToStaticMarkup(withClientWords(element, language)).replace(/<style[\s\S]*?<\/style>/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

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

describe("§986 «Cronometrare»: the page", () => {
  it("stands fourth of «Ziua cursei»'s tabs, current, each tab carrying the event, the short words for a phone", async () => {
    const html = await timing();
    expect(tabs(html)).toEqual([
      { href: `/ro/admin/checkin?eventId=${raceId}`, label: "Prezența", current: false },
      { href: `/ro/admin/events/${raceId}/results`, label: "Clasament", current: false },
      { href: `/ro/admin/checkin/cronometrare?eventId=${raceId}`, label: "Cronometrare Sosiri", current: true },
      { href: `/ro/admin/checkin/lucruri?eventId=${raceId}`, label: "Lucruri de adus Lucruri", current: false },
      // «Jurnal» (§996) and «Declarații» (§1018), the organizers' last two.
      { href: `/ro/admin/checkin/jurnal?eventId=${raceId}`, label: "Jurnal", current: false },
      { href: `/ro/admin/checkin/declaratii?eventId=${raceId}`, label: "Declarații", current: false },
    ]);
    expect(text(html)).toContain("Cronometrare");
  });

  it("draws the gun's line and «Start» for whoever enters results, the box with the numeric keypad and «Ultimii sosiți»", async () => {
    const html = await timing();
    const words = text(html);
    expect(words).toContain("Startul planificat:");
    expect(html).toContain('data-testid="race-gun-start"');
    expect(html).toMatch(/name="claimedAtMs"/);
    expect(html).toMatch(/<input[^>]*name="bib"[^>]*inputMode="numeric"|<input[^>]*inputMode="numeric"[^>]*name="bib"/i);
    expect(words).toContain("De la start: 0:50:00");
    expect(words).toContain("Ultimii sosiți");
    expect(words).toContain("Nimeni nu a sosit încă.");
    expect(words).toContain("0 sosiți din 2 cu număr");
    // No chip time on this page.
    expect(words).not.toContain("Timp cip");
  });

  it("is the same page for the desk Volunteer — the box and the elites, no «Start» — and the 404 for a member", async () => {
    state.actor = staff.CONTRIBUTOR;
    const html = await timing();
    expect(html).toContain('data-testid="finish-form"');
    expect(html).not.toContain('data-testid="race-gun-start"');
    expect(text(html)).toContain("Startul planificat:");
    expect(tabs(html).map((tab) => tab.label)).toEqual(["Prezența", "Cronometrare Sosiri", "Lucruri de adus Lucruri"]);
    state.actor = staff.MEMBER;
    await expect(timing()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("draws the elites first, by label, each a button of 64 pixels — the numberless disabled with what to do, a finished one with its time", async () => {
    const elite = await registerRunner(db, raceId, { name: "Silviu Dobre", bibNumber: 110, sex: "MALE", birthDate: "1992-01-01" });
    await db.update(registrations).set({ elite: true, firstName: "Silviu" }).where(eq(registrations.id, elite.id));
    await db.insert(eventEliteEntries).values([
      { eventId: raceId, name: "Andrei Munteanu", bibNumber: 7 },
      { eventId: raceId, name: "Andrei Pop", bibNumber: null },
    ]);
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 110 }, at(31, 5));
    // The desk Volunteer, who does not write the elite list: the numberless line keeps its note (§990 — an Administrator's page, below).
    state.actor = staff.CONTRIBUTOR;
    const html = await timing();
    const elites = [...html.matchAll(/data-testid="finish-elite" data-bib="(\d*)"/g)].map((match) => match[1]);
    expect(elites).toEqual(["7", "", "110"]);
    expect(html.indexOf('data-testid="finish-elites"')).toBeLessThan(html.indexOf('data-testid="finish-form"'));
    // The buttons a thumb hits at the line: 64 pixels, the box beside «Sosit» too (BR-REQ-041-01 criterion 6 asks 44).
    expect(await timing({ eventId: raceId }, at(50), "ro", true)).toMatch(/min-height:64px/);
    const words = text(html);
    // Two «Andrei» told apart by the full name under the label.
    expect(words).toContain("Andrei Andrei Munteanu");
    expect(words).toContain("Andrei Andrei Pop");
    expect(words).toContain("Fără număr: un Administrator îi pune unul pe lista de elită");
    expect(words).toContain("Silviu Dobre · ✓ 0:31:05");
    // The two buttons that cannot be pressed: the numberless line and the elite already in.
    const buttons = [...html.matchAll(/<button([^>]*)data-testid="finish-elite-button"/g)].map((match) => match[1].includes('disabled=""'));
    expect(buttons).toEqual([false, true, true]);
    expect(html).not.toContain('data-testid="finish-elite-give-number"');
    expect(html).not.toContain('id="finish-elite-number"');
  });

  it("draws «Dă-i un număr» in a numberless line's grey button's place for whoever writes the elite list, and the line's button blue once numbered (§990)", async () => {
    await db.insert(eventEliteEntries).values({ eventId: raceId, name: "Andrei Munteanu", bibNumber: 7 });
    const [ingrid] = await db.insert(eventEliteEntries).values({ eventId: raceId, name: "Ingrid Pop", bibNumber: null }).returning({ id: eventEliteEntries.id });
    // The Administrator: in the place of the grey button, one press naming the line, posting a plain form of its own beside the elites'.
    const html = await timing();
    const cell = /<button([^>]*data-testid="finish-elite-give-number"[^>]*)>/.exec(html);
    expect(cell?.[1]).toContain('type="submit"');
    expect(cell?.[1]).toContain('form="finish-elite-number"');
    expect(cell?.[1]).toContain('name="entryId"');
    expect(cell?.[1]).toContain(`value="${ingrid.id}"`);
    expect(html).toMatch(/<form[^>]*id="finish-elite-number"/);
    expect(html.match(/data-testid="finish-elite-button"/g)).toHaveLength(1);
    const words = text(html);
    expect(words).toContain("Ingrid Dă-i un număr · Ingrid Pop");
    expect(words).not.toContain("Fără număr: un Administrator");
    // A thumb's target, as every elite's: 64 pixels drawn.
    expect(await timing({ eventId: raceId }, at(50), "ro", true)).toMatch(/min-height:64px/);
    expect(text(await timing({ eventId: raceId }, at(50), "en"))).toContain("Ingrid Give a number · Ingrid Pop");
    language = "ro";

    // Every other role at the line keeps the note: the Organizer does not write the elite list either.
    for (const role of ["MODERATOR", "CONTRIBUTOR", "DEV", "COPYWRITER"] as const) {
      state.actor = staff[role];
      const page = await timing();
      expect(page, role).not.toContain('data-testid="finish-elite-give-number"');
      expect(text(page), role).toContain("Fără număr: un Administrator îi pune unul pe lista de elită");
    }

    // Numbered — as the press does it —, the page says so and the line is a button like every other elite's, pressed by its number.
    state.actor = staff.ADMIN;
    const given = await giveEliteLineNumber(db, staff.ADMIN!, ingrid.id, at(49));
    const after = await timing({ eventId: raceId, numbered: String(given.bibNumber) });
    expect(text(after)).toContain(`Ingrid (#${given.bibNumber}) are acum număr: se cronometrează ca celelalte elite.`);
    expect(after).not.toContain('data-testid="finish-elite-give-number"');
    const buttons = [...after.matchAll(/data-testid="finish-elite" data-bib="(\d*)"/g)].map((match) => match[1]);
    expect(buttons).toEqual(["7", String(given.bibNumber)]);
    const pressable = [...after.matchAll(/<button([^>]*)data-testid="finish-elite-button"/g)].map((match) => [/value="(\d+)"/.exec(match[1])?.[1], match[1].includes('disabled=""')]);
    expect(pressable).toEqual([
      ["7", false],
      [String(given.bibNumber), false],
    ]);
    language = "en";
    expect(text(await timing({ eventId: raceId, numbered: String(given.bibNumber) }, at(50), "en"))).toContain(`Ingrid (#${given.bibNumber}) now has a number: timed like the other elites.`);
    language = "ro";
    // A refusal of the press comes back in the banner, in words.
    expect(text(await timing({ eventId: raceId, refused: "ELITE_NO_FREE_NUMBER" }))).toContain("Seria cursei nu mai are niciun număr liber");
  });

  it("lists who entered each finisher, «cont șters» for an account gone, and «Anulează» on the viewer's own for ten minutes", async () => {
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, at(45, 12));
    await recordFinish(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 101 }, at(48));
    state.actor = staff.CONTRIBUTOR;
    const html = await timing({ eventId: raceId }, at(50));
    const words = text(html);
    expect(words).toMatch(/#101 Ana Popescu · 0:48:00 · locul 2 · introdus de Oana Organizator.*#102 Bia Marin · 0:45:12 · locul 1 · introdus de Vlad Voluntar/);
    expect(html.match(/data-testid="finish-undo"/g)).toHaveLength(1);
    // Ten minutes after the volunteer's press, nothing to undo.
    expect(await timing({ eventId: raceId }, at(56))).not.toContain('data-testid="finish-undo"');
    language = "en";
    expect(text(await timing({ eventId: raceId }, at(50), "en"))).toMatch(/#102 Bia Marin · 0:45:12 · place 1 · entered by Vlad Voluntar/);
  });

  it("says on the viewer's own line why there is no «Anulează» once the number was pressed again, and offers none on a row typed on «Clasament»", async () => {
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, at(45, 12));
    await recordFinish(db, staff.COPYWRITER!, { eventId: raceId, bibNumber: 102 }, at(45, 20));
    state.actor = staff.CONTRIBUTOR;
    const html = await timing({ eventId: raceId }, at(46));
    expect(html).not.toContain('data-testid="finish-undo"');
    expect(html).toContain('data-testid="finish-undo-closed"');
    expect(text(html)).toContain("alt voluntar l-a trecut și el după tine: nu se mai anulează aici — corectează la «Clasament»");
    language = "en";
    expect(text(await timing({ eventId: raceId }, at(46), "en"))).toContain("another volunteer entered it after you too: it can no longer be undone here — correct it under «Results»");
    language = "ro";
    // The Organizer typed 101 on «Clasament» a minute ago: his own row, as written, yet no «Anulează» here — it was never pressed at the line.
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "46:00", status: "", chip: "", note: "", agreed: "" }, { key: "r[102]", bib: "102", name: "", sex: "", birthDate: "", time: "45:12", status: "", chip: "", note: "", agreed: "" }] }, at(46, 30));
    state.actor = staff.MODERATOR;
    const organizer = await timing({ eventId: raceId }, at(47));
    expect(text(organizer)).toContain("#101 Ana Popescu · 0:46:00 · locul 2 · introdus de Oana Organizator");
    expect(organizer).not.toContain('data-testid="finish-undo"');
    expect(organizer).not.toContain('data-testid="finish-undo-closed"');
  });

  it("says what a plain press did on its way back: recorded, a duplicate with who and when, a refusal with the time to write down", async () => {
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, at(45, 12));
    expect(text(await timing({ eventId: raceId, ok: "102" }))).toContain("Sosit: #102 Bia Marin · 0:45:12");
    expect(text(await timing({ eventId: raceId, dup: "102", t: "2720000" }))).toContain("#102 era deja trecut de Vlad Voluntar la 0:45:12 — rămâne așa; apăsarea ta (0:45:20)");
    expect(text(await timing({ eventId: raceId, refused: "RESULT_BIB_UNKNOWN", bib: "900", t: "2712000" }))).toContain("#900: nicio înscriere confirmată și nicio elită cu numărul acesta. Timpul lui: 0:45:12");
    expect(text(await timing({ eventId: raceId, refused: "RACE_GUN_FIXED" }))).toContain("Startul e fixat");
    // A runner «Clasament» disqualified: the press left the row as it was, and says so with its own time.
    expect(text(await timing({ eventId: raceId, dup: "101", s: "DSQ", t: "2720000" }))).toContain("#101 e trecut «Descalificat» la «Clasament» — rămâne așa; apăsarea ta (0:45:20) e în «Istoricul sosirilor».");
    // A state that is no decision says what a duplicate says.
    expect(text(await timing({ eventId: raceId, dup: "102", s: "<b>", t: "2720000" }))).toContain("#102 era deja trecut de Vlad Voluntar la 0:45:12");
    // A code the page does not know says nothing.
    expect(await timing({ eventId: raceId, refused: "<script>" })).not.toContain('data-testid="timing-banner"');
  });

  it("says «Start» as pressed, «Mută startul acum» and «Anulează startul» until the first finisher, then that the gun is fixed", async () => {
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(0, 3));
    let words = text(await timing({ eventId: raceId, gun: "set" }, at(1)));
    expect(words).toContain("Startul: 09:00:03 · apăsat de Oana Organizator");
    expect(words).toContain("Startul a fost dat: 09:00:03.");
    expect(words).toContain("Mută startul acum");
    expect(words).toContain("Anulează startul");
    // The organizer's own «Start» heard again within ten seconds: the page says the gun stays.
    expect(text(await timing({ eventId: raceId, gun: "repeat" }, at(1)))).toContain("Startul rămâne la 09:00:03: a doua apăsare, în cel mult zece secunde de la prima, nu îl mută.");
    language = "en";
    expect(text(await timing({ eventId: raceId, gun: "set" }, at(1), "en"))).toContain("The start was set: 09:00:03.");
    language = "ro";
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101 }, at(40));
    const html = await timing({ eventId: raceId }, at(41));
    words = text(html);
    expect(words).toContain("Startul e fixat: au sosit deja alergători.");
    expect(html).not.toContain('data-testid="race-gun-start"');
    // Counted from the gun pressed: 39:57.
    expect(words).toContain("#101 Ana Popescu · 0:39:57");
  });

  it("sends with «Start» the gun the page saw, and says who gave the start when a press under another gun was refused (§986)", async () => {
    // Drawn before anybody pressed: «Start» says it saw no gun.
    expect(await timing({ eventId: raceId }, at(0))).toMatch(/<input type="hidden" name="seenGunAtMs" value=""\/>/);
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(0, 3));
    // Drawn after: «Mută startul acum» under the gun as it stands.
    expect(await timing({ eventId: raceId }, at(1))).toContain(`<input type="hidden" name="seenGunAtMs" value="${at(0, 3).getTime()}"/>`);
    // The Administrator's press from a page drawn before it came back refused: who gave the start, and when.
    expect(text(await timing({ eventId: raceId, refused: "RACE_GUN_CHANGED" }, at(1)))).toContain("Startul a fost dat deja de Oana Organizator la 09:00:03: apăsarea ta nu l-a mutat.");
    language = "en";
    expect(text(await timing({ eventId: raceId, refused: "RACE_GUN_CHANGED" }, at(1), "en"))).toContain("The start was already given by Oana Organizator at 09:00:03: your press did not move it.");
    language = "ro";
    // Taken off since: the press set nothing, and the page asks for «Start» again.
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: true }, at(1, 30));
    expect(text(await timing({ eventId: raceId, refused: "RACE_GUN_CHANGED" }, at(2)))).toContain("Startul a fost anulat între timp: apăsarea ta nu l-a dat.");
  });

  it("draws the gun's sentence in the finish line's island, the one its clock counts from — for every role (§986)", async () => {
    state.actor = staff.CONTRIBUTOR;
    let html = await timing({ eventId: raceId }, at(0));
    // Inside the island, right above the clock — no «Start» box for the volunteer.
    const island = html.slice(html.indexOf('data-testid="finish-line"'));
    expect(island).toContain('data-testid="race-gun-line"');
    expect(island.indexOf('data-testid="race-gun-line"')).toBeLessThan(island.indexOf('data-testid="finish-clock"'));
    expect(html).not.toContain('data-testid="race-gun"');
    expect(text(html)).toContain("Până la «Start», sosirile se numără de la el.");
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(0, 3));
    html = await timing({ eventId: raceId }, at(1));
    expect(text(html)).toContain("Startul: 09:00:03 · apăsat de Oana Organizator");
    expect(text(html)).not.toContain("Până la «Start»");
  });

  it("offers no «Start» outside its window, says a group run has no results, and finds the address's event though the desk does not list it", async () => {
    expect(text(await timing({ eventId: raceId }, new Date(GUN.getTime() + 7 * 3_600_000)))).toContain("Butonul «Start» apare cu 3 ore înainte de startul planificat");
    const run = await createRace(db, { type: "GROUP_RUN" });
    const html = await timing({ eventId: run.id });
    expect(html).toContain('data-testid="results-not-race"');
    expect(html).not.toContain('data-testid="finish-form"');
    // A race of three days ago is no desk event: named in the address, it is the page's all the same.
    const old = await createRace(db, { startsAt: new Date(GUN.getTime() - 3 * 24 * 3_600_000) });
    const oldHtml = await timing({ eventId: old.id });
    expect(oldHtml).toContain(`<option value="${old.id}" selected="">`);
    expect(oldHtml).toContain('data-testid="finish-form"');
  });
});

describe("§986 the old «Sosire» address", () => {
  it("sends whoever records finishes on to «Cronometrare» with its event, and is the 404 for a member and for a malformed id", async () => {
    state.actor = staff.CONTRIBUTOR;
    await expect(FinishPage({ params: Promise.resolve({ locale: "ro", id: raceId }) })).rejects.toThrow(`NEXT_REDIRECT /ro/admin/checkin/cronometrare?eventId=${raceId}`);
    await expect(FinishPage({ params: Promise.resolve({ locale: "en", id: raceId }) })).rejects.toThrow(`NEXT_REDIRECT /en/admin/checkin/cronometrare?eventId=${raceId}`);
    await expect(FinishPage({ params: Promise.resolve({ locale: "ro", id: "not-an-id" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    state.actor = staff.MEMBER;
    await expect(FinishPage({ params: Promise.resolve({ locale: "ro", id: raceId }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("§986 «Clasament»: who wrote each line, «Istoricul sosirilor», and the link to «Cronometrare»", () => {
  it("says «introdus de» on a line as first written and «modificat de» once changed, and links «Cronometrare» with the event", async () => {
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, at(45, 12));
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "50:00", status: "", chip: "", note: "", agreed: "" }, { key: "r[102]", bib: "102", name: "", sex: "", birthDate: "", time: "45:12", status: "", chip: "", note: "a trecut linia", agreed: "" }] }, at(60));
    const html = await results(at(61));
    const written = [...html.matchAll(/data-testid="result-written-by"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(written).toEqual(["introdus de Ana Admin", "modificat de Ana Admin"]);
    expect(html).toContain(`href="/ro/admin/checkin/cronometrare?eventId=${raceId}"`);
    expect(text(html)).toContain("Cronometrare");
  });

  it("folds «Istoricul sosirilor», closed, each line when, who, what with the number, its name of today and the time, and from where", async () => {
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(0, 3));
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, at(45, 15));
    await recordFinish(db, staff.DEV!, { eventId: raceId, bibNumber: 102 }, at(45, 20));
    const html = await results(at(61));
    expect(html).toMatch(/<details[^>]*id="box-results-history"/);
    expect(html).not.toMatch(/<details[^>]*open=""[^>]*id="box-results-history"/);
    const lines = [...html.matchAll(/data-testid="results-history-line" data-where="(\w+)"[^>]*>([^<]*)</g)].map((match) => [match[1], text(match[2]).trim()]);
    expect(lines).toEqual([
      ["timing", "Sâm., 21 nov. 2026, 09:45:20 · Tudor Tehnic a trecut din nou #102 Bia Marin la 0:45:17 — rămâne 0:45:12 · Cronometrare"],
      ["timing", "Sâm., 21 nov. 2026, 09:45:15 · Vlad Voluntar a trecut #102 Bia Marin la 0:45:12 · Cronometrare"],
      ["timing", "Sâm., 21 nov. 2026, 09:00:03 · Oana Organizator a dat startul la 09:00:03 · Cronometrare"],
    ]);
    expect(text(html)).toContain("3 rânduri");
    // The row itself is the first press's, untouched.
    const [row] = await db.select().from(eventResults).where(eq(eventResults.eventId, raceId));
    expect(row.gunTimeMs).toBe(45 * 60_000 + 12_000);
  });

  it("says a press of a runner «Clasament» disqualified with the decision that stays", async () => {
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "DSQ", chip: "", note: "", agreed: "" }] }, at(50));
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101 }, at(51, 3));
    const lines = [...(await results(at(52))).matchAll(/data-testid="results-history-line" data-where="(\w+)"[^>]*>([^<]*)</g)].map((match) => text(match[2]).trim());
    expect(lines[0]).toBe("Sâm., 21 nov. 2026, 09:51:03 · Vlad Voluntar a trecut #101 Ana Popescu la 0:51:03 — rămâne Descalificat, cum e la «Clasament» · Cronometrare");
  });
});

/** The page's element tree, walked: every element in it, so a test reads the props the page hands its island. */
type Element = { props: Record<string, unknown> };
const elementsOf = (node: unknown): Element[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elementsOf(element.props.children)];
};

/**
 * §997 — a press this phone kept from before «Resetează clasamentul», refused after it: the island has the reason's words in both
 * languages, so the press's line says why it no longer counts instead of «nu s-a salvat — notează pe hârtie».
 */
describe("§997 «Cronometrare»: the words of a press older than the reset", () => {
  it("hands the island the refusal's sentence, in Romanian and in English", async () => {
    for (const [locale, sentence] of [
      ["ro", "apăsat înainte de resetarea clasamentului — nu mai contează"],
      ["en", "pressed before the results were reset — it no longer counts"],
    ] as const) {
      language = locale;
      const tree = await atTheClock(at(-50), () => TimingPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId }) }));
      const island = elementsOf(tree).find((element) => typeof element.props.words === "object" && element.props.words !== null && "refused" in (element.props.words as object));
      expect((island?.props.words as { refused: Record<string, string> } | undefined)?.refused.RESULT_PRESS_BEFORE_RESET, locale).toBe(sentence);
    }
  });
});

/**
 * §1010 — a finished elite's number typed again is asked first: the question the island builds from the page's own state and words
 * (`asksBeforeAgain`, `eliteAgainQuestion`), in Romanian and in English — the elite by label and name, the time stored and who entered
 * it, what a second press does — and its two answers as the house's dialog draws them, «Anulează» first, «Trece numărul din nou» in
 * the error colour, so Enter never answers it. The words ask of the number, never of the person, since the elites are men and women:
 * no «Îl treci», no «Trece-l». Any other number, «Sosit» or not, asks nothing.
 */
describe("§1010 «Cronometrare»: the question a finished elite's number typed again asks", () => {
  it("is worded from the page's state and words, in Romanian and in English, its two answers drawn by the house's dialog", async () => {
    await db.insert(eventEliteEntries).values([
      { eventId: raceId, name: "Andrei Munteanu", bibNumber: 7 },
      { eventId: raceId, name: "Ioana Pop", bibNumber: 8 },
    ]);
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 7 }, at(31, 5));
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101 }, at(31, 30));
    state.actor = staff.MODERATOR;
    for (const [locale, title, body, second, answers] of [
      [
        "ro",
        "A sosit deja",
        "Andrei (Andrei Munteanu) a sosit deja la 0:31:05 — introdus de Vlad Voluntar. Treci numărul din nou?",
        "Al doilea timp nu-l schimbă pe primul: apare doar în «Istoricul sosirilor», la «Clasament».",
        ["Anulează", "Trece numărul din nou"],
      ],
      [
        "en",
        "Already finished",
        "Andrei (Andrei Munteanu) already finished at 0:31:05 — entered by Vlad Voluntar. Enter the number again?",
        "A second time does not change the first: it only shows in «Finish history», under «Results».",
        ["Cancel", "Enter the number again"],
      ],
    ] as const) {
      language = locale;
      const tree = await atTheClock(at(32), () => TimingPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId }) }));
      const island = elementsOf(tree).find((element) => typeof element.props.words === "object" && element.props.words !== null && "eliteAgain" in (element.props.words as object));
      const words = island?.props.words as FinishLineWords;
      const initial = island?.props.initial as FinishLineState;
      const again = asksBeforeAgain(7, initial, [], staff.MODERATOR!.id, initial.gunAtMs);
      expect(again?.elite.label, locale).toBe("Andrei");
      const question = eliteAgainQuestion(words, again!);
      expect(question.title, locale).toBe(title);
      expect(question.body, locale).toBe(body);
      expect(question.also, locale).toEqual([{ text: second }]);
      expect(question.destructive, locale).toBe(true);
      // The dialog itself is a portal, which a Node render draws nothing of; its row of answers is drawn apart, in order.
      const row = renderToStaticMarkup(createElement(ConfirmDialogActions, { spec: question, mayConfirm: true, onCancel: () => {}, confirm: () => {}, confirmWithoutEmail: () => {} })).replace(
        /<style[\s\S]*?<\/style>/g,
        "",
      );
      const buttons = [...row.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ testId: /data-testid="([^"]+)"/.exec(match[1])?.[1], label: text(match[2]).trim(), error: match[1].includes("MuiButton-colorError") }));
      expect(buttons, locale).toEqual([
        { testId: "confirm-dialog-cancel", label: answers[0], error: false },
        { testId: "confirm-dialog-confirm", label: answers[1], error: true },
      ]);
      // An elite who has not crossed, and a runner «Sosit» who is no elite: nothing asked, pressed at once as before.
      expect(asksBeforeAgain(8, initial, [], staff.MODERATOR!.id, initial.gunAtMs), locale).toBeNull();
      expect(asksBeforeAgain(101, initial, [], staff.MODERATOR!.id, initial.gunAtMs), locale).toBeNull();
    }
    // Who entered it is left out once the elite is not among «Ultimii sosiți»: the time alone.
    language = "ro";
    const tree = await atTheClock(at(32), () => TimingPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: raceId }) }));
    const island = elementsOf(tree).find((element) => typeof element.props.words === "object" && element.props.words !== null && "eliteAgain" in (element.props.words as object));
    const initial = island?.props.initial as FinishLineState;
    const again = asksBeforeAgain(7, { ...initial, recent: [] }, [], staff.MODERATOR!.id, initial.gunAtMs);
    expect(eliteAgainQuestion(island?.props.words as FinishLineWords, again!).body).toBe("Andrei (Andrei Munteanu) a sosit deja la 0:31:05. Treci numărul din nou?");
  });
});

/**
 * §NNN — «Finish» with a number typed records it, and a short toast says every press that did something (the owner, 2026-11-20: the
 * box emptied after «Finish», and a small toast): the line under the box and the toast's words the page hands its island, in Romanian
 * and in English — an elite's of the number, never of the person (§1010), every sentence a toast's, under 200 characters —; and with
 * scripts off nothing new: the box's form posts the number as before, and neither «Finish» nor the line that names it is drawn.
 */
describe("§NNN «Cronometrare»: «Finish» with a number, the line under the box and the toast", () => {
  it("hands the island the line under the box and the toast's words, in Romanian and in English, each sentence under 200 characters", async () => {
    for (const [locale, help, recorded, elite, kept] of [
      [
        "ro",
        "Cu un număr scris, «Finish» sau «Sosit» îl trece; fără număr, «Finish» prinde doar timpul, pentru un grup.",
        "Nr. 205 — sosit la 0:23:41",
        "Nr. 7 (Andrei) — sosit la 0:31:05",
        "Timp prins la 0:23:41 — scrie numărul",
      ],
      [
        "en",
        "With a number typed, «Finish» or «Finished» enters it; with no number, «Finish» catches the time alone, for a bunch.",
        "No. 205 — finished at 0:23:41",
        "No. 7 (Andrei) — finished at 0:31:05",
        "Time caught at 0:23:41 — type the number",
      ],
    ] as const) {
      language = locale;
      const tree = await atTheClock(at(32), () => TimingPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ eventId: raceId }) }));
      const island = elementsOf(tree).find((element) => typeof element.props.words === "object" && element.props.words !== null && "toast" in (element.props.words as object));
      const words = island?.props.words as FinishLineWords;
      expect(words.boxHelp, locale).toBe(help);
      expect(finishToastSentence(words, { kind: "recorded", bibNumber: 205, label: null, gunTimeMs: 23 * 60_000 + 41_000 }), locale).toBe(recorded);
      expect(finishToastSentence(words, { kind: "recorded", bibNumber: 7, label: "Andrei", gunTimeMs: 31 * 60_000 + 5_000 }), locale).toBe(elite);
      expect(finishToastSentence(words, { kind: "kept", time: "0:23:41" }), locale).toBe(kept);
      // The longest a toast gets: six digits, a day's time and a label longer than the elite list keeps — the label cut, under 200.
      const longest = finishToastSentence(words, { kind: "recorded", bibNumber: 999_999, label: "Ș".repeat(150), gunTimeMs: 23 * 3_600_000 + 59 * 60_000 + 59_000 });
      expect(longest.length, locale).toBeLessThanOrEqual(TOAST_MAX_CHARACTERS);
      expect(longest, locale).toContain(`${"Ș".repeat(79)}…`);
      for (const sentence of [words.boxHelp, words.toast.recorded, words.toast.recordedElite, words.toast.kept]) expect(sentence.length, locale).toBeLessThanOrEqual(TOAST_MAX_CHARACTERS);
    }
    language = "ro";
  });

  it("draws nothing new with scripts off: the box's form posts the number as before, and neither «Finish» nor the line naming it", async () => {
    state.actor = staff.CONTRIBUTOR;
    for (const locale of ["ro", "en"] as const) {
      const html = await timing({ eventId: raceId }, at(50), locale);
      expect(html, locale).toContain('data-testid="finish-form"');
      expect(html, locale).toMatch(/<input[^>]*name="bib"/);
      expect(html, locale).toContain('data-testid="finish-record"');
      expect(html, locale).not.toContain('data-testid="finish-keep-button"');
      expect(html, locale).not.toContain('data-testid="finish-box-help"');
      expect(text(html), locale).not.toContain(locale === "ro" ? "Cu un număr scris" : "With a number typed");
    }
    language = "ro";
  });
});
