import { z } from "zod";

/**
 * The registration form's editable fields (BR-REQ-031-01 criterion 1): full name, email,
 * locale, the privacy-notice acknowledgment, and the public-results consent. No password
 * field and no login link exist because none is in this schema to render.
 *
 * `honeypot` and `renderedAt` are the spam defenses of AGENTS.md §19.4 / WEEKEND.md — a hidden
 * field a human never fills in, and a submission-timing check. Both are validated in
 * `service.ts` rather than here, because a honeypot failure and a timing failure are answered
 * exactly like success (a generic "check your email" response), never with a validation error
 * that would tell a bot which defense it tripped.
 */
const submissionFields = z.object({
  /**
   * The legal name, in two parts (BR-REQ-031-04). Composed into `registered_name` at write
   * time — the declaration is signed against that string, so it is stored, not derived later.
   */
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),

  /**
   * What a public start list shows (BR-REQ-039-02).
   *
   * Optional here and NOT NULL in the table on purpose: blank means "use the derived one",
   * which `resolveDisplayName` turns into a first name and a last initial. The one thing it
   * must never become is the legal name by default.
   */
  displayName: z.string().trim().max(120).optional(),

  /**
   * A date, never an age (BR-REQ-031-04 criterion 4). An age is wrong by the next birthday,
   * and race categories are worked out against the day of the race.
   */
  birthDate: z.iso
    .date()
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      const now = new Date();
      const oldest = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
      return date <= now && date >= oldest;
    }, "birthDate is outside the accepted range"),

  sex: z.enum(["FEMALE", "MALE", "UNSPECIFIED"]),
  /** ISO 3166-1 alpha-2. Rendered per locale by `Intl.DisplayNames`, so no name table exists. */
  nationality: z.string().trim().length(2).toUpperCase(),
  city: z.string().trim().min(1).max(120),

  /**
   * The organizer's way of reaching somebody on race day, and somebody else if that fails.
   * Required on the public form for that reason, and deliberately not validated against a
   * national format: a runner from anywhere may enter, and rejecting a valid foreign number is
   * a worse failure than storing one nobody rings.
   */
  phone: z.string().trim().min(3).max(40),
  emergencyContactName: z.string().trim().min(1).max(200),
  emergencyContactPhone: z.string().trim().min(3).max(40),

  clubName: z.string().trim().max(200).optional(),
  tshirtSize: z.enum(["NONE", "XS", "S", "M", "L", "XL", "XXL"]).default("NONE"),

  /**
   * Health information, and the consent that alone permits holding it (BR-REQ-031-05).
   *
   * GDPR Article 9 asks for an explicit consent of its own, so this is a second checkbox with
   * its own wording rather than a clause folded into the privacy acknowledgment. The pairing is
   * enforced in `superRefine` below, again by a CHECK in the table, and once more by the
   * export omitting the column — three places, because this is the field whose leak would
   * matter most.
   */
  healthNotes: z.string().trim().max(2000).optional(),
  healthConsent: z.boolean().default(false),

  email: z.email().max(320),
  locale: z.enum(["ro", "en"]),
  privacyAcknowledged: z.literal(true),
  resultsNameConsent: z.boolean(),
  /**
   * "Do not put my name on the public start list" (BR-REQ-039-01).
   *
   * Asked on every form, including for an event that publishes no list today. An organizer can
   * switch a list on months after somebody registered, and a question that was never put to
   * that person cannot be answered later on their behalf — so it is put to everyone, once, and
   * the wording says "if the club publishes one".
   */
  listOptOut: z.boolean(),
  /**
  * Deliberately not `.max(0)`: a bot filling the honeypot must get the same generic success
  * response as everyone else, never a distinct validation error that would tell it which
  * defense it tripped. The runtime check in `service.ts` treats any non-empty value as spam.
  *
  * Both are optional because a registration an organizer types in has no rendered form behind
  * it to have timed (BR-REQ-037-05). They are not therefore optional on the public path: the
  * spam check runs for `PUBLIC` submissions only, and an absent `renderedAt` reads there as a
  * timestamp that cannot be parsed — which `looksLikeSpam` already treats as a bot.
  */
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
});

/**
 * BR-REQ-031-05 criterion 2, applied to both entry points below.
 *
 * Health text without its consent is not a validation nicety: it is holding
 * special-category data with no lawful basis. The submission is refused rather than the
 * text quietly dropped, because dropping it would leave somebody believing an organizer
 * knows about their asthma.
 */
const healthConsentRule = (
  value: { healthNotes?: string; healthConsent?: boolean },
  ctx: z.RefinementCtx,
) => {
    // BR-REQ-031-05 criterion 2. Health text without its consent is not a validation nicety:
    // it is holding special-category data with no lawful basis, so the submission is refused
    // rather than the text quietly dropped.
  if (value.healthNotes && value.healthNotes.length > 0 && !value.healthConsent) {
    ctx.addIssue({
      code: "custom",
      path: ["healthConsent"],
      message: "health information may only be stored with its own explicit consent",
    });
  }
};

/** The public form. Every race detail is insisted on (BR-REQ-031-04 criterion 2). */
export const registrationSubmissionSchema = submissionFields.superRefine(healthConsentRule);

/**
 * The same form as an organizer fills it in for somebody who telephoned (BR-REQ-031-04
 * criterion 5, BR-REQ-037-05).
 *
 * Only the details a caller can actually withhold become optional. The name does not: an
 * organizer taking a registration knows who it is for. Nor does the privacy acknowledgment,
 * because the person still has to have been told — a relaxation there would be a different
 * kind of change entirely.
 */
export const staffRegistrationSubmissionSchema = submissionFields
  .partial({
    birthDate: true,
    sex: true,
    nationality: true,
    city: true,
    phone: true,
    emergencyContactName: true,
    emergencyContactPhone: true,
  })
  .superRefine(healthConsentRule);

export type RegistrationSubmissionInput = z.infer<typeof registrationSubmissionSchema>;

export const declarationSigningSchema = z.object({
  accepted: z.literal(true),
  typedName: z.string().trim().min(1).max(200),
});

export type DeclarationSigningInput = z.infer<typeof declarationSigningSchema>;
