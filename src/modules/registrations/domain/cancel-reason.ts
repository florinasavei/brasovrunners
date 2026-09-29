import type { RegistrationCancelReasonKind } from "@/db/schema/registrations";

/**
 * Why a participant cancels their own registration (§NNN; the owner, 2026-09-29: «when people
 * cancel, they need to provide a reason»). Asked at every self-cancellation door — the manage page,
 * «Înscrierile mele» and the family wizard's «Renunț» — as one of three answers, with a short text of
 * the person's own for «Alt motiv» only. Required: a press without one is refused naming the box, and
 * nothing is spent or cancelled.
 *
 * The three in the form's order, the column's enum values exactly (a unit test holds the two
 * together) — written out here, a type import only, so the form's island never bundles the schema.
 */
export const CANCEL_REASON_KINDS = ["INJURY_OR_ILLNESS", "OTHER_PLANS", "OTHER"] as const satisfies readonly RegistrationCancelReasonKind[];

/** The longest «Alt motiv» the form takes: a sentence, not a letter. */
export const CANCEL_REASON_MAX = 200;

/** The form's two field names, the same at every door. */
export const CANCEL_REASON_FIELDS = { kind: "cancelReasonKind", text: "cancelReason" } as const;

export type CancelReason = { kind: RegistrationCancelReasonKind; text: string | null };

/** Which box a refused reason names: no answer chosen, «Alt motiv» with no words, or too many words. */
export type CancelReasonProblem = "kind" | "text" | "long";

export const CANCEL_REASON_PROBLEMS: readonly CancelReasonProblem[] = ["kind", "text", "long"];

export function isCancelReasonKind(value: unknown): value is RegistrationCancelReasonKind {
  return typeof value === "string" && (CANCEL_REASON_KINDS as readonly string[]).includes(value);
}

/**
 * The reason from the posted form. The text is kept only for «Alt motiv» — the other two answers are
 * the whole reason — trimmed, its inner runs of spaces and line breaks folded to one space, and
 * counted in characters as a person counts them.
 */
export function parseCancelReason(
  form: Pick<FormData, "get">,
): { ok: true; reason: CancelReason } | { ok: false; problem: CancelReasonProblem } {
  const kind = form.get(CANCEL_REASON_FIELDS.kind);
  if (!isCancelReasonKind(kind)) return { ok: false, problem: "kind" };
  if (kind !== "OTHER") return { ok: true, reason: { kind, text: null } };
  const raw = form.get(CANCEL_REASON_FIELDS.text);
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text === "") return { ok: false, problem: "text" };
  if ([...text].length > CANCEL_REASON_MAX) return { ok: false, problem: "long" };
  return { ok: true, reason: { kind, text } };
}

/** A refused reason's problem as it comes back in the address (`?reason=`), or undefined. */
export function cancelReasonProblemOf(value: unknown): CancelReasonProblem | undefined {
  return CANCEL_REASON_PROBLEMS.find((problem) => problem === value);
}

const CELL_WORDS: Record<RegistrationCancelReasonKind, string> = {
  INJURY_OR_ILLNESS: "Injury or illness",
  OTHER_PLANS: "Other plans",
  OTHER: "Another reason",
};

/**
 * The export's «Cancellation reason» cell (§NNN), in the export's English like its other words
 * (`sexCell`): the answer, and after «Another reason» the person's own words. Empty for a staff
 * cancellation, a row cancelled before the column, and every row that is not cancelled.
 */
export function cancelReasonCell(kind: RegistrationCancelReasonKind | null | undefined, text: string | null | undefined): string {
  if (!kind) return "";
  return kind === "OTHER" && text ? `${CELL_WORDS.OTHER}: ${text}` : CELL_WORDS[kind];
}
