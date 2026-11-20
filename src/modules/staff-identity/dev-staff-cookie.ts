/**
 * The development switcher's cookie. Holds a `staff_users.id`, nothing else, and is read only
 * while the switcher is enabled.
 *
 * It is not signed, and that is not an oversight: a value that only means anything in local
 * and test cannot be forged into authority anywhere it would matter, because the mode that
 * reads it fails at startup in qa and production. The real session arrives with Auth.js and
 * will be signed by it — hand-rolling one now is exactly what §13.1 forbids.
 *
 * Its own module, reading nothing of the request, so the proxy can name it too: a signed-in
 * developer goes to an event page's live twin (`i18n/live-twin.ts`, §549).
 */
export const DEV_STAFF_COOKIE = "br_dev_staff";

/**
 * The development sign-in's moment (§NNN): milliseconds since the epoch, written beside `DEV_STAFF_COOKIE` by the development
 * sign-in alone and deleted with it at sign-out — the switcher's twin of the claim Auth.js's `jwt` callback writes at a Zitadel
 * sign-in. The team's undertaking is owed once per sign-in (`teamAgreementOwedThisSession`), so the end-to-end suite and
 * `yarn dev` meet it at every sign-in exactly as a colleague does. A session from before §NNN has the id and not this: it is
 * asked once, as a Zitadel session from before it is.
 */
export const DEV_STAFF_SIGNED_IN_COOKIE = "br_dev_staff_at";
