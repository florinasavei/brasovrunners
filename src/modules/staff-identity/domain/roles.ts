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

/**
 * Six roles, in rank order (`DECISIONS.md` §103). The names the club sees are in
 * `staff-labels.ts`: the volunteer, the copywriter, the organizer, the developer, the
 * administrator, the superadministrator. The enum keeps `CONTRIBUTOR` for the volunteer
 * because a Postgres enum value is not renamed; what the role *does* changed in §103.
 */
export const STAFF_ROLES = ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The hierarchy itself, and the only place it is written.
 *
 * `session.ts` used to keep a second copy of this to answer `requireStaffRole`, which is one
 * rule in two places and exactly what §1.5 forbids. It imports this now.
 */
const RANK: Record<StaffRole, number> = {
  CONTRIBUTOR: 1,
  COPYWRITER: 2,
  MODERATOR: 3,
  DEV: 4,
  ADMIN: 5,
  SUPERADMIN: 6,
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
 * The copywriter's whole job (§103): the words of any event and any page, at any status —
 * the title, the description, the rules, the programme, the SEO fields, a page's body — and
 * nothing that is not words: no event setting, no publication, no gallery, no registration.
 * The volunteer (`CONTRIBUTOR`) is below this line: the desk, and only the desk.
 */
export function canEditTexts(role: StaffRole): boolean {
  return atLeast(role, "COPYWRITER");
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
  // Since §103 the answer no longer depends on whose draft it is: a copywriter edits every
  // text and a volunteer none. The author stays in the signature because the callers pass it
  // and a future rule — a piece locked while under review, say — would read it.
  void actorId;
  /*
    **Live text is still editorial, and that is a question left open on purpose (§201).**

    §201 made every move that crosses public view an Administrator's. Editing the *words* of an
    already-published page is the remaining way something reaches the public without her, and
    closing it is one line here — `if (isLiveContent(...)) return atLeast(role, "ADMIN")`.

    It is not written, because it would reverse BR-REQ-051-01 criterion 3 in as many words: "a
    copywriter edits live text with the acknowledgement; a volunteer never" (§103). The club
    asked for the *organizer* to be managed by the Administrator, and the organizer sits above
    the copywriter, so the restriction cannot be applied to one without the other. That is a
    decision about how the club works, not about how this function is written, and it waits for
    the club rather than being taken here.

    What stands in the meantime: BR-REQ-051-01 criterion 4's acknowledgement, which the server
    checks, "because a warning the server does not check is a decoration".
  */
  void translation;
  return canEditTexts(role);
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
  // Submit for approval: the one move a copywriter may make (§103).
  { from: "DRAFT", to: "IN_REVIEW", minimum: "COPYWRITER" },
  // Return to the contributor. Nothing public moves, so the organizer still does it.
  { from: "IN_REVIEW", to: "DRAFT", minimum: "MODERATOR" },
  /*
    **Crossing into or out of public view is an Administrator's act since §201.**

    The owner, of his two colleagues: "Amalia e Administrator, Dani e Organizator dar poate face
    prostii, deci trebuie manageuit de Amalia". These four rows are the whole of what the public
    can see changing — a page appearing, a page disappearing, a live page being taken down or
    put back — so raising exactly these four is what "nothing Dani does goes live on its own"
    means, expressed as the smallest possible change to the table.

    The organizer keeps everything that does not cross that line: writing, submitting, returning
    a draft, archiving something that was never published.
  */
  { from: "IN_REVIEW", to: "PUBLISHED", minimum: "ADMIN" },
  // Unpublish: back to a draft, so the public page 404s again.
  { from: "PUBLISHED", to: "DRAFT", minimum: "ADMIN" },
  { from: "PUBLISHED", to: "ARCHIVED", minimum: "ADMIN" },
  // Neither of these was ever public: a draft and a submission are invisible either way.
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
  // A copywriter submits any draft, theirs or a colleague's (§103): the reviewer is the
  // organizer either way. `isOwnDraft` stays in the signature for the callers that compute it.
  void isOwnDraft;
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
 * **The Administrator creates events (§204).**
 *
 * The owner: "administratorul crează evenimente". It had been the same power as configuring one,
 * on the reasoning that both decide what the club advertises — and the reasoning holds for
 * *configuring*, which stays with the Organizer. Creating is the act that decides there is a
 * race at all, and since the registration block is part of the same row, it decides whether the
 * club takes entries. That is the club's decision, not the organizer's preparation of it.
 *
 * An Organizer opens an event the Administrator created and does everything to it: the date, the
 * place, the route, the capacity, the registration window, the queue, the desk. What they cannot
 * do is invent a race, publish one, or take a published one down (§201).
 */
export function canCreateEvent(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/** A page is words; a copywriter starts one as a draft. Deleting and ordering stay editorial. */
export function canCreatePage(role: StaffRole): boolean {
  return canEditTexts(role);
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
 * Erasing an event **and everyone registered for it** — the hard delete (BR-REQ-037-06,
 * BR-REQ-060-01).
 *
 * Two powers at once, so it asks for both: it destroys club content (`canDeleteEvent`) and it
 * destroys participant data (`canManageRegistrations`). Writing it as the conjunction rather
 * than as `atLeast(role, "ADMIN")` is not decoration — it means that if either boundary is
 * ever moved, this moves with it instead of quietly keeping the old one.
 *
 * **Why not SUPERADMIN.** The tempting answer is "the most destructive verb belongs to the
 * highest role", and it is the wrong one. SUPERADMIN is defined by exactly one capability —
 * deciding who is on the staff and what they may do — and it is deliberately *not* a general
 * "dangerous things" tier; the hierarchy's real line is personal data, and that line is ADMIN
 * (see the header of this file). An Administrator may already erase every registration on an
 * event, one at a time, and then delete the event: gating the single-step version behind a
 * higher role would not protect one row, it would only make the safe path slower than the
 * unsafe one. What actually protects the data is the confirmation the service demands — the
 * event's exact title typed by hand, and a reason — the audit rows it leaves, and the fact
 * that this verb is absent from every bulk control.
 */
export function canHardDeleteEvent(role: StaffRole): boolean {
  return canDeleteEvent(role) && canManageRegistrations(role);
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
 * The race-day desk (BR-REQ-037-07, BR-REQ-037-08; `DECISIONS.md` §67): every staff session.
 *
 * A volunteer handing out numbers is the lowest role there is — CONTRIBUTOR — and the desk is
 * open to them because a desk sees one runner at a time: the person standing in front of it,
 * by name, with a number and a check-in state. It never sees an address, the export, or the
 * cancel and erase verbs, which stay behind `canManageRegistrations`. What the desk *can* do
 * is everything that gets that one runner their number when the normal path failed — no
 * email arrived, no QR to show, never registered at all: enter them, confirm them on a paper
 * declaration, give them a number by hand, check them in. Each of those is audited under the
 * volunteer's own id.
 */
export function canWorkTheDesk(role: StaffRole): boolean {
  return atLeast(role, "CONTRIBUTOR");
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

/**
 * The backoffice's sections, and which of them a role is offered.
 *
 * A pure function because "which sections may this role see" is a rule, and §1.5 requires a
 * rule that can be a pure function to be one. It was not one, and the cost was concrete: the
 * layout tested `role === "ADMIN"` for the whole group, which is a raw equality check against a
 * hierarchy of five nesting roles (`DECISIONS.md` §38). **A SUPERADMIN was therefore shown only
 * the Events tab** — and migration `0016` made every existing ADMIN a SUPERADMIN, so the people
 * actually running the club were the ones who could not see the registrations, the legal
 * documents, the staff screen or `/devs`. A DEV was offered no `/devs`; an ADMIN was offered a
 * Staff tab that 404s on arrival.
 *
 * Nothing was exposed by any of that. Every page below asserts its own capability on the server
 * and answers 404 to a typed URL (BR-REQ-060-01) — the navigation was lying about what the
 * reader may do, not letting them do more. But a section a person cannot see is a feature they
 * conclude does not exist, which is exactly what happened.
 *
 * Each entry names the capability the page behind it actually asserts, so the two cannot drift:
 *
 *     events         everyone with a staff session — the backoffice's front door
 *     checkin        canWorkTheDesk           `admin/checkin/page.tsx` — every role, on purpose
 *     guide          every staff session      `admin/guide/page.tsx`
 *     registrations  canManageRegistrations   `admin/registrations/page.tsx`
 *     pages          isEditorial              `admin/pages/page.tsx`
 *     legal          atLeast(role, "ADMIN")   `admin/legal/page.tsx`
 *     staff          canManageStaff           `admin/staff/page.tsx`
 *     devs           canSeeDiagnostics        `devs/page.tsx`
 *
 * The hierarchy makes one property testable and worth stating: a higher role is offered every
 * section a lower one is. `tests/unit/staff/roles.test.ts` asserts it across every pair, which
 * is the assertion that would have caught the original defect.
 */
export const ADMIN_SECTIONS = [
  "events",
  "checkin",
  "guide",
  "pages",
  "gallery",
  "registrations",
  "tasks",
  "legal",
  "staff",
  "devs",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function visibleAdminSections(role: StaffRole): AdminSection[] {
  return [
    // The events list, for everyone who writes or configures one; a volunteer's backoffice
    // is the desk and the guide, nothing else (§103).
    ...(canEditTexts(role) ? (["events"] as const) : []),
    // The desk: a volunteer's whole backoffice (BR-REQ-037-08), and the guide that explains it.
    ...(canWorkTheDesk(role) ? (["checkin", "guide"] as const) : []),
    // Standing pages are words, so the copywriter writes them (BR-REQ-050-03, §103); the
    // gallery is pictures and stays with the roles that configure an event.
    ...(canEditTexts(role) ? (["pages"] as const) : []),
    ...(isEditorial(role) ? (["gallery"] as const) : []),
    ...(canManageRegistrations(role) ? (["registrations"] as const) : []),
    // What the *club* still owes, for the role that answers for it (BR-REQ-060-01).
    ...(canManageRegistrations(role) ? (["tasks"] as const) : []),
    ...(atLeast(role, "ADMIN") ? (["legal"] as const) : []),
    ...(canManageStaff(role) ? (["staff"] as const) : []),
    ...(canSeeDiagnostics(role) ? (["devs"] as const) : []),
  ];
}
