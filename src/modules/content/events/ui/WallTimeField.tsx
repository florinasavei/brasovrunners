import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * A date and a time as two boxes (BR-REQ-050-02, §70, §345, §439): the date a day-first picker
 * (`DateField`), the time a typed 24-hour box (`TimeField`), since the browser's own controls
 * show its locale's clock and date order. They post `<name>Date` and `<name>Time`, which
 * `admin/actions.ts` joins into `<name>WallTime` in the event's zone; both come back after a
 * refused submit (§315) and work without JavaScript. One clear button: a time with no date is
 * dropped on save.
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
      {/* Side by side where there is room; the date's buttons need ~200 px on a phone. */}
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
