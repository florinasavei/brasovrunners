import { type DomainError, isDomainError } from "@/shared/errors/domain-error";

/**
 * What a backoffice form is handed back when the server refuses it (`DECISIONS.md` §315).
 *
 * The owner: "if I submit an invalid form (eg: event creation) the entire page gets cleared".
 * Every backoffice action used to answer a refusal with a redirect — `?error=CODE#admin-alert`
 * — and the redirected GET rendered the page from the database, or from nothing on a create,
 * so every box the organizer had typed into came back empty. The public registration form
 * solved the same problem with a sealed cookie (`registrations/form-draft.ts`, §142, §286),
 * and a cookie holds about four kilobytes; an event's rich-text bodies run to tens.
 *
 * So a refused backoffice submit does not redirect. The action **returns** this object, React's
 * `useActionState` hands it to the form (`ActionForm`), and every field reads its own value
 * back out of `values` (`RecallField`, `CheckboxField`, the editor islands). It works with
 * JavaScript off, because the server renders the page with the returned state on a plain POST;
 * it puts nothing in the URL; and it has no size limit a cookie has. A successful submit still
 * redirects exactly where it always did.
 *
 * `values` carries names and strings only — never a file, never a `$ACTION_*` field, and never
 * a value that exists to be retyped (`NEVER_KEPT`): a typed confirmation phrase, name or count is
 * the whole guard (§180, §287, §151), and refilling it would be the guard filling itself in.
 */
export type FormOutcome = {
  /** The domain error code, translated by the page as `Admin.errors.<code>`. */
  error: string;
  /**
   * What the sentence for `error` needs filled in, by placeholder name — `{ age: "16 ani" }` for
   * `Admin.errors.UNDER_MINIMUM_AGE` (§329), whose number is the event's. Words the action
   * computed, never anything typed: the summary substitutes them into the catalogue's `{age}`.
   * Absent for every code whose sentence has no placeholder.
   */
  errorValues?: Readonly<Record<string, string>>;
  /**
   * The form field names the refusal is about — the `name` attributes, so the summary can link
   * to the boxes — or empty when it is about the whole form. Names only, never values.
   */
  fields: readonly string[];
  /** Every posted string, by field name, so the page can put it back. A repeated name (a checkbox group) keeps every value. */
  values: Readonly<Record<string, readonly string[]>>;
};

/**
 * What is never carried back into a box, whatever form posted it.
 *
 * A typed confirmation is meant to be typed (§180: the registered name; §287: the count of the
 * selection; §151: the legal document's phrase; the event erase's title). A password field does
 * not exist anywhere in this product (`AGENTS.md` §10.3) and is listed so it never will be kept
 * by accident. File inputs are not strings and are dropped by `keptValuesOf` itself.
 */
export const NEVER_KEPT: ReadonlySet<string> = new Set([
  "typedConfirmation",
  "confirmName",
  "confirmCount",
  "typedTitle",
  "password",
  "confirm",
]);

/** The values the page puts back: every posted string but the framework's own and the ones meant to be retyped. */
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
 * The outcome of a refused submit, from the error the service threw.
 *
 * A domain error is an expected answer — forbidden, stale, invalid — and becomes the state the
 * form re-renders from. Anything else is a bug and is rethrown to Next's error boundary rather
 * than flattened into a friendly message that hides it (`admin/actions.ts#outcomeOf`).
 *
 * `fieldNames` maps the service's field paths (`translations.ro.title`, `capacity`) to the
 * names the form actually posts (`event.capacity`); the default keeps them as they are.
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

/**
 * The `id` a field carries so the refusal summary can link to it: `#field-<name>`, or
 * `#field-<scope>-<name>` for a form that shares its page with another posting the same name
 * (the registration page's cancel and erase both ask for a `reason`; the email copy editor is one
 * form per message and language) — two boxes with one id would be two labels for one box.
 */
export function fieldId(name: string, scope?: string): string {
  return scope ? `field-${scope}-${name}` : `field-${name}`;
}
