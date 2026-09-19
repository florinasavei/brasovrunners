import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
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
 * ticked means the event's own day, as before.
 */
export default async function RepeatFields({
  prefix = "",
  withNone = false,
}: {
  prefix?: string;
  /** Offer "does not repeat" as the default, for the creation form. */
  withNone?: boolean;
}) {
  const t = await getTranslations("Admin");
  const name = (field: string) => `${prefix}${field}`;

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
        <TextField
          select
          name={name("cadence")}
          label={t("editor.repeatCadence")}
          defaultValue={withNone ? "NONE" : "WEEKLY"}
          size="small"
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
        >
          {withNone && <option value="NONE">{t("editor.repeatCadences.NONE")}</option>}
          {REPEAT_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {t(`editor.repeatCadences.${cadence}`)}
            </option>
          ))}
        </TextField>
        <TextField
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
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1 }}>
          {WEEKDAYS.map((day) => (
            <CheckboxField key={day} name="weekday" value={String(day)}>
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
