import { unstable_rethrow } from "next/navigation";
import { isDatabaseAwayError } from "./domain/database-away";

/**
 * A read a page can do without while the database is away (§NNN): its answer, or `whileAway` when
 * the database is away — an outage, Neon's quota refusal, or a red month's cache miss with no copy
 * (`ColdMissError`). Any other error is a bug and still throws, and Next's own throws (`notFound`,
 * `redirect`) pass straight through.
 *
 * For the parts of a page that are not its content — the head's title and alternates, a start list
 * under the event — so they never take the page with them: the page's own read decides whether it
 * serves its last good copy or sends the reader to the resting page.
 */
export async function readOrWhileAway<T>(read: () => Promise<T>, whileAway: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return whileAway;
  }
}
