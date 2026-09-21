import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { RegistrationStatus } from "@/db/schema/registrations";
import type { TokenRejectionReason } from "@/modules/action-tokens/domain/token-state";

/**
 * What a page reached by an email action link should show (BR-REQ-036-02; AGENTS.md §13.2).
 *
 * Priority-1 code — `docs/PRACTICES.md` §198. Read every line.
 *
 * ## Why this exists
 *
 * A participant confirmed her address at 19:36. At 21:37 she opened the same email again, and
 * the page said "this link is no longer valid". She read that as "my registration failed",
 * reported that the confirm button was broken, and never signed her declaration — which was
 * waiting for her in a second email she now had no reason to open. Nothing was broken. The
 * page simply refused to tell her that the thing she was worried about had already happened.
 *
 * ## What this is not
 *
 * It is **not** a reusable link. `evaluateActionToken` still refuses a spent token, the
 * consume statement still matches nothing, and no action is ever re-performed. An email sits
 * in an inbox for years, gets forwarded, and turns up on a phone somebody lost. A link that
 * still *worked* the second time would be a standing authorization to cancel somebody's place.
 * What this adds is idempotence at the level of the *page*: pressing it again does not repeat
 * the action, it reports the state and names the next step.
 *
 * ## Which refusals get a sentence, and which stay generic
 *
 * §13.2 asks for "one generic invalid/expired response with resend path", because telling a
 * stranger with a guessed URL whether a token exists describes the system to somebody who has
 * proven nothing. `ALREADY_USED` is the one reason where that argument does not apply, and the
 * reason it does not apply is structural rather than a judgement about how helpful we feel:
 *
 * - **ALREADY_USED** is only reachable by an exact match on `token_hash`, which is SHA-256 of
 *   32 random bytes. Whoever reached it is holding the secret from the email. Telling them
 *   "this registration is confirmed; the declaration is next" tells them nothing the link in
 *   their hand did not already say, and it is the only truthful answer to the question they
 *   actually asked.
 * - **NOT_FOUND** has nothing to report. There is no row, so there is no state.
 * - **PURPOSE_MISMATCH** must stay indistinguishable from `NOT_FOUND`, and `token-state.ts`
 *   orders its checks so that it is: a `MANAGE_REGISTRATION` link replayed against the
 *   declaration endpoint must not be confirmed as a real token issued for something else.
 * - **EXPIRED** was never used, so the work was never done. A status page would have nothing
 *   to say except "ask for a new link" — which is exactly what the generic message says, and
 *   which is now said with a working link to the resend form rather than with a sentence
 *   pointing vaguely at the event page.
 * - **INVALIDATED** is the hard one, and it stays generic on purpose. `invalidated_at` holds
 *   two different facts with no column to tell them apart: a token superseded because a newer
 *   one was issued (§12.8's partial unique indexes), and a token revoked for cause. The first
 *   is innocent and common — somebody pressed an older email after asking for a fresh link —
 *   and the second is a decision to stop a link working. A friendly page that coached its
 *   holder toward a fresh link would treat both the same, so the strictest reading wins until
 *   the column can say which happened. And the superseded case loses nothing by it: the work
 *   was *not* done, the state has not advanced, and the only true next step is the resend path
 *   the generic message now carries.
 *
 * ## Which purposes
 *
 * The four registration-scoped purposes. `MANAGE_PROFILE` is deliberately excluded: it is
 * scoped to a participant rather than to one registration, so the truthful "where are you"
 * for a spent profile link is the whole list of that person's registrations — which is the
 * page the live link opens. Re-serving a spent link's own content is the thing this module
 * exists not to do, and `/registrations/mine` is one form away.
 */
export type SpentLinkMessage =
  /** Still waiting on the address to be confirmed. */
  | "CONFIRM_EMAIL"
  /** The place is held and the declaration is the one thing left. */
  | "SIGN_DECLARATION"
  /** In the queue, with nothing to do but wait for an offer. */
  | "WAITLISTED"
  /** Done: a place, a number and a desk code. */
  | "CONFIRMED"
  /** They cancelled, or staff did. */
  | "CANCELLED"
  /** A hold or an offer ran out, or the event started. */
  | "LAPSED";

/**
 * Where the page sends them, and why there is no fourth option.
 *
 * - `RESEND` is `/registrations/resend`, which takes an address, is throttled per canonical
 *   email, answers identically whatever the address turns out to mean, and derives the message
 *   from the registration's *current* status via `deriveAllowedResendMessageType`. That last
 *   property is what makes it the right "next step" button for every in-progress state: a
 *   person waiting to sign gets the declaration link, a confirmed person gets the confirmation
 *   with its QR, and neither can ask for a message their state does not allow.
 * - `REGISTER_AGAIN` is the event's own page. Once a registration is cancelled or lapsed there
 *   is no link to resend — there is a form to fill in.
 * - `NONE` is `WAITLISTED`, and it is not laziness. `deriveAllowedResendMessageType` returns
 *   null for that status because nothing is waiting on the participant; offering "send it
 *   again" would show them a success message for an email that is never queued, which is a
 *   worse lie than the one this module is fixing.
 */
export type SpentLinkNext = "RESEND" | "REGISTER_AGAIN" | "NONE";

export type ActionLinkView =
  /** The token is live: render the form. */
  | { view: "PROCEED" }
  /** One generic invalid-or-expired message with a resend path (§13.2). */
  | { view: "REFUSED" }
  /** Where they are, and what is next. */
  | { view: "ALREADY_DONE"; message: SpentLinkMessage; next: SpentLinkNext };

export const REFUSED: ActionLinkView = { view: "REFUSED" };

/**
 * Which step of `RegistrationJourney` a spent link should light up, or null for none.
 *
 * Declared here rather than in the component so the stepper can never contradict the sentence
 * beside it — a heading reading "you are confirmed" over a stepper pointing at step 2 is the
 * same failure as the message this whole module replaces, in a smaller typeface. The union is
 * a subset of `JourneyStep`, and the call site is where TypeScript checks that it still is.
 *
 * `CANCELLED` and `LAPSED` get no stepper at all: there is no journey left to be partway
 * through, and drawing one would suggest there is.
 */
export type SpentLinkStep = "confirm" | "declare" | "done";

export function stepForSpentLink(message: SpentLinkMessage): SpentLinkStep | null {
  switch (message) {
    case "CONFIRM_EMAIL":
      return "confirm";
    case "SIGN_DECLARATION":
      return "declare";
    case "CONFIRMED":
      return "done";
    case "WAITLISTED":
      /*
        Not "done" (§202, found in review).

        The stepper's last step carries its own sentence underneath — "Înscrierea ta este
        confirmată. Ne vedem la start!" — and a waitlisted person has no place at all. Telling
        them in the largest text on the page that they are confirmed is worse than telling them
        nothing, so the stepper says nothing and the message beside it says what is true.
      */
      return null;
    case "CANCELLED":
    case "LAPSED":
      return null;
  }
}

/**
 * Whether a refused token may be answered with the registration's state.
 *
 * Exported and tested separately from `describeActionLink` because it is the security half:
 * everything else in this file is wording, and this is the line that decides whether anything
 * is said at all. It reads as one boolean so a reviewer does not have to trace a switch.
 */
export function mayReportState(
  purpose: EmailActionTokenPurpose,
  reason: TokenRejectionReason,
): boolean {
  if (reason !== "ALREADY_USED") return false;
  return (
    purpose === "VERIFY_REGISTRATION_EMAIL" ||
    purpose === "COMPLETE_DECLARATION" ||
    purpose === "WAITLIST_OFFER" ||
    purpose === "MANAGE_REGISTRATION"
  );
}

/**
 * The whole decision, as one table.
 *
 * `status` is the registration's state read at the moment of the request, never inferred from
 * which purpose the token carried: a `VERIFY_REGISTRATION_EMAIL` token says what was true when
 * the email was sent, and the page is opened hours later. `null` means the row could not be
 * read — a registration erased under §67, or a token with no registration scope — and the
 * honest answer then is the generic one rather than a guess.
 */
export function describeActionLink(input: {
  purpose: EmailActionTokenPurpose;
  /** `null` when the token is live and the page should render its form. */
  reason: TokenRejectionReason | null;
  status: RegistrationStatus | null;
}): ActionLinkView {
  const { purpose, reason, status } = input;

  if (reason === null) return { view: "PROCEED" };
  if (!mayReportState(purpose, reason)) return REFUSED;
  if (status === null) return REFUSED;

  switch (status) {
    /**
     * A spent verify token with the address still unconfirmed should not happen —
     * `consumeAndConfirmEmail` spends the token and advances the row in one transaction — but
     * a registration can be re-submitted for the same event, and "confirm your address" is
     * both true and harmless if it ever does.
     */
    case "PENDING_EMAIL_CONFIRMATION":
      return { view: "ALREADY_DONE", message: "CONFIRM_EMAIL", next: "RESEND" };
    /** The case that started this: confirmed, place held, declaration outstanding. */
    case "PENDING_DECLARATION":
      return { view: "ALREADY_DONE", message: "SIGN_DECLARATION", next: "RESEND" };
    /** An offer is a held place with a deadline: the same one thing left to do. */
    case "WAITLIST_OFFERED":
      return { view: "ALREADY_DONE", message: "SIGN_DECLARATION", next: "RESEND" };
    case "WAITLISTED":
      return { view: "ALREADY_DONE", message: "WAITLISTED", next: "NONE" };
    case "CONFIRMED":
      return { view: "ALREADY_DONE", message: "CONFIRMED", next: "RESEND" };
    case "CANCELLED":
      return { view: "ALREADY_DONE", message: "CANCELLED", next: "REGISTER_AGAIN" };
    case "EXPIRED":
      return { view: "ALREADY_DONE", message: "LAPSED", next: "REGISTER_AGAIN" };
  }
}
