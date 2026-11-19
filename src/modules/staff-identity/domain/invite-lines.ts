/**
 * «Echipa»'s one line after «Adaugă» or «Retrimite invitația» (§NNN): what the person receives — two emails, Zitadel's
 * first, or the club's alone — by what Zitadel answered. The banner tells the inviter; the email tells the person the
 * same, as numbered steps (`notifications/templates.ts`, `signInStepsWords`).
 *
 * A key of `Admin.staff` and the alert's severity, or none: «… fără invitație» carries no answer — its own line says
 * nobody was written to — and no other press is an invitation's.
 */
export const INVITE_LINE_KEYS = [
  "inviteSent",
  "inviteExists",
  "inviteReady",
  "inviteManual",
  "inviteFailed",
  "resendSent",
  "resendReady",
  "resendManual",
  "resendFailed",
] as const;

export type InviteLineKey = (typeof INVITE_LINE_KEYS)[number];

export type InviteLine = { key: InviteLineKey; severity: "success" | "info" | "warning" };

/**
 * `saved` is the press (`invited`, `reinvited`), `invite` Zitadel's answer as the action put it on the redirect
 * (`InviteOutcome["kind"]`). An account made, or found without a password, gets Zitadel's email first; one found with
 * its password gets the club's alone; no key, or a refusal, leaves the club's email with the person's own steps.
 */
export function inviteLineOf(saved: string | undefined, invite: string | undefined): InviteLine | null {
  if (saved === "invited") {
    switch (invite) {
      case "invited":
        return { key: "inviteSent", severity: "success" };
      case "exists":
        return { key: "inviteExists", severity: "success" };
      case "ready":
        return { key: "inviteReady", severity: "success" };
      case "unconfigured":
        return { key: "inviteManual", severity: "success" };
      case "failed":
        return { key: "inviteFailed", severity: "warning" };
      default:
        return null;
    }
  }
  if (saved === "reinvited") {
    switch (invite) {
      case "invited":
      case "exists":
        return { key: "resendSent", severity: "success" };
      case "ready":
        return { key: "resendReady", severity: "success" };
      case "unconfigured":
        return { key: "resendManual", severity: "info" };
      case "failed":
        return { key: "resendFailed", severity: "warning" };
      default:
        return null;
    }
  }
  return null;
}
