import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approvePrivacyNotice, approveResultsTexts, approveTerms, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN — «Clasament» as the server draws it, in both languages (BR-REQ-050-02, BR-REQ-041-01 criterion 6, BR-REQ-060-01): a line per registered runner
 * with its boxes and its place, the runners typed by hand and one blank line, the CSV box above the table, ONE «Salvează tot clasamentul», each line's
 * «Șterge» naming the page's one hidden delete form, the Administrator's tick with the gate's sentence and the link to «Documente legale», the
 * file's link, and nothing at all for a group run or a role that may not.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/events/[id]/results/actions", () => ({
  saveEventResultsAction: async () => null,
  deleteEventResultAction: async () => null,
  setResultsPublishedAction: async () => null,
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

const { default: ResultsPage } = await import("@/app/[locale]/admin/events/[id]/results/page");
const { saveEventResults } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  state.actor = staff.ADMIN;
});

const row = (bib: number, over: Record<string, string> = {}) => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

async function runners() {
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01", checkedInAt: AFTER_THE_RACE });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10", ticked: false });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21", checkedInAt: AFTER_THE_RACE });
  await saveEventResults(
    db,
    staff.ADMIN!,
    {
      eventId: raceId,
      rows: [row(101, { time: "50:00", note: "bine" }), row(102, { time: "45:00", chip: "44:58" }), { ...row(0), key: "n[0]", bib: "900", name: "Ion Vasile", sex: "MALE", birthDate: "05.03.1985", time: "42:00" }],
    },
    AFTER_THE_RACE,
  );
}

async function render(id = raceId, locale: "ro" | "en" = language, search: { resultsError?: string } = {}) {
  language = locale;
  const element = await atTheClock(AFTER_THE_RACE, () => ResultsPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve(search) }));
  return renderToStaticMarkup(withClientWords(element, locale));
}

/** The markup without Emotion's style tags, whose CSS would otherwise read as words. */
const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const text = (html: string) => strip(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const inputValue = (html: string, name: string) => new RegExp(`<input[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`).exec(html)?.[0].match(/value="([^"]*)"/)?.[1];

describe("§NNN the page, in Romanian", () => {
  it("draws a line per registered runner, checked-in first, each with its four boxes named by its race number and its saved values", async () => {
    await runners();
    const html = await render();
    expect(html.match(/data-testid="result-line"/g)).toHaveLength(3);
    // 101 and 103 are checked in, so they come first (by number); 102 follows.
    expect([...html.matchAll(/data-testid="result-line" data-bib="(\d+)"/g)].map((match) => match[1])).toEqual(["101", "103", "102"]);
    for (const bib of [101, 102, 103]) for (const box of ["time", "status", "chip", "note"]) expect(html).toContain(`name="r[${bib}].${box}"`);
    expect(inputValue(html, "r[101].time")).toBe("0:50:00");
    expect(inputValue(html, "r[102].chip")).toBe("0:44:58");
    expect(inputValue(html, "r[101].note")).toBe("bine");
    expect(inputValue(html, "r[103].time")).toBe("");
    // The status select shows the saved state, and «Fără rezultat» on a runner with none.
    expect(html).toMatch(/<select[^>]*name="r\[101\]\.status"[\s\S]*?<option value="FINISHED" selected/);
  });

  it("says the place a save gave, by sex and by category, and «fără loc încă» for a runner without a result", async () => {
    await runners();
    const words = text(await render());
    // Ion (typed, 42:00) is first overall, Bia second (45:00), Ana third (50:00).
    expect(words).toContain("la sex: 1");
    expect(words).toContain("la categorie (Feminin, 40-49 ani): 1");
    expect(words).toContain("fără loc încă");
  });

  it("says what the published list would call each runner: «Participant #bib» for one who did not tick, the name for one who did — once a notice describes the results", async () => {
    await runners();
    await approvePrivacyNotice(db, { results: true });
    const words = text(await render());
    expect(words).toContain("Pe site: Participant #102");
    expect(words).toContain("Pe site: cu numele");
    expect(words).toContain("Prezent");
  });

  it("says «Participant #bib» for every runner while no approved notice describes the results, ticked or not — never a guess from the tick alone", async () => {
    await runners();
    const words = text(await render());
    expect(words).toContain("Pe site: Participant #101");
    expect(words).toContain("Pe site: Participant #102");
    expect(words).not.toContain("Pe site: cu numele");
  });

  it("says «Participant #bib» for a runner who registered under an older notice than the first that described the results, though they ticked", async () => {
    await approvePrivacyNotice(db, { results: false });
    await registerRunner(db, raceId, { name: "Ana Veche", bibNumber: 101, noticeVersion: 1 });
    await approvePrivacyNotice(db, { results: true });
    await registerRunner(db, raceId, { name: "Bia Noua", bibNumber: 102, noticeVersion: 2 });
    const words = text(await render());
    expect(words).toContain("Pe site: Participant #101");
    expect(words).toContain("Pe site: cu numele");
  });

  it("says «fără loc» for a saved runner who dropped out and «fără loc încă» only for one with no result yet", async () => {
    await runners();
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [row(101, { time: "50:00" }), row(103, { status: "DNF" })] }, AFTER_THE_RACE);
    const html = await render();
    const placeOf = (bib: number) => text(html.slice(html.indexOf(`data-bib="${bib}"`)).split('data-testid="result-place"')[1].split("</div>")[0]);
    expect(placeOf(103)).toContain("fără loc");
    expect(placeOf(103)).not.toContain("încă");
    expect(placeOf(102)).toContain("fără loc încă");
  });

  it("names the blank status option for what it does: the status comes from the time", async () => {
    await runners();
    const words = text(await render());
    expect(words).toContain("Din timp (Sosit / Neprezentat)");
    expect(words).not.toContain("Fără rezultat");
  });

  it("gives the note box the sixth column from the medium width up, and the whole line only on a phone", async () => {
    await runners();
    const html = await render();
    expect(html).toMatch(/@media \(min-width:900px\)\{\.css-[\w-]+\{grid-column:auto;\}\}/);
  });

  it("offers the house's file picker: a button wearing a glyph as the label of a hidden input named importFile, and the file's name under it", async () => {
    await runners();
    const html = await render();
    expect(html).toMatch(/<label[^>]*for="results-import-file"[^>]*>[\s\S]*?<svg[\s\S]*?Alege un fișier/);
    const input = /<input[^>]*id="results-import-file"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('type="file"');
    expect(input).toContain('name="importFile"');
    expect(input).toContain("hidden");
    expect(text(html)).toContain("Niciun fișier ales.");
  });

  it("links the event's registrations by a plain path with its own locale once: /ro/admin/registrations?eventId=…, never /ro/ro/", async () => {
    await runners();
    const html = await render();
    expect(html).toContain(`href="/ro/admin/registrations?eventId=${raceId}"`);
    expect(html).not.toContain("/ro/ro/");
    expect(await render(raceId, "en")).toContain(`href="/en/admin/registrations?eventId=${raceId}"`);
  });

  it("draws «Adaugă un alergător neînscris» as a submit of the one form (intent=addRow), so it works with scripts off", async () => {
    await runners();
    const tag = /<button[^>]*data-testid="typed-add"[^>]*>/.exec(await render())?.[0] ?? "";
    expect(tag).toContain('type="submit"');
    expect(tag).toContain('name="intent"');
    expect(tag).toContain('value="addRow"');
  });

  it("draws the runners typed by hand with their boxes and one blank line more, and the button that adds another", async () => {
    await runners();
    const html = await render();
    expect(inputValue(html, "n[0].bib")).toBe("900");
    expect(inputValue(html, "n[0].name")).toBe("Ion Vasile");
    expect(inputValue(html, "n[0].birthDate")).toBe("05.03.1985");
    expect(html).toContain('name="n[0].sex"');
    expect(html).toContain('name="n[1].bib"');
    expect(inputValue(html, "n[1].bib")).toBe("");
    expect(html).not.toContain('name="n[2].bib"');
    expect(html).toContain('data-testid="typed-add"');
    expect(text(html)).toContain("Adaugă un alergător neînscris");
  });

  it("puts the CSV box above the table, inside the one form, with a button of its own that imports and never saves", async () => {
    await runners();
    const html = await render();
    const form = html.slice(html.indexOf('data-testid="results-form"'));
    expect(form.indexOf('name="importText"')).toBeGreaterThan(-1);
    expect(form.indexOf('name="importText"')).toBeLessThan(form.indexOf('name="r[101].time"'));
    expect(form).toContain('name="importFile"');
    expect(form).toMatch(/<button[^>]*name="intent"[^>]*value="import"|<button[^>]*value="import"[^>]*name="intent"/);
    expect(text(html)).toContain("Importă din CSV");
  });

  it("has ONE «Salvează tot clasamentul» — a visible button, and the form's hidden default that Enter presses", async () => {
    await runners();
    const html = await render();
    // One button says it (the import's help names it in a sentence, which is not a second button).
    expect([...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].filter((match) => text(match[1]).includes("Salvează tot clasamentul"))).toHaveLength(1);
    const saves = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]).filter((tag) => /value="save"/.test(tag));
    expect(saves).toHaveLength(2);
    // The hidden one comes first in the form: implicit submission presses it, never the import.
    expect(saves[0]).toContain('aria-hidden="true"');
    expect(saves[0]).toContain('tabindex="-1"');
  });

  it("carries the stored rows' fingerprint, so a form older than another save is refused", async () => {
    await runners();
    expect(inputValue(await render(), "fingerprint")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives each stored result a «Șterge» that names the page's one hidden delete form, posting its number", async () => {
    await runners();
    const html = await render();
    const deletes = [...html.matchAll(/<button[^>]*data-testid="result-delete"[^>]*>/g)].map((match) => match[0]);
    // Three results are stored (101, 102 and the typed 900); 103 has none.
    expect(deletes).toHaveLength(3);
    for (const tag of deletes) {
      expect(tag).toContain('form="delete-result"');
      expect(tag).toMatch(/name="bibNumber"/);
    }
    expect(deletes.map((tag) => tag.match(/value="(\d+)"/)?.[1]).sort()).toEqual(["101", "102", "900"]);
    expect(html.match(/<form[^>]*id="delete-result"[^>]*>/g)).toHaveLength(1);
    // The button is not nested in a form of its own: it belongs to the table's form and names the other by `form=`.
    expect(html).toContain('aria-label="Șterge rezultatul: #101 Ana Popescu"');
  });

  it("shows the Administrator the tick, unticked, with the gate's sentence and the link to «Documente legale» while no notice describes the results", async () => {
    await runners();
    const html = await render();
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="published"/);
    expect(html).not.toMatch(/<input[^>]*name="published"[^>]*checked/);
    expect(text(html)).toContain("Clasamentul e public pe pagina evenimentului");
    const gate = html.slice(html.indexOf('data-testid="results-notice-missing"'));
    expect(text(gate)).toContain("Nota de confidențialitate în vigoare nu descrie încă clasamentul");
    expect(gate).toMatch(/<a[^>]*href="[^"]*\/admin\/legal"/);
  });

  it("says the terms' own sentence while the terms in force do not describe the results, though the notice does", async () => {
    await runners();
    await approvePrivacyNotice(db, { results: true });
    const html = await render();
    expect(html).not.toContain('data-testid="results-notice-missing"');
    const gate = html.slice(html.indexOf('data-testid="results-terms-missing"'));
    expect(text(gate)).toContain("Termenii în vigoare nu descriu încă clasamentul");
    await approveTerms(db, { results: true });
    expect(await render()).not.toContain('data-testid="results-terms-missing"');
  });

  it("says the race's start is the gate while the race is ahead, and nothing of it once the gun has gone", async () => {
    const future = await createRace(db, { startsAt: new Date("2027-05-01T07:00:00Z") });
    expect(text(await render(future.id))).toContain("Clasamentul se poate publica după ce a început cursa");
    expect(await render()).not.toContain('data-testid="results-publish-not-started"');
  });

  it("drops the gate's sentences once a notice and terms from the templates are in force, and shows the tick ticked after it is switched on", async () => {
    await runners();
    await approveResultsTexts(db);
    expect(await render()).not.toContain('data-testid="results-notice-missing"');
    const { setResultsPublished } = await import("@/modules/results/results");
    await setResultsPublished(db, staff.ADMIN!, raceId, true, new Date("2026-11-22T10:00:00Z"));
    const html = await render();
    expect(html).toMatch(/<input[^>]*name="published"[^>]*checked/);
    expect(text(html)).toContain("Public");
  });

  it("shows the Organizer the same page without the tick: only an administrator can publish", async () => {
    await runners();
    state.actor = staff.MODERATOR;
    const html = await render();
    expect(html).not.toContain('name="published"');
    expect(text(html)).toContain("Doar un administrator poate publica clasamentul.");
    // Everything an Organizer enters is there.
    expect(html).toContain('name="r[101].time"');
    expect(html).toContain('data-testid="results-export"');
  });

  it("links the file that downloads the ranking, in the page's language", async () => {
    await runners();
    expect(await render()).toContain(`href="/api/admin/events/${raceId}/results?lang=ro"`);
    expect(text(await render())).toContain("Descarcă clasamentul (CSV)");
  });

  it("draws the summary chips with their own glyphs: did not start, dropped out and disqualified are no clock, calendar or question mark", async () => {
    await runners();
    const html = await render();
    const chips = html.slice(html.indexOf('data-testid="results-summary"'), html.indexOf('data-testid="results-published-chip"'));
    for (const icon of ["CheckCircleIcon", "DoNotDisturbIcon", "FlagIcon", "ErrorOutlinedIcon"]) expect(chips, icon).toContain(`data-testid="${icon}"`);
    for (const icon of ["HelpIcon", "ScheduleIcon", "EventBusyIcon"]) expect(chips, icon).not.toContain(`data-testid="${icon}"`);
  });

  it("counts the results by state in chips", async () => {
    await runners();
    const words = text(await render());
    expect(words).toContain("Sosiți: 3");
    expect(words).toContain("Abandon: 0");
  });

  it("is a named card, with the cards inside it levelled below the page's heading, and every control 44 pixels", async () => {
    await runners();
    const html = await render();
    expect(html).toMatch(/<details[^>]*id="box-results-import"/);
    expect(html).not.toMatch(/<details[^>]*id="box-results-import"[^>]*open/);
    expect(html).toMatch(/<section[^>]*id="box-results-registered"/);
    expect(html).toMatch(/<h3[^>]*>[\s\S]*?Alergători înscriși/);
    // Every box asks for the 44-pixel reach the thumb needs.
    expect(strip(html).match(/data-testid="result-time"/g)?.length).toBeGreaterThan(2);
    expect(html).toContain("min-height:44px");
  });

  it("says nothing is public yet and a race ahead may still be entered", async () => {
    const future = await createRace(db, { startsAt: new Date("2027-05-01T07:00:00Z") });
    const html = await render(future.id);
    expect(text(html)).toContain("Cursa nu a început încă");
    expect(text(html)).toContain("Nepublic");
  });

  it("explains an empty race: no registration holds a number yet", async () => {
    expect(text(await render())).toContain("Niciun înscris nu are încă număr de concurs");
  });
});

describe("§NNN the page, in English", () => {
  it("says the same in English: the lines, the CSV box, the one save, the tick and the gate", async () => {
    await runners();
    const html = await render(raceId, "en");
    const words = text(html);
    expect(words).toContain("Results: Tampa Race");
    for (const phrase of ["Import from CSV", "Save all the results", "The results are public on the event's page", "The privacy notice in force does not describe the results yet", "On the site: Participant #102", "Add a runner who did not register", "Download the results (CSV)", "Finished: 3", "Choose a file", "From the time (Finished / Did not start)"]) {
      expect(words, phrase).toContain(phrase);
    }
    expect([...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].filter((match) => text(match[1]).includes("Save all the results"))).toHaveLength(1);
    expect(html).toContain(`href="/api/admin/events/${raceId}/results?lang=en"`);
    expect(words).toContain("in the category (Female, 40-49): 1");
  });
});

describe("§NNN who may open it", () => {
  it("answers a group run with the sentence that says it has no results, and draws no form", async () => {
    const group = await createRace(db, { type: "GROUP_RUN" });
    const html = await render(group.id);
    expect(text(html)).toContain("Doar o cursă are clasament");
    expect(html).not.toContain('data-testid="results-form"');
    expect(html).toContain('data-testid="results-not-race"');
  });

  it("is the 404 an unknown page gets for the Tehnic role, the volunteer, an unknown event and a malformed id", async () => {
    for (const role of ["DEV", "CONTRIBUTOR"] as const) {
      state.actor = staff[role];
      await expect(render(), role).rejects.toThrow("NEXT_NOT_FOUND");
    }
    state.actor = staff.ADMIN;
    await expect(render("7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("x")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("says a refusal the one-button forms redirected with, in a banner", async () => {
    const html = await render(raceId, "ro", { resultsError: "RESULTS_NOTICE" });
    expect(html).toContain('data-testid="results-error"');
    expect(text(html)).toContain("Nota de confidențialitate în vigoare nu descrie încă clasamentul. Aprobă o notă nouă din șablon");
    // A code the page does not know is no banner at all.
    expect(await render(raceId, "ro", { resultsError: "ALTCEVA" })).not.toContain('data-testid="results-error"');
  });
});

describe("§NNN the agreement tick on the typed lines", () => {
  /** The checkbox input of a box name, as drawn. */
  const checkbox = (html: string, name: string) => new RegExp(`<input[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`).exec(html)?.[0] ?? "";
  const isChecked = (tag: string) => /\schecked(=|\s|\/|>)/.test(tag);

  it("draws one tick on every typed line — the stored one, the blank one after it — and none on a registered line, in Romanian", async () => {
    await runners();
    const html = await render();
    for (const name of ["n[0].agreed", "n[1].agreed"]) {
      const tag = checkbox(html, name);
      expect(tag, name).toContain('type="checkbox"');
      expect(isChecked(tag), name).toBe(false);
    }
    for (const bib of [101, 102, 103]) expect(html).not.toContain(`name="r[${bib}].agreed"`);
    const words = text(html);
    expect(words).toContain("A acceptat să apară cu numele în clasament");
    expect(words).toContain("Bifezi doar dacă persoana ți-a spus-o; cine a bifat și când rămân în jurnal.");
    // The tick is a real tick box of the house (a labelled input), not a button wearing a toggle's glyph.
    expect(html).toMatch(/<label[^>]*>[\s\S]*?name="n\[0\]\.agreed"[\s\S]*?A acceptat să apară cu numele în clasament/);
  });

  it("draws the stored agreement ticked, only on the line it was recorded for", async () => {
    await runners();
    await saveEventResults(
      db,
      staff.ADMIN!,
      { eventId: raceId, rows: [row(101, { time: "50:00" }), row(102, { time: "45:00" }), { ...row(0), key: "n[0]", bib: "900", name: "Ion Vasile", time: "42:00", agreed: "on" }, { ...row(0), key: "n[1]", bib: "901", name: "Maria Pop", time: "43:00" }] },
      AFTER_THE_RACE,
    );
    const html = await render();
    expect(isChecked(checkbox(html, "n[0].agreed"))).toBe(true);
    expect(isChecked(checkbox(html, "n[1].agreed"))).toBe(false);
    expect(isChecked(checkbox(html, "n[2].agreed"))).toBe(false);
  });

  it("says it in English too", async () => {
    await runners();
    const words = text(await render(raceId, "en"));
    expect(words).toContain("Agreed to appear by name in the results");
    expect(words).toContain("Tick only if the person told you so; who ticked it and when stay in the log.");
  });

  it("says the public rule of the typed runners in the typed card's intro, both languages", async () => {
    await runners();
    expect(text(await render())).toContain("Pe site apare „Participant #număr”, afară de cazul în care bifezi că persoana a acceptat numele.");
    expect(text(await render(raceId, "en"))).toContain("The site shows “Participant #number” unless you tick that the person agreed to the name.");
  });

  it("draws the stored agreement ticked whether or not a notice describes the results yet", async () => {
    await runners();
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [{ ...row(0), key: "n[0]", bib: "900", name: "Ion Vasile", time: "42:00", agreed: "on" }] }, AFTER_THE_RACE);
    const before = await render();
    expect(isChecked(checkbox(before, "n[0].agreed"))).toBe(true);
    await approvePrivacyNotice(db, { results: true });
    expect(isChecked(checkbox(await render(), "n[0].agreed"))).toBe(true);
  });
});
