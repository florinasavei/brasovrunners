import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { type ClubIdentityPlace, showsAt } from "@/modules/contact/domain/club-identity";
import { bareRegistrationNumber, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { cachedClubIdentityShown, cachedShownContactAddresses } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { UNDER_LOOK } from "@/theme/look";

/**
 * The club's legal identity on the site (§565; the owner, 2026-09-29: «on the about pages and
 * contact pages we need to show "<the club's legal name> (<the site's name>) CIF <the CIF>" in order to
 * meet legal requirements», then «and also in the footer, more clearly»).
 *
 * **Composed, never typed.** The legal name and the CIF are the same two variables the legal texts
 * are filled with (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, read through `clubFactsFromEnv`,
 * §132), the name in brackets is the platform's one constant (`CLUB_NAME`, §215, §369), and the
 * repository — public — carries none of the values. Unset (CI, a fresh checkout, the e2e run), the
 * identity renders nothing, in any place.
 *
 * **Where each line shows is the club's choice** (§890): «Ce arată site-ul despre asociație» on
 * «Pagini» → «Contact» ticks, for each of three lines — «<legal name> (<site name>) · CIF <CIF>»,
 * «Sediul: <seat>» and «Email: <address>» (the address the club shows for contact, §442) — the places
 * it appears in. The seat is the address typed in the same card («Adresa afișată pe site»: street and
 * number, town, county), never `CLUB_REGISTERED_ADDRESS`, which carries the building, the staircase
 * and the flat for the legal texts; an empty box is no seat line anywhere. The caller names its
 * place; a line shows where its box is ticked and its value is set. Nothing stored, the name and the
 * CIF everywhere and the seat and the email nowhere: a club's seat is often a person's home, and the
 * owner would not have it forced onto the home page (Google for Nonprofits asks for both on the
 * site; the club ticks where).
 *
 * The places, and the shape each one draws:
 *
 * - `home` (the listing, the site's home page), `contact`, `pages` (the club's standing pages and
 *   «Echipa») — a secondary paragraph at the end of the page, with the room above it that ends one.
 * - `footer` — inside the footer's «Despre club, contact și termeni» fold, after its links, never a
 *   block of its own (§582, amending §565; the owner, 2026-09-29: «ai duplicat footerul, arată
 *   oribil!! partea asta trebuie să fie în footerul colapsat!»), at the panel's own size and colour,
 *   with no margin of its own.
 *
 * The ticks come from the public cache, so no visitor wakes the database for them. A Server
 * Component, no island.
 */
type Props = { place: ClubIdentityPlace };

/** The legal facts the site may show, or null while the legal name is unset. */
function shownIdentity(): { legalName: string; cif: string | null } | null {
  const facts = clubFactsFromEnv(env);
  if (!facts.legalName) return null;
  // The variable may carry its own label («CIF …», as the legal texts read it after a comma);
  // the line writes the label itself.
  return { legalName: facts.legalName, cif: facts.registrationNumber ? bareRegistrationNumber(facts.registrationNumber) : null };
}

export default async function ClubIdentity({ place }: Props) {
  const identity = shownIdentity();
  if (!identity) return null;
  const shown = await cachedClubIdentityShown();
  const t = await getTranslations("Identity");

  const name = showsAt(shown, "name", place)
    ? identity.cif
      ? t("line", { legalName: identity.legalName, club: CLUB_NAME, cif: identity.cif })
      : t("lineNoCif", { legalName: identity.legalName, club: CLUB_NAME })
    : null;
  // The address the club typed for the site, never `CLUB_REGISTERED_ADDRESS` (its building, staircase and flat).
  const seat = showsAt(shown, "seat", place) && shown.seatAddress ? t("seat", { address: shown.seatAddress }) : null;
  const emails = showsAt(shown, "email", place) ? await cachedShownContactAddresses() : [];
  const email = emails.length > 0 ? t("email", { email: emails.join(", ") }) : null;
  if (!name && !seat && !email) return null;

  // Each line its own: the name as the element's own words when it is alone, as it always was.
  const lines = (
    <>
      {name && !seat && !email ? name : name && <Box component="span" sx={{ display: "block" }}>{name}</Box>}
      {seat && (
        <Box component="span" data-testid="club-identity-seat" sx={{ display: "block" }}>
          {seat}
        </Box>
      )}
      {email && (
        <Box component="span" data-testid="club-identity-email" sx={{ display: "block" }}>
          {email}
        </Box>
      )}
    </>
  );

  if (place === "footer") {
    // The panel's words (14 pixels, its colour); its own line from `sm`, where the panel is a
    // wrapping row, so the name never sits between two links.
    return (
      <Box
        component="span"
        data-testid="footer-club-identity"
        sx={{ display: "block", flexBasis: { sm: "100%" }, color: "text.secondary", overflowWrap: "anywhere", minWidth: 0, maxWidth: "100%" }}
      >
        {lines}
      </Box>
    );
  }

  return (
    <Typography
      variant="body2"
      color="text.secondary"
      data-testid="club-identity-line"
      // Under the look, the page's bottom padding and the watermark's top room are pulled up under the
      // lines, so they sit near the mountain mark and the footer (the owner: «vreau mai putin spatiu jos»).
      sx={{ mt: { xs: 3, sm: 4 }, overflowWrap: "anywhere", [UNDER_LOOK]: { mb: { xs: -3, sm: -4.5 } } }}
    >
      {lines}
    </Typography>
  );
}
