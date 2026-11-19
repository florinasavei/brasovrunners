import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { NAMED_BADGES_MAX, NAMED_COLOUR_WORDS } from "../badge-named";

/**
 * «Ecusoane cu nume» — the hotfix of 2026-11-19 (the owner: «pune-mi și numele lor pe ele», «Vreau doar prenume pe ele», «… să pot
 * scrie "Voluntar/Fotograf/Organizator" Dany/Amalia»), beside «Tipărire»: one box, one line a badge — the word on its band, «;», the
 * first name — starting from the event's confirmed volunteers (`badge-named.ts#namedBadgeLinesText`), edited freely, and one button
 * that posts it to `/api/admin/events/<id>/badges/named` (a POST: no name in an address). Nothing is saved; the file prints with the
 * design above. A plain form, so it works with scripts off. The page asks `canDesignVolunteerBadges` before it draws this.
 */
export default async function BadgeNamedPanel({ eventId, locale, lines }: { eventId: string; locale: string; lines: string }) {
  const t = await getTranslations("Admin");
  const rows = Math.min(Math.max(lines.split("\n").length + 1, 6), 24);
  return (
    <Panel glyph="print" collapsible level={2} id="box-badge-named" title={t("badges.named.title")} aside={t("badges.named.aside")} data-testid="badge-named">
      <Box component="form" method="post" action={`/api/admin/events/${eventId}/badges/named`} data-testid="badge-named-form">
        <input type="hidden" name="locale" value={locale} />
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t("badges.named.intro")}
          </Typography>
          {lines === "" && (
            <Typography variant="body2" color="text.secondary" data-testid="badge-named-empty">
              {t("badges.named.empty")}
            </Typography>
          )}
          <TextField
            name="lines"
            label={t("badges.named.label")}
            helperText={t("badges.named.help", { colours: locale === "en" ? NAMED_COLOUR_WORDS.en : NAMED_COLOUR_WORDS.ro })}
            defaultValue={lines}
            multiline
            minRows={rows}
            fullWidth
            slotProps={{ htmlInput: { spellCheck: false, "data-testid": "badge-named-lines", maxLength: NAMED_BADGES_MAX * 90 } }}
          />
          <Box>
            <GlyphButton icon="pdf" type="submit" variant="contained" sx={{ minHeight: 44 }} data-testid="badge-named-download">
              {t("badges.named.download")}
            </GlyphButton>
          </Box>
        </Stack>
      </Box>
    </Panel>
  );
}
