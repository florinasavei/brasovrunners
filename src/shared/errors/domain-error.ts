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
  // A volunteer role removed while people are on it (§754): move them first, so no one is deleted by a click on a role.
  | "VOLUNTEER_ROLE_HAS_PEOPLE"
  // A volunteer category removed while roles sit under it (§NNN): move or delete them first, so a click on a heading never orphans a role.
  | "VOLUNTEER_CATEGORY_HAS_ROLES"
  // A role named twice under one category, or a category named twice on one event (§NNN): the same name may stand in two categories, not twice in one.
  | "VOLUNTEER_NAME_TAKEN"
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
  // The guardian's link or paper record for a volunteer whose guardian has already accepted (§768): nothing to send, nothing to record.
  | "VOLUNTEER_GUARDIAN_ACCEPTED"
  // «Trimite linkul părintelui» for a volunteer with no guardian address (§768): the consent is taken on paper.
  | "VOLUNTEER_GUARDIAN_NO_EMAIL"
  // The guardian's link or paper record while the privacy notice and the agreement in force do not both describe minors (§768).
  | "VOLUNTEER_MINORS_CLOSED";

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
