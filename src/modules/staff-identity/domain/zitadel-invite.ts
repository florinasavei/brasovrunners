import type { Locale } from "@/i18n/routing";
import { CLUB_NAME } from "@/theme/brand";
import type { InviteOutcome } from "../zitadel-users";

/**
 * What the club's invitation says about Zitadel's own email and sign-in page (§NNN; the owner, 2026-11-19: «am o alta
 * problema a invitarea voluntarilor in echpa, cumva trebuie un delay intre mailurile de logare, sau sa fie
 * instructiunile mai clare»).
 *
 * A press on «Echipa» that reaches Zitadel sends two emails: Zitadel's, to choose a password, and the club's, with the
 * steps. The club's names Zitadel's by its subject and the sign-in page's buttons by their labels, so the person finds
 * what the steps point at, whichever of the two arrives first. These are Zitadel's words, not the club's, read from
 * Zitadel's own sources; a change at Zitadel is one edit here.
 */

/** The name the invite call hands Zitadel (`zitadel-users.ts`, `sendCode.applicationName`), which its email repeats. */
export const ZITADEL_APPLICATION_NAME = CLUB_NAME;

/**
 * The subject of Zitadel's «Invite user» email in the account's language: Zitadel's default message text,
 * `Invitație la {{.ApplicationName}}` and `Invitation to {{.ApplicationName}}` (its notification texts, `ro.yaml` and
 * `en.yaml`). `SETUP.md` §37 asks the club to keep that subject when it writes its own text in Zitadel's console.
 */
export function zitadelInviteSubject(locale: Locale): string {
  return locale === "ro" ? `Invitație la ${ZITADEL_APPLICATION_NAME}` : `Invitation to ${ZITADEL_APPLICATION_NAME}`;
}

/**
 * The button of Zitadel's «Invite user» email in the account's language — `ButtonText` in the same `ro.yaml` and `en.yaml`:
 * «Acceptare invitație», “Accept invite”. The owner, 2026-11-19, with a picture of it: the email Zitadel sends first comes
 * from the club's name too, so the club's steps name it by its subject and by this button.
 */
export function zitadelInviteButton(locale: Locale): string {
  return locale === "ro" ? "Acceptare invitație" : "Accept invite";
}

/**
 * Two labels of Zitadel's hosted sign-in page, the new login (`docs/RUNBOOKS.md` § Staff sign-in): the button that makes
 * an account, and the one that asks for another code. The new login has no Romanian, so a Romanian reads it in English;
 * each half of the email names the labels as the page shows them.
 */
export const ZITADEL_LOGIN_LABELS = { register: "Register new user", resendCode: "Resend code" } as const;

/**
 * Whose the sign-in account is, in the invitation's steps (§NNN), written in its payload at the press: `zitadel` — the
 * press asks Zitadel for the account, and Zitadel emails the link to choose a password; `self` — there is no key, so the
 * person makes the account at the sign-in page. A row queued before §NNN carries neither and reads as `zitadel`, which
 * is what every environment with the key had asked of Zitadel.
 */
export type SignInSteps = "zitadel" | "self" | "ready";

/**
 * The payload's word read back: `self` — the person's own steps; `ready` — the account already signs in with its password,
 * so no email of Zitadel's is coming and the steps are the button alone; anything else Zitadel's.
 */
export function signInStepsOf(value: unknown): SignInSteps {
  return value === "self" || value === "ready" ? value : "zitadel";
}

/**
 * The steps once Zitadel answered (§NNN): an account made, one found without a password (Zitadel sent it a new code) or
 * one found with its password (nothing to send — the email's «Sari peste pasul 1») keeps Zitadel's steps; a refusal, or
 * no key, leaves the person to make the account themselves.
 */
export function signInStepsAfter(answer: InviteOutcome["kind"]): SignInSteps {
  if (answer === "ready") return "ready";
  return answer === "invited" || answer === "exists" ? "zitadel" : "self";
}
