import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { REPEAT_CADENCES, WEEKDAYS } from "@/modules/events/domain/repeat";

/**
 * How an event repeats (BR-REQ-050-02 criterion 7, §122): the cadence, the days of the week,
 * and until when — a date, or nothing for a series without an end, which the maintenance job
 * keeps eight weeks ahead. On the creation form with a "does not repeat" default — the owner
 * looked for recurrence there first ("every Monday and every Wednesday") — and on the event
 * page, where the same fields make a standing series from an existing event.
 *
 * `prefix` namespaces the fields (`repeat.cadence` on the creation form, bare on the event
 * page, which posts its own form). The weekday boxes post `weekday=1..7`, ISO numbered; none
 * ticked means the event's own day, as before. The event's own day is always in the series
 * (§128): on the event page, where it is known, its box is ticked and locked and a hidden
 * input posts it (a disabled input posts nothing); on the creation form the date is not
 * typed yet, and the service adds the day itself.
 *
 * There is no "does not repeat" cadence any more (§170): `RepeatToggle`'s checkbox is what
 * says whether the event repeats at all, and these fields are not shown until it is ticked.
 * The enum value stays in the domain for the rows that carry it.
 *
 * After a refused submit every one of them comes back as it was chosen (`DECISIONS.md` §315): the
 * cadence and the end are `RecallField`s, the weekday ticks `CheckboxField`s, which read the
 * form's returned state wherever the form is an `ActionForm`.
 */
export default async function RepeatFields({
  prefix = "",
  ownWeekday,
}: {
  prefix?: string;
  /** The event's own ISO weekday, when the event exists: ticked and locked. */
  ownWeekday?: number;
}) {
  const t = await getTranslations("Admin");
  const name = (field: string) => `${prefix}${field}`;

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
        <RecallField
          select
          name={name("cadence")}
          label={t("editor.repeatCadence")}
          defaultValue="WEEKLY"
          size="small"
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
        >
          {REPEAT_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {t(`editor.repeatCadences.${cadence}`)}
            </option>
          ))}
        </RecallField>
        <RecallField
          name={name("until")}
          type="date"
          label={t("editor.repeatUntil")}
          helperText={t("editor.repeatUntilHelp")}
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 220 }}
        />
      </Stack>
      <Box>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {t("editor.repeatWeekdays")}
        </Typography>
        {ownWeekday !== undefined && <input type="hidden" name="weekday" value={String(ownWeekday)} />}
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1 }}>
          {WEEKDAYS.map((day) => (
            <CheckboxField
              key={day}
              name="weekday"
              value={String(day)}
              defaultChecked={day === ownWeekday}
              disabled={day === ownWeekday}
            >
              {t(`editor.weekdays.${day}`)}
            </CheckboxField>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("editor.repeatWeekdaysHelp")}
        </Typography>
      </Box>
    </Stack>
  );
}
