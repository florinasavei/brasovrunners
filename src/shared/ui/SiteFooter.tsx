import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";

/**
 * The footer: the two legal links on a row that is always visible — every public page offers
 * them (AGENTS.md §11.4) — and below it a native `<details>` about the club, closed by default,
 * which is what the owner asked for on 2026-09-17 when he said the footer should collapse.
 *
 * `<details>` rather than a client island: it works with JavaScript off, costs no client code,
 * and is what a collapsible section *is* on the platform (AGENTS.md §1.5). The summary is a
 * 44px tap target, because the footer is reached on a phone (BR-REQ-041-01).
 *
 * The contact line renders only when `EMAIL_REPLY_TO` is configured — the mailbox the club
 * actually reads (AGENTS.md §8). Nothing here invents an address: until the club has one, the
 * block says who the club is and no more.
 */
export default async function SiteFooter() {
  const legal = await getTranslations("Legal");
  const footer = await getTranslations("Footer");
  const contact = env.EMAIL_REPLY_TO;

  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper", mt: "auto" }}
    >
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
            <Link href="/legal/privacy">{legal("privacyLinkLabel")}</Link>
            <Link href="/legal/terms">{legal("termsLinkLabel")}</Link>
          </Stack>

          <Box component="details">
            <Box
              component="summary"
              sx={{ cursor: "pointer", color: "text.secondary", fontSize: "0.875rem", py: 1.5 }}
            >
              {footer("about.summary")}
            </Box>
            <Stack spacing={1} sx={{ pb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {footer("about.description")}
              </Typography>
              {contact && (
                <Typography variant="body2" color="text.secondary">
                  {footer("about.contact")} <a href={`mailto:${contact}`}>{contact}</a>
                </Typography>
              )}
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
