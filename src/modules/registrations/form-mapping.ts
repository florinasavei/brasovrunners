import type { Locale } from "@/i18n/routing";

/**
 * The rendered form's field names, read into the shape `registrationSubmissionSchema` parses.
 *
 * ## Why this is a module and not four lines inside the server action
 *
 * `submitRegistration` takes `unknown`, because it parses input that arrived over the wire and
 * must not be trusted to have a shape. That is correct, and it has one consequence: when a
 * field is added to the schema and the action is not updated to read it, **nothing fails to
 * compile**. It fails at runtime, on the deployed form, as a generic validation error — which
 * is precisely what happened once already.
 *
 * Extracting the mapping does not fix that by itself. What it buys is a pure function that a
 * unit test can drive with a `FormData` built from the same names the page renders, so the
 * drift is caught by `yarn test` rather than by a browser, a deployment, or a person.
 */
export type RegistrationFormValues = ReturnType<typeof readRegistrationForm>;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * An unfilled optional field is absent, not empty.
 *
 * `z.string().max(200).optional()` accepts `""`, so passing the raw value would store an empty
 * club name — and, worse, an empty display name. BR-REQ-039-02 makes the display name fall back
 * to the legal name only when nothing was chosen, and an empty box is exactly that: nothing
 * chosen. Handing the schema `""` would mean storing a blank name on a public start list.
 */
function optional(form: FormData, name: string): string | undefined {
  const value = text(form, name).trim();
  return value === "" ? undefined : value;
}

/** An unchecked checkbox is absent from `FormData` entirely; a checked one is `"on"`. */
function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

export function readRegistrationForm(form: FormData, locale: Locale) {
  return {
    // BR-REQ-031-04 — the legal name, in two parts, and what the start list shows.
    firstName: text(form, "firstName"),
    lastName: text(form, "lastName"),
    displayName: optional(form, "displayName"),

    email: text(form, "email"),

    birthDate: text(form, "birthDate"),
    sex: text(form, "sex"),
    nationality: text(form, "nationality"),
    city: text(form, "city"),

    phone: text(form, "phone"),
    emergencyContactName: text(form, "emergencyContactName"),
    emergencyContactPhone: text(form, "emergencyContactPhone"),

    clubName: optional(form, "clubName"),
    tshirtSize: optional(form, "tshirtSize"),

    // BR-REQ-031-05 — the text is refused without its own consent, in the schema.
    healthNotes: optional(form, "healthNotes"),
    healthConsent: checked(form, "healthConsent"),

    locale,
    privacyAcknowledged: checked(form, "privacyAcknowledged"),
    resultsNameConsent: checked(form, "resultsNameConsent"),
    listOptOut: checked(form, "listOptOut"),

    // Validated in the service, not here: a honeypot failure and a timing failure are answered
    // exactly like success, never as a validation error that would tell a bot what it tripped.
    honeypot: text(form, "honeypot"),
    renderedAt: text(form, "renderedAt"),
  };
}
