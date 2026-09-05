/**
 * Staff roles and what each one may do (AGENTS.md §10.2, §11.2; BR-REQ-051-01, BR-REQ-060-01).
 *
 * Pure functions over plain values: no database, no request, no React. That is what lets the
 * same rules be unit-tested exhaustively and still be the single thing the server asserts on
 * every request. BR-REQ-060-01 criterion 4 is explicit that authorization is asserted at the
 * server rather than in the interface — the backoffice hides buttons as a courtesy, and every
 * one of those buttons is checked again here when its action runs.
 *
 * ## Five roles, and they nest
 *
 * The club asked for a hierarchy, and a hierarchy is what this is: each role can do everything
 * the one below it can, plus one thing more. That single property is worth more than the
 * individual grants — it means a capability is a *threshold* rather than a list of roles, so
 * adding a role later cannot silently drop a permission somebody had, and every rule below
 * reads as one comparison.
 *
 *     CONTRIBUTOR  proposes; edits their own drafts and submits them for approval
 *     MODERATOR    edits any event and approves — the club's editorial hands
 *     DEV          the above, plus the configuration report. No participant data
 *     ADMIN        the above, plus registrations, participants and exports
 *     SUPERADMIN   the above, plus staff administration: who is here and what they may do
 *
 * **DEV is the one that is not obvious, so it is written down.** It exists so somebody helping
 * with the platform can read `/devs`, reproduce a problem and fix an event, without being
 * handed the club's participant list. The line between DEV and ADMIN is exactly personal data:
 * everything below ADMIN is about the club's own content, everything from ADMIN up is about the
 * people who registered. That is the boundary worth defending, and it is why DEV sits where it
 * does rather than at the top.
 */

export const STAFF_ROLES = ["CONTRIBUTOR", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The hierarchy itself, and the only place it is written.
 *
 * `session.ts` used to keep a second copy of this to answer `requireStaffRole`, which is one
 * rule in two places and exactly what §1.5 forbids. It imports this now.
 */
const RANK: Record<StaffRole, number> = {
  CONTRIBUTOR: 1,
  MODERATOR: 2,
  DEV: 3,
  ADMIN: 4,
  SUPERADMIN: 5,
};

/** Whether `role` is at least `minimum` in the hierarchy. Every capability below is one of these. */
export function atLeast(role: StaffRole, minimum: StaffRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export const EDITORIAL_STATUSES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type EditorialStatus = (typeof EDITORIAL_STATUSES)[number];

/**
 * Editorial control of what the club publishes: a Moderator and everything above.
 *
 * A Contributor proposes and does not decide, which is the whole difference between the two
 * bottom roles.
 */
export function isEditorial(role: StaffRole): boolean {
  return atLeast(role, "MODERATOR");
}

/**
 * Content that is live, or has been submitted for someone else to judge, is out of a
 * Contributor's hands (§11.2).
 *
 * The status is the *event's*, not the translation's: publication is one state per event
 * (`DECISIONS.md` §28), so a Contributor's own draft is a draft of an unpublished event. The
 * author is still per translation — somebody who wrote the Romanian half does not thereby own
 * the English one.
 */
export function canEditTranslation(
  role: StaffRole,
  translation: { editorialStatus: EditorialStatus; authorStaffUserId: string | null },
  actorId: string,
): boolean {
  if (isEditorial(role)) return true;
  // A Contributor edits their own drafts. Not a colleague's, and not one they submitted for
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
 * The editorial workflow of AGENTS.md §11.2:
 *
 *     DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED
 *
 * A table rather than conditionals, because the interesting property is which moves are
 * *absent*: DRAFT never reaches PUBLISHED directly, so nothing goes live without passing a
 * review, and a Contributor appears in exactly one cell.
 *
 * Each row names the *minimum* role, which is what makes the hierarchy real: a rule written as
 * a list of roles is a rule somebody forgets to add a new role to.
 */
type Transition = { from: EditorialStatus; to: EditorialStatus; minimum: StaffRole };

export const TRANSITIONS: readonly Transition[] = [
  // Submit for approval. The one move a Contributor may make, and only on their own draft.
  { from: "DRAFT", to: "IN_REVIEW", minimum: "CONTRIBUTOR" },
  // Return to the contributor.
  { from: "IN_REVIEW", to: "DRAFT", minimum: "MODERATOR" },
  { from: "IN_REVIEW", to: "PUBLISHED", minimum: "MODERATOR" },
  // Unpublish: back to a draft, so the public page 404s again.
  { from: "PUBLISHED", to: "DRAFT", minimum: "MODERATOR" },
  { from: "PUBLISHED", to: "ARCHIVED", minimum: "MODERATOR" },
  { from: "DRAFT", to: "ARCHIVED", minimum: "MODERATOR" },
  { from: "IN_REVIEW", to: "ARCHIVED", minimum: "MODERATOR" },
  { from: "ARCHIVED", to: "DRAFT", minimum: "MODERATOR" },
] as const;

export function canTransition(
  role: StaffRole,
  from: EditorialStatus,
  to: EditorialStatus,
  isOwnDraft: boolean,
): boolean {
  const transition = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!transition || !atLeast(role, transition.minimum)) return false;
  // A Contributor may submit their own draft and nobody else's. Anyone editorial may submit any.
  if (!isEditorial(role)) return isOwnDraft;
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
 * editorial control of what the club advertises, not authoring. A Contributor has drafts and
 * nothing else (§10.2).
 */
export function canEditEventFields(role: StaffRole): boolean {
  return isEditorial(role);
}

/**
 * Creating and duplicating an event is the same power as configuring one: what the club
 * advertises, and — since the registration block is part of the same row — whether it takes
 * entries at all.
 */
export function canCreateEvent(role: StaffRole): boolean {
  return isEditorial(role);
}

/**
 * Deleting is the one editorial action that destroys rather than moves, so it starts at ADMIN.
 * Archiving is what an event that happened gets; deletion is for a row that should never have
 * existed. An event with any registration against it is refused outright by the service,
 * whoever asks.
 */
export function canDeleteEvent(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * Registrations, participants, the timeline and the export — everything about the people who
 * signed up. This is the personal-data boundary, and it is where ADMIN begins (§10.2).
 *
 * Split out from `canManageStaff`, which every one of these screens used to call. They are two
 * different powers: reading who registered is an Administrator's job, and deciding who is on
 * the staff is not.
 */
export function canManageRegistrations(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * Filling an event's queue with synthetic registrations reaches `registrations` and
 * `participants`, so it sits on the same side of the line as reading them. The environment is
 * the other half of the gate: never in production, refused twice.
 */
export function canManageTestRegistrations(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * The configuration report at `/devs` (BR-REQ-090-04).
 *
 * From DEV up, and deliberately below ADMIN: it names which variables are set, never a value
 * and never anything about a participant, so it is the one screen a technical helper can be
 * given without also being given the club's participant list.
 */
export function canSeeDiagnostics(role: StaffRole): boolean {
  return atLeast(role, "DEV");
}

/**
 * Staff administration — who is here, and what they may do — is the Superadministrator's alone.
 *
 * The top of the hierarchy is defined by this one capability, and it has to be: a role that can
 * grant itself a higher one makes every rule above it decorative. An Administrator can read the
 * whole participant list and still cannot make themselves able to change who else can.
 */
export function canManageStaff(role: StaffRole): boolean {
  return atLeast(role, "SUPERADMIN");
}
