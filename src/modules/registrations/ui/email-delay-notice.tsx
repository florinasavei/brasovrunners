import Alert from "@mui/material/Alert";
import type { SxProps, Theme } from "@mui/material/styles";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedEmailDelay } from "@/modules/public-cache/reads";

/**
 * «Emailurile noastre întârzie acum» (§NNN; the owner, 2026-10-01: «In caz că mai pică sau avem coadă
 * de mailuri, userii trebuie să vadă»): what a page that waits for an email says while the club's
 * emails are late — and nothing at all otherwise (null), so a normal day's page is exactly what it was.
 *
 * `full`, on every page that waits for an email, above the page's own wait sentence: how many
 * messages wait, the oldest's wait, at most how long more when the platform can tell, and the one
 * rule that makes waiting safe — the deadline runs from the moment the email leaves (§513), not from
 * now — then "do not register again", which is what a person who has waited does next.
 *
 * `short`, one line in the event page's registration box and under the form's send button: the
 * person has not asked for anything yet, and needs only to know before pressing.
 *
 * Awaited by the page that draws it, like `registrationForm`, rather than an async component nested
 * in the tree: the page reads it beside its other cached reads, and the tree it returns stays one a
 * synchronous render can draw. Nothing to press, so no client island: the read is the data cache's
 * minute (`cachedEmailDelay`), and a page that cannot ask says nothing.
 */
export async function emailDelayNotice(options: { variant?: "full" | "short"; sx?: SxProps<Theme> } = {}): Promise<ReactNode> {
  const { variant = "full", sx } = options;
  const delay = await cachedEmailDelay(new Date());
  if (!delay?.late) return null;
  const t = await getTranslations("Delay");
  const locale = await getLocale();
  const estimate = delay.estimateMinutes === null ? "" : t("estimate", { estimate: minutesPhrase(locale, delay.estimateMinutes) });
  return (
    <Alert severity="warning" data-testid="email-delay" data-variant={variant} sx={sx}>
      {variant === "short"
        ? t("short", { estimate })
        : t("full", {
            queued: t(`queued.${countForm(delay.queued, locale)}`, { count: delay.queued }),
            // A paused road can be a minute old: never «cel mai vechi de 0 minute».
            minutes: minutesPhrase(locale, Math.max(1, delay.oldestWaitMinutes)),
            estimate,
          })}
    </Alert>
  );
}
