import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { bareRegistrationNumber, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";

/**
 * The club's legal identity on the site (§565; the owner, 2026-09-29: «on the about pages and
 * contact pages we need to show "<the club's legal name> (<the site's name>) CIF <the CIF>" in order to
 * meet legal requirements», then «and also in the footer, more clearly»).
 *
 * **Composed, never typed.** The legal name and the CIF are the same two variables the legal texts
 * are filled with (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, read through `clubFactsFromEnv`,
 * §132), the name in brackets is the platform's one constant (`CLUB_NAME`, §215, §369), and the
 * repository — public — carries none of the values. Unset (CI, a fresh checkout, the e2e run), the
 * identity renders nothing, in either shape.
 *
 * One line, «<legal name> (<site name>) · CIF <CIF>», in two places:
 *
 * - `line` — at the end of the «about» pages (the club's standing pages and «Echipa») and of the
 *   contact page: a secondary paragraph with the room above it that ends a page.
 * - `fold` — inside the footer's «Despre club, contact și termeni» fold, after its links, never a block of its own (§582,
 *   amending §565; the owner, 2026-09-29: «ai duplicat footerul, arată oribil!! partea asta trebuie
 *   să fie în footerul colapsat!»). §565 drew a block under the bar — the name, the marks again,
 *   «Contact» with the address and «Scrie-ne» again — which repeated the bar's marks and the fold's
 *   «Scrie-ne: <address>». The fold already holds the contact; the identity is its one new line, at
 *   the panel's own size and colour, with no margin of its own.
 *
 * The seat (`CLUB_REGISTERED_ADDRESS`) is not shown: it is a person's address on many a club's
 * certificate, and the owner asked for the name and the CIF. A Server Component, no island.
 */
type Props = { shape: "line" | "fold" };

/** The legal facts the site shows, or null while the legal name is unset. */
function shownIdentity(): { legalName: string; cif: string | null } | null {
  const facts = clubFactsFromEnv(env);
  if (!facts.legalName) return null;
  // The variable may carry its own label («CIF …», as the legal texts read it after a comma);
  // the line writes the label itself.
  return { legalName: facts.legalName, cif: facts.registrationNumber ? bareRegistrationNumber(facts.registrationNumber) : null };
}

export default async function ClubIdentity({ shape }: Props) {
  const identity = shownIdentity();
  if (!identity) return null;
  const t = await getTranslations("Identity");
  const words = identity.cif
    ? t("line", { legalName: identity.legalName, club: CLUB_NAME, cif: identity.cif })
    : t("lineNoCif", { legalName: identity.legalName, club: CLUB_NAME });

  if (shape === "fold") {
    // The panel's words (14 pixels, its colour); its own line from `sm`, where the panel is a
    // wrapping row, so the name never sits between two links.
    return (
      <Box
        component="span"
        data-testid="footer-club-identity"
        sx={{ display: "block", flexBasis: { sm: "100%" }, color: "text.secondary", overflowWrap: "anywhere", minWidth: 0, maxWidth: "100%" }}
      >
        {words}
      </Box>
    );
  }

  return (
    <Typography
      variant="body2"
      color="text.secondary"
      data-testid="club-identity-line"
      sx={{ mt: { xs: 3, sm: 4 }, overflowWrap: "anywhere" }}
    >
      {words}
    </Typography>
  );
}
