import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";

/**
 * The footer: one line, and nothing else until somebody asks for more.
 *
 * The two legal links are always visible — every public page offers them (`AGENTS.md` §11.4) —
 * and "about the club" sits on that same line as a native `<details>`, closed. Opening it grows
 * the line downwards rather than adding a second permanent row, which is what the owner asked
 * for on 2026-09-17: a footer that is one line until it is wanted.
 *
 * ## Why `<details>` and not a client island
 *
 * It is a collapsible section on the platform: it works with JavaScript off, costs no client
 * code, and needs no state (§1.5). The summary is a 44px tap target, because this is reached with
 * a thumb (BR-REQ-041-01).
 *
 * ## Why the links are beside the `<details>` and not inside its summary
 *
 * A `<summary>` is a button. Links nested inside a button are invalid, and a screen reader
 * announcing "button, privacy link, terms link" describes something nobody built. Three siblings
 * in one flex row read correctly and look identical.
 *
 * The contact line renders only when `EMAIL_REPLY_TO` is set — the mailbox the club actually
 * reads (§8). Until the club has one, the block says who the club is and no more; nothing here
 * invents an address.
 */
export default async function SiteFooter() {
  const legal = await getTranslations("Legal");
  const footer = await getTranslations("Footer");
  const contact = env.EMAIL_REPLY_TO;
  const social = [
    { href: env.CLUB_FACEBOOK_URL, label: footer("about.facebook") },
    { href: env.CLUB_INSTAGRAM_URL, label: footer("about.instagram") },
  ].filter((entry): entry is { href: string; label: string } => Boolean(entry.href));

  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper", mt: "auto" }}
    >
      <Container maxWidth="sm" sx={{ py: 1 }}>
        <Stack
          direction="row"
          spacing={2}
          // `flex-start` keeps the two links on the first line when the disclosure is open: the
          // row grows under "about the club" alone, where the summary that opened it is.
          sx={{ flexWrap: "wrap", alignItems: "flex-start", rowGap: 0.5 }}
        >
          <Link href="/legal/privacy">{legal("privacyLinkLabel")}</Link>
          <Link href="/legal/terms">{legal("termsLinkLabel")}</Link>

          <Box component="details">
            <Box
              component="summary"
              sx={{
                cursor: "pointer",
                color: "text.secondary",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
              }}
            >
              {footer("about.summary")}
            </Box>
            <Stack spacing={1} sx={{ pb: 1, maxWidth: "40rem" }}>
              <Typography variant="body2" color="text.secondary">
                {footer("about.description")}
              </Typography>
              {contact && (
                <Typography variant="body2" color="text.secondary">
                  {footer("about.contact")} <a href={`mailto:${contact}`}>{contact}</a>
                </Typography>
              )}
              {social.length > 0 && (
                <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
                  {social.map((entry) => (
                    // Off-site, so each opens in a new tab and carries its own `rel` — the same
                    // rule the rich-text renderer applies to every external link.
                    <MuiLink
                      key={entry.href}
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="body2"
                    >
                      {entry.label}
                    </MuiLink>
                  ))}
                </Stack>
              )}
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
