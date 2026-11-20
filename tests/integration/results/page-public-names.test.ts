import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { PostedResultRow } from "@/modules/results/rows";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approvePrivacyNotice, approveResultsTexts, createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §985 — «Clasament» says why a line is «Participant #…», how many the site names, what «Loc» is, and «Public de la start»
 * (BR-REQ-050-02, BR-REQ-039-01; the owner, 2026-11-18, with every line reading «Pe site: Participant #001», «Nepublic» and «Cursa nu a
 * început încă»: «toate BIB-urile insa doar numele celor care au bifat ca vor sa apara se vad» — and «ce inseamna "Loc" aici?»).
 *
 * The page as the server draws it, in both languages: under each «Pe site: Participant #…» the reason `publicNameReason` gives (the tick
 * off, the club's «Apare pe site», not confirmed, a hidden guest, an older notice, a runner typed by hand with no agreement), none under a
 * named line; «Cu nume pe site: N din M» beside the counts; the one reason that is every line's — no approved notice describes the results
 * — said once at the top instead; the publish card's chip and sentence with the start's day and hour while ticked before the race; and the
 * plain words for «Loc» above the lines.
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

const { default: ResultsPage } = await import("@/app/[locale]/admin/events/[id]/results/page");
const { readEventResults, saveEventResults, setResultsPublished } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  admin = await person(db, "ADMIN", "Ana Admin");
  raceId = (await createRace(db)).id;
  state.actor = admin;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

async function render(at: Date = AFTER_THE_RACE, locale: "ro" | "en" = language) {
  language = locale;
  const element = await atTheClock(at, () => ResultsPage({ params: Promise.resolve({ locale, id: raceId }), searchParams: Promise.resolve({}) }));
  return renderToStaticMarkup(withClientWords(element, locale)).replace(/<style[\s\S]*?<\/style>/g, "");
}
const decode = (html: string) => html.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** The text of one registered line, by its number. */
function lineText(html: string, bib: number): string {
  const start = html.indexOf(`data-testid="result-line" data-bib="${bib}"`);
  if (start < 0) throw new Error(`no line ${bib}`);
  const next = html.indexOf('data-testid="result-line"', start + 1);
  return text(html.slice(start, next < 0 ? html.indexOf('data-testid="results-typed"', start) : next));
}
/** The reason under a registered line, or null. */
const reasonOf = (html: string, bib: number) => {
  const start = html.indexOf(`data-testid="result-line" data-bib="${bib}"`);
  const next = html.indexOf('data-testid="result-line"', start + 1);
  const slice = html.slice(start, next < 0 ? undefined : next);
  const match = /data-testid="result-public-reason"[^>]*>([^<]*)</.exec(slice);
  return match ? decode(match[1]) : null;
};
const typedReasons = (html: string) => [...html.matchAll(/data-testid="typed-public-reason"[^>]*>([^<]*)</g)].map((match) => decode(match[1]));
/** The words of a chip, by its test id. */
const chipText = (html: string, testId: string) => text(new RegExp(`data-testid="${testId}"[^>]*>([\\s\\S]*?)</div>`).exec(html)?.[1] ?? "");

/**
 * The field, under a notice that described the results from version 2: everyone registered under it but Vechi.
 * 101 Ana ticked (named) · 102 Bia did not tick · 103 Dan ticked, cancelled after his result · 104 Eli an elite whose «Apare pe site»
 * the club unticked · 105 Gigi a special guest the event hides · 106 Vechi registered under the older notice · 107 Ilie did not tick and
 * has no result yet · 900 Ion typed with no agreement · 901 Maria typed, agreed.
 */
async function field() {
  await approvePrivacyNotice(db, { results: false });
  await approvePrivacyNotice(db, { results: true });
  const under = { noticeVersion: 2 };
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, ...under });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, ticked: false, ...under });
  const dan = await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, ...under });
  const eli = await registerRunner(db, raceId, { name: "Eli Vasile", bibNumber: 104, ...under });
  await registerRunner(db, raceId, { name: "Gigi Stan", bibNumber: 105, outsideCapacity: true, ...under });
  await registerRunner(db, raceId, { name: "Vechi Inscris", bibNumber: 106, noticeVersion: 1 });
  await registerRunner(db, raceId, { name: "Ilie Fara", bibNumber: 107, ticked: false, ...under });
  await db.update(registrations).set({ elite: true, eliteHiddenFromSite: true }).where(eq(registrations.id, eli.id));
  await saveEventResults(
    db,
    admin,
    {
      eventId: raceId,
      rows: [
        line(101, { time: "50:00" }),
        line(102, { time: "45:00" }),
        line(103, { time: "47:00" }),
        line(104, { time: "40:00" }),
        line(105, { time: "52:00" }),
        line(106, { status: "DNF" }),
        typed(0, { bib: "900", name: "Ion Tastat", time: "55:00" }),
        typed(1, { bib: "901", name: "Maria Acord", time: "56:00", agreed: "on" }),
      ],
    },
    AFTER_THE_RACE,
  );
  await db.update(registrations).set({ status: "CANCELLED", cancelledAt: AFTER_THE_RACE, cancellationSource: "ADMIN" }).where(eq(registrations.id, dan.id));
}

describe("§985 «Pe site: Participant #…» says why, in Romanian", () => {
  it("says under each unnamed line the reason the rule gives, and nothing under a named line", async () => {
    await field();
    const html = await render();
    expect(lineText(html, 101)).toContain("Pe site: cu numele");
    expect(reasonOf(html, 101)).toBeNull();
    expect(reasonOf(html, 102)).toBe("N-a bifat „Vreau să apar pe lista de participanți & rezultate”.");
    expect(reasonOf(html, 103)).toBe("Înscrierea nu e confirmată.");
    expect(reasonOf(html, 104)).toBe("Un administrator a debifat „Apare pe site”.");
    expect(reasonOf(html, 105)).toBe("Invitat special: evenimentul nu arată public invitații speciali.");
    expect(reasonOf(html, 106)).toBe("Înscris sub o notă de confidențialitate mai veche: apare cu numele doar dacă cere din pagina înscrierii, când nota o permite.");
    // A line with no result yet still says why: the published results would show it so once it has one.
    expect(reasonOf(html, 107)).toBe("N-a bifat „Vreau să apar pe lista de participanți & rezultate”.");
    for (const bib of [102, 103, 104, 105, 106, 107]) expect(lineText(html, bib), String(bib)).toContain(`Pe site: Participant #${bib}`);
    // The typed lines: Ion with no agreement says so; Maria, agreed, is named and says nothing.
    expect(typedReasons(html)).toEqual(["Alergător trecut de mână: nu s-a notat acordul pentru nume."]);
    expect(html).not.toContain('data-testid="results-names-nobody"');
  });

  it("counts «Cu nume pe site: N din M» beside the counts: M the lines with a result the site would show, N those named", async () => {
    await field();
    const html = await render();
    // Eight results stored (107 has none); Ana and Maria are named.
    expect(chipText(html, "results-named-count")).toBe("Cu nume pe site: 2 din 8");
    // In the summary row, before the publish chip.
    const summary = html.slice(html.indexOf('data-testid="results-summary"'), html.indexOf('data-testid="results-published-chip"'));
    expect(summary).toContain('data-testid="results-named-count"');
  });

  it("leaves an elite out of the ranking out of M, and its line keeps its own words with no reason", async () => {
    await field();
    await db.update(registrations).set({ eliteHiddenFromResults: true }).where(eq(registrations.bibNumber, 104));
    const html = await render();
    expect(chipText(html, "results-named-count")).toContain("Cu nume pe site: 2 din 7");
    expect(lineText(html, 104)).toContain("Pe site: nu apare — elită în afara clasamentului");
    expect(reasonOf(html, 104)).toBeNull();
  });

  it("says once, at the top, that no approved notice describes the results — and no reason under any line", async () => {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, ticked: false });
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(101, { time: "50:00" }), line(102, { time: "45:00" }), typed(0, { bib: "900", name: "Ion Tastat", time: "55:00", agreed: "on" })] }, AFTER_THE_RACE);
    const html = await render();
    expect(html.match(/data-testid="results-names-nobody"/g)).toHaveLength(1);
    // Said once on the page: in that sentence at the top, and under no line.
    expect(text(html).split("Nota de confidențialitate în vigoare nu descrie clasamentul: nimeni nu apare cu numele.")).toHaveLength(2);
    expect(html.indexOf('data-testid="results-names-nobody"')).toBeLessThan(html.indexOf('data-testid="result-line"'));
    expect(html).not.toContain('data-testid="result-public-reason"');
    expect(html).not.toContain('data-testid="typed-public-reason"');
    for (const bib of [101, 102]) expect(lineText(html, bib)).toContain(`Pe site: Participant #${bib}`);
    expect(text(html)).toContain("Cu nume pe site: 0 din 3");
  });

  it("explains «Loc» above the lines, in plain words, with the details behind its «?»", async () => {
    await field();
    const html = await render();
    const hint = /data-testid="results-place-hint"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(text(hint)).toContain("„Loc” e locul în clasament: general și, sub el, la sex și la categorie. Îl calculează site-ul din timpi; până scrii un timp, rândul spune „fără loc încă”.");
    expect(hint).toContain('data-testid="results-place-help"');
    expect(hint).toMatch(/aria-label="Timpii egali împart locul/);
    // Above the lines, so a phone (no column header) reads it before the first «Loc:».
    expect(html.indexOf('data-testid="results-place-hint"')).toBeLessThan(html.indexOf('data-testid="result-line"'));
    // Once, above both panels — the typed runners' lines say «Loc:» too.
    expect(html.match(/data-testid="results-place-hint"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="results-place-hint"')).toBeLessThan(html.indexOf('data-testid="results-registered"'));
  });

  it("explains «Loc» once for a race whose only lines are typed by hand, and not at all with no line", async () => {
    expect(await render()).not.toContain('data-testid="results-place-hint"');
    await approvePrivacyNotice(db, { results: true });
    await saveEventResults(db, admin, { eventId: raceId, rows: [typed(0, { bib: "900", name: "Ion Tastat", time: "55:00" })] }, AFTER_THE_RACE);
    const html = await render();
    expect(html).toContain('data-testid="results-registered-empty"');
    expect(html.match(/data-testid="results-place-hint"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="results-place-hint"')).toBeLessThan(html.indexOf('data-testid="results-typed"'));
  });
});

describe("§985 the club's «Apare pe site» told from the person's own tick — read beside the tick, in results.ts", () => {
  it("says «hiddenByClub» exactly when the person ticked and the club unticked «Apare pe site» on an elite or an ambassador, and names as before", async () => {
    await approvePrivacyNotice(db, { results: true });
    const cases: { bib: number; ticked: boolean; elite: boolean; ambassador: boolean; hidden: boolean }[] = [];
    let bib = 200;
    for (const ticked of [true, false]) for (const elite of [true, false]) for (const ambassador of [true, false]) for (const hidden of [true, false]) cases.push({ bib: bib++, ticked, elite, ambassador, hidden });
    for (const runner of cases) {
      const registration = await registerRunner(db, raceId, { name: `Alergator ${runner.bib}`, bibNumber: runner.bib, ticked: runner.ticked });
      await db.update(registrations).set({ elite: runner.elite, ambassador: runner.ambassador, eliteHiddenFromSite: runner.hidden }).where(eq(registrations.id, registration.id));
    }
    await saveEventResults(db, admin, { eventId: raceId, rows: [...cases.map((runner) => line(runner.bib, { time: "50:00" })), typed(0, { bib: "900", name: "Ion Tastat", time: "55:00" })] }, AFTER_THE_RACE);
    const view = await readEventResults(db, admin, raceId);
    for (const runner of cases) {
      const read = view.registered.find((line) => line.bibNumber === runner.bib);
      // The club's tick counts under either mark, and only on a person who ticked; with both marks off it is inert (§910, §948).
      const hiddenByClub = runner.ticked && (runner.elite || runner.ambassador) && runner.hidden;
      const named = runner.ticked && !hiddenByClub;
      expect({ ...runner, named: read?.named, reason: read?.nameReason }).toEqual({ ...runner, named, reason: named ? "named" : hiddenByClub ? "hiddenByClub" : "notTicked" });
    }
    // A runner typed by hand has no registration, so no mark and no club tick: its own reason.
    expect(view.typed.map((line) => line.nameReason)).toEqual(["typedNoAgreement"]);
  });
});

describe("§985 «Public de la start» on the publish card", () => {
  const BEFORE = new Date(RACE_STARTS_AT.getTime() - 2 * 86_400_000);

  it("says, ticked before the race, «Public de la start» with the start's day and hour — in the summary, the card's header and the card", async () => {
    await field();
    await approveResultsTexts(db);
    await expect(setResultsPublished(db, admin, raceId, true, BEFORE)).resolves.toEqual({ changed: true, fromStart: true });
    const html = await render(BEFORE);
    expect(chipText(html, "results-published-chip")).toBe("Public de la start");
    const card = html.slice(html.indexOf('data-testid="results-publish"'));
    expect(card).toContain('data-testid="results-from-start-chip"');
    expect(text(card)).toContain("Clasamentul apare pe site de la start, sâm., 21 nov. 2026, la 09:00, pe măsură ce sosesc alergătorii.");
    expect(card).not.toContain('data-testid="results-publish-not-started"');
    // The page's own sentence before the race fits: the tick may be set, nothing shows before the start.
    expect(text(html)).toContain("Cursa nu a început încă. Poți scrie rezultate și bifa clasamentul public de pe acum; pe site nu apare nimic până la start.");
    expect(html).toMatch(/<input[^>]*name="published"[^>]*checked/);
  });

  it("says «Public» as before once the race has started, and nothing of the start", async () => {
    await field();
    await approveResultsTexts(db);
    await setResultsPublished(db, admin, raceId, true, BEFORE);
    const html = await render(AFTER_THE_RACE);
    expect(chipText(html, "results-published-chip")).toBe("Public");
    expect(html).not.toContain('data-testid="results-publish-from-start"');
    expect(html).not.toContain('data-testid="results-not-started"');
  });

  it("says, unticked before the race, that it may be ticked now and shows from the start", async () => {
    await field();
    await approveResultsTexts(db);
    const html = await render(BEFORE);
    expect(chipText(html, "results-published-chip")).toBe("Nepublic");
    expect(html).toContain('data-testid="results-publish-not-started"');
    expect(html).not.toContain('data-testid="results-from-start-chip"');
    expect(text(html)).toContain("Poți bifa de pe acum: pe site, clasamentul apare de la start, sâm., 21 nov. 2026, la 09:00, pe măsură ce sosesc alergătorii.");
  });
});

describe("§985 before the race, for whoever may not tick, and while the start's hour is to be announced", () => {
  const BEFORE = new Date(RACE_STARTS_AT.getTime() - 2 * 86_400_000);

  it("tells the Organizer only that results may be typed — no «bifa», no «Poți bifa de pe acum»", async () => {
    await field();
    state.actor = await person(db, "MODERATOR", "Oana Organizator");
    const html = await render(BEFORE);
    expect(text(html)).toContain("Cursa nu a început încă. Poți scrie rezultate de pe acum; pe site nu apare nimic până la start.");
    expect(text(html)).not.toContain("bifa clasamentul public");
    expect(html).not.toContain('data-testid="results-publish-not-started"');
    expect(html).toContain('data-testid="results-publish-admin-only"');
    // And in English.
    const en = text(await render(BEFORE, "en"));
    expect(en).toContain("The race has not started yet. You can type results already; nothing shows on the site before the start.");
    expect(en).not.toContain("You can tick it already");
  });

  it("names no hour while «Ora se anunță» is on: the results appear once the start's hour is announced", async () => {
    await field();
    await db.update(events).set({ timeToBeAnnounced: true }).where(eq(events.id, raceId));
    await approveResultsTexts(db);
    const unticked = text(await render(BEFORE));
    expect(unticked).toContain("Poți bifa de pe acum: pe site, clasamentul apare de la start, după ce anunți ora startului, pe măsură ce sosesc alergătorii.");
    expect(unticked).not.toContain("la 09:00");
    await setResultsPublished(db, admin, raceId, true, BEFORE);
    const html = await render(BEFORE);
    const card = text(html.slice(html.indexOf('data-testid="results-publish"')));
    expect(card).toContain("Clasamentul apare pe site de la start, după ce anunți ora startului, pe măsură ce sosesc alergătorii.");
    expect(card).not.toContain("la 09:00");
    expect(text(await render(BEFORE, "en"))).toContain("The results appear on the site from the start, once you announce the start's hour, as the runners arrive.");
  });
});

describe("§985 the same in English", () => {
  it("says the reasons, the count, «Place», and «Public from the start» in English", async () => {
    await field();
    await approveResultsTexts(db);
    const before = new Date(RACE_STARTS_AT.getTime() - 2 * 86_400_000);
    await setResultsPublished(db, admin, raceId, true, before);
    const html = await render(before, "en");
    expect(reasonOf(html, 102)).toBe("Did not tick “I want to appear on the participants & results list”.");
    expect(reasonOf(html, 103)).toBe("The registration is not confirmed.");
    expect(reasonOf(html, 104)).toBe("An administrator unticked “On the site”.");
    expect(reasonOf(html, 105)).toBe("A special guest: the event does not show its special guests publicly.");
    expect(reasonOf(html, 106)).toBe("Registered under an older privacy notice: appears by name only if they ask from their registration's page, once the notice allows it.");
    expect(typedReasons(html)).toEqual(["A runner entered by hand: no agreement to the name was recorded."]);
    const words = text(html);
    expect(words).toContain("Named on the site: 2 of 8");
    expect(words).toContain("“Place” is the place in the results: overall and, under it, by sex and by category.");
    expect(chipText(html, "results-published-chip")).toBe("Public from the start");
    expect(words).toContain("The results appear on the site from the start, Sat, 21 Nov 2026, at 09:00, as the runners arrive.");
  });

  it("says once, at the top, in English, that nobody appears by name", async () => {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(101, { time: "50:00" })] }, AFTER_THE_RACE);
    const words = text(await render(AFTER_THE_RACE, "en"));
    expect(words).toContain("The privacy notice in force does not describe the results: nobody appears by name.");
    expect(words).toContain("Named on the site: 0 of 1");
  });
});
