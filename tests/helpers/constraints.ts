import { expect } from "vitest";

/**
 * Assert that a database write was refused by a specific constraint.
 *
 * Drizzle wraps driver errors, so the constraint name is not in `error.message` — that only
 * says "Failed query". Matching on the message would pass for any failure at all, including
 * a typo in the query. The driver error hangs off `cause` and carries the SQLSTATE code and
 * the constraint name, which is what actually proves the rule fired.
 */
type DriverError = { code?: string; constraint?: string; message?: string };

export const SQLSTATE = {
  CHECK_VIOLATION: "23514",
  UNIQUE_VIOLATION: "23505",
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  INVALID_ENUM_INPUT: "22P02",
  /** Raised by PostgreSQL for any write inside a `SET TRANSACTION READ ONLY` block. */
  READ_ONLY_TRANSACTION: "25006",
} as const;

export async function expectViolation(
  operation: Promise<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  let cause: DriverError | undefined;

  try {
    await operation;
  } catch (error) {
    cause = (error as { cause?: DriverError }).cause;
  }

  if (!cause) {
    expect.fail(
      `expected the write to be refused by ${expected.constraint ?? expected.code}, but it succeeded`,
    );
  }

  expect(
    { code: cause.code, constraint: cause.constraint },
    `refused, but by a different rule than expected: ${cause.message}`,
  ).toMatchObject(expected.constraint ? expected : { code: expected.code });
}
