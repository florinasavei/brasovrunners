import RedeemIcon from "@mui/icons-material/Redeem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";

/**
 * The event page's one calm link to the raffle's sign-up (§NNN): a line, «Avem tombolă! Înscrie-te cu numărul tău de concurs.», and
 * one outlined button, «Înscrie-te la tombolă», to the raffle's own page (`/evenimente/<slug>/tombola`) — drawn only while that page
 * would answer 200 (`cachedRaffleSignUpOpen`, the page decides). Nothing else of the raffle is on the event's page: no count, no name.
 * A Server Component: the button is a plain link (`ButtonLink`, 44 pixels, a glyph before its words), not prefetched.
 */
export default async function RaffleCallout({ slug }: { slug: string }) {
  const t = await getTranslations("Event");
  return (
    <Box component="section" aria-label={t("raffle.title")} data-testid="raffle-callout" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Typography variant="body1" sx={{ mb: 1 }}>
        {t("raffle.callout.line")}
      </Typography>
      <ButtonLink href={{ pathname: "/events/[slug]/tombola", params: { slug } }} variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="raffle-callout-button">
        <RedeemIcon aria-hidden="true" sx={glyphSx("medium")} />
        {t("raffle.callout.button")}
      </ButtonLink>
    </Box>
  );
}
