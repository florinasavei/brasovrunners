import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { OrderTotal, OrderTotals as Totals } from "../domain/race-plan";

/**
 * «De comandat» on «Planul locurilor» (§NNN), under «Kituri de pregătit» (`KitCount`, the registrations' kits now): every
 * kit needed now, the elite list's lines and the volunteers with a kit added (`domain/race-plan.ts#kitsNow`); what to
 * order if every place fills — the kits and the race numbers (`orderTotals`); each total with the parts it is the sum of
 * written out under it, so the club can check the arithmetic and drop a part it does not print — and the race numbers
 * given now, the elite list's named bibs beside them, with the door to «Numerele de concurs». An event with no limit of
 * places says only what is needed now. A Server Component; the one link is a plain `<a>` (`GlyphButton` with an `href`).
 */
export default async function OrderTotals({
  now,
  totals,
  bibs,
  eliteEntries,
  eventId,
  locale,
}: {
  /** Every kit needed now (`kitsNow`). */
  now: OrderTotal;
  totals: Totals | null;
  /** The race numbers given now and how many are still unprinted (`countBibs`). */
  bibs: { total: number; unprinted: number };
  /** The elite list's lines (§895): a bib with a name each, printed from their own sheet. */
  eliteEntries: number;
  eventId: string;
  locale: string;
}) {
  const t = await getTranslations("Admin");
  const block = (title: string, value: OrderTotal, testId: string) => (
    <Box data-testid={testId} sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {value.parts.map((part) => (
          <Typography key={part.key} component="li" variant="body2" color="text.secondary" data-part={part.key}>
            {t("racePlan.order.part", { label: t(`racePlan.order.parts.${part.key}`), count: part.count })}
          </Typography>
        ))}
      </Box>
    </Box>
  );
  return (
    <Box data-testid="race-plan-order">
      {block(t("racePlan.order.kitsNow", { total: now.total }), now, "race-plan-order-now")}
      {totals ? (
        <>
          {block(t("racePlan.order.kits", { total: totals.kits.total }), totals.kits, "race-plan-order-kits")}
          {block(t("racePlan.order.bibs", { total: totals.bibs.total }), totals.bibs, "race-plan-order-bibs")}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-testid="race-plan-order-uncapped">
          {t("racePlan.order.uncapped")}
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="race-plan-bibs-now">
        {t("racePlan.order.bibsNow", { total: bibs.total, unprinted: bibs.unprinted })}
      </Typography>
      {eliteEntries > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="race-plan-bibs-elite">
          {t("racePlan.order.bibsElite", { count: eliteEntries })}
        </Typography>
      )}
      <GlyphButton
        icon="number"
        href={getPathname({ locale, href: { pathname: "/admin/events/[id]/bibs", params: { id: eventId } } })}
        variant="text"
        size="small"
        sx={TAP_TARGET}
        data-testid="race-plan-bibs-link"
      >
        {t("racePlan.order.bibsLink")}
      </GlyphButton>
    </Box>
  );
}
