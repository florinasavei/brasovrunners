/**
 * The signing form's field names, in the refusal summary's order (§393, §47); a refusal puts names,
 * never values, in the address (§14.5).
 */
export const GROUP_RUN_FORM_FIELDS = ["idDocument", "birthDate", "email", "accepted", "typedName", "captcha"] as const;
export type GroupRunFormField = (typeof GROUP_RUN_FORM_FIELDS)[number];

/** Marker beside `birthDate` when under the run's minimum age, as the registration's `tooYoung` (§440, §321). */
export const GROUP_RUN_TOO_YOUNG = "tooYoung";

export function parseGroupRunInvalid(value: string | undefined): GroupRunFormField[] {
  const named = new Set((value ?? "").split(","));
  return GROUP_RUN_FORM_FIELDS.filter((field) => named.has(field));
}

export function refusedTooYoung(value: string | undefined): boolean {
  return (value ?? "").split(",").includes(GROUP_RUN_TOO_YOUNG);
}

/**
 * The fields a refused press restores (§314) — never the version's id and hash or the honeypot. They
 * ride sealed for ten minutes in the signer's own browser.
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
