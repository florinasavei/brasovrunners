import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";

/**
 * The site footer: the two public legal routes (AGENTS.md §9.2 — "linked from the footer in
 * both locales"), and a way in for the club's own people. A Server Component, like the header:
 * nothing here is interactive.
 *
 * The staff link appears only where somebody can actually sign in. It is not a secret — the
 * backoffice is guarded on the server, on every request, and a link to a locked door is not a
 * weakness (BR-REQ-060-01 criterion 4) — but where `STAFF_AUTH_MODE=disabled` there is no door
 * at all, and offering one would be an invitation to look for it. `robots.txt` disallows the
 * path either way, so the link is for the three people who need it and for nobody's index.
 */
export default async function SiteFooter() {
  const t = await getTranslations("Legal");
  const tAdmin = await getTranslations("Admin");

  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper", mt: "auto" }}
    >
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
          <Link href="/legal/terms">{t("termsLinkLabel")}</Link>
          {env.STAFF_AUTH_MODE !== "disabled" && (
            <Link href="/sign-in" rel="nofollow">
              {tAdmin("signIn.footerLink")}
            </Link>
          )}
        </Stack>
      </Container>
    </Box>
  );
}
