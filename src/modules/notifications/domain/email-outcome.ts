import type { EmailOutboxStatus } from "@/db/schema/email-outbox";

/**
 * What became of one email, as one closed word (§960) — the ONE judgement a person's «Emailuri» fold draws its chips
 * and its closed line from (`ui/EmailJournal.tsx#DepartedChip`, `ui/EmailHistory.tsx`), and the «Emailuri» column of the
 * «Voluntari» and registrations lists says in a word (`email-summaries.ts`, `ui/EmailSummary.tsx`). One function, so the
 * column and the fold can never say two things of one row.
 *
 * In the order it is asked:
 * - **waiting** — it has not left: queued, or a worker holds it now (`PENDING`, `PROCESSING`);
 * - **failed** — it spent its tries and never left (`FAILED`);
 * - **rejected** — the recipient's server refused it, or the person marked it as spam (`BOUNCED`, `COMPLAINED`);
 * - **captured** — the environment kept it (QA's allowlist): it was «sent» to nobody (`recipient_count = 0`);
 * - **delivered** — it left and the recipient's server took it (`delivered_at`);
 * - **sent** — it left, and nothing more is known: no delivery fact yet, or a road that reports none (Gmail).
 *
 * Read from the row's state and the provider's facts alone — never from the payload, an address or `last_error`.
 */
export const EMAIL_OUTCOMES = ["waiting", "sent", "delivered", "rejected", "failed", "captured"] as const;
export type EmailOutcome = (typeof EMAIL_OUTCOMES)[number];

/** The facts of a row the judgement reads. A reader that does not carry the delivery fact leaves it out: it then reads «sent». */
export type EmailOutcomeFacts = {
  status: EmailOutboxStatus;
  /** 0 for a message the environment captured; null on rows sent before the count existed. */
  recipientCount: number | null;
  deliveredAt?: Date | null;
};

/** Whether a row has not left yet: queued, or held by a worker. */
export function isWaitingStatus(status: EmailOutboxStatus): boolean {
  return status === "PENDING" || status === "PROCESSING";
}

export function emailOutcomeOf(row: EmailOutcomeFacts): EmailOutcome {
  if (isWaitingStatus(row.status)) return "waiting";
  if (row.status === "FAILED") return "failed";
  if (row.status === "BOUNCED" || row.status === "COMPLAINED") return "rejected";
  if (row.recipientCount === 0) return "captured";
  return row.deliveredAt ? "delivered" : "sent";
}
