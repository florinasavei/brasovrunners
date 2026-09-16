/**
 * Which fields the server rejected, read back off the URL (BR-REQ-031-01, BR-REQ-031-04).
 *
 * `submitRegistrationAction` redirects with `?error=<code>&fields=<names>` — names only,
 * because nothing a participant typed may go into a URL that every proxy in between logs
 * (AGENTS.md §14.5). The page then marks those fields and links to them from the summary at
 * the top.
 *
 * That query parameter is a string anybody can type, so it is matched against this list rather
 * than trusted. Without the filter, `?fields=<whatever>` reaches `t("fieldNames.<whatever>")`,
 * which renders the raw key back to the visitor — a small reflected-content bug on the one
 * public form in the product.
 *
 * The list is also the contract the catalogues and the rendered form are checked against:
 * `tests/unit/registrations/form-errors.test.ts` asserts every name here has a label in both
 * locales and is a field `readRegistrationForm` actually reads.
 */
export const REGISTRATION_FORM_FIELDS = [
  "firstName",
  "lastName",
  "displayName",
  "email",
  "birthDate",
  "sex",
  "nationality",
  "city",
  "phone",
  "emergencyContactName",
  "emergencyContactPhone",
  "tshirtSize",
  "clubName",
  "healthNotes",
  "healthConsent",
  "privacyAcknowledged",
] as const;

export type RegistrationFormField = (typeof REGISTRATION_FORM_FIELDS)[number];

/**
 * The `fields` parameter as a set the form can ask about, with anything unrecognized dropped.
 *
 * Order follows the form rather than the URL, so the summary at the top of the page lists the
 * fields in the order somebody will meet them on the way down.
 */
export function parseInvalidFields(value: string | undefined): RegistrationFormField[] {
  if (!value) return [];
  const named = new Set(value.split(","));
  return REGISTRATION_FORM_FIELDS.filter((field) => named.has(field));
}

/**
 * The anchor a rejected submission is sent back to.
 *
 * Shared by the action that builds the redirect and the page that renders the target, because
 * a fragment that does not match anything fails silently — the browser simply leaves the
 * reader at the top of the page, which is the failure this exists to remove.
 *
 * It lives here and not in `actions.ts`: a `"use server"` module may export nothing but async
 * functions.
 */
export const ERROR_SUMMARY_ID = "registration-errors";
