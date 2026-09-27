import Box from "@mui/material/Box";
import { publicInstagramUrl, publicStravaUrl } from "@/modules/registrations/social-links";
import SocialIcon, { type SocialNetwork } from "@/shared/ui/SocialIcon";

/**
 * A listed runner's Strava and Instagram beside their name on the public list (§NNN): the
 * networks' own marks (`SocialIcon`, the footer's and «Echipa»'s), each a link to the profile.
 *
 * Only what the query returned — and it returns them only behind the notice's gate and the
 * runner's own tick (`registrations/repository.ts#publicSocialColumns`) — and only a value that
 * is still one of the network's own addresses (`social-links.ts`). Nothing to print, nothing drawn.
 *
 * Each mark is a 44-pixel target (BR-REQ-041-01 criterion 6) whose negative vertical margin eats
 * the cell's own padding, so a row with socials is no taller than the target itself. The link's
 * accessible name is the given label — "Ana Pop pe Strava" — and the mark is decorative. A
 * profile is somebody else's page the club does not vouch for: `nofollow ugc`, a new tab, no referrer.
 * Server-rendered, no JavaScript; the labels come from the caller, which has the page's translator.
 */
export default function StartListSocials({
  stravaUrl,
  instagramHandle,
  stravaLabel,
  instagramLabel,
}: {
  stravaUrl?: string | null;
  instagramHandle?: string | null;
  stravaLabel: string;
  instagramLabel: string;
}) {
  const links: Array<{ network: SocialNetwork; href: string; label: string }> = [];
  const strava = publicStravaUrl(stravaUrl);
  const instagram = publicInstagramUrl(instagramHandle);
  if (strava) links.push({ network: "strava", href: strava, label: stravaLabel });
  if (instagram) links.push({ network: "instagram", href: instagram, label: instagramLabel });
  if (links.length === 0) return null;

  return (
    <Box component="span" data-testid="start-list-socials" sx={{ display: "inline-flex", verticalAlign: "middle", ml: 0.5 }}>
      {links.map((link) => (
        <Box
          key={link.network}
          component="a"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          aria-label={link.label}
          title={link.label}
          data-network={link.network}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            my: -1,
            borderRadius: 1,
          }}
        >
          <SocialIcon network={link.network} size={18} />
        </Box>
      ))}
    </Box>
  );
}
