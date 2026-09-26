import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * The declarations of a family on one address, signed as a wizard (§NNN, over §389 and §446).
 *
 * Each person on the address has their own registration, their own declaration and their own
 * link (§389). A parent who registered three people used to open three emails, one after the
 * other, each on its own page. The wizard is one stepper over the address's registrations at the
 * event: one person per step, the same signing form for each, one acceptance and one PDF each —
 * and «Semnez mai târziu» on every step, which moves on without signing anybody.
 *
 * Pure: which registrations are steps, in which order, and which one is signed now. The page and
 * the action read the rows and the pass; this decides.
 */

/** The two states a declaration can be signed from — the same two `signDeclaration` accepts. */
export const SIGNABLE_STATUSES: readonly RegistrationStatus[] = ["PENDING_DECLARATION", "WAITLIST_OFFERED"];

export function isSignable(status: RegistrationStatus): boolean {
  return SIGNABLE_STATUSES.includes(status);
}

/** One registration of the address at the event, as the stepper needs it. */
export type FamilySigningRow = {
  id: string;
  /** The name the declaration is signed against (§314). */
  registeredName: string;
  status: RegistrationStatus;
  createdAt: Date;
  /** When an unsigned place lapses — the declaration hold or the offer (§104); caps the pass. */
  holdExpiresAt?: Date | null;
  /** The desk's code once confirmed, for the last screen's QR (§77). */
  checkinCode?: string | null;
};

/**
 * - `signed`: signed in this pass (or the opened person, once its link is spent);
 * - `current`: the person signed now;
 * - `next`: still to sign here, after the current one;
 * - `later`: «Semnez mai târziu» — shown, never current; their own emailed link still signs them;
 * - `closed`: was a step and moved on without a signature here (lapsed, cancelled at the desk).
 */
export type FamilyStepState = "signed" | "current" | "next" | "later" | "closed";

export type FamilyStep = {
  id: string;
  registeredName: string;
  status: RegistrationStatus;
  state: FamilyStepState;
  holdExpiresAt: Date | null;
  checkinCode: string | null;
};

export type FamilyStepsInput = {
  /** The registration whose emailed link was opened; null when the wizard began on «Înscrierile mele». */
  originId: string | null;
  /** Whether the opened link can still sign its own person — true while its token is live. */
  originSignable: boolean;
  signedIds: readonly string[];
  skippedIds?: readonly string[];
  /**
   * The registrations the wizard was started over, fixed when the pass was issued (§NNN, found in
   * review): a registration added to the address afterwards is never a step of this pass. Absent
   * for a page built fresh from the link, which lists what is on the address now.
   */
  eligibleIds?: readonly string[] | null;
};

/**
 * The steps, in order: the person whose link was opened first, then the others in the order they
 * were registered.
 *
 * A step is the opened person, a person signed or put off in this pass, or a person whose
 * declaration can be signed now. A registration still waiting for its address confirmation, or
 * queued without an offer, has nothing to sign and is not a step; a cancelled one is not either.
 */
export function familySigningSteps(rows: readonly FamilySigningRow[], input: FamilyStepsInput): FamilyStep[] {
  const skippedIds = input.skippedIds ?? [];
  const eligible = input.eligibleIds ?? null;
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.id === input.originId) - Number(a.id === input.originId) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const included = ordered.filter(
    (row) =>
      (eligible === null || eligible.includes(row.id)) &&
      (row.id === input.originId || input.signedIds.includes(row.id) || skippedIds.includes(row.id) || isSignable(row.status)),
  );

  let currentTaken = false;
  return included.map((row) => {
    let state: FamilyStepState;
    if (input.signedIds.includes(row.id)) state = "signed";
    else if (skippedIds.includes(row.id)) state = isSignable(row.status) ? "later" : "closed";
    else if (row.id === input.originId && !input.originSignable) state = "signed";
    else if (isSignable(row.status) && !currentTaken) {
      state = "current";
      currentTaken = true;
    } else if (isSignable(row.status)) state = "next";
    else state = "closed";
    return {
      id: row.id,
      registeredName: row.registeredName,
      status: row.status,
      state,
      holdExpiresAt: row.holdExpiresAt ?? null,
      checkinCode: row.checkinCode ?? null,
    };
  });
}

/** The step signed now, or null when nobody is left to sign here. */
export function currentFamilyStep(steps: readonly FamilyStep[]): FamilyStep | null {
  return steps.find((step) => step.state === "current") ?? null;
}

/** Whether another person follows the current one — the button then says «… și treci la următoarea». */
export function hasNextFamilyStep(steps: readonly FamilyStep[]): boolean {
  return steps.some((step) => step.state === "next");
}

/** Whether the page is a wizard at all: one person alone signs the page they always had. */
export function isFamilyWizard(steps: readonly FamilyStep[]): boolean {
  return steps.length > 1;
}

/** How long the pass that carries the wizard lives after each press, at most. */
export const FAMILY_PASS_MINUTES = 30;

/**
 * When the pass lapses (§NNN, found in review): {@link FAMILY_PASS_MINUTES} after this press, and
 * never later than the earliest hold still running among the people left to sign — the wizard ends
 * with the first place that would lapse under it, and each person's own link carries on from there.
 */
export function familyPassExpiresAt(steps: readonly FamilyStep[], now: Date): Date {
  let at = now.getTime() + FAMILY_PASS_MINUTES * 60_000;
  for (const step of steps) {
    if (step.state !== "current" && step.state !== "next") continue;
    const hold = step.holdExpiresAt?.getTime();
    if (hold !== undefined && hold > now.getTime()) at = Math.min(at, hold);
  }
  return new Date(at);
}
