import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { getTranslations, setRequestLocale } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1">{t("intro")}</Typography>
    </Container>
  );
}
