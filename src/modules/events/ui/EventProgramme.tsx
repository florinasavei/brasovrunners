import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale } from "next-intl/server";
import { Fragment } from "react";
import { formatDay, formatTime } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { localizedSchedule, readScheduleItems } from "../domain/schedule";
import { dayKey } from "../domain/calendar";

/**
 * The programme under `#schedule` (§96, §117): the timed rows as a list — the time, what,
 * where — with a day heading when the programme spans days (kit pickup on Saturday, the race
 * on Sunday), and the free text beneath them for what does not fit a row. Nothing at all when
 * there is neither, so the anchor the emails point at exists only when it leads somewhere.
 * One component for the public page and the staff preview, so the two cannot differ.
 */
export default async function EventProgramme({
  scheduleItems,
  scheduleJson,
  timeZone,
  heading,
}: {
  scheduleItems: unknown;
  scheduleJson: unknown;
  timeZone: string;
  heading: string;
}) {
  const locale = (await getLocale()) as Locale;
  const rows = localizedSchedule(readScheduleItems(scheduleItems), locale);
  const prose = !isRichTextEmpty(readRichText(scheduleJson));
  if (rows.length === 0 && !prose) return null;

  const days = [...new Set(rows.map((row) => dayKey(row.startsAt, timeZone)))];
  const time = (at: Date) => formatTime(at, { locale, timeZone });

  return (
    <Box component="section" id="schedule" sx={{ mt: 4 }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {heading}
      </Typography>
      {rows.length > 0 && (
        <Box component="dl" sx={{ m: 0, mb: prose ? 2 : 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.75, alignItems: "baseline" }}>
          {days.map((day) => (
            <Fragment key={day}>
              {days.length > 1 && (
                /* The day heading in the one long form (§349), its capital from the helper: CSS's
                   `capitalize` would have capitalised the month as well. */
                <Typography component="div" variant="subtitle2" sx={{ gridColumn: "1 / -1", mt: 1 }}>
                  {formatDay(rows.find((row) => dayKey(row.startsAt, timeZone) === day)?.startsAt ?? new Date(), { locale, timeZone, style: "long" })}
                </Typography>
              )}
              {rows
                .filter((row) => dayKey(row.startsAt, timeZone) === day)
                .map((row, index) => (
                  <Fragment key={`${day}-${index}`}>
                    <Typography component="dt" variant="body1" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {time(row.startsAt)}
                      {row.endsAt && `–${time(row.endsAt)}`}
                    </Typography>
                    <Typography component="dd" variant="body1" sx={{ m: 0 }}>
                      {row.label}
                      {row.place && (
                        <Box component="span" sx={{ color: "text.secondary" }}>
                          {" · "}
                          {row.place}
                        </Box>
                      )}
                    </Typography>
                  </Fragment>
                ))}
            </Fragment>
          ))}
        </Box>
      )}
      {prose && <RichText body={scheduleJson} />}
    </Box>
  );
}
