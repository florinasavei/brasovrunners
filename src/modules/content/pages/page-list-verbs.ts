import {
  isEditorial,
  canEditTexts,
  canTransition,
  type EditorialStatus,
  type StaffRole,
} from "@/modules/staff-identity/domain/roles";

/**
 * The verbs one row of `/admin/pages` offers a role (BR-REQ-060-01): each asks the gate its service
 * asserts, since a Redactor reaches the list but may neither delete (`isEditorial`) nor publish
 * (`TRANSITIONS`). `toggleTo` is null when this role may not make the move from this status.
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
    remove: isEditorial(role),
  };
}
