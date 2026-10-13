import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";

type OutsideMarkKey =
  | "confirm.outsideMarkBody"
  | "confirm.outsideMarkBodyWaitlisted"
  | "confirm.outsideMarkBodyWaitlistedTest"
  | "confirm.outsideMarkBodyOffered"
  | "confirm.outsideMarkBodyOfferedTest"
  | "confirm.outsideMarkBodyPendingEmail"
  | "emails.types.COMPLETE_DECLARATION";

/**
 * The body of «Pune pe lista de invitați speciali»'s question, by the row's state (§643, §648): the one
 * the registration's page and the list's «⋮» (§743) both show. A waiting runner, or an open offer, is
 * seated now with the declaration's email; a TEST row's body names no email (§384).
 */
export function outsideMarkBody(
  t: (key: OutsideMarkKey, values?: { name: string; message: string }) => string,
  row: { status: RegistrationStatus; kind: RegistrationKind; registeredName: string },
): string {
  const name = row.registeredName;
  const message = () => t("emails.types.COMPLETE_DECLARATION");
  if (row.status === "WAITLISTED") {
    return row.kind === "TEST" ? t("confirm.outsideMarkBodyWaitlistedTest", { name, message: "" }) : t("confirm.outsideMarkBodyWaitlisted", { name, message: message() });
  }
  if (row.status === "WAITLIST_OFFERED") {
    return row.kind === "TEST" ? t("confirm.outsideMarkBodyOfferedTest", { name, message: "" }) : t("confirm.outsideMarkBodyOffered", { name, message: message() });
  }
  if (row.status === "PENDING_EMAIL_CONFIRMATION") return t("confirm.outsideMarkBodyPendingEmail", { name, message: "" });
  return t("confirm.outsideMarkBody", { name, message: "" });
}
