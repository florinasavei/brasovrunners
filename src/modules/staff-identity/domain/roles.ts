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
 *     MODERATOR    configures any event, and reads the registrations, the export and the bibs
 *     DEV          the above, plus the configuration report
 *     ADMIN        the above, plus *changing* a registration, and publication
 *     SUPERADMIN   the above, plus staff administration: who is here and what they may do
 *
 * **DEV is the one that is not obvious, so it is written down.** It exists so somebody helping
 * with the platform can read `/devs`, reproduce a problem and fix an event. It sits above
 * MODERATOR only so that `canSeeDiagnostics` can be a threshold; it is not a step up in what it
 * may do to the club's participants.
 *
 * **Where the line runs, since §289.** It used to be personal data, with ADMIN on the far side of
 * it. The owner moved it: an Organizer who cannot see the start list cannot organize the race, so
 * MODERATOR reads the whole list, the spreadsheet and the race numbers. What ADMIN keeps is every
 * verb that *changes* a registration — cancel, erase, resend, correct a name, assign or mark the
 * numbers — and publication (§201). Reading against changing is the boundary now, and it is worth
 * defending in the same way the old one was: each of those verbs asserts itself in its own
 * service, never in the interface that hides its button.
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
 * The words of any event and any page, at any status — the title, the description, the rules, the
 * programme, the SEO fields, a page's body — and nothing that is not words: no event setting, no
 * publication, no gallery, no registration (§103).
 *
 * ## The one deliberate gap in the ladder (§207)
 *
 * **This is a set, not a threshold, and it is the only capability in this file that is.** Every
 * other one reads `atLeast(role, …)`, which makes the hierarchy real: a rule written as a list
 * of roles is a rule somebody forgets to add a new role to. So a gap here has to earn itself.
 *
 * The owner, of his two colleagues: "tot ce vreau e ca organizatorul să nu fie și redactor…
 * Redactorul scrie, Organizatorul organizează", and then, asked to confirm the consequence: "da,
 * așa vreau". An Organizer sets the date, the place, the route, the capacity, the registration
 * window, the queue and the desk. A Redactor writes the words. Neither does the other's job, and
 * a rank ladder cannot express that — rank would give the Organizer the Redactor's work simply
 * for being above them, which is what the club is asking not to happen.
 *
 * `DEV` is out for the same reason it is out of everything editorial: "Tehnic" is diagnostics,
 * and it sits where it does in the ladder only so that `canSeeDiagnostics` can be a threshold.
 * `ADMIN` and `SUPERADMIN` keep it, because the Administrator is who both of the others ask.
 *
 * The volunteer (`CONTRIBUTOR`) is below all of it: the desk, and only the desk.
 */
const MAY_EDIT_TEXTS: ReadonlySet<StaffRole> = new Set<StaffRole>([
  "COPYWRITER",
  "ADMIN",
  "SUPERADMIN",
]);

export function canEditTexts(role: StaffRole): boolean {
  return MAY_EDIT_TEXTS.has(role);
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
 * **Reading who signed up, without a verb that changes one (§289).**
 *
 * The owner, of his Organizer: "ca si organizator ar trebui sa vad cine s-a inscris!", and then
 * "organizer should also be able to see BIDs and export them". Asked how far it should go, he
 * chose the whole list — the addresses, the telephone numbers, the identity document, the signed
 * declarations and the spreadsheet — and no verb: no cancel, no erasure, no resend.
 *
 * That is a real narrowing of §10.2, which reserved "registrations, participants, waitlist…
 * exports" to the Administrator, and it is written here rather than argued twice because the
 * reason is the job: an Organizer who cannot see the start list cannot organize the race. What
 * the boundary between the two roles now means is **reading against changing**, not the data
 * itself — the Administrator is still the only one who cancels a place, erases a row, resends a
 * message or corrects a name, and each of those is asserted in its own service (BR-REQ-060-01).
 *
 * ## The second deliberate gap in the ladder, and it is `DEV`
 *
 * **A set, not a threshold**, which this file allows only where the gap earns itself (see
 * `MAY_EDIT_TEXTS`). It does here, for the one reason `DEV` exists at all: it is the role the
 * club can give somebody helping with the platform, and §38 and `roles.test.ts` both say in as
 * many words that such a person never receives the participant list. `DEV` outranks `MODERATOR`
 * only so that `canSeeDiagnostics` can be written as a threshold — it is not a step up in what a
 * role may know about a person, and a threshold here would quietly have made it one.
 *
 * The volunteer stays out too: `CONTRIBUTOR` gets the desk, which shows one runner at a time by
 * name with a state and a number and never an address (`AGENTS.md` §15.11).
 */
const MAY_READ_REGISTRATIONS: ReadonlySet<StaffRole> = new Set<StaffRole>([
  "MODERATOR",
  "ADMIN",
  "SUPERADMIN",
]);

export function canReadRegistrations(role: StaffRole): boolean {
  return MAY_READ_REGISTRATIONS.has(role);
}

/**
 * **Writing to an event's participants in the club's own words (§364)** — "Trimite un mesaj
 * participanților": bad weather, a changed start, anything the organizer has to tell the people
 * registered for one event.
 *
 * Whoever may tell them about a change today (`canEditEventFields`, the §331 update notice) and
 * may also read who they are (`canReadRegistrations`) — so the Organizer, the Administrator and
 * the Superadministrator. Written as the conjunction rather than as a new list, so that moving
 * either boundary moves this with it.
 *
 * **The Tehnic role is out on purpose — a narrowing of the §331 set, for the owner to confirm**
 * (§364). `DEV` outranks the Organizer and may save an event's fields, so it may send the §331
 * update and cancellation notices, their free-text note included. Those ride on a change to the
 * event itself: the note sits under the platform's sentences, goes to everybody active, and only
 * with a save. This is a message on its own, of whatever was typed, to a group the sender picks
 * from the registrations' states — an act on the participant list, and `DEV` is the role that
 * never receives it (§38, §289). Should the owner want the §331 set instead, this becomes
 * `canEditEventFields` alone. The volunteer and the Redactor are out as they are out of the
 * event's settings.
 */
export function canMessageParticipants(role: StaffRole): boolean {
  return canEditEventFields(role) && canReadRegistrations(role);
}

/**
 * **Sending the newsletter (§NNN)** — a message the club writes to every subscriber of one topic.
 * The same people who may write to an event's participants (§364): the Organizer, the
 * Administrator and the Superadministrator — it is the club speaking to people who asked to hear
 * from it, the organizer's own kind of act. Nobody reads an address on the way: the page shows
 * counts. Removing an address by hand (the notice's "or by writing to us") is the Administrator's,
 * as the "Anunță-mă" list's withdrawal is (§146), through `canManageRegistrations`.
 */
export function canSendNewsletter(role: StaffRole): boolean {
  return canMessageParticipants(role);
}

/**
 * Changing a registration: cancel, erase, resend, correct a name, assign or mark the race
 * numbers, fill a queue with test rows, send the thank-you. The Administrator's, and it is where
 * the line between the two roles now sits (§289) — reading is `canReadRegistrations`.
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
 *     registrations  canReadRegistrations     `admin/registrations/page.tsx` — the verbs on it
 *                                             ask `canManageRegistrations` one by one (§289)
 *     pages          isEditorial              `admin/pages/page.tsx`
 *     tasks          canManageRegistrations   `admin/tasks/page.tsx` — or `canSeeDiagnostics`,
 *                    or canSeeDiagnostics      for the «Aplicația» panel alone (§397)
 *     legal          atLeast(role, "ADMIN")   `admin/legal/page.tsx`
 *     emails         every staff session      `admin/emails/page.tsx` — the panels gate themselves
 *     newsletter     canSendNewsletter        `admin/newsletter/page.tsx` — the subscribers and the
 *                                             composer (§NNN); withdrawing an address asks
 *                                             `canManageRegistrations` for itself
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
  "emails",
  "newsletter",
  "staff",
  "devs",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/**
 * **Whether a role may *look* at the club's own content (§208).**
 *
 * The capability this file did not have. Every other function here answers "may you change
 * this", and the navigation was built out of those answers — so the day the Organizer stopped
 * writing texts (§207) they also stopped being able to *see* the events list, which is not what
 * anybody asked for.
 *
 * The owner: "organizatorul vede cam tot (dar în readonly), practic Dani îi zice Amaliei să
 * modifice X, Y lucru." So the Organizer is an observer with the desk: they read the events, the
 * pages, the gallery and the legal texts, and they ask the Administrator for every change. A
 * person who cannot see what the club publishes cannot tell her which line is wrong.
 *
 * It stops at the club's **content**. What the club still owes — `/admin/tasks` — stays behind
 * `canManageRegistrations`, because it is the Administrator's own worklist.
 *
 * **The participant list is no longer on this side of the line (§289).** It was, on the reasoning
 * that "vede cam tot" is not an instruction to hand somebody four hundred addresses — and the
 * owner answered that question directly afterwards: the Organizer reads the whole list, the
 * export and the race numbers, and changes nothing. So the boundary this hierarchy draws is
 * reading against changing, and `canReadRegistrations` is where it is written. What a *volunteer*
 * sees of a participant is still only the desk: a name, a state and a number, never an address
 * (`AGENTS.md` §15.11).
 */
export function canReadContent(role: StaffRole): boolean {
  return atLeast(role, "COPYWRITER");
}

export function visibleAdminSections(role: StaffRole): AdminSection[] {
  return [
    // The events list, for everyone who may look at it — writing is a separate question and
    // a separate gate (§208). A volunteer's backoffice is the desk and the guide (§103).
    ...(canReadContent(role) ? (["events"] as const) : []),
    // The desk: a volunteer's whole backoffice (BR-REQ-037-08), and the guide that explains it.
    ...(canWorkTheDesk(role) ? (["checkin", "guide"] as const) : []),
    // Standing pages are words and the gallery is pictures; both are the club's content, so
    // both are offered to whoever may read it and guarded on the way in (§208).
    ...(canReadContent(role) ? (["pages"] as const) : []),
    ...(canReadContent(role) ? (["gallery"] as const) : []),
    // Who signed up, for the roles that may read it (§289). Every verb on that screen asks
    // `canManageRegistrations` for itself, so an Organizer arrives at a list and no buttons.
    ...(canReadRegistrations(role) ? (["registrations"] as const) : []),
    // What the *club* still owes, for the role that answers for it (BR-REQ-060-01) — and, since
    // 2026-09-25, the «Aplicația» panel of the same screen for a Tehnic, who reads none of the
    // rest of it (`modules/diagnostics/domain/task-panels.ts`'s `canOpenTasks`, `DECISIONS.md`
    // §397). Written out rather than imported, because that module reads `canManageRegistrations`
    // and `canSeeDiagnostics` from this one.
    ...(canManageRegistrations(role) || canSeeDiagnostics(role) ? (["tasks"] as const) : []),
    // The legal texts are readable by the roles that must know what the club published; only
    // the Administrator writes one (§46, §181, §203).
    ...(canReadContent(role) ? (["legal"] as const) : []),
    /*
      The club's email (§250): the messages as they go out and the words in them, which is the
      Redactor's work (§247) — so the same gate as the club's other content, and the page's own
      panels ask their own questions behind it. The queue, the plan and who receives a copy of a
      declaration are Administrator's, and each is read only for a role that may see it (§243,
      §244).

      It had no entry here at all, which is how a page nobody could navigate to ended up holding
      the templates, the outbox and the club's copies: reachable from one link in the guide, and
      from nowhere else (the owner: "I am missing the email templates config … in this navbar").
    */
    ...(canReadContent(role) ? (["emails"] as const) : []),
    /*
      «Newsletter» (§NNN; the owner, 2026-09-26: "pentru newsletter o să fie un meniu suplimentar
      în backoffice cu «Newsletter»"): the subscribers as numbers and the composer, for whoever may
      write to them — the Organizer, the Administrator and the Superadministrator. Not the Tehnic,
      who writes to nobody (§38), which is the ladder's second deliberate hole beside the list.
    */
    ...(canSendNewsletter(role) ? (["newsletter"] as const) : []),
    ...(canManageStaff(role) ? (["staff"] as const) : []),
    ...(canSeeDiagnostics(role) ? (["devs"] as const) : []),
  ];
}
