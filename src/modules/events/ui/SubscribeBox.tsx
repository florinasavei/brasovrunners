import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import DownloadIcon from "@mui/icons-material/Download";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import CalendarAddress from "@/modules/events/ui/CalendarAddress";
import { webcalUrl } from "@/modules/events/ical";
import { calendarFeedLinks } from "@/modules/events/ui/CalendarIntroFold";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { CLUB_NAME } from "@/theme/brand";
import { LOOK_ACCENT_TINT, UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";

/**
 * Outlook on the web's "subscribe from web" window with the feed filled in (§720 amended; the
 * facelift's phase 4: a separate Outlook row, now one per kind of account). A personal account
 * (outlook.com, hotmail, live) is on outlook.live.com, a work or school one (Microsoft 365) on
 * outlook.office.com. The format — the slash after `addfromweb` and the feed as `webcal://` — is the
 * one the add-to-calendar-button library sends (`src/generators/outlook.ts`, `subscribe_microsoft`;
 * its index turns `https://` into `webcal://` first). Microsoft documents no such link and
 * outlook.com refuses automated requests (HTTP 417), so no test can open it: the unit test pins the
 * format. Both hosts are in `PROVIDER_HOSTS` (`scripts/docs-check.mjs`): Microsoft's, fixed, nothing
 * loaded from them.
 */
export function outlookSubscribeUrl(feed: string, account: "personal" | "work", name: string = CLUB_NAME): string {
  const host = account === "work" ? "outlook.office.com" : "outlook.live.com";
  return `https://${host}/calendar/0/addfromweb/?url=${encodeURIComponent(webcalUrl(feed))}&name=${encodeURIComponent(name)}`;
}

export type SubscribeBoxProps = {
  locale: string;
  /** `APP_BASE_URL`: every address the box carries derives from it (AGENTS.md §8). */
  baseUrl: string;
  /** The feed address box's `id`, unique on the page (`CalendarAddress` selects it when the clipboard is refused). */
  addressId?: string;
};

/** One row: a 44-pixel link on a card, the glyph before the words. */
const ROW_SX = {
  display: "flex",
  alignItems: "center",
  gap: 1.25,
  minHeight: 44,
  px: 1.5,
  border: 1,
  borderColor: "divider",
  borderRadius: "12px",
  bgcolor: "background.paper",
  color: "text.primary",
  textDecoration: "none",
  fontSize: "0.9375rem",
  fontWeight: 500,
  "& > svg": { fontSize: 20, color: "text.secondary", flexShrink: 0 },
  "&:hover": { borderColor: "text.secondary" },
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/**
 * «Vrei să nu ratezi alergările?» — the calendar's subscribe box under «Aspectul nou» (the
 * facelift's phase 4). The same doors as today's «Adaugă în calendarul tău» row (§107, §139, §674),
 * each a row of its own: Google Calendar's add link, Apple's `webcal://`, Outlook's own add link
 * for a personal and for a work or school account (§720 amended; today's one «Apple / Outlook» button is a `webcal://` that a browser on a PC hands to no
 * one), the `.ics` file, and the feed's address to copy in a fold, with the sentences that say when
 * a person needs it. Every address from `calendarFeedLinks`, so the box and the page head's «?»
 * never differ.
 *
 * The page draws it only under the look, where today's row is hidden (`OFF_UNDER_LOOK`); a Server
 * Component with typed props, the one island inside is the address's «Copiază» (strings only).
 */
export default async function SubscribeBox({ locale, baseUrl, addressId = "calendar-feed-address-box" }: SubscribeBoxProps) {
  const t = await getTranslations("Events");
  const links = calendarFeedLinks(baseUrl, locale);

  return (
    <Box
      component="section"
      aria-labelledby="calendar-subscribe-title"
      data-testid="calendar-subscribe"
      sx={{
        p: 2,
        borderRadius: "16px",
        border: 1,
        borderColor: "divider",
        // By day the accent's pale band — the club's accent, through the layout's variable.
        [UNDER_LOOK]: { bgcolor: LOOK_ACCENT_TINT, borderColor: "transparent" },
        // After dark a quiet card on the page, the mock-up's: the accent's deep band would outweigh the month beside it.
        [UNDER_LOOK_DARK]: { bgcolor: "background.paper", borderColor: "divider" },
      }}
    >
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", mb: 1.5 }}>
        <EventRepeatIcon aria-hidden="true" sx={{ fontSize: 32, color: "primary.main", flexShrink: 0 }} />
        <Box>
          <Typography id="calendar-subscribe-title" component="h2" variant="h3" sx={{ fontSize: "1.0625rem", fontWeight: 700, m: 0 }}>
            {t("calendar.look.subscribe.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {t("calendar.look.subscribe.intro", { club: CLUB_NAME })}
          </Typography>
        </Box>
      </Box>
      <Box component="ul" aria-label={t("calendar.look.subscribe.rows")} sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
        <li>
          <Box component="a" href={links.google} target="_blank" rel="noopener noreferrer" sx={ROW_SX} data-testid="subscribe-google">
            <EventAvailableIcon aria-hidden="true" />
            {t("calendar.look.subscribe.google")}
          </Box>
        </li>
        <li>
          <Box component="a" href={links.webcal} sx={ROW_SX} data-testid="subscribe-apple">
            <CalendarMonthIcon aria-hidden="true" />
            {t("calendar.look.subscribe.apple")}
          </Box>
        </li>
        <li>
          <Box component="a" href={outlookSubscribeUrl(links.feed, "personal")} target="_blank" rel="noopener noreferrer" sx={ROW_SX} data-testid="subscribe-outlook">
            <CalendarTodayIcon aria-hidden="true" />
            {t("calendar.look.subscribe.outlook")}
          </Box>
        </li>
        <li>
          <Box component="a" href={outlookSubscribeUrl(links.feed, "work")} target="_blank" rel="noopener noreferrer" sx={ROW_SX} data-testid="subscribe-outlook-work">
            <CalendarTodayIcon aria-hidden="true" />
            {t("calendar.look.subscribe.outlookWork")}
          </Box>
        </li>
        <li>
          <Box component="a" href={`/${locale}/events/calendar.ics`} sx={ROW_SX} data-testid="subscribe-ics">
            <DownloadIcon aria-hidden="true" />
            {t("calendar.look.subscribe.ics")}
          </Box>
        </li>
      </Box>
      {/* The address to copy (§674), folded: what Google's «Din URL» wants pasted when its button does nothing. */}
      <Box
        component="details"
        data-testid="subscribe-feed"
        sx={{ mt: 1, ...DISCLOSURE_SX, "& > summary": { ...DISCLOSURE_SUMMARY_SX, minHeight: 44, fontSize: "0.875rem", color: "text.secondary" } }}
      >
        <summary>
          <RssFeedIcon aria-hidden sx={FOLD_GLYPH_SX} />
          {t("calendar.look.subscribe.feed")}
        </summary>
        <CalendarAddress
          id={addressId}
          address={links.feed}
          label={t("calendar.addressLabel")}
          copyLabel={t("calendar.copy")}
          copiedLabel={t("calendar.copied")}
          hints={[
            t("calendar.look.subscribe.hintAuto"),
            t("calendar.googleHintWhy"),
            t("calendar.googleHintHow"),
            t("calendar.look.subscribe.hintPhone"),
            t("calendar.look.subscribe.hintOutlook"),
            t("calendar.androidSync"),
          ]}
        />
      </Box>
    </Box>
  );
}
