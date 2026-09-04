import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The site footer: today, just the two public legal routes (AGENTS.md §9.2 — "linked from the
 * footer in both locales"). A Server Component, like the header: nothing here is interactive.
 */
export default async function SiteFooter() {
  const t = await getTranslations("Legal");

  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper", mt: "auto" }}
    >
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
          <Link href="/legal/terms">{t("termsLinkLabel")}</Link>
        </Stack>
      </Container>
    </Box>
  );
}
