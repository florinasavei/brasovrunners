import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The site footer: the two public legal routes (AGENTS.md §9.2 — "linked from the footer in
 * both locales"). A Server Component, like the header: nothing here is interactive.
 *
 * It used to carry a "Staff" link as well, and that link is gone. It was never a security
 * question — the backoffice is guarded on the server on every request (BR-REQ-060-01 criterion
 * 4), `robots.txt` disallows the path, and a link to a locked door is not a weakness. It was a
 * question of what a club's public page says: an invitation to a backoffice, on every page every
 * visitor reads, for the three people who already know the URL. The entrance moved to the build
 * badge, which those three people can find and nobody else is offered (`BuildBadge.tsx`).
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
