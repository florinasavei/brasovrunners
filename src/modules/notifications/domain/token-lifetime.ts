/**
 * How long an action link lives when the registration has no deadline of its own to lend it — the
 * "my registrations" link, a manage link sent after the start (`render.ts`). A fortnight.
 *
 * A security property of the link, not one of the club's deadlines (§12.8, §NNN): it is not on
 * "Termene". It lives here, apart from the renderer, so the sentence that states it
 * (`templates.ts`, "Linkul este valabil 14 zile") reads the same constant the token is minted with
 * and the two cannot drift.
 */
export const DEFAULT_TOKEN_HOURS = 14 * 24;
