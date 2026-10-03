import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * The one deadline a live registration waits on (§635, §NNN): until when the person can sign the
 * declaration on a held or offered place, or confirm the address on a row still waiting for it.
 *
 * - `hold` / `kept`: a place held for the declaration (§160), before and past its deadline — past it the
 *   place is kept while nobody asks for it, so the person can still sign;
 * - `offer` / `offerLapsed`: a waiting-list offer (§520), which lapses at its deadline;
 * - `reserved`: a family's reservation on a row waiting for its address (§543), while it holds;
 * - `link` / `linkLapsed`: the first email's link (§377), from when the email left (§513).
 *
 * Every other state — waiting, confirmed, ended — waits on no deadline: `null`. The list's column, its
 * sort (`admin-repository.ts#rowDeadlineOrder`, the same cases in SQL), the export and the timeline of
 * the registration's page read this one function, so they cannot say two different things.
 */
export type RowDeadlineKind = "hold" | "kept" | "offer" | "offerLapsed" | "reserved" | "link" | "linkLapsed";

export type RowDeadline = { kind: RowDeadlineKind; at: Date };

export type RowDeadlineInput = {
  status: RegistrationStatus;
  holdExpiresAt: Date | null;
  /** Optional: a caller that has not read the column says nothing of the link. */
  emailLinkExpiresAt?: Date | null;
};

export function rowDeadlineOf(row: RowDeadlineInput, now: Date): RowDeadline | null {
  const passed = (at: Date) => at.getTime() <= now.getTime();
  switch (row.status) {
    case "PENDING_DECLARATION":
      return row.holdExpiresAt ? { kind: passed(row.holdExpiresAt) ? "kept" : "hold", at: row.holdExpiresAt } : null;
    case "WAITLIST_OFFERED":
      return row.holdExpiresAt ? { kind: passed(row.holdExpiresAt) ? "offerLapsed" : "offer", at: row.holdExpiresAt } : null;
    case "PENDING_EMAIL_CONFIRMATION":
      if (row.holdExpiresAt && !passed(row.holdExpiresAt)) return { kind: "reserved", at: row.holdExpiresAt };
      return row.emailLinkExpiresAt ? { kind: passed(row.emailLinkExpiresAt) ? "linkLapsed" : "link", at: row.emailLinkExpiresAt } : null;
    default:
      return null;
  }
}

/** Whether the deadline is a place's — held, offered or reserved — rather than the email's link. */
export function deadlineHoldsAPlace(deadline: RowDeadline | null): boolean {
  return deadline !== null && deadline.kind !== "link" && deadline.kind !== "linkLapsed";
}

/** Whether the deadline has passed (`kept`, `offerLapsed`, `linkLapsed`). */
export function deadlinePassed(deadline: RowDeadline | null): boolean {
  return deadline !== null && (deadline.kind === "kept" || deadline.kind === "offerLapsed" || deadline.kind === "linkLapsed");
}
