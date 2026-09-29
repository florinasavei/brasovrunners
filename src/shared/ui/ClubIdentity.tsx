import EditNoteIcon from "@mui/icons-material/EditNote";
import MailOutlinedIcon from "@mui/icons-material/MailOutlined";
import PhoneOutlinedIcon from "@mui/icons-material/PhoneOutlined";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { telHref } from "@/modules/contact/domain/public-phone";
import { bareRegistrationNumber, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { cachedPublicPhone, cachedShownContactAddresses } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { type ClubSocialLink, clubSocialLinks } from "./club-socials";
import SocialIcon from "./SocialIcon";

/**
 * The club's legal identity on the site (§565; the owner, 2026-09-29: «on the about pages and
 * contact pages we need to show "<the club's legal name> (<the site's name>) CIF <the CIF>" in order to
 * meet legal requirements», then «and also in the footer, more clearly», with another running club's
 * footer as the example).
 *
 * **Composed, never typed.** The legal name and the CIF are the same two variables the legal texts
 * are filled with (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, read through `clubFactsFromEnv`,
 * §132), the name in brackets is the platform's one constant (`CLUB_NAME`, §215, §369), and the
 * repository — public — carries none of the values. Unset (CI, a fresh checkout, the e2e run), the
 * identity renders nothing: the `line` is absent, and the `block`'s first column with it.
 *
 * Two shapes:
 *
 * - `line` — «<legal name> (<site name>) · CIF <CIF>», one secondary line that wraps at 320 px, at
 *   the end of the «about» pages (the club's standing pages and «Echipa») and of the contact page.
 * - `block` — under the footer's bar on every page, three columns from `sm` and stacked on a phone:
 *   the legal name with the site's name, «C.I.F.» and the country; the club's social marks (the
 *   bar's own list, `clubSocialLinks`); «Contact» with the address the club chose to show (§442 —
 *   never `CONTACT_FORM_TO`, who *receives*), the «Telefon public» when one is set, and «Scrie-ne».
 *   The seat (`CLUB_REGISTERED_ADDRESS`) is not shown: it is a person's address on many a club's
 *   certificate, and the owner asked for the name and the CIF. It can be added as its own line.
 *
 * A Server Component with no island; every glyph is drawn here from its own icon file (§521), none
 * passed to a client component. Every link is a 44-pixel target (BR-REQ-041-01 criterion 6): the
 * block is not the bar, so the bar's footer-only exception (§372) does not reach it.
 */
type Props = { shape: "line"; social?: never } | { shape: "block"; social?: readonly ClubSocialLink[] };

/** The legal facts the site shows, or null while the legal name is unset. */
function shownIdentity(): { legalName: string; cif: string | null } | null {
  const facts = clubFactsFromEnv(env);
  if (!facts.legalName) return null;
  // The variable may carry its own label («CIF …», as the legal texts read it after a comma);
  // the line and the block write the label themselves.
  return { legalName: facts.legalName, cif: facts.registrationNumber ? bareRegistrationNumber(facts.registrationNumber) : null };
}

export default async function ClubIdentity(props: Props) {
  const t = await getTranslations("Identity");
  const identity = shownIdentity();

  if (props.shape === "line") {
    if (!identity) return null;
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="club-identity-line"
        sx={{ mt: { xs: 3, sm: 4 }, overflowWrap: "anywhere" }}
      >
        {identity.cif
          ? t("line", { legalName: identity.legalName, club: CLUB_NAME, cif: identity.cif })
          : t("lineNoCif", { legalName: identity.legalName, club: CLUB_NAME })}
      </Typography>
    );
  }

  const locale = (await getLocale()) as Locale;
  const [social, addresses, phone] = await Promise.all([
    props.social ? Promise.resolve(props.social) : clubSocialLinks(),
    cachedShownContactAddresses(),
    cachedPublicPhone(),
  ]);

  // One contact line: its glyph, then its words; a thumb's 44 pixels tall, as wide as its words.
  const contactLinkSx = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.75,
    minHeight: 44,
    color: "text.secondary",
    overflowWrap: "anywhere",
    "& svg": { fontSize: 18, flexShrink: 0 },
  } as const;

  return (
    <Box
      component="section"
      aria-label={t("blockLabel")}
      data-testid="club-identity-block"
      sx={{ bgcolor: "background.paper", borderTop: 1, borderColor: "divider", fontSize: "0.8125rem" }}
    >
      <Container
        maxWidth={PAGE_WIDTH}
        sx={{
          display: "grid",
          // Stacked on a phone; three columns from `sm`, each in its own place, so a missing one
          // leaves its column empty rather than moving the others (§565).
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(3, minmax(0, 1fr))" },
          columnGap: 3,
          rowGap: 1.5,
          py: { xs: 2, sm: 3 },
          alignItems: "start",
        }}
      >
        {identity && (
          <Box data-testid="club-identity-name" sx={{ gridColumn: { sm: 1 }, gridRow: { sm: 1 }, minWidth: 0 }}>
            {/* The site's heading face, at the block's size: a fact, not a section, so a paragraph. */}
            <Typography variant="h2" component="p" sx={{ fontSize: "1rem", fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {identity.legalName}{" "}
              <Box component="span" sx={{ fontWeight: 400, color: "text.secondary" }}>
                ({CLUB_NAME})
              </Box>
            </Typography>
            {identity.cif && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.25 }}>
                {t("cif", { cif: identity.cif })}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem" }}>
              {t("country")}
            </Typography>
          </Box>
        )}

        {social.length > 0 && (
          <Box
            component="ul"
            aria-label={t("socialLabel")}
            data-testid="club-identity-social"
            sx={{
              gridColumn: { sm: 2 },
              gridRow: { sm: 1 },
              listStyle: "none",
              m: 0,
              p: 0,
              display: "flex",
              justifyContent: { xs: "flex-start", sm: "center" },
              gap: 1,
            }}
          >
            {social.map((entry) => (
              <li key={entry.href}>
                <MuiLink
                  href={entry.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={entry.label}
                  title={entry.label}
                  sx={{ width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
                >
                  <SocialIcon network={entry.network} size={22} />
                </MuiLink>
              </li>
            ))}
          </Box>
        )}

        <Box data-testid="club-identity-contact" sx={{ gridColumn: { sm: 3 }, gridRow: { sm: 1 }, minWidth: 0 }}>
          {/* A paragraph styled as a heading, like the legal name's column: the block ends every
              page, the backoffice's too, and a «Contact» section in each page's outline would be noise. */}
          <Typography component="p" variant="h2" sx={{ fontSize: "1rem", fontWeight: 600, lineHeight: 1.35 }}>
            {t("contactHeading")}
          </Typography>
          {/* One wrapping row on a phone, as many to a line as fit; one per line from `sm`. */}
          <Box sx={{ display: "flex", flexDirection: { xs: "row", sm: "column" }, flexWrap: "wrap", alignItems: "flex-start", columnGap: 2 }}>
            {addresses.map((address) => (
              <MuiLink key={address} href={`mailto:${address}`} sx={contactLinkSx} data-testid="club-identity-email">
                <MailOutlinedIcon aria-hidden />
                {address}
              </MuiLink>
            ))}
            {phone && (
              <MuiLink href={telHref(phone)} sx={contactLinkSx} data-testid="club-identity-phone">
                <PhoneOutlinedIcon aria-hidden />
                {phone}
              </MuiLink>
            )}
            {/* A plain address, never a component reference into MUI's client link (§370): no
                prefetch either, and the form is rendered per request (§549). */}
            <MuiLink href={getPathname({ locale, href: "/contact" })} sx={contactLinkSx} data-testid="club-identity-write">
              <EditNoteIcon aria-hidden />
              {t("writeToUs")}
            </MuiLink>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
