import { roleBox, type RoleRowBox } from "@/modules/volunteers/role-rows";

/**
 * One row of the event editor's «Roluri» form as a post (§NNN): a role's boxes by their short names, each under its row's key —
 * `roles[<id>].needed` — the way the card names them (`src/modules/volunteers/role-rows.ts`). A saved role's key is its id; the blank row of a
 * category is `new-<category id>`, of the roles under none `new-none`.
 */
export function rowBoxes(key: string, fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([box, value]) => [roleBox(key, box as RoleRowBox), value]));
}

/** The key of the blank row under no category. */
export const NEW_ROW = "new-none";
