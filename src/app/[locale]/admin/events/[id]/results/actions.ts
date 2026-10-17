"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { ResultsCsvError } from "@/modules/results/domain/import-csv";
import { mergeImportedRows } from "@/modules/results/import-merge";
import { deleteEventResult, importResultsCsv, ResultRowError, saveEventResults, setResultsPublished } from "@/modules/results/results";
import { EXTRA_ROWS, postedResultRows } from "@/modules/results/rows";
import { RESULT_NAME_MAX, RESULT_NOTE_MAX } from "@/modules/results/domain/ranking";
import { requireStaff } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { keptValuesOf, type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";
import { RESULTS_CSV_MAX_CHARS } from "@/modules/results/domain/import-csv";

/*
  A race's results (§NNN): the Server Actions behind «Clasament». Each is a plain form that works with scripts off; every one asks
  the service, which asserts the role again (the Organizer and the Administrators enter, import and delete; only the Administrators
  publish — BR-REQ-060-01), so the buttons the page draws are a courtesy.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * Back to the page, with the toast's word in the flash cookie (§384) or, for a one-button form that has no boxes to keep, the
 * refusal's code in the address for the page's banner.
 */
async function backToPage(form: FormData, outcome: { saved?: string; error?: string; count?: string }): Promise<never> {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  if (outcome.saved) await flashOutcome({ saved: outcome.saved, ...(outcome.count ? { count: outcome.count } : {}) });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/results", params: { id } } });
  revalidatePath(path);
  redirect(`${path}${outcome.error ? `?resultsError=${encodeURIComponent(outcome.error)}` : ""}`);
}

/**
 * What a refused row of «Salvează tot clasamentul» says (§791's pattern): the runner in the sentence's placeholder — «#101 Ana
 * Popescu», the backoffice reads names — and the problem in the club's words, computed here in the language of the page the form came
 * from, because only the action knows which row and why.
 */
async function rowRefusal(error: ResultRowError, form: FormData): Promise<FormOutcome> {
  const t = await getTranslations({ locale: localeOf(form), namespace: "Admin" });
  const max = { note: RESULT_NOTE_MAX, nameLong: RESULT_NAME_MAX } as const;
  const bib = error.bibNumber === null ? t("results.problems.noNumber") : `#${error.bibNumber}`;
  return {
    ...refused(error, form),
    errorValues: {
      runner: error.runnerName ? `${bib} ${error.runnerName}` : bib,
      problem: t(`results.problems.${error.problem}`, { max: String((max as Record<string, number>)[error.problem] ?? 0) }),
    },
  };
}

/** What a refused CSV says: the line and the problem, or the problem alone for a file refused as a whole. */
async function importRefusal(error: ResultsCsvError, form: FormData): Promise<FormOutcome> {
  const t = await getTranslations({ locale: localeOf(form), namespace: "Admin" });
  return {
    // The pasted text stays in its box: what is wrong with it is said by line, and the club corrects it where it is.
    ...refused(error, form),
    errorValues: {
      where: error.line > 0 ? t("results.csvWhere", { line: String(error.line) }) : "",
      problem: t(`results.csvProblems.${error.problem}`, { max: String(RESULTS_CSV_MAX_CHARS) }),
    },
  };
}

/** The file or the pasted text the import reads: the file when one was chosen, else the box. */
async function importTextOf(form: FormData): Promise<string> {
  const file = form.get("importFile");
  if (file instanceof File && file.size > 0) {
    // A file past the limit is refused by the parser's own bound, never read whole into a string first.
    return file.size > RESULTS_CSV_MAX_CHARS * 4 ? "x".repeat(RESULTS_CSV_MAX_CHARS + 1) : file.text();
  }
  return field(form, "importText");
}

/**
 * «Importă din CSV»: the one form's second button. Reads the file or the pasted text, matches the numbers to the registrations and
 * answers with the table's boxes **filled** — a returned state, not a redirect, so every box comes back as it stands with the file's
 * times in the lines they belong to — and a notice that counts what was read and how many numbers need a name. **Nothing is saved**
 * (`importResultsCsv`): the club reads the table, then presses «Salvează tot clasamentul».
 */
async function importIntoForm(form: FormData): Promise<FormOutcome> {
  let rows;
  try {
    const actor = await requireStaff();
    rows = await importResultsCsv(getDb(), actor, eventIdOf(form), await importTextOf(form));
  } catch (error) {
    if (error instanceof ResultsCsvError) return importRefusal(error, form);
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "CONFLICT" || error.code === "NOT_FOUND" || error.code === "RESULTS_NOT_OPEN")) return refused(error, form);
    throw error;
  }
  // The pasted text and the chosen file leave the boxes: what they said is in the table now.
  const merged = mergeImportedRows(keptValuesOf(form, ["importText"]), rows);
  return {
    fields: [],
    values: merged.values,
    notice: merged.added > 0
      ? { kind: "info", key: "resultsImportedNew", values: { count: String(rows.length), new: String(merged.added) } }
      : { kind: "info", key: "resultsImported", values: { count: String(rows.length) } },
  };
}

/**
 * «Adaugă un alergător neînscris», pressed with scripts off: the page's boxes come back as they stand with one more blank typed line asked
 * for (`extraRows`, which the page posts again, so a second press adds a second line). Saves nothing. With scripts on the button adds the
 * line in the page and never posts.
 */
function addRowToForm(form: FormData): FormOutcome {
  const values = keptValuesOf(form, [EXTRA_ROWS]);
  const asked = Number(field(form, EXTRA_ROWS)) || 0;
  return { fields: [], values: { ...values, [EXTRA_ROWS]: [String(Math.min(Math.max(asked, 0) + 1, 50))] }, notice: { kind: "info", key: "resultsRowAdded" } };
}

/**
 * «Salvează tot clasamentul» (the owner, 2026-10-17: «să pot pune și clasament la final după cursă»; one save, §791's model): every row of
 * the page — the registered runners' lines, the runners typed by hand, each with its boxes — in one post, saved in one transaction
 * (`saveEventResults`) or, when any row is refused, none: the sentence names the runner, the boxes name what to correct, and every
 * box keeps what was typed (§315). A form drawn before another session saved is refused with CONFLICT. The toast counts the results
 * written. The form's other button, «Importă din CSV», only fills the boxes (`importIntoForm`).
 */
export async function saveEventResultsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  if (field(form, "intent") === "import") return importIntoForm(form);
  if (field(form, "intent") === "addRow") return addRowToForm(form);
  let saved;
  try {
    const actor = await requireStaff();
    saved = await saveEventResults(getDb(), actor, { eventId: eventIdOf(form), rows: postedResultRows(form.entries()), fingerprint: field(form, "fingerprint") || null }, new Date());
  } catch (error) {
    if (error instanceof ResultRowError) return rowRefusal(error, form);
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "CONFLICT" || error.code === "NOT_FOUND" || error.code === "RESULTS_NOT_OPEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToPage(form, { error: error.code });
  }
  const count = saved.created + saved.updated + saved.deleted;
  // A save that only moved places (a corrected answer changed a category) wrote no result: it says the places were counted again, not «0 rezultate».
  if (!saved.changed && saved.rewritten > 0) return backToPage(form, { saved: "resultsRecalculated" });
  return backToPage(form, saved.changed ? { saved: "resultsSaved", count: String(count) } : { saved: "resultsUnchanged" });
}

/** The row's own «Șterge»: asks first (§384) — a deleted result is gone, and the audit row keeps its number and state, never a name. */
export async function deleteEventResultAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    const bibNumber = Number(field(form, "bibNumber"));
    if (!Number.isInteger(bibNumber) || bibNumber <= 0) throw new DomainError("NOT_FOUND", "there is no result for that number");
    await deleteEventResult(getDb(), actor, { eventId: eventIdOf(form), bibNumber }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToPage(form, { error: error.code });
  }
  return backToPage(form, { saved: "resultDeleted" });
}

/**
 * «Clasamentul e public pe pagina evenimentului»: the Administrator's tick (a box and one button, never a toggle), saved on its own —
 * the disclosure has its own gate and its own audit row, and does not ride on a save of the rows. The state the box shows is the state
 * wanted, so two presses end where the second aimed. Switching it on is refused before the race has started (`RESULTS_NOT_STARTED`) and
 * while the privacy notice or the terms in force do not name `{{results}}` (`RESULTS_NOTICE`, `RESULTS_TERMS`): the summary says so, the
 * box comes back unticked, and the page's note links «Documente legale».
 */
export async function setResultsPublishedAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const on = field(form, "published") === "on";
  let changed: boolean;
  try {
    const actor = await requireStaff();
    changed = (await setResultsPublished(getDb(), actor, eventIdOf(form), on, new Date())).changed;
  } catch (error) {
    if (isDomainError(error) && (error.code === "RESULTS_NOTICE" || error.code === "RESULTS_TERMS" || error.code === "RESULTS_NOT_STARTED" || error.code === "RESULTS_NOT_OPEN")) return refused(error, form, { never: ["published"] });
    if (!isDomainError(error)) throw error;
    return backToPage(form, { error: error.code });
  }
  return backToPage(form, { saved: !changed ? "resultsPublicUnchanged" : on ? "resultsPublished" : "resultsUnpublished" });
}
