/**
 * The signing form's boxes, by the names they post (§393) — what a refusal may name in the address
 * (`?invalid=typedName,email`), and in the order the summary lists them (§47). Names only, never a
 * value (§14.5).
 */
export const GROUP_RUN_FORM_FIELDS = ["idDocument", "birthDate", "email", "accepted", "typedName", "captcha"] as const;
export type GroupRunFormField = (typeof GROUP_RUN_FORM_FIELDS)[number];

/**
 * The marker beside `birthDate` when the date is under the run's minimum age (§440), the shape of
 * the registration's `tooYoung` (§321): the field lets the summary link to the box, the marker lets
 * the page say which rule refused it — the minimum, by its number — rather than "fill it in".
 */
export const GROUP_RUN_TOO_YOUNG = "tooYoung";

/** The refused boxes the address names, known ones only, in the form's order. */
export function parseGroupRunInvalid(value: string | undefined): GroupRunFormField[] {
  const named = new Set((value ?? "").split(","));
  return GROUP_RUN_FORM_FIELDS.filter((field) => named.has(field));
}

/** Whether the refusal was the run's minimum age (`GROUP_RUN_TOO_YOUNG`). */
export function refusedTooYoung(value: string | undefined): boolean {
  return (value ?? "").split(",").includes(GROUP_RUN_TOO_YOUNG);
}

/**
 * What a refused press brings back to the form (§314's rule): these boxes and nothing else — never
 * the version's id and hash, never the honeypot. The document's series and the address ride along
 * sealed for ten minutes on the signer's own browser, a smaller exposure than retyping costs.
 */
export const GROUP_RUN_DRAFT_FIELDS = ["accepted", "idDocumentType", "idDocument", "birthDate", "email", "typedName"] as const;

export function groupRunDraftOf(form: FormData): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const name of GROUP_RUN_DRAFT_FIELDS) {
    const value = form.get(name);
    if (typeof value === "string" && value !== "") draft[name] = value;
  }
  return draft;
}
