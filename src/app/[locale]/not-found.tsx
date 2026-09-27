import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";

export default async function NotFound() {
  const t = await getTranslations("NotFound");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      {/* "/events", not "/": the root itself 308-redirects to the listing
          (`app/[locale]/page.tsx`), the same reason `LogoLink` names (§342). */}
      <ButtonLink href="/events" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
        <ArrowBackIcon aria-hidden="true" sx={glyphSx("medium")} />
        {t("back")}
      </ButtonLink>
    </Container>
  );
}
