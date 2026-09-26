import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * The declarations of a family on one address, signed as a wizard (§NNN, over §389 and §446).
 *
 * Each person on the address has their own registration, their own declaration and their own
 * link (§389). A parent who registered three people used to open three emails, one after the
 * other, each on its own page. The wizard is one stepper over the address's registrations at the
 * event: one person per step, the same signing form for each, one acceptance and one PDF each.
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
};

export type FamilyStepState = "signed" | "current" | "next" | "closed";

export type FamilyStep = {
  id: string;
  registeredName: string;
  status: RegistrationStatus;
  state: FamilyStepState;
};

/**
 * The steps, in order: the person whose link was opened first, then the others in the order they
 * were registered.
 *
 * A step is the opened person, a person signed in this pass, or a person whose declaration can be
 * signed now. A registration still waiting for its address confirmation, or queued without an
 * offer, has nothing to sign and is not a step; a cancelled one is not a step either.
 *
 * `originSignable` is whether the opened link can still sign its own person — true while its
 * token is live. Once it is spent the opened person is never "current" again: the pass that
 * carries the wizard on signs the others, never the link's own person a second time.
 *
 * The current step is the first step that can be signed; `signed` is a person signed in this pass
 * (or the opened person, once its link is spent), shown with a tick; `closed` is a person who was a
 * step and has moved on without a signature (lapsed, cancelled at the desk) — shown, never current.
 */
export function familySigningSteps(
  rows: readonly FamilySigningRow[],
  pass: { originId: string; originSignable: boolean; signedIds: readonly string[] },
): FamilyStep[] {
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.id === pass.originId) - Number(a.id === pass.originId) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const included = ordered.filter(
    (row) => row.id === pass.originId || pass.signedIds.includes(row.id) || isSignable(row.status),
  );

  let currentTaken = false;
  return included.map((row) => {
    const signedHere = pass.signedIds.includes(row.id) || (row.id === pass.originId && !pass.originSignable);
    const canSign = isSignable(row.status) && !signedHere;
    let state: FamilyStepState;
    if (signedHere) state = "signed";
    else if (canSign && !currentTaken) {
      state = "current";
      currentTaken = true;
    } else if (canSign) state = "next";
    else state = "closed";
    return { id: row.id, registeredName: row.registeredName, status: row.status, state };
  });
}

/** The step signed now, or null when every declaration on the address is done. */
export function currentFamilyStep(steps: readonly FamilyStep[]): FamilyStep | null {
  return steps.find((step) => step.state === "current") ?? null;
}

/** Whether the page is a wizard at all: one person alone signs the page they always had. */
export function isFamilyWizard(steps: readonly FamilyStep[]): boolean {
  return steps.length > 1;
}

/** How long the pass that carries the wizard from one person to the next lives after each signature. */
export const FAMILY_PASS_MINUTES = 30;
