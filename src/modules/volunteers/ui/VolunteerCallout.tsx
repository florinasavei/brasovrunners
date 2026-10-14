import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";

/**
 * The event page's volunteers box (§NNN, amending §754; the owner, 2026-10-14: «formularul trebuie să fie pagină separată,
 * nu embedded în pagina evenimentului»): one line, «Căutăm voluntari: Punct de apă, Sosire», and one button,
 * «Vreau să fiu voluntar», to the volunteers' own page (`/evenimente/<slug>/voluntari`) — where the roles with their
 * descriptions and the form are. Nothing else of the volunteers is on the event's page: the header and the landing stay
 * as light as they were.
 *
 * Drawn only where that page would answer 200 — `readVolunteerOffer`, the one read both share — and only for the roles
 * that still need people, so the line never names a full one and the button never leads to a 404. A Server Component:
 * the button is a plain link (`ButtonLink`, 44 pixels, a glyph before its words), not prefetched — the page it opens is
 * rendered per request.
 */
export default async function VolunteerCallout({ slug, roleNames }: { slug: string; roleNames: readonly string[] }) {
  const t = await getTranslations("Event");
  return (
    <Box component="section" aria-label={t("volunteers.title")} data-testid="volunteer-callout" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Typography variant="body1" sx={{ mb: 1 }} data-testid="volunteer-callout-line">
        {t("volunteers.callout.line", { roles: roleNames.join(", ") })}
      </Typography>
      <ButtonLink
        href={{ pathname: "/events/[slug]/volunteers", params: { slug } }}
        variant="outlined"
        sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}
        data-testid="volunteer-callout-button"
      >
        <VolunteerActivismIcon aria-hidden="true" sx={glyphSx("medium")} />
        {t("volunteers.title")}
      </ButtonLink>
    </Box>
  );
}
