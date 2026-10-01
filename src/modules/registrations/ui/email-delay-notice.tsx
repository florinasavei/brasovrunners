import Alert from "@mui/material/Alert";
import type { SxProps, Theme } from "@mui/material/styles";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import { durationPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedEmailDelay } from "@/modules/public-cache/reads";

/** Above this many minutes a wait is said in whole hours (§NNN). */
export const LONG_WAIT_MINUTES = 90;

/** Each shape of the full notice, its message (`Delay`). */
const FULL_KEYS = { full: "full", link: "fullLink", subscribe: "fullSubscribe", resend: "fullResend", plain: "fullPlain" } as const;

/**
 * «Emailurile noastre întârzie acum» (§NNN; the owner, 2026-10-01: «In caz că mai pică sau avem coadă
 * de mailuri, userii trebuie să vadă»): what a page that waits for an email says while the club's
 * emails are late — and nothing at all otherwise (null), so a normal day's page is exactly what it was.
 *
 * `full`, on every page that waits for an email, above the page's own wait sentence: how many
 * messages wait, the oldest's wait, at most how long more when the platform can tell, and the one
 * rule that makes waiting safe — the deadline runs from the moment the email leaves (§513), not from
 * now — then not to ask again, which is what a person who has waited does next, in the page's own
 * words.
 *
 * Three shapes of the full notice, by what the page's own email carries. `full` (the default) says the
 * deadline rule and "do not register again": the screen after the form, the address confirmed, the
 * family's links — an email that starts a deadline at its send. The same, closed by what the page
 * itself asked for: `link` on «Înscrierile mele» («Nu cere din nou linkul»), `subscribe` on the
 * newsletter's confirmation («Nu te abona din nou») — neither page registers anybody. `resend` — the
 * resend form — says the deadline of the FIRST email runs from when that one left: a resend starts
 * none (§513's re-base moves nothing for it). `plain` — the newsletter's way out, the signed
 * declaration's copy — says the delay and nothing about a deadline there is not.
 *
 * `short`, one line in the event page's registration box and under the form's send button: the
 * person has not asked for anything yet, and needs only to know before pressing.
 *
 * Awaited by the page that draws it, like `registrationForm`, rather than an async component nested
 * in the tree: the page reads it beside its other cached reads, and the tree it returns stays one a
 * synchronous render can draw. Nothing to press, so no client island: the read is the data cache's
 * minute (`cachedEmailDelay`), and a page that cannot ask says nothing.
 */
export async function emailDelayNotice(
  options: { variant?: "full" | "link" | "subscribe" | "resend" | "plain" | "short"; sx?: SxProps<Theme> } = {},
): Promise<ReactNode> {
  const { variant = "full", sx } = options;
  const delay = await cachedEmailDelay(new Date());
  if (!delay?.late) return null;
  const t = await getTranslations("Delay");
  const locale = await getLocale();
  // Past an hour and a half, whole hours: «cel mult 23 de ore», never «1385 de minute».
  const estimate =
    delay.estimateMinutes === null
      ? ""
      : t("estimate", { estimate: delay.estimateMinutes > LONG_WAIT_MINUTES ? durationPhrase(locale, Math.ceil(delay.estimateMinutes / 60), "hours") : minutesPhrase(locale, delay.estimateMinutes) });
  // A paused road can be a minute old: never «cel mai vechi așteaptă de 0 minute». Long waits: «de peste 4 ore», rounded down.
  const oldest = Math.max(1, delay.oldestWaitMinutes);
  const minutes =
    oldest > LONG_WAIT_MINUTES ? t("over", { amount: durationPhrase(locale, Math.floor(oldest / 60), "hours") }) : minutesPhrase(locale, oldest);
  return (
    <Alert severity="warning" data-testid="email-delay" data-variant={variant} sx={sx}>
      {variant === "short"
        ? t("short", { estimate })
        : t(FULL_KEYS[variant], {
            queued: t(`queued.${countForm(delay.queued, locale)}`, { count: delay.queued }),
            minutes,
            estimate,
          })}
    </Alert>
  );
}
