import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { deadlinePassed, type RowDeadline } from "@/modules/registrations/domain/row-deadline";

/**
 * «Până când» on the registrations list (§NNN): one sentence with the exact moment the row waits on —
 * «Poate semna până …», «Poate accepta până …», «Linkul e valabil până …» — or, past it, the moment
 * first and what it means (§160: a held place is kept while nobody asks for it). A moment already
 * passed reads quieter. «—» on a row that waits on nothing, as the race number's column says it.
 *
 * The moment is the timeline's (`formatDay`, short, with the time): inside the sentence with the hour's
 * «la» (§452), at its start capitalised. Rendered on the server, from `rowDeadlineOf`, in both of
 * `AdminTable`'s layouts; the sentence may wrap at 320 px.
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
  // A passed deadline's sentence starts with the moment; a live one says it after «până».
  const instant = formatDay(deadline.at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: passed ? "start" : "inline" });
  return (
    <Box
      component="span"
      data-testid="row-deadline"
      data-deadline-kind={deadline.kind}
      sx={{ display: "block", fontVariantNumeric: "tabular-nums", color: passed ? "text.secondary" : "text.primary" }}
    >
      {t(`registrations.untilWhen.${deadline.kind}`, { instant })}
    </Box>
  );
}
