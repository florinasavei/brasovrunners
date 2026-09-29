import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { SponsorList } from "../sponsor-list";

/**
 * «Descarcă lista pentru sponsori» with «N persoane» beside it (§NNN) — on an event's registrations
 * page for that event, and in the «Newsletter» fold for every event: one button, one route, one
 * file. A Server Component; the caller reads the list (`sponsorList`, which asserts the role) and
 * passes it. While the notice in force does not describe the sharing the button is a disabled
 * `<button>` with no address, and one sentence says why — the route refuses it all the same.
 */
export default async function SponsorListButton({ locale, eventId, list }: { locale: Locale; eventId: string | null; list: SponsorList }) {
  const t = await getTranslations("Admin");
  const query = new URLSearchParams({ lang: locale });
  if (eventId) query.set("event", eventId);
  const count = list.rows.length;
  return (
    <Stack spacing={0.5} data-testid="sponsor-list">
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {list.offered ? (
          <GlyphButton icon="sponsors" href={`/api/admin/registrations/sponsor-list?${query.toString()}`} variant="outlined" size="small" sx={TAP_TARGET} data-testid="sponsor-list-button">
            {t("sponsors.button")}
          </GlyphButton>
        ) : (
          <GlyphButton icon="sponsors" type="button" disabled variant="outlined" size="small" sx={TAP_TARGET} data-testid="sponsor-list-button">
            {t("sponsors.button")}
          </GlyphButton>
        )}
        {list.offered && (
          <Typography variant="body2" color="text.secondary" data-testid="sponsor-list-count">
            {t(`sponsors.count.${countForm(count, locale)}`, { count })}
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" data-testid="sponsor-list-help">
        {list.offered ? t("sponsors.help") : t("sponsors.noticeMissing")}
      </Typography>
    </Stack>
  );
}
