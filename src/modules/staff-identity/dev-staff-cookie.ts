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
 * developer goes to an event page's live twin (`i18n/live-twin.ts`, §543).
 */
export const DEV_STAFF_COOKIE = "br_dev_staff";
