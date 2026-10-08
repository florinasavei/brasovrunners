import type { RecipientRole } from "./email-audience";
import type { RejectionCause } from "./rejection-cause";

/**
 * The club's own mailboxes that refuse its emails, one entry per address (§NNN): what «Setări → Emailuri»
 * draws in «Adresele clubului care resping emailuri» and what «Sarcini» counts. Pure: the refusals as
 * `listClubMailboxRejections` reads them (newest first, the address only while it is still one of the club's),
 * and which addresses are now the declaration's visible or hidden copies.
 *
 * - **By address**, while the address is still in the club's settings; a mailbox the club has since removed is
 *   one entry per role, named by the role's words alone — never its address (the data decision, §NNN).
 * - **The role**, in the words of «Copiile clubului»: the declarations' archive, a Cc of it (an archive copy
 *   whose address is now one of the declaration's copies), the confirmation notices, the Bcc of the
 *   participants' messages.
 * - **The last refusal** — its message, its day, its cause — and how many in the window.
 * - **One thing to do**: lift Mailgun's suppression when the address is right; make room in a full mailbox;
 *   correct or remove the address otherwise; nothing for a mailbox no longer in the settings.
 *
 * The club's account refused at the send (`account`) says nothing about a mailbox, and is left out.
 */
export type ClubRejectionRole = "archive" | "archiveCopy" | "notice" | "copy";
export type ClubRejectionTodo = "suppressed" | "mailbox" | "fix" | "removed";

export type ClubRejectionInput = {
  role: RecipientRole;
  recipientEmail: string | null;
  messageType: string;
  at: Date;
  cause: RejectionCause;
};

export type ClubMailboxGroup = {
  /** The mailbox, while it is still in the club's settings; null for one removed since. */
  address: string | null;
  role: ClubRejectionRole;
  /** The newest refusal's message, day and cause. */
  messageType: string;
  at: Date;
  cause: RejectionCause;
  /** Refusals in the window, the newest included. */
  count: number;
  todo: ClubRejectionTodo;
};

const SUPPRESSIONS: ReadonlySet<RejectionCause> = new Set(["suppressed", "unsubscribed", "complaint-suppressed"]);

function roleOf(row: ClubRejectionInput, declarationCopies: ReadonlySet<string>): ClubRejectionRole {
  if (row.role === "notice") return "notice";
  if (row.role === "archive") return row.recipientEmail !== null && declarationCopies.has(row.recipientEmail.trim().toLowerCase()) ? "archiveCopy" : "archive";
  return "copy";
}

function todoOf(address: string | null, cause: RejectionCause): ClubRejectionTodo {
  if (address === null) return "removed";
  if (SUPPRESSIONS.has(cause)) return "suppressed";
  if (cause === "mailbox-full") return "mailbox";
  return "fix";
}

/** One entry per address (or per role for removed ones), newest refusal first, as the input is ordered. */
export function groupClubMailboxRejections(
  rows: readonly ClubRejectionInput[],
  settings: { declarationCopies: readonly string[] },
): ClubMailboxGroup[] {
  const copies = new Set(settings.declarationCopies.map((address) => address.trim().toLowerCase()));
  const groups = new Map<string, ClubMailboxGroup>();
  for (const row of rows) {
    if (row.cause === "account") continue;
    const role = roleOf(row, copies);
    const key = row.recipientEmail !== null ? `address:${row.recipientEmail.trim().toLowerCase()}` : `role:${role}`;
    const known = groups.get(key);
    if (known) {
      known.count += 1;
      continue;
    }
    groups.set(key, { address: row.recipientEmail, role, messageType: row.messageType, at: row.at, cause: row.cause, count: 1, todo: todoOf(row.recipientEmail, row.cause) });
  }
  return [...groups.values()];
}

/** The addresses somebody must act on: every entry but a mailbox no longer in the settings. */
export function clubMailboxesToFix(groups: readonly ClubMailboxGroup[]): number {
  return groups.filter((group) => group.todo !== "removed").length;
}
