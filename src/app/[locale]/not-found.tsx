import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";

export default async function NotFound() {
  const t = await getTranslations("NotFound");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <ButtonLink href="/" variant="contained">
        {t("back")}
      </ButtonLink>
    </Container>
  );
}
