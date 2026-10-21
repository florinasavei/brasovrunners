import { cookies } from "next/headers";
import { cache } from "react";
import { decodeEmailRoadChoice, EMAIL_ROAD_COOKIE, type EmailRoadChoice } from "./email-road";

/**
 * The road the press that made this request chose for its email (§NNN, `email-road.ts`), read
 * once per request: `enqueueEmail` asks it for every row it queues, and `flashOutcome` for the
 * toast, and both must see the same answer — so the read is remembered through React's
 * per-request `cache`, and nothing here deletes the cookie: the flash does, once the toast has
 * its road (`consumeEmailRoadChoice`), so a cache that did not hold could still never lose it.
 *
 * Outside a request — a job, a script, a test with no `next/headers` — there is no jar and no
 * choice: the row takes its group's road, exactly as before this existed.
 */
export const emailRoadChoice = cache(async (): Promise<EmailRoadChoice | null> => {
  try {
    const jar = await cookies();
    return decodeEmailRoadChoice(jar.get(EMAIL_ROAD_COOKIE)?.value, Date.now());
  } catch {
    return null;
  }
});

/**
 * The choice is spent: deleted with the action's response, so the next press's request finds no
 * choice of this one. A render may not write cookies and is left to the cookie's twenty seconds;
 * so is an action refused before it flashed, whose cookie no row reads after that.
 */
export async function consumeEmailRoadChoice(): Promise<void> {
  try {
    (await cookies()).delete(EMAIL_ROAD_COOKIE);
  } catch {
    // Not an action: nothing to delete, nothing to do.
  }
}
