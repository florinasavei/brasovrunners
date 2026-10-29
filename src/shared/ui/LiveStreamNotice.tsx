import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { cachedLiveStream } from "@/modules/public-cache/reads";
import { PAGE_WIDTH } from "@/theme/brand";
import { TAP_TARGET } from "./tap-target";

/**
 * «Suntem în direct» (§NNN; the owner, 2026-10-29: «I want on the website a notification that we
 * are live streaming»): one slim bar under the site header on every page while the club's setting
 * («Setări» → «Aspect» → «În direct pe YouTube») is on — a red dot, one sentence, and the one link
 * to the broadcast on YouTube. Off, nothing is drawn, and the header is byte for byte what it was.
 *
 * A Server Component, no client code: the setting comes from the public cache (§333), so the bar
 * costs a visitor nothing beyond the header's own reads, and it loads nothing from YouTube — the
 * link is a plain anchor the visitor presses (the privacy notice describes YouTube as loaded only
 * on a press, §69). In the flow, under the sticky header, like the new-build notice (§210): a bar
 * that travelled with the header would cover a field on a phone.
 *
 * Drawn in the backoffice too, deliberately: the person who switched it on sees from any screen
 * that the site still says the club is live, and switches it off when the broadcast ends.
 */
export default async function LiveStreamNotice() {
  const live = await cachedLiveStream();
  if (!live.on || !live.url) return null;
  const site = await getTranslations("Site");

  return (
    <Box component="aside" aria-label={site("live.label")} data-testid="live-stream-notice" sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }}>
      <Container maxWidth={PAGE_WIDTH} sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.5, rowGap: 0, py: 0.25, ...TAP_TARGET }}>
        <Box
          component="span"
          aria-hidden="true"
          sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main", flexShrink: 0 }}
        />
        <Typography component="p" variant="body2" sx={{ fontWeight: 600, my: 0 }}>
          {site("live.body")}
        </Typography>
        <MuiLink href={live.url} variant="body2" underline="always" sx={{ display: "inline-flex", alignItems: "center", fontWeight: 600, ...TAP_TARGET }} data-testid="live-stream-link">
          {site("live.watch")}
        </MuiLink>
      </Container>
    </Box>
  );
}
