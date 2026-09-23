import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RecallField from "@/shared/forms/recall";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * A date and a time, as two fields, each with the browser's own picker (BR-REQ-050-02,
 * `DECISIONS.md` §70 and the § that amended it).
 *
 * `<input type="datetime-local">` shows whatever clock and date order the *browser's* locale
 * uses — an English-language Chrome on a Romanian laptop offers "06:30 PM" and a month-first
 * calendar, and no attribute on the input changes that. §70 split the two so the date keeps
 * the native calendar (unambiguous whatever order it prints the digits in) and made the time a
 * text box for `HH:MM`. The owner then asked for the time to be picked, not typed
 * ("timepickerul ar trebui să fie tot element MUI, nu să bag eu de mână timpul"), so the time
 * is `<input type="time">` now: a clock on a phone, spinners on a desktop, the same family as
 * the date box beside it, and no dependency. The browser may *display* it on a 12-hour clock
 * where the OS does; what it **posts** is always `HH:MM` on the 24-hour clock, which is what
 * the service reads and every bib prints — the ambiguity §70 refused was the date's, and the
 * date still has its own box.
 *
 * The two post as `<name>Date` and `<name>Time`; `admin/actions.ts` joins them into the
 * `<name>WallTime` string the service has always read, so nothing below the form changed.
 * Both come back filled after a refused submit (§306), like every other box on the form.
 */
export default function WallTimeField({
  name,
  label,
  helperText,
  value,
  zone,
  required = false,
  timeLabel,
}: {
  name: string;
  label: string;
  helperText?: string;
  value: Date | null;
  zone: string;
  required?: boolean;
  timeLabel: string;
}) {
  const wall = toWallTimeInput(value, zone);
  const [date, time] = wall ? wall.split("T") : ["", ""];

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <RecallField
          name={`${name}Date`}
          type="date"
          label={label}
          defaultValue={date}
          slotProps={{ inputLabel: { shrink: true } }}
          required={required}
          sx={{ flex: 1 }}
        />
        <RecallField
          name={`${name}Time`}
          type="time"
          label={timeLabel}
          defaultValue={time}
          slotProps={{ inputLabel: { shrink: true } }}
          required={required}
          sx={{ width: 140 }}
        />
      </Stack>
      {helperText && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {helperText}
        </Typography>
      )}
    </Stack>
  );
}
