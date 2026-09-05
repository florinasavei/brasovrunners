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
  | "CONFLICT";

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
