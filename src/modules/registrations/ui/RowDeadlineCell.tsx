import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { deadlinePassed, type RowDeadline } from "@/modules/registrations/domain/row-deadline";

/**
 * «Termen» on the registrations list (§NNN): the exact moment one row waits on — until when the person
 * can sign the declaration, or confirm the address — and under it what it is the deadline of. A moment
 * already passed reads quieter, with what it means (§160: a held place is kept while nobody asks for
 * it). «—» on a row that waits on nothing, as the race number's column says it.
 *
 * Rendered on the server, from `rowDeadlineOf`, in both of `AdminTable`'s layouts: the date stays on
 * one line, the words under it may wrap at 320 px.
 */
export default async function RowDeadlineCell({ deadline }: { deadline: RowDeadline | null }) {
  if (!deadline) {
    return (
      <Box component="span" data-testid="row-deadline" sx={{ color: "text.disabled" }}>
        —
      </Box>
    );
  }
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const passed = deadlinePassed(deadline);
  return (
    <Box component="span" data-testid="row-deadline" data-deadline-kind={deadline.kind} sx={{ display: "block" }}>
      <Box
        component="span"
        sx={{ display: "block", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: passed ? 400 : 600, color: passed ? "text.secondary" : "text.primary" }}
      >
        {formatDay(deadline.at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true })}
      </Box>
      <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.8125rem" }}>
        {t(`registrations.deadline.${deadline.kind}`)}
      </Box>
    </Box>
  );
}
