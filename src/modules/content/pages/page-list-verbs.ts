import {
  canEditEventFields,
  canEditTexts,
  canTransition,
  type EditorialStatus,
  type StaffRole,
} from "@/modules/staff-identity/domain/roles";

/**
 * Which verbs one row of the `/admin/pages` list offers a role (BR-REQ-060-01).
 *
 * The list's layout lets a Redactor in (`canReadContent`), so the ⋮ menu cannot be gated on
 * `canEditTexts` alone: a Redactor would be shown «Șterge», which `deletePage` refuses
 * (`canEditEventFields`), and «Publică» / «Retrage», which `transitionPage` refuses for any role
 * under the Administrator (`TRANSITIONS`). Each verb here asks the gate its service asserts, so the
 * menu offers only what the server would accept; the server still asserts it on every press.
 *
 * - `edit`: the editor, for a role that writes the club's texts (`canEditTexts`).
 * - `toggleTo`: the status «Publică» (to PUBLISHED) or «Retrage» (to DRAFT) would move the page to,
 *   or `null` when the table does not let this role make that move from this status.
 * - `remove`: «Șterge», only where `deletePage` accepts the role.
 */
export function pageListVerbs(
  role: StaffRole,
  status: EditorialStatus,
): { edit: boolean; toggleTo: EditorialStatus | null; remove: boolean } {
  const target: EditorialStatus = status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
  return {
    edit: canEditTexts(role),
    // `isOwnDraft` does not change a page's publish or unpublish row (`canTransition`).
    toggleTo: canTransition(role, status, target, false) ? target : null,
    remove: canEditEventFields(role),
  };
}
