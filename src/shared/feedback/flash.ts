import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { currentEmailPress } from "@/modules/notifications/press";
import { pressMailValues } from "@/modules/notifications/press-receipt";
import { consumeEmailRoadChoice, emailRoadChoice } from "./email-road-request";
import { decodeFlash, encodeFlash, FLASH_COOKIE, FLASH_MAX_AGE_SECONDS, type FormNotice, noticeOf, PROVIDER_FAILED_TOASTS } from "./notice";
import { isPublicToastKey, PUBLIC_INFO_TOAST_KEYS, type PublicToastKey } from "./public-toasts";

/**
 * The flash: a notice that survives one redirect (`notice.ts`, `DECISIONS.md` §384).
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
 * An emailing press adds what it sent (`withPressMail`): an email's type by its name in the code,
 * how many, a departure word and its instants — still never a name or an address.
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
 * The one line every `backTo` calls before `redirect()`, and so the one place every emailing
 * press's toast learns what it sent (`withPressMail`). Outside a request — an action driven from
 * a test — there is no cookie to write, and nothing is read for one.
 */
export async function flashOutcome(outcome: Readonly<Record<string, string | number | undefined>>): Promise<void> {
  const notice = noticeOf(outcome);
  if (!notice) return;
  try {
    await cookies();
  } catch {
    return;
  }
  // Zitadel's own email (§123): its answer rides on the outcome of an invitation to the team. What the press chose not
  // to send (slice 4): `mailSkipped=1` when «Trimite emailul» was unticked, `alert` for a publication's new-event alert.
  const alert = outcome.alert === "later" || outcome.alert === "skipped" ? outcome.alert : undefined;
  const told = await withPressMail(notice, { zitadel: outcome.invite === "invited", skipped: outcome.mailSkipped === "1", alert });
  if (told) await flash(told);
}

/**
 * The notice with what the press emailed (the design «telling the owner about every email a staff press sends»,
 * slice 2): inside an email press (`notifications/press.ts`), the press's rows read back once its transaction
 * committed (`notifications/press-receipt.ts`) and merged in as `mail…` values — the toast's line «Pleacă la 10:30
 * (estimat): „Înscriere anulată” către 1 persoană și 1 email pentru club.» (`mail-line.ts`). A press that queued
 * nothing adds nothing, and its toast says nothing about email. Tokens, counts and instants only: the dialog before
 * the press is what names the person.
 *
 * The road the press's dialog promised (§841) is spent here either way: told inside the mail line, or — outside an
 * email press — as `via`, «Pleacă prin Mailgun.», as before. A press that queued nothing names no road.
 *
 * A Zitadel failure on an invitation (`PROVIDER_FAILED_TOASTS`) is toasted only for the club's emails that still left
 * (null otherwise: the banner alone says why), never as a green tick. The toast is a courtesy: a read that fails falls
 * back to the plain notice. Exported for the presses that flash or answer with a notice themselves.
 *
 * What the press chose not to send is said whatever it queued (slice 4): `skipped` — «Trimite emailul» unticked, the
 * person was sent nothing (`mailSkipped`) — and a publication's new-event alert, left to the job's next pass or not
 * sent at all (`mailAlert`).
 */
export async function withPressMail(
  notice: FormNotice,
  extras: { zitadel?: boolean; skipped?: boolean; alert?: "later" | "skipped" } = {},
): Promise<FormNotice | null> {
  const road = (await emailRoadChoice())?.road ?? null;
  if (road) await consumeEmailRoadChoice();
  const onlyWithMail = PROVIDER_FAILED_TOASTS.has(notice.key);
  const chosen: Record<string, string> = { ...(extras.skipped ? { mailSkipped: "1" } : {}), ...(extras.alert ? { mailAlert: extras.alert } : {}) };
  const told = (base: FormNotice): FormNotice => (Object.keys(chosen).length > 0 ? { ...base, values: { ...base.values, ...chosen } } : base);
  const plain = road ? { ...notice, values: { ...notice.values, via: road } } : notice;
  const press = currentEmailPress();
  if (!press) return onlyWithMail ? null : told(plain);
  let mail: Record<string, string>;
  try {
    mail = await pressMailValues(getDb(), press, { road, zitadel: extras.zitadel === true }, new Date());
  } catch (error) {
    console.error("[flash] the press's emails could not be read for its toast", error);
    return onlyWithMail ? null : told(plain);
  }
  if (!mail.mail) return onlyWithMail ? null : told(notice);
  return told({ ...notice, values: { ...notice.values, ...mail } });
}

/**
 * A public flow's outcome, flashed before its redirect (§427): a key from `PUBLIC_TOAST_KEYS`
 * and nothing else — no count, no name, no address — so the cookie says what happened and never
 * to whom. The page the redirect lands on shows it through `PublicFlash`.
 */
export async function flashPublic(key: PublicToastKey): Promise<void> {
  await flash({ kind: PUBLIC_INFO_TOAST_KEYS.includes(key) ? "info" : "success", key });
}

async function readAnyFlash(): Promise<FormNotice | null> {
  const jar = await cookies();
  return decodeFlash(jar.get(FLASH_COOKIE)?.value);
}

/**
 * The backoffice's flash the last redirect left, if any — read by the admin layout; the island
 * clears it. A public flow's flash (§427) is not the backoffice's: a visitor with JavaScript off
 * leaves it in the browser for its minute, and a staff page opened in that minute must not turn
 * it into a generic "Salvat.".
 */
export async function readFlash(): Promise<FormNotice | null> {
  const notice = await readAnyFlash();
  return notice && !isPublicToastKey(notice.key) ? notice : null;
}

/** A public flow's flash (§427), if that is what the last redirect left — read by `PublicFlash`. */
export async function readPublicFlash(): Promise<(FormNotice & { key: PublicToastKey }) | null> {
  const notice = await readAnyFlash();
  return notice && isPublicToastKey(notice.key) ? { ...notice, key: notice.key } : null;
}
