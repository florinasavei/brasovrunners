import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import { CLUB_NAME } from "@/theme/brand";
import { UNDER_LOOK } from "@/theme/look";
import type { ClubSocialLink } from "./club-socials";
import SocialIcon from "./SocialIcon";
import type { SocialNetwork } from "./SocialIcon";

/**
 * The header's order of the club's profiles (§722): the owner's, «Insta, Facebook, Strava» — not the
 * footer's, which keeps its own. A network the environment leaves unset is simply not drawn.
 */
export const HEADER_SOCIAL_ORDER: readonly SocialNetwork[] = ["instagram", "facebook", "strava"];

/** The `Site` catalogue's translator, as far as the header's marks need it: a key and the club's name. */
type Words = (key: string, values?: Record<string, string>) => string;

/**
 * The links in the header's order, the networks it does not name left out, each named by whose profile it
 * is and where: «{club} pe Instagram» / "{club} on Instagram" (`Site.followOn`, the club's name from
 * `CLUB_NAME`, §369). A mark met on its own — a screen reader going from link to link — then says both,
 * which the group's «Urmărește-ne» does not repeat on each one. The footer's marks stay the network alone,
 * under their own group's name (`clubSocialLinks`).
 */
export function headerSocials(links: readonly ClubSocialLink[], site: Words): ClubSocialLink[] {
  return HEADER_SOCIAL_ORDER.flatMap((network) =>
    links.filter((entry) => entry.network === network).map((entry) => ({ ...entry, label: site(`followOn.${network}`, { club: CLUB_NAME }) })),
  );
}

/**
 * «Urmărește-ne» / "Follow us" and the club's Instagram, Facebook and Strava, at the top right of the
 * header under «Aspectul nou» (§722, amending §708). The owner, 2026-10-11, with a screenshot of the
 * new-look header: «on the desktop version, the social media button must be in the top right with an
 * indicator saying "Follow us" and these 3 buttons: Insta, Facebook, Strava». The links come from the
 * one list the footer reads (`clubSocialLinks`, §565) — never a second list — in the header's order
 * (`headerSocials`).
 *
 * The header draws it as the row's last item, after the nav (and its ☰, when a section folds): under
 * the look the language left the header for the floating button, so the far right is free. The words
 * are the group's indicator, not a link; the group is a navigation named by the same words, which a
 * screen reader hears once (the visible copy is hidden from it). Each mark is a 44-pixel target
 * (BR-REQ-041-01 criterion 6) whose accessible name is «{club} pe {network}» (`headerSocials`), the
 * mark decoration; off-site, so a new tab and `rel`, as in the footer.
 *
 * Drawn from `md` up (the desktop): on a phone and a small tablet the footer's bar already carries the
 * marks and the header keeps its one row (§569). Inside the new look's scope only, so the backoffice —
 * which shares this header — never shows it.
 */
export default function HeaderSocials({ links, label }: { links: readonly ClubSocialLink[]; label: string }) {
  if (links.length === 0) return null;
  return (
    <Box
      component="nav"
      aria-label={label}
      data-testid="header-socials"
      sx={{ flexShrink: 0, alignItems: "center", gap: 0.5, display: "none", [UNDER_LOOK]: { display: { xs: "none", md: "flex" } } }}
    >
      <Box
        component="span"
        aria-hidden="true"
        data-testid="header-socials-label"
        sx={{ color: "text.secondary", fontSize: "0.8125rem", fontWeight: 600, whiteSpace: "nowrap", mr: 0.25 }}
      >
        {label}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        {links.map((entry) => (
          <MuiLink
            key={entry.href}
            href={entry.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={entry.label}
            title={entry.label}
            data-network={entry.network}
            sx={{
              width: 44,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <SocialIcon network={entry.network} size={20} />
          </MuiLink>
        ))}
      </Box>
    </Box>
  );
}
