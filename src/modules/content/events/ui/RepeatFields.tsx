import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import CheckboxField from "@/shared/ui/CheckboxField";
import { REPEAT_CADENCES, REPEAT_MAX_COUNT, WEEKDAYS } from "../service";

/**
 * How an event repeats (BR-REQ-050-02 criterion 7): the cadence, the days of the week, how
 * many weeks. On the creation form with a "does not repeat" default — the owner looked for
 * recurrence there first ("every Monday and every Wednesday") — and on the event page, where
 * the same fields make a further series from an existing event.
 *
 * `prefix` namespaces the fields (`repeat.cadence` on the creation form, bare on the event
 * page, which posts its own form). The weekday boxes post `weekday=1..7`, ISO numbered; none
 * ticked means the event's own day, as before.
 */
export default async function RepeatFields({
  prefix = "",
  withNone = false,
  defaultCount = 4,
}: {
  prefix?: string;
  /** Offer "does not repeat" as the default, for the creation form. */
  withNone?: boolean;
  defaultCount?: number;
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
          name={name("count")}
          type="number"
          label={t("editor.repeatWeeks")}
          defaultValue={defaultCount}
          size="small"
          slotProps={{ htmlInput: { min: 1, max: REPEAT_MAX_COUNT } }}
          sx={{ width: 160 }}
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
