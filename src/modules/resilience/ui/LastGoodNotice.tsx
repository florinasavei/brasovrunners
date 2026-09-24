import Alert from "@mui/material/Alert";
import { getFormatter, getTranslations } from "next-intl/server";
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
 */
export default async function LastGoodNotice({ read }: { read: Pick<Resilient<unknown>, "freshness" | "takenAt"> }) {
  if (read.freshness === "live") return null;

  const t = await getTranslations("Offline");
  const format = await getFormatter();

  return (
    <Alert severity="warning" sx={{ mb: 3 }}>
      {t("stale", { when: format.dateTime(read.takenAt, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "long", hourCycle: "h23" }) })}
    </Alert>
  );
}
