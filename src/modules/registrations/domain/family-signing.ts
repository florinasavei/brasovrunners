import type { RegistrationStatus } from "@/db/schema/registrations";
import { compareFamilyOrder } from "./family-sitting";
import { type RaceNumber, raceNumberOf } from "./race-number";

/**
 * The declarations of a family on one address, signed as a wizard (§471, over §389 and §446).
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
  /** Whether a declaration acceptance exists for the registration — signed on a link or on paper (§67). */
  declared?: boolean;
  /** The race number's two columns (§214), for the number beside the desk code (`raceNumberOf`). */
  bibNumber?: number | null;
  provisionalBibNumber?: number | null;
  /** The place in the family's order (§519, `compareFamilyOrder`), when the family's one button confirmed it. */
  familyRank?: number | null;
};

/**
 * Whether the person signed before this wizard began (§471, found in review): a declaration on
 * the row and a state it leads to — confirmed, or queued after a signature that found no place.
 * Such a person is a step shown as signed and counted in «din M», never dropped from the list.
 */
export function signedBefore(row: Pick<FamilySigningRow, "status" | "declared">): boolean {
  return row.declared === true && (row.status === "CONFIRMED" || row.status === "WAITLISTED");
}

/**
 * - `signed`: signed in this pass, signed before it (`signedBefore`), or the opened person once
 *   its link is spent;
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
  /** The number the person has, settled or provisional (`raceNumberOf`, §420), or null while there is none. */
  raceNumber: RaceNumber | null;
};

export type FamilyStepsInput = {
  /** The registration whose emailed link was opened; null when the wizard began on «Înscrierile mele». */
  originId: string | null;
  /** Whether the opened link can still sign its own person — true while its token is live. */
  originSignable: boolean;
  signedIds: readonly string[];
  skippedIds?: readonly string[];
  /**
   * The registrations the wizard was started over, fixed when the pass was issued (§471, found in
   * review): a registration added to the address afterwards is never a step of this pass. Absent
   * for a page built fresh from the link, which lists what is on the address now.
   */
  eligibleIds?: readonly string[] | null;
};

/**
 * The steps, in order: the person whose link was opened first, then the others in the order they
 * were registered.
 *
 * A step is the opened person, a person signed or put off in this pass, a person who signed before
 * the wizard began (shown as signed, counted in «din M»), or a person whose declaration can be
 * signed now. A registration still waiting for its address confirmation, or queued without an
 * offer and without a signature, has nothing to sign and is not a step; a cancelled one is not either.
 */
export function familySigningSteps(rows: readonly FamilySigningRow[], input: FamilyStepsInput): FamilyStep[] {
  const skippedIds = input.skippedIds ?? [];
  const eligible = input.eligibleIds ?? null;
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.id === input.originId) - Number(a.id === input.originId) ||
      // The order the family's forms were sent (§519): one helper for the email, the page and the wizard.
      compareFamilyOrder(a, b),
  );
  const included = ordered.filter(
    (row) =>
      (eligible === null || eligible.includes(row.id)) &&
      (row.id === input.originId || input.signedIds.includes(row.id) || skippedIds.includes(row.id) || signedBefore(row) || isSignable(row.status)),
  );

  let currentTaken = false;
  return included.map((row) => {
    let state: FamilyStepState;
    if (input.signedIds.includes(row.id) || signedBefore(row)) state = "signed";
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
      raceNumber: raceNumberOf({ bibNumber: row.bibNumber ?? null, provisionalBibNumber: row.provisionalBibNumber ?? null }),
    };
  });
}

/**
 * The words a step's line says after the name, as a key under `declare.family.state` (§471): the
 * five states, and a person signed whose signature found no free place says the waiting list
 * rather than «semnată» alone. Pure, so both languages' words are unit-tested.
 */
export type FamilyStepWordsKey = FamilyStepState | "waitlisted" | "cancelled";

/**
 * A person withdrawn from the wizard with «Renunț la înscrierea pentru …» (§NNN) is a closed step
 * whose registration is cancelled: the line says «înscriere anulată», never the vaguer «nu mai
 * așteaptă semnătura» a lapsed hold gets.
 */
export function familyStepWordsKey(step: Pick<FamilyStep, "state" | "status">): FamilyStepWordsKey {
  if (step.status === "CANCELLED" && step.state !== "signed") return "cancelled";
  return step.state === "signed" && step.status === "WAITLISTED" ? "waitlisted" : step.state;
}

/**
 * The signing button's words (§NNN, amending §471; the owner, 2026-09-28: «altfel nu scrie»):
 * «Semnează și treci la următoarea persoană» only while another person's declaration follows in
 * this sitting; on the last one, and on a single declaration, just «Semnează». A key under
 * `Registrations`, so both languages are tested together.
 */
export type SignActionKey = "declare.family.nextAction" | "declare.sign";

export function signActionKey(steps: readonly FamilyStep[] | null): SignActionKey {
  return steps && hasNextFamilyStep(steps) ? "declare.family.nextAction" : "declare.sign";
}

/**
 * «Declarația N din M» (§471): the current person's place in the list, counted from one, and how
 * many people the list holds — the ones signed before or in this pass, put off and still to sign
 * all counted in M. Null when nobody is current.
 */
export function familyStepPosition(steps: readonly FamilyStep[]): { step: number; total: number } | null {
  const index = steps.findIndex((step) => step.state === "current");
  return index < 0 ? null : { step: index + 1, total: steps.length };
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

/**
 * Where one person's declaration stands, as «Toate înscrierile mele» says it under each name (§519;
 * the owner: «pagina „Toate înscrierile mele” arată starea declarației fiecăruia»):
 * - `signed` — an acceptance exists, on a link, in the wizard or on paper at the desk;
 * - `toSign` — a place held, or offered, waiting for it;
 * - `afterAddress` — asked once the address is confirmed from the email;
 * - `waiting` — on the waiting list: asked when a place is offered.
 * A key under `mine.declaration`, so both languages' words are tested together.
 */
export type DeclarationStateKey = "signed" | "toSign" | "afterAddress" | "waiting";

export function declarationStateKey(status: RegistrationStatus, signedAt: Date | null): DeclarationStateKey | null {
  if (signedAt !== null) return "signed";
  if (isSignable(status)) return "toSign";
  if (status === "PENDING_EMAIL_CONFIRMATION") return "afterAddress";
  if (status === "WAITLISTED") return "waiting";
  return null;
}

/** How long the pass that carries the wizard lives after each press, at most. */
export const FAMILY_PASS_MINUTES = 30;

/**
 * When the pass lapses (§471, found in review): {@link FAMILY_PASS_MINUTES} after this press, and
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
