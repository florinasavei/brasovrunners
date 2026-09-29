import type { RegistrationSex } from "@/db/schema/registrations";

/**
 * «Sex» on a registration: two answers, «Masculin» and «Feminin» (§NNN, amending §510; the owner,
 * 2026-09-29: «sexul e doar masculin și feminin … nu avem opțiunea de a prefera să nu zică»).
 *
 * **The one rule every door meets.** `fields.ts` builds every submission schema — the public form,
 * the family link and a sitting's forms, the staff entry and the desk's walk-in behind it, a TEST
 * row — from one `sex` field, `z.enum(SEX_CHOICES)`, so no new row can carry `UNSPECIFIED`: the
 * public form refuses it by name, and a staff entry may leave the answer out (a paper entry, §510)
 * but never give the retired one.
 *
 * **The enum keeps `UNSPECIFIED`.** Rows stored before this release keep it — no contract
 * migration, nothing rewritten — and every screen and file shows them as having no answer
 * (`sexShown`), as it shows a staff entry that never had one.
 */
export const SEX_CHOICES = ["MALE", "FEMALE"] as const satisfies readonly RegistrationSex[];

export type SexChoice = (typeof SEX_CHOICES)[number];

export function isSexChoice(value: unknown): value is SexChoice {
  return typeof value === "string" && (SEX_CHOICES as readonly string[]).includes(value);
}

/** A stored answer as a screen or a file shows it: one of the two, or none (`UNSPECIFIED`, null). */
export function sexShown(sex: RegistrationSex | null | undefined): SexChoice | null {
  return isSexChoice(sex) ? sex : null;
}

/**
 * The spreadsheet's words (§172): its headers are English, and so is this column. Empty for a row
 * with no answer — the retired «Prefer să nu spun» included.
 */
export function sexCell(sex: RegistrationSex | null | undefined): string {
  const shown = sexShown(sex);
  return shown === "MALE" ? "Male" : shown === "FEMALE" ? "Female" : "";
}

/**
 * A form kept before this release (§446, `pending_family_entries.fields`) may hold the retired
 * answer: pressed through after it, the answer is dropped rather than the person refused — the
 * parent did everything right, and the row stores no sex, as a paper entry may. The same shape as
 * the country an older kept form never had (§510, `family-confirm.ts`).
 */
export function withoutRetiredSex<T extends Record<string, unknown>>(fields: T): T {
  if (fields.sex === undefined || isSexChoice(fields.sex)) return fields;
  const rest: Record<string, unknown> = { ...fields };
  delete rest.sex;
  return rest as T;
}
