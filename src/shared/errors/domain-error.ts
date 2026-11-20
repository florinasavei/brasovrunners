/**
 * Stable domain error codes, translated at the boundary (AGENTS.md §14.3).
 *
 * The code is language-neutral and the message is for developers and logs. Nothing here is
 * rendered to a visitor directly: the backoffice maps the code to a message key, so a new
 * locale needs no change in this file, and a SQL string, a stack or a token can never reach a
 * page through an error message.
 *
 * Only the codes this batch can actually raise are listed. §14.3 names the full set; adding an
 * unused one here would be a value the code claims to produce and never does.
 */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  // An erase refused because a declaration is held for a complaint or a dispute (§556): its own
  // code, so every form that shows `Admin.errors` says so rather than "somebody else saved".
  | "DECLARATION_HELD"
  // A shop size unticked while an order names it (§697): the order's variant would dangle and its
  // stock would have nowhere to go back to, so the save says which box rather than "not valid".
  | "SHOP_SIZE_HAS_ORDERS"
  // A volunteer badge's colour whose words would not read at AA on it (§764): the save names the box and asks for another.
  | "BADGE_COLOUR_UNREADABLE"
  // A volunteer badge's size with no room for everything ticked (§776): the free-text line and the telephone need a taller badge.
  | "BADGE_SIZE_TOO_SMALL"
  // An internal note on a registration with no words, or past its limit (§777): the form says which, naming its box.
  | "NOTE_EMPTY"
  | "NOTE_TOO_LONG"
  // «E de la parteneri» ticked with the box «Numele partenerului sau sponsorului» empty (the decision «De la parteneri»): the box is named.
  | "PARTNER_NAME_MISSING"
  // «Direct pe lista de așteptare» after the event's start (§872): a remote vouching is refused then; the desk takes the person.
  | "VOUCHED_ENTRY_AFTER_START"
  // A volunteer role removed while people are on it (§754): move them first, so no one is deleted by a click on a role.
  | "VOLUNTEER_ROLE_HAS_PEOPLE"
  // A volunteer category removed while roles sit under it (§774): move or delete them first, so a click on a heading never orphans a role.
  | "VOLUNTEER_CATEGORY_HAS_ROLES"
  // A role named twice under one category, or a category named twice on one event (§774): the same name may stand in two categories, not twice in one.
  | "VOLUNTEER_NAME_TAKEN"
  // One role of the «Roluri» card's one save refused (§791): the sentence names the role and its category, the boxes name what to correct, and nothing of the save was written.
  | "VOLUNTEER_ROLE_INVALID"
  // The same address entered twice for one event's volunteers (§754): one row per person per event, so the card says so.
  | "VOLUNTEER_ALREADY_LISTED"
  // «Trimite linkul contractului» or a paper acceptance while no volunteer agreement is in force (§758): approve one first.
  | "VOLUNTEER_AGREEMENT_MISSING"
  // The same, for a volunteer who has already accepted the agreement (§758): nothing to send, nothing to record.
  | "VOLUNTEER_AGREEMENT_ACCEPTED"
  // The link or a paper acceptance while the privacy notice in force does not describe the acceptance (§758).
  | "VOLUNTEER_AGREEMENT_NOTICE"
  // «Semnat pe hârtie» after the version in force or the person's role changed since the sheet was printed (§758).
  | "VOLUNTEER_AGREEMENT_REPRINT"
  // «Confirmă» on a volunteer under eighteen whose parent or guardian has not accepted the agreement (§768): «Acordul părintelui lipsește».
  | "VOLUNTEER_GUARDIAN_MISSING"
  // «Numerele voluntarilor încep de la» set at or below the runners' numbers (§948): the two series would run into each other.
  | "VOLUNTEER_NUMBERS_IN_RACE_SERIES"
  // «Transformă în voluntar» on a runner under eighteen on the event's day (§948): a minor volunteers only with a parent's agreement, asked by the hand entry.
  | "RUNNER_TO_VOLUNTEER_MINOR"
  // «Transformă în alergător» on a volunteer the club typed without an address (§948): a registration is its address.
  | "VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS"
  // The guardian's link or paper record for a volunteer whose guardian has already accepted (§768): nothing to send, nothing to record.
  | "VOLUNTEER_GUARDIAN_ACCEPTED"
  // «Trimite linkul părintelui» for a volunteer with no guardian address (§768): the consent is taken on paper.
  | "VOLUNTEER_GUARDIAN_NO_EMAIL"
  // A verb that only sends an email — the agreement's link, the parent's link — for a volunteer the club entered with no address (§865):
  // the card draws neither for such a row, so only a forged or stale post reaches it; the agreements are signed on paper.
  | "VOLUNTEER_NO_EMAIL"
  // The guardian's link or paper record while the privacy notice and the agreement in force do not both describe minors (§768).
  | "VOLUNTEER_MINORS_CLOSED"
  // «Contract semnat» (§998): a file with no bytes, one past `SIGNED_CONTRACT_MAX_BYTES`, or one whose own bytes are not a PDF, a Word
  // document or a photograph (JPEG, PNG, HEIC) — whatever its name says. Each writes nothing.
  | "VOLUNTEER_CONTRACT_EMPTY"
  | "VOLUNTEER_CONTRACT_TOO_LARGE"
  | "VOLUNTEER_CONTRACT_TYPE"
  // A piece of a large file sent in pieces whose upload is not there any more — replaced by a newer one, gone with its person — or that
  // is not the next piece (sent twice, out of turn): the page sends the file again from the start.
  | "VOLUNTEER_CONTRACT_UPLOAD_GONE"
  // «Încarcă contractele semnate» pressed with no file chosen, scripts off (§998): said as such, never as «0 attached».
  | "VOLUNTEER_CONTRACTS_NONE_CHOSEN"
  // «Trimite fiecăruia punctul lui» with nobody to write to (§956): no volunteer with an address stands at a point of the route…
  | "VOLUNTEER_POINTS_NOBODY"
  // …or every one who does was already told the point they stand at, and the press did not ask to write to everybody again.
  | "VOLUNTEER_POINTS_ALL_TOLD"
  // One row of the race's results refused (§808): the sentence names the runner, the boxes name what to correct, and nothing of the save was written.
  | "RESULT_ROW_INVALID"
  // The CSV file of results cannot be read (§808): the sentence names the line and what is wrong with it; nothing was imported.
  | "RESULTS_IMPORT_INVALID"
  // «Clasamentul e public» ticked while the privacy notice in force does not describe the results (§808, `{{results}}`): approve one first.
  | "RESULTS_NOTICE"
  // «Clasamentul e public» ticked while the terms in force do not describe the results (§808): the older terms promised to ask separately first.
  // (Ticked before the race is accepted since §985: set then, shown from the start — there is no refusal for it.)
  | "RESULTS_TERMS"
  // Results entered, imported or published for an event that is not a race (§808): the page says so, and so does the save.
  | "RESULTS_NOT_OPEN"
  // The «Categorii de vârstă» box of a race's results cannot be read (§850): the sentence names what is wrong; nothing was saved.
  | "RESULTS_AGE_BANDS"
  // «Cronometrare» (§850, §986): the number pressed at the line belongs to no confirmed registration and no line of the race's elite
  // list; the line carries the stamped time to write down. (A number already «Sosit» is no refusal since §986: a duplicate, in the trail.)
  | "RESULT_BIB_UNKNOWN"
  // «Cronometrare» pressed before the gun: a finish cannot be before the start.
  | "RESULT_FINISH_NOT_STARTED"
  // «Cronometrare» pressed more than a day after the gun: the results are written on «Clasament» by then.
  | "RESULT_FINISH_CLOSED"
  // «Anulează» at the line (§986) on a row that is not the viewer's own unchanged press of the last ten minutes: «Clasament» corrects it.
  | "RESULT_UNDO_NOT_ALLOWED"
  // A press sent again whose row is gone since — undone at the line, deleted on «Clasament» (§986): told so, never recorded again.
  | "RESULT_PRESS_UNDONE"
  // A press made before «Resetează clasamentul» and sent after it — a queue on a phone without signal (§997): it belongs to the
  // trial the reset wiped, so it is refused, its line on the phone saying why, and never brings a test finish back.
  | "RESULT_PRESS_BEFORE_RESET"
  // «Resetează clasamentul» once the race's planned gun has passed (§997): the results can only be wiped before the start.
  | "RESULTS_RESET_AFTER_START"
  // «Folosește» on «Clasament» (§1012) with a time that is not one «Cronometrare» recorded for that number since the last reset — a
  // stale page or a forged post: nothing is written, and no made-up time reaches the ranking.
  | "RESULT_TIME_NOT_RECORDED"
  // «Folosește» on «Clasament» (§1012) for a line whose result is «Descalificat»: a disqualification is changed by hand in «Stare»,
  // never by a recorded time — the page draws no «Folosește» there; nothing is written.
  | "RESULT_DISQUALIFIED"
  // «Start» outside its window (§986): from three hours before the planned gun to six hours after.
  | "RACE_GUN_WINDOW"
  // «Start» moved or taken off once a runner is «Sosit» (§986): the gun is fixed; a correction of the times is «Clasament»'s.
  | "RACE_GUN_FIXED"
  // «Start» from a page that saw another gun than the one stored (§986): another organizer gave it, moved it or took it off since;
  // the page drawn again says who and when, and only a «Mută startul acum» from a page that saw the gun as it stands moves it.
  | "RACE_GUN_CHANGED"
  // «Adaugă un lucru» on an event whose «Lucruri de adus» already holds the most a list may (§979): the sentence says how many.
  | "RACE_DAY_ITEMS_FULL"
  // A member tier deleted while members hold it (§811): give them another level first. The action adds how many.
  | "MEMBER_TIER_HAS_MEMBERS"
  // A member tier deleted while a discount code is for that tier alone (§811): an empty limit means every member, so the code would open to all.
  | "MEMBER_TIER_IN_CODES"
  // A legal version approved while a `<PLACEHOLDER>` still stands in its text (§884): a club fact or a club choice nobody typed.
  | "LEGAL_PLACEHOLDERS_LEFT"
  // «Apare în clasament» / «Apare pe site» on a registration no longer marked «Elită» (§910): a stale menu, or a colleague took the mark off first.
  | "ELITE_NOT_MARKED"
  // «Eticheta pe BIB» longer than an elite bib carries (§975, `ELITE_NAME_MAX`): the sentence names the box and the limit.
  | "ELITE_LABEL_TOO_LONG"
  // A line of the elite list given its number by itself, and the race's own series has no free number left for it (§990,
  // `bibs.ts#pickEliteLineNumber`): the sentence says to type one on the elite list.
  | "ELITE_NO_FREE_NUMBER"
  // A line's «Număr» changed while a result is stored on its number (§990): the result would lose its runner, so it is refused.
  | "ELITE_NUMBER_HAS_RESULT"
  // The club's refusal under the terms (§618) posted with its email kept back (the design «telling the owner about every email a
  // staff press sends», slice 4; its question offers no «… fără email», §976): the terms promise the person is told the ground,
  // so the refusal never goes without its email.
  | "REFUSAL_NEEDS_EMAIL"
  // The raffle's sign-up (§984): the gate is shut (`raffleSignUpClosedFor`); the person is not one the raffle takes — not
  // confirmed, no number, a test registration, a group not ticked; the rules' acceptance missing. Each writes nothing.
  | "RAFFLE_SIGN_UP_CLOSED"
  | "RAFFLE_NOT_ELIGIBLE"
  | "RAFFLE_RULES_NOT_ACCEPTED"
  // The desk's eye pressed (§NNN, `desk-list-wish.ts`): on a registration that is over (cancelled or expired); on one whose address
  // was never confirmed — the email that tells the person would go where nobody vouched for it, so confirm it first («Confirmă
  // aici»); at an event completed or cancelled, whose desk is closed. Each writes nothing.
  | "LIST_WISH_OVER"
  | "LIST_WISH_ADDRESS_UNCONFIRMED"
  | "LIST_WISH_DESK_CLOSED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  /**
   * The field names a VALIDATION_ERROR is about — names only, never values.
   *
   * A generic "check your details" tells somebody nothing about which of eleven boxes is
   * wrong, and the boundary that renders it cannot invent the list. Field *names* are safe
   * to carry across it in a way a message built from user input would not be (§14.5).
   */
  readonly fields: readonly string[];

  constructor(code: DomainErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fields = fields;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
