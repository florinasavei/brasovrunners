import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §997 — «Resetează clasamentul» on «Clasament» as the server draws it, in both languages (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01
 * criterion 6): the Administrator's danger card at the foot of the page, its one button asking first with the question that counts what
 * goes — the results by `countForm`, the start given and its hour, the phones' presses not sent — and posting what the page drew; drawn
 * disabled with the sentence why once the planned start has passed, or when there is nothing to wipe; not drawn for the Organizer, nor
 * on an event that is not a race; the banner's words for a refused reset, and the reset's own line in «Istoricul sosirilor».
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
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
const resetAction = vi.hoisted(() => async () => null);
vi.mock("@/app/[locale]/admin/events/[id]/results/actions", () => ({
  saveEventResultsAction: async () => null,
  deleteEventResultAction: async () => null,
  setResultsPublishedAction: async () => null,
  setResultsAllNamesAction: async () => null, setResultPublicNoteAction: async () => null, setResultDistanceAction: async () => null,
  setResultAgeBandsAction: async () => null,
  setResultAwardsAction: async () => null,
  resetEventResultsAction: resetAction,
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
const { resetEventResults, saveEventResults } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

/** An hour before the planned gun: the trial is over and the reset is open. Its «Start» was given at 07:55 in Brașov. */
const BEFORE_THE_START = new Date(RACE_STARTS_AT.getTime() - 50 * 60_000);
const TRIAL_GUN = new Date(RACE_STARTS_AT.getTime() - 65 * 60_000);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["SUPERADMIN", "Sorin Super"], ["MODERATOR", "Oana Organizator"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  state.actor = staff.ADMIN;
});

const row = (bib: number, over: Record<string, string> = {}) => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

/** The trial: a gun given and `count` results stored — the registered runners first, then runners typed by hand. */
async function trial(count: number, gun: Date | null = TRIAL_GUN) {
  if (gun) await db.update(events).set({ raceGunAt: gun, raceGunByStaffUserId: staff.ADMIN!.id }).where(eq(events.id, raceId));
  const rows = [row(101, { time: "50:00" }), row(102, { status: "DNS", note: "probă" })].slice(0, count);
  for (let index = rows.length; index < count; index += 1) rows.push({ ...row(0), key: `n[${index}]`, bib: String(900 + index), name: `Alergător ${index}`, time: "45:00" });
  await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows }, BEFORE_THE_START);
}

async function draw(at: Date = BEFORE_THE_START, locale: "ro" | "en" = language, search: { resultsError?: string } = {}, id = raceId) {
  language = locale;
  const tree = (await atTheClock(at, () => ResultsPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve(search) }))) as ReactElement;
  return { tree, html: renderToStaticMarkup(withClientWords(tree, locale)) };
}

type Element = ReactElement<Record<string, unknown>>;
/** Every element of a tree the Server Component returned, depth first. */
function elementsOf(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

/** The reset's form as the page hands it to the island: its action, its question and its hidden fields; undefined when not drawn. */
function resetForm(tree: ReactNode) {
  const form = elementsOf(tree).find((element) => element.props["data-testid"] === "results-reset-form");
  if (!form) return undefined;
  const inside = elementsOf(form.props.children as ReactNode);
  return {
    action: form.props.action,
    confirm: form.props.confirm as ConfirmSpec,
    hidden: Object.fromEntries(inside.filter((element) => element.type === "input" && element.props.type === "hidden").map((input) => [String(input.props.name), String(input.props.value)])),
    button: inside.find((element) => element.props.icon === "reset")?.props,
  };
}

const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const text = (html: string) => strip(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("§997 «Resetează clasamentul» on «Clasament»", () => {
  it("is the danger card at the foot of the page, its one button asking first with what goes, posting the count and the gun the page drew", async () => {
    await trial(3);
    const { tree, html } = await draw();
    // At the foot: after the history, the links and the registrations' door — the page's last card, its border the danger's.
    expect(html.lastIndexOf('data-testid="results-reset"')).toBeGreaterThan(html.indexOf('data-testid="results-registrations-link"'));
    expect(html.indexOf('data-testid="results-reset"')).toBeGreaterThan(html.indexOf('data-testid="results-history"'));
    const words = text(html);
    expect(words).toContain("Resetează clasamentul Doar înainte de start");
    expect(words).toContain("Pentru probele dinainte de cursă: șterge toate rezultatele și startul dat la «Cronometrare»");
    const form = resetForm(tree);
    expect(form?.action).toBe(resetAction);
    expect(form?.hidden).toMatchObject({ uiLocale: "ro", eventId: raceId, results: "3", seenGunAtMs: String(TRIAL_GUN.getTime()) });
    expect(form?.confirm).toEqual({
      title: "Resetezi clasamentul?",
      body: "Se șterg toate cele 3 rezultate ale cursei — sosiri, timpi, stări, note și rândurile alergătorilor neînscriși. Se șterge și startul dat la 07:55. Ce e pe telefoanele de la «Cronometrare» și n-a plecat încă se pierde. Nu se poate anula.",
      confirmLabel: "Resetează clasamentul",
      cancelLabel: "Renunță",
      destructive: true,
    });
    // The house's destructive shape: an outlined red button, the reset's glyph, its words while the press is on its way.
    expect(form?.button).toMatchObject({ color: "error", variant: "outlined", label: "Resetează clasamentul", pendingLabel: "Se resetează…" });
    expect(html).not.toContain('data-testid="results-reset-disabled"');
  });

  it("says it in English, the counted forms by countForm, and a gun alone or results alone", async () => {
    await trial(1);
    const english = resetForm((await draw(BEFORE_THE_START, "en")).tree);
    expect(english?.confirm).toMatchObject({
      title: "Reset the results?",
      body: "The race's 1 result is deleted — its finish, time, state, note or the line of a runner who did not register. The start given at 07:55 is deleted too. Whatever waits on the phones at «Timing», not sent yet, is lost. It cannot be undone.",
      confirmLabel: "Reset the results",
      destructive: true,
    });
    expect(resetForm((await draw(BEFORE_THE_START, "ro")).tree)?.confirm.body).toMatch(/^Se șterge 1 rezultat al cursei — sosirea, timpul, starea, nota sau rândul unui alergător neînscris\. Se șterge și startul/);

    // Twenty results: «de» before the noun; and no «Start» given — no sentence about a gun, the field empty.
    await resetTables(db);
    for (const [role, name] of [["ADMIN", "Ana Admin"]] as const) staff[role] = await person(db, role, name);
    state.actor = staff.ADMIN;
    raceId = (await createRace(db)).id;
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
    await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
    await trial(20, null);
    const many = resetForm((await draw(BEFORE_THE_START, "ro")).tree);
    expect(many?.hidden).toMatchObject({ results: "20", seenGunAtMs: "" });
    expect(many?.confirm.body).toBe(
      "Se șterg toate cele 20 de rezultate ale cursei — sosiri, timpi, stări, note și rândurile alergătorilor neînscriși. Ce e pe telefoanele de la «Cronometrare» și n-a plecat încă se pierde. Nu se poate anula.",
    );
  });

  it("asks about the gun alone when «Start» was given and nothing was entered", async () => {
    await trial(0);
    const form = resetForm((await draw()).tree);
    expect(form?.hidden).toMatchObject({ results: "0", seenGunAtMs: String(TRIAL_GUN.getTime()) });
    expect(form?.confirm.body).toBe("Nu e niciun rezultat; se șterge startul dat la 07:55. Ce e pe telefoanele de la «Cronometrare» și n-a plecat încă se pierde. Nu se poate anula.");
  });

  it("is drawn disabled with the sentence why once the planned start has passed — a test «Start» earlier does not close it before", async () => {
    await trial(2);
    // A minute before the planned gun, after the trial's «Start» an hour earlier: still open.
    expect(resetForm((await draw(new Date(RACE_STARTS_AT.getTime() - 60_000))).tree)).toBeDefined();
    for (const at of [RACE_STARTS_AT, AFTER_THE_RACE]) {
      const { tree, html } = await draw(at);
      expect(resetForm(tree)).toBeUndefined();
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="results-reset-disabled"|<button[^>]*data-testid="results-reset-disabled"[^>]*disabled=""/);
      expect(text(html)).toContain("Clasamentul se poate reseta doar înainte de start.");
    }
    expect(text((await draw(AFTER_THE_RACE, "en")).html)).toContain("The results can only be reset before the start.");
  });

  it("is drawn disabled with «Nimic de resetat» when there is no result and no start given", async () => {
    const { tree, html } = await draw();
    expect(resetForm(tree)).toBeUndefined();
    expect(html).toContain('data-testid="results-reset-disabled"');
    expect(text(html)).toContain("Nimic de resetat: niciun rezultat și niciun start dat.");
  });

  it("is the Superadministrator's too, and nobody else's: not drawn for the Organizer, nor on an event that is not a race", async () => {
    await trial(2);
    state.actor = staff.SUPERADMIN;
    expect(resetForm((await draw()).tree)).toBeDefined();
    state.actor = staff.MODERATOR;
    const organizer = await draw();
    expect(organizer.html).toContain('data-testid="results-form"');
    expect(organizer.html).not.toContain('data-testid="results-reset"');
    state.actor = staff.ADMIN;
    const groupRun = await createRace(db, { type: "GROUP_RUN" });
    const notRace = await draw(BEFORE_THE_START, "ro", {}, groupRun.id);
    expect(notRace.html).toContain('data-testid="results-not-race"');
    expect(notRace.html).not.toContain('data-testid="results-reset"');
  });

  it("says a refused reset in the banner: the start passed, or results arrived since the page was drawn", async () => {
    await trial(2);
    expect(text((await draw(AFTER_THE_RACE, "ro", { resultsError: "RESULTS_RESET_AFTER_START" })).html)).toContain("Clasamentul se poate reseta doar înainte de start.");
    const conflict = text((await draw(BEFORE_THE_START, "ro", { resultsError: "CONFLICT" })).html);
    expect(conflict).toContain("Între timp au venit rezultate noi sau startul s-a schimbat: nu s-a șters nimic.");
    expect(text((await draw(BEFORE_THE_START, "en", { resultsError: "CONFLICT" })).html)).toContain("New results arrived or the start changed meanwhile: nothing was deleted.");
  });

  it("comes back with no result on the page, and the reset's own line in «Istoricul sosirilor»", async () => {
    await trial(2);
    await resetEventResults(db, staff.ADMIN!, { eventId: raceId, seenResults: 2, seenGunAtMs: TRIAL_GUN.getTime() }, BEFORE_THE_START);
    const { tree, html } = await draw(new Date(BEFORE_THE_START.getTime() + 60_000));
    const words = text(html);
    expect(words).toContain("Sosiți: 0");
    expect(words).toContain("Neprezentați: 0");
    expect(html).not.toContain('data-testid="result-delete"');
    expect(words).toMatch(/Ana Admin a resetat clasamentul: 2 rezultate șterse, startul anulat · Clasament/);
    // Nothing left to wipe: the card stays, the button disabled with its sentence.
    expect(resetForm(tree)).toBeUndefined();
    expect(words).toContain("Nimic de resetat: niciun rezultat și niciun start dat.");
    expect(text((await draw(new Date(BEFORE_THE_START.getTime() + 60_000), "en")).html)).toMatch(/Ana Admin reset the results: 2 results deleted, the start cancelled · Results/);
  });
});
