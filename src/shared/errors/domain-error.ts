/**
 * Stable domain error codes, translated at the boundary (AGENTS.md §14.3). The message is for
 * logs only and never rendered, so no SQL, stack or token reaches a page. Only codes actually
 * raised are listed; §14.3 names the full set.
 */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  /** The field names a VALIDATION_ERROR is about — names only, never values (§14.5). */
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
