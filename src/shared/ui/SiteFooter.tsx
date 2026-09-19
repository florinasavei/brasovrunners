import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/shared/config/env";
import SocialIcon, { type SocialNetwork } from "./SocialIcon";
import ThemeModeToggle from "./ThemeModeToggle";
import { PAGE_WIDTH } from "@/theme/brand";

/**
 * The height of the footer's one visible line. Thin, by the owner's instruction: the bar sits at
 * the bottom of every page and should cost as little of the screen as a tap target allows. It
 * was 40px while the line held a disclosure and the social marks; since the scheme switch moved
 * here (§115) the line carries a control, and 44px is what BR-REQ-041-01 asks of one.
 */
const BAR_HEIGHT = 44;

/** The scheme switch's own width, which the summary starts after. */
const SWITCH_WIDTH = 44;

/**
 * The footer: one thin line, with the social marks always on it and everything else behind it.
 *
 * Four things share the line. In the bottom-left corner, the light/dark switch (§115: "the
 * theme switcher should be in the bottom left corner" — it was in the header). Then a
 * `<summary>` that opens the rest — the club, the contact, the legal pages — and names them, so
 * a visitor after the privacy notice knows to open it (`AGENTS.md` §9.2 asks the legal routes
 * be *linked from* the footer; they are, and the registration form links the notice directly
 * where it matters, BR-REQ-070-01). In the middle, the social marks — Facebook, Instagram and
 * the Strava club — **outside the disclosure and always visible**, by the owner's instruction
 * on 2026-09-17. On the right, the build badge keeps its fixed corner.
 *
 * ## Why the marks are positioned rather than laid out
 *
 * The middle of the line belongs to the `<details>`, whose summary must be its own first child
 * and whose panel must open full-width beneath. A flex row cannot put a third element between a
 * summary and its panel, and links inside a summary are links inside a button, which reads
 * wrongly to assistive technology. So the marks are absolutely positioned on the line, centred
 * from `sm` up and on the right below it, where the summary's text would otherwise run under
 * them on a 320px screen. The badge is static there, so nothing else claims that corner.
 *
 * ## Aligned with the page, sticky at the bottom
 *
 * The container is `lg`, the same as the header and every content page, so the summary's left
 * edge sits on the logo's column. Sticky like the header, below the badge's layer (1050) and the
 * header's (1100); `mt: "auto"` still pushes it to the bottom of a short page.
 *
 * ## Why `<details>` and not a client island
 *
 * It is a collapsible section on the platform: works with JavaScript off, costs no client code,
 * needs no state (§1.5). The summary's height comes from its line-height — `display: flex` on a
 * `<summary>` removes the disclosure triangle in Chrome and Safari.
 *
 * The contact line renders only when `EMAIL_REPLY_TO` is set — the mailbox the club actually
 * reads (§8) — and the marks only when configured. Nothing here invents an address.
 */
export default async function SiteFooter() {
  const legal = await getTranslations("Legal");
  const footer = await getTranslations("Footer");
  const contact = env.EMAIL_REPLY_TO;
  const social = [
    { network: "facebook" as SocialNetwork, href: env.CLUB_FACEBOOK_URL, label: footer("about.facebook") },
    { network: "instagram" as SocialNetwork, href: env.CLUB_INSTAGRAM_URL, label: footer("about.instagram") },
    { network: "strava" as SocialNetwork, href: env.CLUB_STRAVA_URL, label: footer("about.strava") },
  ].filter((entry): entry is typeof entry & { href: string } => Boolean(entry.href));

  return (
    <Box
      component="footer"
      sx={{
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        mt: "auto",
        position: "sticky",
        bottom: 0,
        zIndex: 1000,
      }}
    >
      {/* In the corner of the bar itself, not of the page's column (the owner: "all the way to
          the left") — positioned like the marks, because the line is the summary's. */}
      <Box sx={{ position: "absolute", top: 0, left: 0, height: BAR_HEIGHT, display: "flex", alignItems: "center" }}>
        <ThemeModeToggle />
      </Box>
      <Container maxWidth={PAGE_WIDTH} sx={{ position: "relative" }}>
        <Box component="details">
          <Box
            component="summary"
            sx={{
              cursor: "pointer",
              color: "text.secondary",
              fontSize: "0.875rem",
              lineHeight: `${BAR_HEIGHT}px`,
              // Only as wide as its label. A block summary spans the line, which put its
              // centre — where a pointer test clicks — under the social marks, and made empty
              // space on the bar toggle the panel.
              width: "fit-content",
              // Clear of the scheme switch in the bar's corner: on a wide screen the column's
              // own margin already is (`xl`: 168px either side of the `lg` column).
              ml: { xs: `${SWITCH_WIDTH}px`, xl: 0 },
              // On a phone the marks sit on the right of this same line (three of them, ~130px
              // with their gaps): the label stops before them, whatever its length, and its
              // tail — ", contact and legal" — is dropped there so what is left reads whole.
              // The owner saw "About the club, contact and lega" under the Facebook mark.
              maxWidth: { xs: `calc(100% - 140px - ${SWITCH_WIDTH}px)`, sm: "none" },
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              "&::marker": { color: "text.secondary" },
            }}
          >
            {footer("about.summaryShort")}
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {footer("about.summaryTail")}
            </Box>
          </Box>

          {/* Indented to the summary's text, past the switch and its marker, so the panel reads as its body. */}
          <Stack spacing={1.5} sx={{ pt: 0.5, pb: 2, pl: { xs: `${SWITCH_WIDTH + 20}px`, xl: 2.5 }, maxWidth: "40rem" }}>
            <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
              <Link href="/legal/privacy">{legal("privacyLinkLabel")}</Link>
              <Link href="/legal/terms">{legal("termsLinkLabel")}</Link>
              {/* "My registrations" (BR-REQ-036-04): the one place a runner finds it without an email. */}
              <Link href="/registrations/mine">{footer("myRegistrations")}</Link>
            </Stack>
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

        {social.length > 0 && (
          <Stack
            direction="row"
            component="nav"
            aria-label={footer("about.socialLabel")}
            sx={{
              position: "absolute",
              top: 0,
              height: BAR_HEIGHT,
              alignItems: "center",
              right: { xs: 16, sm: "auto" },
              left: { xs: "auto", sm: "50%" },
              transform: { xs: "none", sm: "translateX(-50%)" },
              gap: 0.5,
            }}
          >
            {social.map((entry) => (
              // Off-site, so each opens in a new tab and carries its own `rel` — the same rule
              // the rich-text renderer applies to every external link. The name is on the link,
              // the mark is decoration.
              <MuiLink
                key={entry.href}
                href={entry.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={entry.label}
                title={entry.label}
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: BAR_HEIGHT,
                  height: BAR_HEIGHT,
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <SocialIcon network={entry.network} size={22} />
              </MuiLink>
            ))}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
