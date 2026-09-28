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
 *     MODERATOR    reads the events, the registrations, the export and the bibs; works the queue,
 *                  the desk and the messages to participants — and changes no event (§542)
 *     DEV          the configuration report; no event, no participant list
 *     ADMIN        runs the club: every event (§542), *changing* a registration, publication, the
 *                  legal texts, the team (every role but the top one), the plans and the club's
 *                  settings (§450)
 *     SUPERADMIN   the above, plus the platform settings that can stop the service — the jobs'
 *                  throttle, the database's limits, when email leaves — and the only role that
 *                  makes, changes or removes another Superadministrator (§450)
 *
 * **DEV is the one that is not obvious, so it is written down.** It exists so somebody helping
 * with the platform can read `/devs` and reproduce a problem — fixing an event is the
 * Administrator's since §542, as it is for the Organizer below it. It sits above
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
 * Seven roles, in rank order (`DECISIONS.md` §103, §524). The names the club sees are in
 * `staff-labels.ts`: the member, the volunteer, the copywriter, the organizer, the developer, the
 * administrator, the superadministrator. The enum keeps `CONTRIBUTOR` for the volunteer
 * because a Postgres enum value is not renamed; what the role *does* changed in §103.
 *
 * **`MEMBER` is below the ladder's first rung, and outside the backoffice (§524).** A club member
 * with a sign-in account: the same Zitadel sign-in and the same `staff_users` allowlist row as a
 * colleague — added on the team page, invited the same way — and nothing of the backoffice. What a
 * member opens is the members' zone, one page of the club's member-only words. `isBackofficeRole`
 * is the line, and `session.ts` draws it at the door: `getCurrentStaffUser` answers null for a
 * member, so every page, action and route that asks for a staff session refuses one exactly as it
 * refuses a stranger, whatever the capability it asks next.
 */
export const STAFF_ROLES = ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The hierarchy itself, and the only place it is written.
 *
 * `session.ts` used to keep a second copy of this to answer the old `requireStaffRole`, which is one
 * rule in two places and exactly what §1.5 forbids. It imports this now.
 */
const RANK: Record<StaffRole, number> = {
  // A member (§524): below the volunteer, so no threshold from the desk up ever includes one.
  MEMBER: 0,
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

/**
 * **Whether a role is staff at all — the backoffice's line (§524).** Every role from the volunteer
 * up. A member is not: `session.ts` answers "no staff session" for one, so the backoffice, `/devs`,
 * the staff preview and every staff route handler treat a member as signed out.
 */
export function isBackofficeRole(role: StaffRole): boolean {
  return atLeast(role, "CONTRIBUTOR");
}

/**
 * **The members' zone (§524)** — the club's member-only page, behind the sign-in. Every account the
 * club has made: a member, and every colleague, who is a member of the club first.
 */
export function canOpenMembersZone(role: StaffRole): boolean {
  return atLeast(role, "MEMBER");
}

/**
 * Writing the members' pages — the public benefits and the member-only words (§524): words, so the
 * Redactor's and the Administrator's, like «Echipa»'s introduction (§459).
 */
export function canEditMembersPage(role: StaffRole): boolean {
  return canEditTexts(role);
}

/**
 * Putting «Beneficiile membrilor» on the site, or taking it off (§524): crossing public view, the
 * Administrator's since §201 — the threshold of publishing «Echipa».
 */
export function canPublishMembersPage(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
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
 * așa vreau". An Organizer runs the queue and the desk; the event's settings — the date, the
 * place, the route, the capacity, the registration window — are the Administrator's since §542.
 * A Redactor writes the words. Neither does the other's job, and
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

    The owner, of his two colleagues: "[colega] e Administrator, [colegul] e Organizator dar poate
    face prostii, deci trebuie manageuit de [ea]". These four rows are the whole of what the public
    can see changing — a page appearing, a page disappearing, a live page being taken down or
    put back — so raising exactly these four is what "nothing the Organizer does goes live on its own"
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
 * The verbs an event's editor offers (§423): the table's, and «Publică» on a draft for a role
 * that may publish — first, the page's own verb, beside "Trimite spre verificare". The create
 * page's «Creează și publică» (§315) and the list's «Publică» (§351) already take a draft live in
 * one press; the draft's own editor now does too, and the service walks DRAFT → IN_REVIEW →
 * PUBLISHED through the table, so no move leaves it (`publishEvent`). Standing pages and albums
 * keep the plain table.
 */
export function eventEditorTransitions(
  role: StaffRole,
  from: EditorialStatus,
  isOwnDraft: boolean,
): EditorialStatus[] {
  const table = allowedTransitions(role, from, isOwnDraft).filter((to) => canTransitionEvent(role, from, to, isOwnDraft));
  if (from !== "DRAFT" || !canTransitionEvent(role, "IN_REVIEW", "PUBLISHED", isOwnDraft)) return table;
  return ["PUBLISHED", ...table.filter((to) => to !== "PUBLISHED")];
}

/**
 * **An event moves only for somebody who writes it (§542).** The table's answer, and a role that
 * writes the event's words (`canEditTexts`, the Redactor's «Trimite spre verificare») or its
 * settings (`canEditEventFields`, the Administrator). The Organizer and the Tehnic write neither,
 * so they make no move on an event — not a submission, not a return to draft, not an archive —
 * although the table's rows for pages and albums still let them (those are not events).
 */
export function canTransitionEvent(
  role: StaffRole,
  from: EditorialStatus,
  to: EditorialStatus,
  isOwnDraft: boolean,
): boolean {
  if (!canEditTexts(role) && !canEditEventFields(role)) return false;
  return canTransition(role, from, to, isOwnDraft);
}

/**
 * **The event row itself is the Administrator's (§542, amending §103, §204 and §289).** Its
 * times, its place, its route, its capacity, the registration and participation windows, the bib
 * band, its links and pictures, which event the site leads with, a series' dates, the update
 * notice and the cancellation: every save of an event, every one asserted in
 * `content/events/service.ts`.
 *
 * The owner, 2026-09-28: «Organizatorul nu ar trebui să poată edita evenimentele». It had been
 * `isEditorial` — the Organizer configured any event the Administrator created (§204). Now the
 * Organizer reads the event and runs what hangs off it — the registrations list, the export and
 * the numbers (§289), the queue, the race-day desk (§67), the messages to the participants
 * (§364) — and asks the Administrator for every change to the event. A threshold, so the Tehnic,
 * between the two, drops out with the Organizer. The Redactor keeps the words (`canEditTexts`).
 *
 * Pages and albums borrowed this gate for their own settings; they ask `isEditorial` now, so
 * nothing about them moved.
 */
export function canEditEventFields(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
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
 * Since §542 the Organizer does not configure one either (`canEditEventFields`): they open an
 * event the Administrator created to read it and to run its queue and its desk.
 */
export function canCreateEvent(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/** A page is words; a copywriter starts one as a draft. Deleting and ordering stay editorial. */
export function canCreatePage(role: StaffRole): boolean {
  return canEditTexts(role);
}

/**
 * **«Echipa» — the team page's cards (§459).** A card is words and a photograph, so it is the
 * Redactor's and the Administrator's, like a page's text: adding one, writing it, putting its
 * photo, moving it, and deleting one that is not on the site. A new card starts hidden.
 */
export function canEditTeamPage(role: StaffRole): boolean {
  return canEditTexts(role);
}

/**
 * Showing a card on the site, or taking one off it — and deleting one that is on it — is the act
 * of crossing public view, which is the Administrator's since §201: the same threshold as
 * publishing a page, so nothing the Redactor writes goes up on its own.
 */
export function canShowTeamMember(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * **«Întrebări frecvente» — the FAQ page's questions (§525).** A question and its answer are
 * words, so writing, moving and deleting a hidden one is the Redactor's and the Administrator's,
 * as a team card is (§459).
 */
export function canEditFaqPage(role: StaffRole): boolean {
  return canEditTexts(role);
}

/**
 * Showing a question on the site, taking it off, deleting one that is on it, and publishing the
 * page: crossing public view, the Administrator's since §201 — «Echipa»'s threshold.
 */
export function canShowFaqItem(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
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
 * highest role", and it is the wrong one. SUPERADMIN is defined by the platform — the settings
 * that can stop the service for everybody (`canManagePlatform`, §450) — and by who may join it;
 * it is deliberately *not* a tier for everything that destroys club data. The club's own data is
 * the Administrator's to run, and that line is ADMIN (see the header of this file). An Administrator may already erase every registration on an
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
 * Whoever holds editorial control (`isEditorial`) and may also read who they are
 * (`canReadRegistrations`) — so the Organizer, the Administrator and the Superadministrator.
 * Written as the conjunction rather than as a new list, so that moving either boundary moves this
 * with it. It read `canEditEventFields` until §542 made the event row the Administrator's; the
 * Organizer keeps the message, which is an act on the list, not on the event.
 *
 * **The Tehnic role is out on purpose** (§364): this is a message on its own, of whatever was
 * typed, to a group the sender picks from the registrations' states — an act on the participant
 * list, and `DEV` is the role that never receives it (§38, §289). The §331 update and
 * cancellation notices ride on a save of the event, so since §542 they are the Administrator's
 * alone (`canEditEventFields`). The volunteer and the Redactor are out as they are out of the
 * participant list.
 */
export function canMessageParticipants(role: StaffRole): boolean {
  return isEditorial(role) && canReadRegistrations(role);
}

/**
 * **Sending the newsletter (§445)** — a message the club writes to every subscriber of one topic.
 * The same people who may write to an event's participants (§364): the Organizer, the
 * Administrator and the Superadministrator — it is the club speaking to people who asked to hear
 * from it, the organizer's own kind of act. Since §NNN these roles also read the «Abonați» list —
 * every address — and download its CSV. Removing an address — «Dezabonează» on a row, and the
 * typed-address withdrawal (the notice's "or by writing to us") — is the Administrator's, as the
 * "Anunță-mă" list's withdrawal is (§146), through `canManageRegistrations`.
 */
export function canSendNewsletter(role: StaffRole): boolean {
  return canMessageParticipants(role);
}

/**
 * «Tradu din română» (§464): whoever writes words the club publishes or sends — the Redactor's
 * texts (`canEditTexts`) and the Organizer's notes, reasons and messages to the participants
 * (`canMessageParticipants`). So the Redactor, the Organizer, the Administrator and the
 * Superadministrator; never the volunteer, and never Tehnic, who writes no text of the club's.
 *
 * The press saves nothing — it fills a box in the browser, and the save that follows asserts its
 * own right to that box — so this gate guards the club's translation allowance, not a text.
 */
export function canTranslateTexts(role: StaffRole): boolean {
  return canEditTexts(role) || canMessageParticipants(role);
}

/**
 * Changing a registration: cancel, erase, resend, correct a name, assign or mark the race
 * numbers, fill a queue with test rows, send the thank-you. The Administrator's, and it is where
 * the line between the two roles now sits (§289) — reading is `canReadRegistrations`.
 *
 * Split out from `canManageStaff`, which every one of these screens used to call. They are two
 * different powers, and they are kept apart although both are the Administrator's since §450:
 * changing a registration and deciding who is on the staff may move apart again.
 */
export function canManageRegistrations(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * The race-day desk (BR-REQ-037-07, BR-REQ-037-08; `DECISIONS.md` §67): every staff session.
 *
 * A volunteer handing out numbers is the lowest staff role — CONTRIBUTOR; a member is no staff
 * at all (§524) and has no desk — and the desk is
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
 * **The team is the Administrator's (§450).** Who is here, and as what: adding a colleague,
 * changing a role, resending an invitation, a password link, switching an account off, taking
 * access away.
 *
 * The owner: "I will make [the Administrator] superadministrator but later administrators should manage
 * everything; superadministrator is more like administrator + platform configs that can break
 * stuff (throttling, etc)". It had been the Superadministrator's alone, on the reasoning that a
 * role able to grant itself a higher one makes every rule above it decorative. That reasoning
 * still holds, and it is kept where it bites: `canAssignRole` and `canManageMember` below. An
 * Administrator manages every colleague *up to their own rank* — never makes a
 * Superadministrator, never changes or removes one — and the service refuses their own row, so
 * an Administrator promotes nobody above their own rank and cannot promote themselves.
 */
export function canManageStaff(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * Whether `actor` may give somebody `role` — on an invitation or a role change (§450).
 *
 * Everything but the top of the ladder is an Administrator's to give; the Superadministrator is
 * made only by another Superadministrator, because it is the one role whose settings can stop
 * the service, and the one role an Administrator could otherwise hand themselves through a
 * colleague's account.
 */
export function canAssignRole(actor: StaffRole, role: StaffRole): boolean {
  if (!canManageStaff(actor)) return false;
  return isSuperadmin(role) ? isSuperadmin(actor) : true;
}

/**
 * Whether `actor` may act on a colleague who currently holds `target` — change their role,
 * resend their invitation, send a password link, switch the account off, take access away
 * (§450). A Superadministrator's row is a Superadministrator's to touch: an Administrator who
 * could switch off the owner's account could lock the platform's settings away from everybody.
 */
export function canManageMember(actor: StaffRole, target: StaffRole): boolean {
  if (!canManageStaff(actor)) return false;
  return isSuperadmin(target) ? isSuperadmin(actor) : true;
}

/**
 * Whether `role` is the top of the ladder — the one a team page protects, and the one the
 * service counts so the last of them is never demoted or removed (§450). Named here so no call
 * site compares a role to a string of its own (`tests/unit/staff/no-raw-role-checks.test.ts`).
 */
export function isSuperadmin(role: StaffRole): boolean {
  return role === "SUPERADMIN";
}

/** The roles `actor` may give, in rank order — what the team page's selects offer (§450). */
export function assignableRoles(actor: StaffRole): StaffRole[] {
  return STAFF_ROLES.filter((role) => canAssignRole(actor, role));
}

/**
 * **The club's legal texts are the Administrator's (§450)** — writing a version, approving it,
 * the one-press approval of the platform's texts, withdrawing and deleting one.
 *
 * They had been the Superadministrator's, riding on `canManageStaff` ("only the role that already
 * administers staff may write the club's legal text"). The Administrator runs the club, and the
 * texts are the club's own commitments, not a platform setting: an approved text is still never
 * rewritten, approval is still one-way, and deleting an approved version still asks for the typed
 * phrase and a reason — those guards are in `legal-documents/service.ts`, not in a rank.
 */
export function canWriteLegalTexts(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
}

/**
 * **The platform settings that can stop the service — the Superadministrator's (§450).**
 *
 * What makes a Superadministrator more than an Administrator: a setting whose wrong value takes
 * the site down or holds every message back, for every participant at once —
 *
 *     "Cât de des verifică site-ul"   the jobs' throttle (§334): a long interval delays every
 *                                       hand-over of a place and every email the jobs send
 *     "Limitele bazei de date"          Neon's size ceiling and monthly quota (§335): a quota
 *                                       reached suspends the database, and the site with it
 *     the anti-robot check              (§254, §282) the Turnstile switch: on with a broken key
 *                                       it refuses every registration; off, the form is open
 *                                       to bots — either way every participant at once
 *
 * The club's own settings — the Mailgun and Neon plans (§100, §280), the deadlines (§377) and
 * when email leaves (§221, in «Termene» since §513: nothing is lost either way), who receives the
 * club's copies — are `canManageClubSettings`, the Administrator's: each changes
 * what the club promises or pays, not whether the platform runs.
 */
export function canManagePlatform(role: StaffRole): boolean {
  return atLeast(role, "SUPERADMIN");
}

/**
 * **The club's own settings — the Administrator's (§450).** The email and database plans
 * (§100, §280), the deadlines, the per-address limit and when email leaves ("Termene", §377,
 * §513), the club's notices and
 * email texts, who receives the contact form and the club's copies, "Trimite acum" within the
 * allowance (§80), giving older pictures their sizes (§414). Each changes what the club promises,
 * says or pays; none of them can stop the platform — those are `canManagePlatform`.
 */
export function canManageClubSettings(role: StaffRole): boolean {
  return atLeast(role, "ADMIN");
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
 *     registrations  canReadRegistrations     `admin/registrations/page.tsx` — the verbs on it
 *                                             ask `canManageRegistrations` one by one (§289)
 *     checkin        canWorkTheDesk           `admin/checkin/page.tsx` — every role, on purpose
 *     gallery        canReadContent           `admin/gallery/page.tsx`
 *     pages          isEditorial              `admin/pages/page.tsx`
 *     newsletter     canSendNewsletter        `admin/newsletter/page.tsx` — the subscribers and the
 *                                             composer (§445); withdrawing an address asks
 *                                             `canManageRegistrations` for itself
 *     settings       canOpenSettings          `admin/settings/layout.tsx` — «Setări» (§516), each tab
 *                                             its own gate (`settings-tabs.ts`): «Emailuri», «Termene»,
 *                                             «Aspect» canReadContent, «Costuri» and
 *                                             «Anti-robot» canManageRegistrations; the forms on them ask
 *                                             `canManageClubSettings` or `canManagePlatform` (§450)
 *     tasks          canReadContent           `admin/tasks/page.tsx` — each panel its own gate:
 *                                             «Club» canManageRegistrations, «Aplicația»
 *                                             canSeeDiagnostics (§397), «De făcut» canReadClubTodo (§438)
 *     staff          canManageStaff           `admin/staff/page.tsx` — the Administrator's since
 *                                             §450; a Superadministrator's row is not (canManageMember)
 *     legal          canReadContent           `admin/legal/page.tsx` — writing asks
 *                                             `canWriteLegalTexts` (§450)
 *     guide          every staff session      `admin/guide/page.tsx`
 *
 * **`/devs` («Configurație») is not a section of this bar (§520).** It is the last tab of «Setări»'s
 * row (`settings-tabs.ts`'s `offersConfigurationTab`, gate `canSeeDiagnostics`), and it had its own
 * entry here as well — one page, two ways in, and the main bar lit neither on arrival. The Tehnic,
 * whose reason to open the backoffice is that page, reaches it through «Setări», which every role
 * from the Redactor up is offered; the bar lights «Setări» on `/devs` (`BackofficeShell`).
 *
 * **In the order the club opens them (§516)**, which is the array's order and the bar's: the
 * events, who signed up, the race-day desk, the pictures, the pages, the newsletter, then the
 * settings, what is owed, the team, the legal texts and the guide. A role is
 * offered the same order with its own gaps — the volunteer's bar is «Ziua cursei», «Ghid».
 *
 * The hierarchy makes one property testable and worth stating: a higher role is offered every
 * section a lower one is. `tests/unit/staff/roles.test.ts` asserts it across every pair, which
 * is the assertion that would have caught the original defect.
 */
export const ADMIN_SECTIONS = [
  "events",
  "registrations",
  "checkin",
  "gallery",
  "pages",
  "newsletter",
  "settings",
  "tasks",
  "staff",
  "legal",
  "guide",
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
 * The owner: "organizatorul vede cam tot (dar în readonly), practic organizatorul îi zice administratorului să
 * modifice X, Y lucru." So the Organizer is an observer with the desk: they read the events, the
 * pages, the gallery and the legal texts, and they ask the Administrator for every change. A
 * person who cannot see what the club publishes cannot tell her which line is wrong.
 *
 * It stops at the club's **content**. What the club still owes as the system reads it —
 * `/admin/tasks`'s «Club» — stays behind `canManageRegistrations`, because it is the
 * Administrator's own worklist; the club's typed checklist «De făcut» beside it is read by every
 * role from the copywriter up and written by the Organizer and the Administrators (§438).
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

/**
 * Whether «Setări» is offered at all (§516): the union of its tabs' gates, which
 * `settings-tabs.ts` spells out per tab. Written here as the threshold — every tab asks
 * `canReadContent` or the higher `canManageRegistrations` — because that module reads its
 * predicates from this one and importing back would cycle; a unit test holds the two equal.
 */
export function canOpenSettings(role: StaffRole): boolean {
  return canReadContent(role);
}

export function visibleAdminSections(role: StaffRole): AdminSection[] {
  /*
    Each section's own gate, filtered over `ADMIN_SECTIONS` so the bar's order is the array's —
    by how often the club opens them (§516) — and a role only ever loses a tab, never reorders one.
  */
  const offered: Record<AdminSection, boolean> = {
    // The events list, for everyone who may look at it — writing is a separate question and
    // a separate gate (§208). A volunteer's backoffice is the desk and the guide (§103).
    events: canReadContent(role),
    // Who signed up, for the roles that may read it (§289). Every verb on that screen asks
    // `canManageRegistrations` for itself, so an Organizer arrives at a list and no buttons.
    registrations: canReadRegistrations(role),
    // The desk: a volunteer's whole backoffice (BR-REQ-037-08), and the guide that explains it.
    checkin: canWorkTheDesk(role),
    // The gallery is pictures and the standing pages are words; both are the club's content, so
    // both are offered to whoever may read it and guarded on the way in (§208).
    gallery: canReadContent(role),
    pages: canReadContent(role),
    /*
      «Newsletter» (§445; the owner, 2026-09-26: "pentru newsletter o să fie un meniu suplimentar
      în backoffice cu «Newsletter»"): the subscribers as numbers and the composer, for whoever may
      write to them — the Organizer, the Administrator and the Superadministrator. Not the Tehnic,
      who writes to nobody (§38), which is the ladder's second deliberate hole beside the list.
    */
    newsletter: canSendNewsletter(role),
    /*
      «Setări» (§516): the club's settings as one row of tabs — the email page (§250, which had no
      entry at all until the owner's "I am missing the email templates config … in this navbar"),
      «Termene», «Aspect», «Costuri», «Anti-robot» («Contact» is «Pagini»'s since 2026-09-28). Offered to whoever may open one tab of
      it (`settings-tabs.ts`); the Redactor opens «Emailuri» for the words (§247).
    */
    settings: canOpenSettings(role),
    // «Sarcini»: what the *club* still owes, read from the system, for the role that answers for
    // it (BR-REQ-060-01); the «Aplicația» panel for a Tehnic (§397); and since §438 the club's own
    // checklist «De făcut», which every role that reads the club's content opens — so the whole
    // section is offered from the copywriter up, and each panel asserts its own gate
    // (`modules/diagnostics/domain/task-panels.ts`'s `canOpenTasks`). Written as the threshold
    // rather than imported, because that module reads its predicates from this one.
    tasks: canReadContent(role),
    staff: canManageStaff(role),
    // The legal texts are readable by the roles that must know what the club published; only
    // the Administrator writes one (§46, §181, §203).
    legal: canReadContent(role),
    guide: canWorkTheDesk(role),
  };
  return ADMIN_SECTIONS.filter((section) => offered[section]);
}
