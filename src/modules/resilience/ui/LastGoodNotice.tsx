import Alert from "@mui/material/Alert";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Resilient } from "../last-good";

/**
 * "This is the last copy we have" — the one sentence a stale page owes its reader
 * (`DECISIONS.md` §281).
 *
 * Serving an old page during an outage is only defensible if the page says so. Without this the
 * club would be showing a visitor facts that may have changed, in a way indistinguishable from
 * facts that have not — and the reason the mechanism exists at all is the club's reputation.
 *
 * It names **when** the copy was taken rather than "recently": a runner deciding whether to come
 * on Saturday can judge a page from twenty minutes ago and a page from nine hours ago
 * differently, and only one of those judgements is the platform's to make.
 *
 * Nothing is rendered while the page is live, which is almost always.
 *
 * While Neon has suspended the project for the rest of its billing period (§447) the sentence is a
 * different one, and a calmer one: the site is not "having trouble", it is resting on purpose, the
 * page is the copy saved on a named day, registration and the forms wait, and the date they are
 * back is known — so it is said. An `info`, not a `warning`: nothing is wrong that a reader could
 * help with or should worry about. It never names money, a quota or a provider: those are the
 * club's business, not the reader's.
 */
export default async function LastGoodNotice({ read }: { read: Pick<Resilient<unknown>, "freshness" | "takenAt" | "restingUntil"> }) {
  if (read.freshness === "live") return null;

  const t = await getTranslations("Offline");
  const locale = await getLocale();
  const when = formatDay(read.takenAt, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" });

  if (read.restingUntil) {
    return (
      <Alert severity="info" sx={{ mb: 3 }} data-testid="resting-notice">
        {t("resting", { when, until: formatDay(read.restingUntil, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }) })}
      </Alert>
    );
  }

  return (
    <Alert severity="warning" sx={{ mb: 3 }}>
      {t("stale", { when })}
    </Alert>
  );
}
