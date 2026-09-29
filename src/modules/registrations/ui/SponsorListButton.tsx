import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { SPONSOR_RECIPIENT_MAX, type SponsorListSummary } from "../sponsor-list";

/**
 * «Descarcă lista pentru sponsori» with «N persoane» beside it (§NNN) — on an event's registrations
 * page for that event, and in the «Newsletter» fold for every event: one button, one route, one
 * file. A Server Component; the caller reads the count (`sponsorListSummary`, which asserts the
 * role) and passes it. While the notice in force does not describe the sharing the button is a
 * disabled `<button>` with no form, and one sentence says why — the route refuses it all the same.
 *
 * A plain GET form, no script: the optional «Cui dai lista» travels as `to` and the route writes it
 * into the audit row beside the registrations in the file, so a registration's page can later say
 * which partner received it (the notice's art. 15 and 19 promise; review finding).
 */
export default async function SponsorListButton({ locale, eventId, list }: { locale: Locale; eventId: string | null; list: SponsorListSummary }) {
  const t = await getTranslations("Admin");
  const count = list.count;
  return (
    <Stack spacing={0.5} data-testid="sponsor-list">
      {list.offered ? (
        <Stack
          component="form"
          action="/api/admin/registrations/sponsor-list"
          method="get"
          direction="row"
          sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
        >
          <input type="hidden" name="lang" value={locale} />
          {eventId && <input type="hidden" name="event" value={eventId} />}
          <TextField
            name="to"
            size="small"
            label={t("sponsors.recipient")}
            slotProps={{ htmlInput: { maxLength: SPONSOR_RECIPIENT_MAX, "data-testid": "sponsor-list-recipient" } }}
            sx={{ minWidth: 0, flex: "1 1 14rem", maxWidth: "24rem" }}
          />
          <GlyphButton icon="sponsors" type="submit" variant="outlined" size="small" sx={TAP_TARGET} data-testid="sponsor-list-button">
            {t("sponsors.button")}
          </GlyphButton>
          <Typography variant="body2" color="text.secondary" data-testid="sponsor-list-count">
            {t(`sponsors.count.${countForm(count, locale)}`, { count })}
          </Typography>
        </Stack>
      ) : (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <GlyphButton icon="sponsors" type="button" disabled variant="outlined" size="small" sx={TAP_TARGET} data-testid="sponsor-list-button">
            {t("sponsors.button")}
          </GlyphButton>
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" data-testid="sponsor-list-help">
        {list.offered ? t("sponsors.help") : t("sponsors.noticeMissing")}
      </Typography>
    </Stack>
  );
}
