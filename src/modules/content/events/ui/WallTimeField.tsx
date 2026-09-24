import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * A date and a time, as two boxes, each on MUI's picker (BR-REQ-050-02, `DECISIONS.md` §70,
 * §303 and §NNN).
 *
 * `<input type="datetime-local">` showed the *browser's* clock and date order — "06:30 PM" and a
 * month-first calendar on an English-language Chrome — and no attribute changes that. §70 split
 * the two, §303 made the time `<input type="time">`, which still *showed* "07:00 PM" wherever the
 * operating system did. The owner, over exactly that: "vreau ca timpul să fie mereu în format de
 * 24H, nu cu AM și PM ca aici". So both halves are pickers now (`shared/forms/pickers`): the date
 * reads `30.09.2026`, the time `19:00`, in either language of the backoffice.
 *
 * **Nothing below the form changed.** The two still post as `<name>Date` (`YYYY-MM-DD`) and
 * `<name>Time` (`HH:mm`), from hidden inputs beside the pickers; `admin/actions.ts` joins them
 * into the `<name>WallTime` string the service has read since `0011`, in the event's own zone.
 * Both come back filled after a refused submit (§315), and without JavaScript each is a text box
 * with the shape as its `pattern`, posting under the same name.
 *
 * The time half has no clear button: a time with no date is dropped on save (`actions.ts`'s
 * `wallTime` reads no value without a date), so the two boxes needed only one clear button, and
 * the box stays 140 pixels wide. Clearing the date leaves whatever the time box holds on
 * screen — it is the save that drops it, not the box.
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
      {/* Side by side where there is room, the time under the date on a phone: `30.09.2026`, the
          calendar button and the clear button need some two hundred pixels of their own. */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
        <DateField name={`${name}Date`} label={label} defaultValue={date} required={required} sx={{ flex: "1 1 200px" }} />
        <TimeField name={`${name}Time`} label={timeLabel} defaultValue={time} required={required} clearable={false} sx={{ flex: "0 0 140px" }} />
      </Box>
      {helperText && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {helperText}
        </Typography>
      )}
    </Stack>
  );
}
