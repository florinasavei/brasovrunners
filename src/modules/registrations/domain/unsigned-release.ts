import { confirmationWindow } from "./hold-deadlines";

/**
 * «Eliberează singur locurile nesemnate la termen» (§NNN; the owner, 2026-11-04, for the 21 November race: at the
 * declaration's deadline the places of those who have not signed go back, and nobody is given them by itself), as pure
 * rules over the event's row.
 *
 * **One run per deadline.** On a capped, scheduled event with the box ticked and a participation window whose deadline
 * is strictly before the start, the first capacity-changing transaction at or after that deadline — normally the
 * maintenance run the deadline wakes — releases every declaration hold that holds a counted place and is past its own
 * deadline, whether or not anybody waits, writes the deadline it ran for (`events.unsigned_released_for`) and ticks
 * «Locurile libere le dau doar eu», so nobody is given the freed places by the site or the line. A window moved to
 * another deadline arms it again; holds given or lapsing after it follow §160 as before — no release is driven by the
 * clock alone. At or after the start everything is released silently anyway (§160), so the run has nothing to add.
 *
 * `deadlineReleaseDueSql` in `repository.ts` is the same rule in SQL, for the job's choice of events; a unit test holds
 * the two together. Both count days as 24 hours (`confirmationWindow`), never a calendar day that DST bends.
 */
export type DeadlineReleaseRules = {
  capacity: number | null;
  eventStatus: string;
  startsAt: Date;
  confirmationOpensDaysBefore: number | null;
  confirmationDeadlineDaysBefore: number | null;
  releaseUnsignedAtDeadline: boolean;
  unsignedReleasedFor: Date | null;
};

/** The participation window's deadline, only when it is strictly before the start — a deadline at the start releases nothing new. */
export function windowDeadlineOf(event: Pick<DeadlineReleaseRules, "startsAt" | "confirmationOpensDaysBefore" | "confirmationDeadlineDaysBefore">): Date | null {
  const window = confirmationWindow(event);
  return window && window.deadline.getTime() < event.startsAt.getTime() ? window.deadline : null;
}

/** The deadline the release is armed for — ticked, capped, scheduled, a window before the start, not yet run for it — or null. */
export function deadlineReleaseArmedFor(rules: DeadlineReleaseRules): Date | null {
  if (!rules.releaseUnsignedAtDeadline || rules.capacity === null || rules.eventStatus !== "SCHEDULED") return null;
  const deadline = windowDeadlineOf(rules);
  if (!deadline) return null;
  return rules.unsignedReleasedFor?.getTime() === deadline.getTime() ? null : deadline;
}

/**
 * Whether the armed release will take this hold: a counted declaration hold — never a special guest's («În afara
 * locurilor», released only at the start) — ending by the deadline the release is armed for. The one question every
 * promise about an unsigned place asks — the declaration's emails (`render.ts`), its page, «Înregistrările mele» and
 * «Ce îi spui» — so none says a place stays while nobody waits when the release will take it.
 */
export function releaseTakesHold(rules: DeadlineReleaseRules, hold: { holdExpiresAt: Date | null; outsideCapacity?: boolean | null }): boolean {
  if (!hold.holdExpiresAt || hold.outsideCapacity === true) return false;
  const deadline = deadlineReleaseArmedFor(rules);
  return deadline !== null && hold.holdExpiresAt.getTime() <= deadline.getTime();
}

/**
 * The deadline the release must run for now — armed, the deadline reached and the start still ahead — or null. The
 * one question `expireStaleHolds` asks under the event's lock before it decides which lapsed holds go.
 */
export function deadlineReleaseDue(rules: DeadlineReleaseRules, now: Date): Date | null {
  const deadline = deadlineReleaseArmedFor(rules);
  if (!deadline) return null;
  return deadline.getTime() <= now.getTime() && now.getTime() < rules.startsAt.getTime() ? deadline : null;
}

/** The instant the maintenance job must wake for the release — the armed deadline, while it is still ahead — or null. */
export function deadlineReleaseWakeAt(rules: DeadlineReleaseRules, now: Date): Date | null {
  const deadline = deadlineReleaseArmedFor(rules);
  return deadline && deadline.getTime() > now.getTime() ? deadline : null;
}
