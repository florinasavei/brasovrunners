import { type DomainError, isDomainError } from "@/shared/errors/domain-error";
import type { FormNotice } from "@/shared/feedback/notice";

/**
 * What a backoffice form is handed back when the server refuses it (`DECISIONS.md` §315).
 *
 * A refusal is returned, not redirected, so every box can read its value back (`RecallField`) —
 * with JavaScript off too, nothing in the URL and no cookie size limit (an event's bodies exceed
 * one). A success still redirects.
 *
 * `values` holds strings only: never a file, a `$ACTION_*` field, or a value meant to be retyped
 * (`NEVER_KEPT`) — refilling a typed confirmation would defeat the guard (§180, §287, §151).
 */
export type FormOutcome = {
  /** `Admin.errors.<code>`; absent on a success that stays on the page with `notice`. */
  error?: string;
  /** "It worked" as a toast, for an action that does not redirect (§384); a redirect flashes instead. */
  notice?: FormNotice;
  /** The sentence's placeholders (`{ age: "16 ani" }`, §329): words the action computed, never typed input. */
  errorValues?: Readonly<Record<string, string>>;
  /** The `name`s the refusal is about, for the summary's links; empty for the whole form. */
  fields: readonly string[];
  /** Every posted string by name; a repeated name keeps every value. */
  values: Readonly<Record<string, readonly string[]>>;
};

/**
 * Never carried back into a box: typed confirmations (§180, §287, §151) and, should one ever
 * exist, a password (`AGENTS.md` §10.3).
 */
export const NEVER_KEPT: ReadonlySet<string> = new Set([
  "typedConfirmation",
  "confirmName",
  "confirmCount",
  "typedTitle",
  "password",
  "confirm",
]);

/** Every posted string except the framework's `$…` fields and the ones meant to be retyped. */
export function keptValuesOf(form: FormData, never: Iterable<string> = []): Record<string, string[]> {
  const skipped = new Set([...NEVER_KEPT, ...never]);
  const values: Record<string, string[]> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string" || skipped.has(name) || name.startsWith("$")) continue;
    (values[name] ??= []).push(value);
  }
  return values;
}

/**
 * The outcome of a refused submit. Only a domain error becomes state; anything else is a bug and
 * is rethrown to the error boundary. `fieldNames` maps service field paths to posted names.
 */
export function refused(
  error: unknown,
  form: FormData,
  options: { fieldNames?: (error: DomainError) => readonly string[]; never?: Iterable<string> } = {},
): FormOutcome {
  if (!isDomainError(error)) throw error;
  return {
    error: error.code,
    fields: options.fieldNames ? options.fieldNames(error) : error.fields,
    values: keptValuesOf(form, options.never),
  };
}

/** A submit that worked and stays on its page, with its toast (§384). */
export function succeeded(notice: FormNotice): FormOutcome {
  return { notice, fields: [], values: {} };
}

/**
 * The id the refusal summary links to; `scope` keeps it unique when two forms on a page post the
 * same name.
 */
export function fieldId(name: string, scope?: string): string {
  return scope ? `field-${scope}-${name}` : `field-${name}`;
}
