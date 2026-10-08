import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CopyCodeButton from "@/modules/content/member-codes/ui/CopyCodeButton";

/** An event's own calendar file, as an absolute address (§107; the file the event page offers). */
export function eventCalendarFileUrl(baseUrl: string, locale: string, slug: string): string {
  return `${baseUrl}/${locale}/events/${slug}/calendar.ics`;
}

/**
 * A calendar's address, to copy (§674, amending §107 and §195): a read-only box with the plain
 * `https://` address and «Copiază» beside it, and the sentences that say when a person needs it.
 *
 * Google Calendar's quick-add link (the «Google Calendar» button) works the first time. After a
 * person has hidden or removed the calendar, Google keeps it by its address and the button does
 * nothing; what always works is calendar.google.com on the web → «Din URL» → this address, with
 * `?v=2` at the end when Google says it already has it. So the address is in the page's HTML,
 * selectable with scripts off, and the one clipboard island (`CopyCodeButton`) puts it on the
 * clipboard in one press — or, where the browser refuses the clipboard, selects it in the box.
 *
 * A Server Component: the island receives strings only. The address comes from `APP_BASE_URL`
 * through the caller, never a literal.
 */
export default function CalendarAddress({
  id,
  address,
  label,
  copyLabel,
  copiedLabel,
  hints,
}: {
  /** The box's `id`, unique on the page: the island selects it when the clipboard is refused. */
  id: string;
  address: string;
  /** The box's accessible name. */
  label: string;
  copyLabel: string;
  copiedLabel: string;
  /** The sentences under the box, each its own short line. */
  hints: readonly string[];
}) {
  return (
    <Box data-testid="calendar-address" sx={{ mt: 1 }}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        <Box
          component="input"
          id={id}
          type="text"
          readOnly
          value={address}
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          sx={{
            flex: "1 1 14rem",
            minWidth: 0,
            minHeight: 44,
            px: 1,
            fontFamily: "monospace",
            // 16 pixels on a phone, or iOS zooms the page when the box takes the focus.
            fontSize: { xs: "1rem", sm: "0.8125rem" },
            color: "text.primary",
            bgcolor: "background.default",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        />
        <CopyCodeButton code={address} label={copyLabel} copiedLabel={copiedLabel} selectId={id} />
      </Stack>
      {hints.map((hint) => (
        <Typography key={hint} variant="body2" color="text.secondary" sx={{ mt: 0.75, fontSize: "0.8125rem" }}>
          {hint}
        </Typography>
      ))}
    </Box>
  );
}
