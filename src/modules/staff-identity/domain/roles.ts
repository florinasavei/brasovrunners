/**
 * Staff roles and what each one may do (AGENTS.md §10.2, §11.2; BR-REQ-051-01, BR-REQ-060-01).
 *
 * Pure functions over plain values: no database, no request, no React. That is what lets the
 * same rules be unit-tested exhaustively and still be the single thing the server asserts on
 * every request. BR-REQ-060-01 criterion 4 is explicit that authorization is asserted at the
 * server rather than in the interface — the backoffice hides buttons as a courtesy, and every
 * one of those buttons is checked again here when its action runs.
 */

export const STAFF_ROLES = ["AUTHOR", "EDITOR", "ADMIN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const EDITORIAL_STATUSES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type EditorialStatus = (typeof EDITORIAL_STATUSES)[number];

/** Editor and Administrator share every editorial power; only Author is restricted. */
export function isEditorial(role: StaffRole): boolean {
  return role === "EDITOR" || role === "ADMIN";
}

/**
 * Content that is live, or has been submitted for someone else to judge, is out of an
 * Author's hands (§11.2: "Author cannot publish/edit Published").
 */
export function canEditTranslation(
  role: StaffRole,
  translation: { editorialStatus: EditorialStatus; authorStaffUserId: string | null },
  actorId: string,
): boolean {
  if (isEditorial(role)) return true;
  // An Author edits their own drafts. Not a colleague's, and not one they submitted for
  // review — after submission the piece belongs to the reviewer until it comes back.
  return translation.editorialStatus === "DRAFT" && translation.authorStaffUserId === actorId;
}

/**
 * Editing something the public can read right now needs an explicit acknowledgement from the
 * person doing it (BR-REQ-051-01 criterion 4). The interface warns; this is what makes the
 * warning binding, because a warning the server does not check is a decoration.
 */
export function isLiveContent(status: EditorialStatus): boolean {
  return status === "PUBLISHED";
}

/**
 * The editorial workflow of AGENTS.md §11.2, per locale:
 *
 *     DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED
 *
 * Written as an explicit table rather than as conditionals, because the interesting property
 * is which moves are *absent*: DRAFT never reaches PUBLISHED directly, so nothing can be made
 * live without passing a review, and an Author appears in exactly one cell.
 */
type Transition = { from: EditorialStatus; to: EditorialStatus; roles: readonly StaffRole[] };

export const TRANSITIONS: readonly Transition[] = [
  // Submit for review. The one move an Author may make, and only on their own draft.
  { from: "DRAFT", to: "IN_REVIEW", roles: ["AUTHOR", "EDITOR", "ADMIN"] },
  // Return to the author.
  { from: "IN_REVIEW", to: "DRAFT", roles: ["EDITOR", "ADMIN"] },
  { from: "IN_REVIEW", to: "PUBLISHED", roles: ["EDITOR", "ADMIN"] },
  // Unpublish: back to a draft, so the public page 404s in this locale again.
  { from: "PUBLISHED", to: "DRAFT", roles: ["EDITOR", "ADMIN"] },
  { from: "PUBLISHED", to: "ARCHIVED", roles: ["EDITOR", "ADMIN"] },
  { from: "DRAFT", to: "ARCHIVED", roles: ["EDITOR", "ADMIN"] },
  { from: "IN_REVIEW", to: "ARCHIVED", roles: ["EDITOR", "ADMIN"] },
  { from: "ARCHIVED", to: "DRAFT", roles: ["EDITOR", "ADMIN"] },
] as const;

export function canTransition(
  role: StaffRole,
  from: EditorialStatus,
  to: EditorialStatus,
  isOwnDraft: boolean,
): boolean {
  const transition = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!transition || !transition.roles.includes(role)) return false;
  // An Author may submit their own draft and nobody else's.
  if (role === "AUTHOR") return isOwnDraft;
  return true;
}

export function allowedTransitions(
  role: StaffRole,
  from: EditorialStatus,
  isOwnDraft: boolean,
): EditorialStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && canTransition(role, from, t.to, isOwnDraft))
    .map((t) => t.to);
}

/**
 * The event row itself — its times, its map link, and which event the site leads with — is
 * editorial control of what the club advertises, not authoring. §10.2 gives an Editor "event
 * content"; an Author has drafts and nothing else.
 */
export function canEditEventFields(role: StaffRole): boolean {
  return isEditorial(role);
}

/**
 * Staff administration is the Administrator's alone (§10.2: "roles"). An Editor who could
 * grant themselves ADMIN would make the other two roles decorative.
 */
export function canManageStaff(role: StaffRole): boolean {
  return role === "ADMIN";
}
