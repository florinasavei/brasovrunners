import { z } from "zod";
import { DomainError } from "@/shared/errors/domain-error";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isMinorOn, isUnderMinimumAge } from "./domain/age";
import { E164_PHONE } from "./phone";

/**
 * The registration form's editable fields (BR-REQ-031-01 criterion 1): full name, email,
 * locale and the privacy-notice acknowledgment. The public-results consent is no longer asked
 * (§322) and defaults to false. No password field and no login link exist because none is in
 * this schema to render.
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
  /**
   * ISO 3166-1 alpha-2. Rendered per locale by `Intl.DisplayNames`, so no name table exists.
   *
   * Required on the public form again since §432 (the owner, 2026-09-26: "cetățenia ar trebui să
   * fie obligatorie; by default pune Român"), reversing §322's optional: the form asks it beside
   * the birth date, pre-chosen on `RO`, so a Romanian runner leaves it. Optional for a staff entry
   * (paper), relaxed below; older rows without it stay blank. The city stays optional (§322).
   */
  nationality: z.string().trim().length(2).toUpperCase(),
  city: z.string().trim().min(1).max(120).optional(),

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
   * "I declare I am medically fit to take part" (§171, amended by §421).
   *
   * Required on the public form and nowhere else. A statement of fitness, treated as data
   * concerning health and kept under art. 9(2)(f) GDPR as evidence (§418, amending §171; the
   * privacy notice's §2 says so) — required because it rests on no consent, which is why it can be
   * insisted on where `healthNotes` cannot. Only the moment is stored (`fitness_declared_at`),
   * never anything medical. A registration an organizer takes over the telephone, or a walk-in at
   * the desk, makes it on paper instead, so the staff schema relaxes it below; so does the form for
   * another adult on the same address (§389, §421), where `fitnessAcknowledged` stands in its place.
   */
  fitnessDeclared: z.literal(true),
  /**
   * The family form's tick for an adult (§421): "I know the person I am registering declares
   * themselves, when they sign their declaration, that their health allows the effort". An
   * acknowledgement by the address holder, not a statement about anybody's health, so nothing is
   * stored for it; `anotherPersonFitnessRule` requires it for an adult and ignores it otherwise.
   */
  fitnessAcknowledged: z.boolean().default(false),

  /**
   * The club's terms, accepted expressly (§421). One tick, always shown and never folded, that
   * names the unusual clauses — cancellation or change of the event, being stopped or excluded
   * on the course, the limits of the club's liability, the governing law and the court — because
   * a standard clause of that kind binds only once it is accepted expressly (Codul civil
   * art. 1202–1203). Separate from the event's own rules (`rulesAcknowledged`). The service
   * records the version in force and the moment; the page names the version, never typed.
   * A staff or desk entry makes it on paper, so the staff schema relaxes it.
   */
  termsAccepted: z.literal(true),

  /**
   * The version the form showed the tick as naming (§421, finding (7) of the fix round): a
   * hidden field, posted alongside the tick, never typed. The service records the version *in
   * force at submit* (`service.ts` ~1030/1143), which can differ from the one the page rendered
   * if a new one is approved in between — this is what lets it tell the two apart and refuse
   * rather than silently record a version the reader's tick never named. Optional because a
   * staff or desk entry, which relaxes `termsAccepted` itself, posts nothing here either.
   */
  termsVersionShown: z.coerce.number().int().positive().optional(),

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
  /**
   * "My name may appear in the public results" (BR-REQ-072-01) — no longer asked (§322).
   *
   * There are no results on this site and none are planned before M2, so the form was asking a
   * person to consent to a publication that does not exist, and a consent to nothing is not a
   * consent anybody can be informed about. The column stays (a later contract step drops it) and
   * every new row carries `false`; when results exist, the question comes back with a text that
   * can say what it is for.
   */
  resultsNameConsent: z.boolean().default(false),
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
 * The marker a form carries after a refusal (§282).
 *
 * Not part of the schema: it says nothing about the registration and everything about this
 * attempt, so it travels with the other two signals the action already gathers rather than
 * becoming a field of a participant.
 */
export const SECOND_ATTEMPT_FIELD = "secondAttempt";

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

/**
 * The marker a refusal for age carries beside `birthDate` (§321), in the shape of §231's
 * `emergencySame`: the field name is what lets the error summary link to the box, and this is
 * what lets the page say *which* rule refused it — "complete this field correctly" about a real
 * birth date would be untrue. Not a field, so `parseInvalidFields` drops it from the summary.
 */
export const UNDER_MINIMUM_AGE = "tooYoung";

/**
 * The event's minimum age on the day of the event (§321; per event since §329, `events.min_age`).
 *
 * A factory, because the rule needs the one thing this schema does not have: the event — its day
 * and its number. The service knows both (`submitRegistration`) and adds this to whichever schema
 * the caller gets, so the public form, a staff entry, the desk's walk-in, a restart and a TEST row
 * all meet it through the one door every registration already passes (`AGENTS.md` §12.6: `kind`
 * decides nothing here either). The number is a parameter with no default on purpose: the club's
 * fourteen (`MIN_PARTICIPANT_AGE`) is what an event starts with, never what this rule falls back
 * to behind an event that says otherwise. Zero is no minimum, and then there is nothing to count.
 *
 * *Only when a birth date is given.* The public schema always has one; the staff schema may not
 * (BR-REQ-031-04 criterion 5), and then there is nothing to count — the organizer saw or heard
 * the person, and refusing the row for a detail nobody was told would lose the registration,
 * which is the rule that criterion keeps. A malformed date is left to the schema's own message
 * (`ageOn` answers null), so the summary never gives a second, untrue reason. The comparison is
 * `isUnderMinimumAge`, the one a group run's self-declaration asks too (§440).
 *
 * Counted against the day of the event, where the guardian rule above counts against today:
 * the minimum is about the day somebody runs; eighteen is about who fills the form in.
 */
export function minimumAgeRule(eventDay: string, minAge: number) {
  return (value: { birthDate?: string }, ctx: z.RefinementCtx): void => {
    if (!value.birthDate || !isUnderMinimumAge(value.birthDate, eventDay, minAge)) return;
    ctx.addIssue({
      code: "custom",
      path: ["birthDate"],
      message: `a participant must be at least ${minAge} on the day of the event (${eventDay})`,
    });
    ctx.addIssue({ code: "custom", path: [UNDER_MINIMUM_AGE], message: "under the minimum age" });
  };
}

/**
 * An emergency contact is somebody **else** (`DECISIONS.md` §228).
 *
 * Amalia, testing: "și poți pune la persoana de contact numele tău și nr tău". You could, and
 * the field was then worth nothing — the whole point of it is a number somebody can ring when
 * the runner cannot answer their own. A contact who is the runner is not a contact; it is a
 * blank the form let through.
 *
 * *The number is the rule, and the name is not.* Both are compared, and only the number is
 * refused: two people at one race genuinely share a surname and sometimes a full name — a
 * father and son, two Ion Popescus — and refusing that would turn a real entry away. Nobody
 * shares a telephone that answers in an emergency, and by this point both numbers are E.164,
 * so the comparison is exact rather than a guess about formatting.
 *
 * The name match is worth *saying* and not worth refusing, so the form says it live (§198's
 * shape) and the server lets it through.
 */
const emergencyContactRule = (
  value: { phone?: string; emergencyContactPhone?: string },
  ctx: z.RefinementCtx,
): void => {
  if (value.phone && value.emergencyContactPhone && value.phone === value.emergencyContactPhone) {
    ctx.addIssue({
      code: "custom",
      path: ["emergencyContactPhone"],
      message: "the emergency contact must be somebody other than the participant",
    });
    /*
      A second marker, so the page can say *which* rule refused it (§231).

      The path above is the field, which is what makes the error summary able to link to it.
      But the field has two ways to fail — a malformed number and this — and the page could
      only tell somebody "that number is not valid", which about their own correct number is
      simply untrue. Not a field name, so `parseInvalidFields` drops it from the summary; the
      page reads it from the raw parameter, as it does for the captcha and the timing check.
    */
    ctx.addIssue({ code: "custom", path: ["emergencySame"], message: "same as the participant" });
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
  .superRefine(guardianRule)
  .superRefine(emergencyContactRule);

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
    // Citizenship is required on the public form only (§432): a paper entry may not have it.
    nationality: true,
    phone: true,
    emergencyContactName: true,
    emergencyContactPhone: true,
    // The fitness statement is made on the paper declaration at the desk (§171), not by a
    // staff member ticking a box on somebody else's behalf — `AGENTS.md` §15.11.
    fitnessDeclared: true,
    // The same, for the race's conditions (§195): the paper the participant signs says they
    // read them, and a staff member does not say it for them.
    rulesAcknowledged: true,
    // And the club's terms (§421): accepted on the paper, never ticked by staff on a person's behalf.
    termsAccepted: true,
  })
  .superRefine(healthConsentRule)
  .superRefine(guardianRule)
  .superRefine(emergencyContactRule);

/**
 * Another person on an address that is registered already (§389), as the press on the emailed
 * confirmation reads the kept form again (§446, `family-confirm.ts`). Everything the public form
 * asks, but the runner's own telephone — kept optional from §389's family form, where the second
 * person was often a child with none; the emergency contact is still required. The address itself
 * is never read from the kept form: the caller fixes it from the token.
 */
export const anotherPersonSubmissionSchema = submissionFields
  .partial({ phone: true })
  // Asked of a minor's parent only (§421): `anotherPersonFitnessRule(now)` decides which tick is
  // owed. Applied by the caller (`service.ts`, alongside `minimumAgeRule`), not baked in here, so
  // one `now` decides it and `withoutAnotherAdultsConsents` alike (finding (9)).
  .extend({ fitnessDeclared: z.boolean().default(false) })
  .superRefine(healthConsentRule)
  .superRefine(guardianRule)
  .superRefine(emergencyContactRule);

/**
 * Whether the runner on the family form is an adult (§421): eighteen or over today, by the same
 * calendar rule as the guardian check. False for a date that cannot be read — the schema refuses
 * that on its own, and nothing is taken away from a form it is about to refuse. The confirmation
 * page of §446 asks the adult's acknowledgement by the same rule (`family-entries.ts`).
 */
export function adultOnTheFamilyForm(birthDate: unknown, now: Date): boolean {
  if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  if (Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`))) return false;
  return !isMinorOn(birthDate, now);
}

/**
 * The fitness statement on the family form (§421). A parent registering a minor makes it, as
 * today (the parent acts for the child: art. 8 GDPR, Codul civil art. 41–43). For another adult
 * the address holder cannot make a first-person statement on their behalf, so the form asks them
 * to acknowledge that the person makes it themselves, in the declaration they sign.
 *
 * A factory over `now` (§421, finding (9) of the fix round), like `minimumAgeRule` beside it: the
 * service's own `superRefine` used to reach for `new Date()` here while `withoutAnotherAdultsConsents`
 * decided adult-or-minor from the service's `now` a few lines above it — two different instants
 * that could disagree around an eighteenth birthday at midnight, or in a test with a fixed clock.
 * One instant now decides both.
 */
export function anotherPersonFitnessRule(now: Date) {
  return (value: { birthDate?: string; fitnessDeclared?: boolean; fitnessAcknowledged?: boolean }, ctx: z.RefinementCtx): void => {
    if (!value.birthDate) return;
    if (adultOnTheFamilyForm(value.birthDate, now)) {
      if (value.fitnessAcknowledged !== true) {
        ctx.addIssue({ code: "custom", path: ["fitnessAcknowledged"], message: "acknowledge that the person declares their own fitness when they sign" });
      }
    } else if (value.fitnessDeclared !== true) {
      ctx.addIssue({ code: "custom", path: ["fitnessDeclared"], message: "the parent declares the minor fit to take part" });
    }
  };
}

/**
 * What the family form may **not** carry for another adult (§421; §389's flow, amended).
 *
 * The address holder fills it in; a consent given by a third party for an adult is not that
 * adult's consent (GDPR art. 4(11), 7(1)), and the health note is art. 9 data. So for a runner
 * eighteen or over today — the guardian rule's day and calendar — the health note and its
 * consent, the Strava link and the Instagram username, the public-list tick and the first-person
 * fitness statement are dropped **whatever was posted**, before the schema reads anything: the
 * form hides them, and this is the rule for a form posted without JavaScript or by anything else.
 * A minor is left alone: the parent consents for the child, as on the ordinary form.
 *
 * Applied by `submitRegistration` to the family form only; the ordinary form is the person's own.
 */
export function withoutAnotherAdultsConsents(raw: unknown, now: Date): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;
  if (!adultOnTheFamilyForm(input.birthDate, now)) return raw;
  return {
    ...input,
    healthNotes: undefined,
    healthConsent: false,
    stravaUrl: undefined,
    instagramHandle: undefined,
    listOptOut: true,
    fitnessDeclared: undefined,
  };
}

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
  /**
   * The declarant's document — the adult's, or the parent's for a minor. Required when the
   * declaration's text names an identity document (`asksForIdDocument`); the service decides.
   */
  idDocument: z.string().trim().regex(ID_DOCUMENT, "an identity document is a series and a number").optional(),
  /**
   * A minor's own signature and document, beside the parent's (§330). Optional here because an
   * adult posts neither; for a minor the service requires the name always, and the document
   * whenever it requires the parent's. A blank name is left to the service, which refuses it as
   * the signature that does not match — the same refusal, on the same box, as a wrong one.
   */
  minorTypedName: z.string().trim().max(200).optional(),
  minorIdDocument: z.string().trim().regex(ID_DOCUMENT, "an identity document is a series and a number").optional(),
  /**
   * The version the page rendered, by id and content hash (BR-REQ-033-02 criterion 6). The
   * service compares both with the version that is current at signing time and refuses a
   * mismatch, so the acceptance row can only ever name the text the participant actually read.
   */
  documentId: z.uuid(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type DeclarationSigningInput = z.infer<typeof declarationSigningSchema>;
