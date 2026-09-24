import { type IntlError, IntlErrorCode } from "next-intl";

/**
 * What a missing message does (§353).
 *
 * next-intl's default is quiet: a `console.error` and the key itself rendered in place of the
 * sentence ("Admin.pickers.dateTyped"). That is the right answer for a visitor on production — a
 * page with one odd word beats a page that does not render — and the wrong one everywhere a
 * person or a test could have caught it. Since each client provider now carries only the keys its
 * islands read (`client-messages.ts`), a key left out of those lists is exactly this failure, and
 * it would pass every test that does not read that one word.
 *
 * So, locally and in tests, a missing message throws: the island (or the Server Component) fails,
 * the error boundary renders, and the end-to-end suite — which runs a production build with
 * `APP_ENV=local` — sees a broken page instead of a key. On QA and production the quiet fallback
 * stays. `APP_ENV`, not `NODE_ENV`, because `yarn start` is `NODE_ENV=production` on a laptop too
 * (AGENTS.md §7.1).
 *
 * Import-free beyond next-intl, because the client provider (`IntlErrorHandling.tsx`) imports it
 * and must not pull the server's environment module into the browser.
 */
export function missingMessagesAreLoud(appEnv: string): boolean {
  return appEnv === "local" || appEnv === "test";
}

/** The two codes that mean "the words are not there": no such key, or a key that is a sub-tree. */
const MISSING = new Set<string>([IntlErrorCode.MISSING_MESSAGE, IntlErrorCode.INSUFFICIENT_PATH]);

/** next-intl's `onError`: throws on a missing message when `loud`, and otherwise logs as before. */
export function onIntlError(loud: boolean): (error: IntlError) => void {
  return (error) => {
    if (loud && MISSING.has(error.code)) throw error;
    console.error(error);
  };
}
