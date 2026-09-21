import { z } from "zod";
import { DomainError } from "@/shared/errors/domain-error";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isMinorOn } from "./domain/age";
import { E164_PHONE } from "./phone";

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
/** Strava's own hosts only: a profile (`/athletes/<id>`) or the app's share link. */
export const STRAVA_URL = /^https:\/\/(www\.)?strava\.com\/(athletes|pros)\/[A-Za-z0-9_-]+\/?$|^https:\/\/strava\.app\.link\/[A-Za-z0-9_-]+$/;
/** Instagram usernames: letters, digits, dots and underscores, up to thirty, no leading `@`. */
export const INSTAGRAM_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9])?$/;

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
   * Required on the public form for that reason. Since `DECISIONS.md` §84 the form asks for
   * the country and the number, `form-mapping.ts` composes E.164 (`+40712345678`), and this
   * is what the row stores — deliberately not a national-format check beyond that: a runner
   * from anywhere may enter, and rejecting a valid foreign number is a worse failure than
   * storing one nobody rings.
   */
  phone: z.string().regex(E164_PHONE, "a telephone number in international form"),
  emergencyContactName: z.string().trim().min(1).max(200),
  emergencyContactPhone: z.string().regex(E164_PHONE, "a telephone number in international form"),

  clubName: z.string().trim().max(200).optional(),

  /**
   * The parent or legal guardian (§108): required when the birth date gives under eighteen
   * today — `guardianRule` below — optional otherwise, and ignored for an adult who typed it.
   */
  guardianName: z.string().trim().max(200).optional(),

  /**
   * Socials, optional (§106). A Strava link is one of Strava's own addresses — a profile, or
   * the short link the app shares — and nothing else, so the field cannot become a link to
   * anywhere; an Instagram handle is the username, with or without the `@`, which is stored
   * without it. Empty is the common case and means "did not say".
   */
  stravaUrl: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || STRAVA_URL.test(value), "a Strava profile link, like https://www.strava.com/athletes/12345"),
  instagramHandle: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value.replace(/^@/, "") : undefined))
    .refine((value) => value === undefined || INSTAGRAM_HANDLE.test(value), "an Instagram username, like @brasovrunners"),

  /**
   * "I am a Brașov Runners team member" (BR-REQ-031-06).
   *
   * A claim, not a fact, and deliberately not validated against anything: most members of this
   * club have no backoffice account, so checking `staff_users` would answer "no" for exactly
   * the people the question is asked to find (`DECISIONS.md` §48). It is informational — it
   * may not decide a price, a place or a queue position, and nothing downstream reads it except
   * the backoffice list, the filter and the export.
   *
   * `.default(false)` rather than `.optional()`: an unticked box is absent from `FormData`, and
   * the column is NOT NULL because "did not say" and "no" are the same answer here.
   */
  clubMemberDeclared: z.boolean().default(false),

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

  /**
   * "I declare I am medically fit to take part" (§171).
   *
   * Required on the public form and nowhere else. It is a statement about oneself, not health
   * data — which is why it can be insisted on where `healthNotes` cannot — and it is the thing
   * the medical block was always trying to ask before the free-text box buried it. A
   * registration an organizer takes over the telephone, or a walk-in at the desk, makes it on
   * paper instead, so the staff schema relaxes it below.
   */
  fitnessDeclared: z.literal(true),

  /**
   * "I have read the race's conditions" (§195). Required on the public form, like the statement
   * above and for the same reason: it is a thing the entrant says, not a thing the club checks.
   * The screen makes it hard to say without reading — the text opens in a panel and the box is
   * dead until it has been scrolled to the end — but the screen is not the guarantee, and this
   * schema does not pretend otherwise. At the desk the paper declaration carries the sentence.
   */
  rulesAcknowledged: z.literal(true),

  email: z.email().max(320),
  /**
   * The address typed a second time (§206) — carried through the schema so the draft cookie can
   * put it back after a rejection, and checked by `assertEmailTypedTwice` in the action rather
   * than here: asking twice is the public form's affair and no other caller has a second box.
   */
  emailConfirm: z.email().max(320).optional(),
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
/**
 * Eighteen on the day, by calendar years. It moved to `domain/age.ts` so the browser can read it
 * without this file's Zod schema coming with it (§188); re-exported here because everything that
 * validates a registration already imports it from this module.
 */
export { isMinorOn } from "./domain/age";

/**
 * A minor is registered by a parent or legal guardian (§108; the terms and the declaration
 * have said so since §95): the form must carry the guardian's name, and the declaration is
 * then theirs to sign. Checked against today rather than the event's day — a birth date is
 * parsed here without the event in hand, and a runner who turns eighteen between the two
 * loses nothing by having named a parent.
 */
const guardianRule = (
  value: { birthDate?: string; guardianName?: string },
  ctx: z.RefinementCtx,
): void => {
  if (value.birthDate && isMinorOn(value.birthDate, new Date()) && !value.guardianName) {
    ctx.addIssue({
      code: "custom",
      path: ["guardianName"],
      message: "a participant under eighteen is registered by a parent or legal guardian, whose name is required",
    });
  }
};

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
/**
 * The two addresses of the public form must be the same mailbox (§206).
 *
 * **Not part of `registrationSubmissionSchema`**, and that is the decision: typing an address
 * twice is a property of the *form*, not of a registration. Putting it in the submission schema
 * made every caller of the service carry a field that only one screen has — the desk, the
 * telephone entry, the synthetic queue and forty test fixtures — for a check none of them can
 * fail. It belongs where the two boxes exist, which is the public action.
 *
 * The comparison is the canonicalizer's, not `===`: that is what the platform uses to decide
 * whether two addresses are the same person (`AGENTS.md` §10.4), so `Ana@Gmail.com` and
 * `ana@gmail.com` match — the same row once stored — while two Gmail spellings differing in
 * dots do not, because the club treats those as two people (§74). Comparing raw strings would
 * refuse the first pair and accept the second, which is wrong in both directions.
 *
 * Checked on the server, because a comparison that only ever ran in a browser is a decoration.
 */
export function assertEmailTypedTwice(input: { email?: string; emailConfirm?: string }): void {
  const second = input.emailConfirm?.trim();
  // Absent means this form does not ask twice; the desk and the telephone entry never do.
  if (!second) return;
  let same = false;
  try {
    same = canonicalizeEmail(input.email ?? "").canonicalEmail === canonicalizeEmail(second).canonicalEmail;
  } catch {
    same = false;
  }
  if (!same) {
    throw new DomainError("VALIDATION_ERROR", "the two addresses are not the same mailbox", [
      "emailConfirm",
    ]);
  }
}

export const registrationSubmissionSchema = submissionFields
  .superRefine(healthConsentRule)
  .superRefine(guardianRule);

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
    // The fitness statement is made on the paper declaration at the desk (§171), not by a
    // staff member ticking a box on somebody else's behalf — `AGENTS.md` §15.11.
    fitnessDeclared: true,
    // The same, for the race's conditions (§195): the paper the participant signs says they
    // read them, and a staff member does not say it for them.
    rulesAcknowledged: true,
  })
  .superRefine(healthConsentRule)
  .superRefine(guardianRule);

export type RegistrationSubmissionInput = z.infer<typeof registrationSubmissionSchema>;

/**
 * "CI seria BV nr. 123456", as people write it: letters, digits, spaces, dots and dashes,
 * between four and thirty characters. A passport number for a runner from abroad fits the
 * same shape. Not parsed into series and number — the declaration prints it as one thing.
 */
export const ID_DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9 .\-\/]{2,28}[A-Za-z0-9]$/;

export const declarationSigningSchema = z.object({
  accepted: z.literal(true),
  typedName: z.string().trim().min(1).max(200),
  /** Required when the declaration's text names it (`mergeFieldsIn`); the service decides. */
  idDocument: z.string().trim().regex(ID_DOCUMENT, "an identity document is a series and a number").optional(),
  /**
   * The version the page rendered, by id and content hash (BR-REQ-033-02 criterion 6). The
   * service compares both with the version that is current at signing time and refuses a
   * mismatch, so the acceptance row can only ever name the text the participant actually read.
   */
  documentId: z.uuid(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type DeclarationSigningInput = z.infer<typeof declarationSigningSchema>;
