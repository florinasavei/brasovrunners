import type { Locale } from "@/i18n/routing";
import { composePhone } from "./phone";
import { env } from "@/shared/config/env";

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

/**
 * The country and the digits become one international number (`DECISIONS.md` §84). Empty
 * stays absent, so the staff form's optional phone is optional; digits that cannot be a number
 * pass through as typed, so the schema refuses them by the field's name.
 */
function phoneField(form: FormData, name: string): string | undefined {
  const typed = text(form, name).trim();
  if (typed === "") return undefined;
  return composePhone(text(form, `${name}Country`) || "RO", typed) ?? typed;
}

export function readRegistrationForm(
  form: FormData,
  locale: Locale,
  // Whether the form offered a public display name (`FEATURE_DISPLAY_NAME`, §95); a test names it.
  options: { displayName: boolean } = { displayName: env.FEATURE_DISPLAY_NAME },
) {
  return {
    // BR-REQ-031-04 — the legal name, in two parts, and what the start list shows.
    firstName: text(form, "firstName"),
    lastName: text(form, "lastName"),
    // Only when the form offers it (`FEATURE_DISPLAY_NAME`, §95); otherwise the registered name is the name.
    displayName: options.displayName ? optional(form, "displayName") : undefined,

    email: text(form, "email"),

    birthDate: text(form, "birthDate"),
    sex: text(form, "sex"),
    nationality: text(form, "nationality"),
    city: text(form, "city"),

    phone: phoneField(form, "phone"),
    emergencyContactName: text(form, "emergencyContactName"),
    emergencyContactPhone: phoneField(form, "emergencyContactPhone"),

    clubName: optional(form, "clubName"),
    // BR-REQ-031-06 — a claim the club can see and correct, and that grants nothing.
    clubMemberDeclared: checked(form, "clubMemberDeclared"),
    guardianName: text(form, "guardianName"),
    stravaUrl: text(form, "stravaUrl"),
    instagramHandle: text(form, "instagramHandle"),
    tshirtSize: optional(form, "tshirtSize"),

    // BR-REQ-031-05 — the text is refused without its own consent, in the schema.
    healthNotes: optional(form, "healthNotes"),
    healthConsent: checked(form, "healthConsent"),
    // "Declar că sunt apt" (§171) — required on the public form, absent on a staff entry.
    fitnessDeclared: checked(form, "fitnessDeclared"),

    // The language of the emails and the declaration (§97): chosen on the form, the page's
    // language until chosen — a runner on the Romanian site may still want English.
    locale: form.get("preferredLocale") === "en" ? "en" : form.get("preferredLocale") === "ro" ? "ro" : locale,
    privacyAcknowledged: checked(form, "privacyAcknowledged"),
    resultsNameConsent: checked(form, "resultsNameConsent"),
    // Opted into, not out of (§143): the row keeps the column's name, the box asks the other way.
    listOptOut: !checked(form, "listOptIn"),

    // Validated in the service, not here: a honeypot failure and a timing failure are answered
    // exactly like success, never as a validation error that would tell a bot what it tripped.
    honeypot: text(form, "honeypot"),
    renderedAt: text(form, "renderedAt"),
  };
}
