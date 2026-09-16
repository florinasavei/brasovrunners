import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./types";

/**
 * Run `body` in a transaction PostgreSQL will refuse to let write.
 *
 * BR-REQ-036-02 criterion 4 and AGENTS.md §13.2: a GET carrying an action token must not
 * mutate anything. This is not a style preference. Gmail and Outlook fetch links in messages
 * before a human sees them, and link-scanning proxies do the same, so a confirmation that
 * happens on GET is a confirmation performed by a mail server — for the participant, and
 * possibly for a token they never intended to use.
 *
 * "The handler does not write" is a property of the code as written, which stops holding the
 * moment someone adds a helpful `UPDATE ... SET last_seen_at`. `SET TRANSACTION READ ONLY`
 * makes PostgreSQL itself refuse every INSERT, UPDATE and DELETE for the rest of the
 * transaction, with SQLSTATE 25006. The guarantee then survives the next edit.
 *
 * The statement is issued explicitly rather than through the driver's transaction options so
 * that it is a visible statement both drivers send, and so a test can prove it fired.
 */
export async function inReadOnlyTransaction<TSchema extends Record<string, unknown>, T>(
  db: Database<TSchema>,
  body: (tx: Transaction<TSchema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Must be the first statement after BEGIN; PostgreSQL rejects it once the transaction
    // has done any work.
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return body(tx);
  });
}
