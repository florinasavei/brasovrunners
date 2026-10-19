"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { rememberPerson } from "@/modules/person-session/session";
import { confirmRsvp, readRsvpLink, setRsvpShowName, withdrawRsvp, type RsvpProved } from "@/modules/rsvp/rsvp";
import { RSVP_BOX_ID } from "@/modules/rsvp/rsvp-box";
import { WITHDRAWN_ASKED_SUFFIX, withdrawnProof } from "@/modules/rsvp/withdrawn-proof";

/**
 * The two buttons of a «Vin!» message's page (§811, «Vin!» part 1): «Da, vin» and «Nu mai vin». Each spends its link — single
 * use, one statement, one winner (AGENTS.md §12.8) — and each remembers the browser, because a link used from an inbox proves the
 * address as much as the first one did (`person-session/`): the next press on any event that takes answers is one tap. The GET
 * of the page changed nothing; only these do.
 */
function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function pageOf(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/vin/[token]", params: { token } } });
}

/** The event's page at the box, in the answer's language — or the listing when the page is gone. */
function eventPageOf(proved: RsvpProved, hash: string): string {
  return proved.slug
    ? `${getPathname({ locale: proved.locale, href: { pathname: "/events/[slug]", params: { slug: proved.slug } } })}${hash}`
    : getPathname({ locale: proved.locale, href: "/events" });
}

async function remember(proved: RsvpProved, now: Date): Promise<void> {
  try {
    await rememberPerson(getDb(), await cookies(), { email: proved.email, displayName: proved.displayName }, now);
  } catch {
    // The answer is counted; a browser that cannot be remembered still types its address next time.
  }
}

/** «Da, vin»: counts the answer, remembers the browser, lands on the event page at the box, which now shows the one-tap state. */
export async function confirmRsvpAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = String(form.get("token") ?? "");
  const db = getDb();
  const now = new Date();
  if (!(await tokenAttemptAllowed(db, token, now))) redirect(`${pageOf(locale, token)}?invalid=1`);
  // The email's «Vin» (§818) may carry the name and the tick; for any other link the service ignores them.
  const proved = await confirmRsvp(db, token, now, { displayName: String(form.get("name") ?? ""), showName: form.get("showName") === "on" });
  if (!proved) redirect(`${pageOf(locale, token)}?invalid=1`);
  await remember(proved, now);
  redirect(eventPageOf(proved, `#${RSVP_BOX_ID}`));
}

/** «Nu mai vin»: deletes the answer, remembers the browser (not after the email's unanswered question), and says so on the same address (the row and its links are gone). */
export async function withdrawRsvpAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = String(form.get("token") ?? "");
  const db = getDb();
  const now = new Date();
  if (!(await tokenAttemptAllowed(db, token, now))) redirect(`${pageOf(locale, token)}?invalid=1`);
  const proved = await withdrawRsvp(db, { token }, now);
  if (!proved) redirect(`${pageOf(locale, token)}?invalid=1`);
  /*
    «Nu vin» of the «Vii?» email (§818): the person declined a question they never started, so nothing they asked for needs the
    browser recognised — no cookie (the notice justifies the cookies as strictly necessary to a function the person asked for). The
    row says which it was (`unanswered`, read from the deleted row), never the page's form; «Nu mai vin» after an answer remembers, as before.
  */
  if (!proved.unanswered) await remember(proved, now);
  // The slug travels as the page's own address, never a value of the person's (§14.5): where the sentence's link goes.
  const slug = proved.slug ?? "";
  // `nu`: the sentence of the email's «Nu vin» (nobody was counted). The server's reading of the row, folded into the proof.
  const proof = withdrawnProof(token, proved.unanswered ? `${slug}${WITHDRAWN_ASKED_SUFFIX}` : slug);
  redirect(`${pageOf(proved.locale, token)}?retras=${encodeURIComponent(slug)}&ok=${proof}${proved.unanswered ? "&nu=1" : ""}`);
}

/**
 * «Numele meu apare la „Cine vine"» (§NNN, amending §812; the owner, 2026-10-19: «oamenii să poată ușor să zică „afișează / ascunde" numele
 * meu public») on a live «Nu mai vin» link's page: the person's own tick on their counted answer, any time. §186's shape for «Vin!».
 *
 * **This POST does NOT spend the link** (`setRsvpShowName` reads the token, it does not consume it): showing or hiding a name is a reversible,
 * low-stakes choice — the precedent is the registration's `LIST_CONSENT` link (§186) — so the same link still takes the answer back with
 * «Nu mai vin» afterwards. The GET of the page changed nothing and still does not (BR-REQ-036-02); only this press
 * writes, and it writes the one tick and the name the box holds (prefilled with the answer's own: a stored name is never published unposted).
 * A link that is not live — spent, replaced, expired, the event started, or a confirm link — lands on the page's «linkul nu mai merge»,
 * and no address or name is ever read from the form. The page is read again live, drawing the new state and one sentence from `?nume=`.
 *
 * **The throttle is its own** (`rsvp-name`, thirty an hour per link), not `token-validate`'s ten: that bucket is what «Nu mai vin» and the page's
 * every GET spend, and a flip is a POST plus the redirect's GET — two attempts each, so five flips in an hour would have locked «Nu mai vin» out
 * of its own link. The redirect's GET is paid back here (`refundRateLimit`) because this press, not the person, caused it; a person who
 * opens the page ten times still spends ten. A refused flip says so on the page (`?nume=wait`) and leaves the link working.
 */
export async function setNameByLinkAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = String(form.get("token") ?? "");
  const db = getDb();
  const now = new Date();
  if (!isWellFormedTokenSecret(token)) redirect(`${pageOf(locale, token)}?invalid=1`);
  const key = hashTokenSecret(token);
  const allowed = (await consumeRateLimit(db, "rsvp-name", key, now)).allowed;
  const link = allowed ? await readRsvpLink(db, token, now) : null;
  // The redirect below lands on the page, whose GET spends one `token-validate` attempt: this press pays it back (see above).
  if (allowed && (!link || link.state !== "live" || link.purpose !== "RSVP_WITHDRAW")) redirect(`${pageOf(locale, token)}?invalid=1`);
  await refundRateLimit(db, "token-validate", key, now);
  if (!allowed || !link) redirect(`${pageOf(locale, token)}?nume=wait`);
  const result = await setRsvpShowName(
    db,
    link.eventId,
    { token },
    { showName: form.get("showName") === "on", displayName: String(form.get("name") ?? "") },
    now,
  );
  const code = result.ok ? (result.showName ? "shown" : "hidden") : result.reason;
  redirect(`${pageOf(locale, token)}?nume=${code}`);
}
