import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * A date and a 24-hour time, as two fields (BR-REQ-050-02, `DECISIONS.md` §70).
 *
 * `<input type="datetime-local">` shows whatever clock the *browser's* locale uses — an
 * English-language Chrome on a Romanian laptop offers "06:30 PM" and a month-first calendar,
 * and no attribute on the input changes that. The date keeps the native picker (its calendar
 * is unambiguous whatever the display order); the time is a plain text field that accepts
 * only `HH:MM` on a 24-hour clock, which is how every runner in Brașov reads a start time.
 *
 * The two post as `<name>Date` and `<name>Time`; `admin/actions.ts` joins them into the
 * `<name>WallTime` string the service has always read, so nothing below the form changed.
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
        <TextField
          name={`${name}Date`}
          type="date"
          label={label}
          defaultValue={date}
          slotProps={{ inputLabel: { shrink: true } }}
          required={required}
          sx={{ flex: 1 }}
        />
        <TextField
          name={`${name}Time`}
          type="text"
          label={timeLabel}
          defaultValue={time}
          placeholder="HH:MM"
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: {
              inputMode: "numeric",
              pattern: "([01][0-9]|2[0-3]):[0-5][0-9]",
              maxLength: 5,
              autoComplete: "off",
            },
          }}
          required={required}
          sx={{ width: 110 }}
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
