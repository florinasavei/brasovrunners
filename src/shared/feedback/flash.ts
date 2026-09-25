import { cookies } from "next/headers";
import { decodeFlash, encodeFlash, FLASH_COOKIE, FLASH_MAX_AGE_SECONDS, type FormNotice, noticeOf } from "./notice";

/**
 * The flash: a notice that survives one redirect (`notice.ts`, `DECISIONS.md` §NNN).
 *
 * Every backoffice success redirects — to the editor with `?saved=event`, to the list with
 * `?saved=eventsArchived&archived=3` — and a toast that lived in the action's own response would
 * be gone with it. So the action writes the notice into a cookie before it redirects; Next
 * carries `Set-Cookie` on the redirect (and, with JavaScript on, the same request renders the
 * redirected page, where `cookies()` already sees it); the admin layout reads it and hands it to
 * `ToastProvider`, which shows it once and deletes the cookie in the browser. A refresh finds no
 * cookie and shows no toast; a second save writes a second cookie and shows a second toast.
 *
 * A cookie rather than the query string, which the island could have read: the query is what
 * the page's own banner and every e2e `waitForURL(/saved=…/)` read, and stripping it after the
 * toast would race them; keeping it would show the toast again on every refresh. A cookie is one
 * line in the action and nothing in the URL.
 *
 * Not `httpOnly` — the island clears it — and `sameSite: lax`, `secure` where the site is; it
 * holds a key and a few counts, never a name or an address: `noticeOf` keeps only the numbers a
 * sentence counts, so neither the desk's search box (a participant's name) nor a provider's error
 * text, both of which may ride on the redirect's query, reaches a cookie every request carries.
 */
export async function flash(notice: FormNotice): Promise<void> {
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    // No request to write a cookie on — an action driven from a test, or a caller outside the
    // request scope. The toast is a courtesy; the redirect that follows is the work, and it goes on.
    return;
  }
  jar.set(FLASH_COOKIE, encodeFlash(notice), {
    path: "/",
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * The flash for a redirect's outcome, when it has one: `{ saved: "event", offered: "2" }` is
 * the toast `event` with `offered` and `count` as its values; `{ error: "CONFLICT" }` is none.
 * The one line every `backTo` calls before `redirect()`.
 */
export async function flashOutcome(outcome: Readonly<Record<string, string | number | undefined>>): Promise<void> {
  const notice = noticeOf(outcome);
  if (notice) await flash(notice);
}

/** The flash the last redirect left, if any — read by the admin layout; the island clears it. */
export async function readFlash(): Promise<FormNotice | null> {
  const jar = await cookies();
  return decodeFlash(jar.get(FLASH_COOKIE)?.value);
}
