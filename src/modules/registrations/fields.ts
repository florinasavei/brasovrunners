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
export const registrationSubmissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
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

export type RegistrationSubmissionInput = z.infer<typeof registrationSubmissionSchema>;

export const declarationSigningSchema = z.object({
  accepted: z.literal(true),
  typedName: z.string().trim().min(1).max(200),
});

export type DeclarationSigningInput = z.infer<typeof declarationSigningSchema>;
