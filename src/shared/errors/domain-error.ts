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

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
