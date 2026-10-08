import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { webcalUrl } from "@/modules/events/ical";
import CalendarAddress from "@/modules/events/ui/CalendarAddress";

/**
 * The two doors into a reader's own calendar (§107, §139), built exactly as `CalendarSection` builds
 * them, and the plain `https://` address behind both, to copy (§674).
 */
export function calendarFeedLinks(baseUrl: string, locale: string): { google: string; webcal: string; feed: string } {
  const feed = `${baseUrl}/${locale}/events/calendar.ics`;
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(feed))}`,
    webcal: webcalUrl(feed),
    feed,
  };
}

/**
 * The words under the feed's address (§674), in order: why Google's button may do nothing, the way
 * that always works, and the phone app's limit. One list for both places that draw the address.
 */
export function feedAddressHints(
  t: (key: "calendar.googleHintWhy" | "calendar.googleHintHow" | "calendar.phoneAppHint" | "calendar.androidSync") => string,
): string[] {
  // The Android step last (the owner, 2026-10-08: «It just says that calendar was added successfully but I can't see it»).
  return [t("calendar.googleHintWhy"), t("calendar.googleHintHow"), t("calendar.phoneAppHint"), t("calendar.androidSync")];
}

const LINK_SX = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.75,
  minHeight: 44,
  fontSize: "0.875rem",
} as const;

/**
 * The calendar page's «?» on a phone (§487): the intro sentence under the heading moved into a
 * fold beside the H1, so the month starts a paragraph higher. A native `<details>`, rendered on
 * the server — it opens with scripts off, and it holds what a tooltip cannot: the two links the
 * sentence promises (Google Calendar's add link and the `webcal://` feed, §107), so "you can
 * take the calendar into your phone" is one press from the head — and, since §674, the feed's
 * address to copy, with what to do when Google says it already has it. The summary is a small muted
 * glyph with a 44-pixel target and a name of its own (BR-REQ-041-01 criterion 6); the body opens
 * as a panel under the heading row, anchored to it, so the heading does not move.
 *
 * The page draws it below `sm` only; from `sm` the sentence stands under the heading as before
 * and the "Adaugă în calendarul tău" row further down keeps the same links — never both heads.
 */
export default async function CalendarIntroFold({ locale, baseUrl }: { locale: string; baseUrl: string }) {
  const t = await getTranslations("Events");
  const links = calendarFeedLinks(baseUrl, locale);

  return (
    <Box
      component="details"
      data-testid="calendar-intro-help"
      sx={{
        "& > summary": {
          listStyle: "none",
          "&::-webkit-details-marker": { display: "none" },
          "&::marker": { content: '""' },
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 44,
          minHeight: 44,
          color: "text.secondary",
          borderRadius: 1,
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
        },
        "&[open] > summary": { color: "primary.main" },
      }}
    >
      <summary aria-label={t("calendar.introHelp")}>
        <HelpOutlineIcon aria-hidden="true" sx={{ fontSize: 20 }} />
      </summary>
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "100%",
          zIndex: 2,
          p: 1.5,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          boxShadow: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t("calendar.pageIntro")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2 }}>
          <Box component="a" href={links.google} target="_blank" rel="noopener noreferrer" sx={LINK_SX}>
            <EventAvailableIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeGoogle")}
          </Box>
          <Box component="a" href={links.webcal} sx={LINK_SX}>
            <CalendarMonthIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeApple")}
          </Box>
        </Box>
        {/* Under the two doors, the address itself (§674): for when Google's button does nothing. */}
        <CalendarAddress
          id="calendar-feed-address-head"
          address={links.feed}
          label={t("calendar.addressLabel")}
          copyLabel={t("calendar.copy")}
          copiedLabel={t("calendar.copied")}
          hints={feedAddressHints(t)}
        />
      </Box>
    </Box>
  );
}
