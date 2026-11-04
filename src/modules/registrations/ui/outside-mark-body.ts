import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";
import type { ConfirmMail } from "@/shared/feedback/confirm-words";
import { holdsAPlace } from "../domain/state-machine";

type OutsideMarkKey =
  | "confirm.outsideMarkBody"
  | "confirm.outsideMarkBodyWaitlisted"
  | "confirm.outsideMarkBodyWaitlistedTest"
  | "confirm.outsideMarkBodyOffered"
  | "confirm.outsideMarkBodyOfferedTest"
  | "confirm.outsideMarkBodyPendingEmail"
  | "confirm.outsideMarkTitle"
  | "confirm.outsideUnmarkTitle"
  | "confirm.outsideUnmarkBody"
  | "registrations.outside.mark"
  | "registrations.outside.unmark"
  | "emails.types.COMPLETE_DECLARATION";

/**
 * The body of «Pune pe lista de invitați speciali»'s question, by the row's state (§643, §648): the one
 * the registration's page and the list's «⋮» (§747) both show. A waiting runner, or an open offer, is
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

/**
 * The whole question «Pune pe» / «Scoate de pe lista de invitați speciali» asks (§643, §648, §747), for
 * the registration's page and the list's «⋮» alike: its title, the body by the row's state, the email line
 * the one builder worded (the design «telling the owner about every email a staff press sends», slice 3) —
 * the declaration's email to a waiting or offered runner seated now (`seated`; a TEST row's says its address
 * reaches nobody), no email but the freed place's offer for a row that held a counted place (`freed`), and no
 * email for any other press (`none`) — and the two buttons' words.
 */
export function outsideMarkConfirm(
  t: (key: OutsideMarkKey, values?: { name: string; message: string }) => string,
  row: { status: RegistrationStatus; kind: RegistrationKind; registeredName: string; outsideCapacity: boolean },
  words: { cancel: string; seated: ConfirmMail; freed: ConfirmMail; none: ConfirmMail },
): ConfirmMail & { title: string; body: string; confirmLabel: string; cancelLabel: string } {
  if (row.outsideCapacity) {
    return {
      title: t("confirm.outsideUnmarkTitle"),
      body: t("confirm.outsideUnmarkBody", { name: row.registeredName, message: "" }),
      ...words.none,
      confirmLabel: t("registrations.outside.unmark"),
      cancelLabel: words.cancel,
    };
  }
  const seatedNow = row.status === "WAITLISTED" || row.status === "WAITLIST_OFFERED";
  return {
    title: t("confirm.outsideMarkTitle"),
    body: outsideMarkBody(t, row),
    ...(seatedNow ? words.seated : holdsAPlace(row.status) ? words.freed : words.none),
    confirmLabel: t("registrations.outside.mark"),
    cancelLabel: words.cancel,
  };
}
