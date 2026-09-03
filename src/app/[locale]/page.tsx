import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import ButtonLink from "@/shared/ui/ButtonLink";
import JsonLd from "@/shared/ui/JsonLd";

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const tSite = await getTranslations("Site");

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      {/* BR-REQ-052-02 criterion 1. Incomplete by design — see structured-data.ts. */}
      <JsonLd data={sportsOrganizationJsonLd(tSite("name"))} />

      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        {t("intro")}
      </Typography>
      <ButtonLink href="/events" variant="contained">
        {t("seeEvents")}
      </ButtonLink>
    </Container>
  );
}
