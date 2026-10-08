import RateReviewIcon from "@mui/icons-material/RateReview";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { contactSmtpRoadExists } from "@/modules/contact/delivery";
import { feedbackQueryFor, offeredBranches } from "@/modules/feedback/domain/branches";
import { eventDay } from "@/modules/feedback/links";
import { cachedFeedbackFormsDescribed, cachedFeedbackOffer } from "@/modules/public-cache/reads";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";

type EndedEvent = {
  slug: string;
  eventStatus: string;
  startsAt: Date | null;
  endsAt?: Date | null;
  timezone?: string | null;
};

/** Over: the club marked it completed, or — not cancelled — its end (its start, without one) has passed. */
export function eventHasEnded(event: EndedEvent, now: Date): boolean {
  if (event.eventStatus === "COMPLETED") return true;
  if (event.eventStatus === "CANCELLED" || !event.startsAt) return false;
  return (event.endsAt ?? event.startsAt).getTime() <= now.getTime();
}

/**
 * «Spune-ne cum a fost» on an event's page once it is over (§NNN): one button to the anonymous form
 * with the event and its day filled in, under the sentence that says the event is over — only while
 * «Cum a fost» is offered (switched on, a recipient, the notice in force describing the forms). A read
 * that cannot answer draws nothing (§281): the page stands without it.
 */
export default async function EventFeedbackButton({ event, locale, now }: { event: EndedEvent; locale: Locale; now: Date }) {
  if (!eventHasEnded(event, now)) return null;
  let open = false;
  try {
    const [offer, described] = await Promise.all([cachedFeedbackOffer(), cachedFeedbackFormsDescribed(now)]);
    open = offeredBranches(offer, described, contactSmtpRoadExists()).includes("howItWent");
  } catch {
    open = false;
  }
  if (!open) return null;
  const t = await getTranslations("Tell");
  const href = getPathname({
    locale,
    href: { pathname: "/contact/feedback", query: feedbackQueryFor(event.slug, eventDay(event.startsAt, event.timezone ?? CLUB_TIME_ZONE)) },
  });
  return (
    <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 2 }, mb: { xs: DENSITY.gapSm, sm: 3 } }} data-testid="event-feedback">
      <Typography variant="body1" sx={{ mb: 1 }}>
        {t("eventPage.lead")}
      </Typography>
      <Button component="a" href={href} variant="outlined" size="large" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
        <RateReviewIcon aria-hidden="true" sx={glyphSx("large")} />
        {t("eventPage.button")}
      </Button>
    </Box>
  );
}
