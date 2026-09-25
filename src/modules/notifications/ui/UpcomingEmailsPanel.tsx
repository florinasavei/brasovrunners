import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatAddressList } from "@/modules/contact/domain/recipients";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import type { ForecastRow } from "../forecast";

type Props = {
  locale: Locale;
  rows: ForecastRow[];
  /** How far ahead the forecast looks, in days (`FORECAST_HORIZON_DAYS`). */
  horizonDays: number;
  /**
   * The addresses that receive a club copy of every participant email (§320, "Copiile clubului"),
   * or null for a reader who may not see that list — the line is left out for them.
   */
  clubCopies: string[] | null;
  openWhen?: FoldOpenWhen;
};

/** A thumb hits these on a phone at the desk: 44 pixels tall (BR-REQ-041-01 criterion 6). */
const TAP = { display: "inline-flex", alignItems: "center", minHeight: 44 } as const;

/**
 * "Următoarele emailuri automate" (§NNN): every message the platform will send a participant on
 * its own in the coming days, sorted by the moment it becomes due — the event (a link to its
 * editor), the moment with its weekday in the event's own zone (§349), the message (a link to its
 * preview card further down this page) and how many runners the job would pick if it ran now.
 *
 * A Server Component and a closed fold (§336), directly above "Emailurile trimise participanților",
 * the cards it links to. Under the list, the club-copy line: whether the club gets a copy of each
 * of these, and where that is set.
 */
export default async function UpcomingEmailsPanel({ locale, rows, horizonDays, clubCopies, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const other: Locale = locale === "ro" ? "en" : "ro";

  return (
    <Panel
      title={t("emails.forecast.title")}
      intro={t("emails.forecast.intro")}
      aside={t(`emails.forecast.aside.${countForm(rows.length, locale)}`, { count: rows.length, days: horizonDays })}
      collapsible
      openWhen={openWhen}
      id="upcoming-emails"
      data-testid="upcoming-emails"
    >
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="upcoming-emails-empty">
          {t("emails.forecast.empty", { days: horizonDays })}
        </Typography>
      ) : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map((row) => {
            // No unmarked fallback (§354): a row without this locale's title reads "untitled",
            // never silently the other language's words. The other title is still offered, so a
            // staff reader can still find the right event to edit, but only marked with its own
            // language code — never presented as this locale's title.
            const ownTitle = row.eventTitle[locale];
            const otherTitle = row.eventTitle[other];
            const title = ownTitle ?? (otherTitle
              ? t("emails.forecast.untitledOther", { title: otherTitle, locale: other.toUpperCase() })
              : t("emails.forecast.untitled"));
            const moment = formatDay(row.at, { locale, timeZone: row.zone, style: "short", withTime: true });
            const editor = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: row.eventId } } });
            return (
              <Box
                component="li"
                key={`${row.eventId}-${row.send}-${row.at.getTime()}`}
                data-testid="upcoming-email"
                data-type={row.type}
                data-send={row.send}
                sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="upcoming-email-moment">
                  {moment}
                  {row.zone !== CLUB_TIME_ZONE && ` (${t("emails.forecast.zone", { zone: row.zone })})`}
                  {row.overdue && ` · ${t("emails.forecast.nextRun")}`}
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2, alignItems: "center" }}>
                  <Link href={editor} sx={TAP} data-testid="upcoming-email-event">
                    {title}
                  </Link>
                  {/*
                    Labelled by what actually triggers it (`sends.*`), not by the message type: a
                    type such as BIB_ASSIGNED covers more than this one automatic send (it also
                    reads "given by hand", which is an Administrator's own action, never this
                    row's). The link still opens that type's own preview card further down.
                  */}
                  <Link href={`#email-${row.type}`} sx={TAP} data-testid="upcoming-email-type">
                    {t(`emails.forecast.sends.${row.send}`)}
                  </Link>
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }} data-testid="upcoming-email-recipients">
                    {t(`emails.forecast.recipients.${countForm(row.recipients, locale)}`, { count: row.recipients })}
                    {/* Sent to like real ones (§12.6), never counted with them — labelled apart (§30). */}
                    {row.testRecipients > 0 &&
                      ` ${t(`emails.forecast.tests.${countForm(row.testRecipients, locale)}`, { count: row.testRecipients })}`}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}

      {clubCopies !== null && (
        <Box sx={{ mt: 2 }} data-testid="upcoming-emails-club-copy">
          <Typography variant="body2">
            {clubCopies.length === 0
              ? t("emails.forecast.clubCopy.none")
              : t("emails.forecast.clubCopy.some", { addresses: formatAddressList(clubCopies) })}
          </Typography>
          <Link href="#club-notices" sx={TAP}>
            {t("emails.forecast.clubCopy.link")}
          </Link>
        </Box>
      )}
    </Panel>
  );
}
