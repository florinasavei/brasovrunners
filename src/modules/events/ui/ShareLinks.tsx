import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import LinkIcon from "@mui/icons-material/Link";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DENSITY } from "@/theme/density";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import SocialIcon from "@/shared/ui/SocialIcon";
import CalendarAddress from "./CalendarAddress";
import { facebookShareUrl, whatsappShareUrl } from "../share-links";
import InstagramShareButton from "./InstagramShareButton";
import NativeShareButton from "./NativeShareButton";
import { SHARE_ICON_SX, SHARE_PILL_SX } from "./share-pill";

/**
 * Share this event (`DECISIONS.md` §90, §140): the phone's own share sheet where there is
 * one, then Facebook and WhatsApp, which take the link and show the card drawn by
 * `opengraph-image.tsx`; Instagram takes no link, so its button hands the same card as a
 * square picture to the share sheet where a phone can take one, and offers it as a download
 * everywhere else (`InstagramShareButton`). Beside them, "add to calendar" (§107): Google's
 * own add-event address and the `.ics`.
 *
 * The network buttons are anchors rendered here, on the server, with the event's absolute
 * address built from `APP_BASE_URL` (`../share-links.ts`): a plain `<a target="_blank">` is
 * what every browser opens on a tap, where iOS Safari refuses a popup opened by script.
 * Buttons rather than a line of text links (the owner: "share should look nicer"); the icons
 * are children, never a prop across the boundary (`AGENTS.md` §14.1).
 */
type Props = {
  /** The event's own absolute address (`eventPageUrl`) — never a path, never the site's root. */
  url: string;
  title: string;
  /** The square card, as a path on this site. */
  imageHref: string;
  /** What the card is called when it is shared or saved. */
  fileName: string;
  /**
   * "Add to calendar" (§107). `fileAddress` is the `.ics`'s absolute address, drawn in a fold under
   * the row to copy (§674) — absent on a members' event, whose file opens with a session only.
   */
  calendar?: { icsHref: string; googleUrl: string; fileAddress?: string };
  /**
   * False on an event for the members alone (§552): its link opens for a member only, and its
   * share pictures answer 404 — so no Facebook, WhatsApp or Instagram button, the calendar kept.
   */
  shareable?: boolean;
};

export default async function ShareLinks({ url, title, imageHref, fileName, calendar, shareable = true }: Props) {
  const t = await getTranslations("Event");
  const anchor = (href: string, label: string, icon: ReactNode, download = false) => (
    <Button
      component="a"
      href={href}
      target={download ? undefined : "_blank"}
      rel={download ? undefined : "noopener noreferrer"}
      download={download ? true : undefined}
      variant="outlined"
      size="small"
      sx={SHARE_PILL_SX}
    >
      {icon}
      {label}
    </Button>
  );
  const caption = (text: string) => (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ minHeight: { xs: 44, sm: 32 }, display: "inline-flex", alignItems: "center", mr: 0.5 }}
    >
      {text}
    </Typography>
  );
  return (
    <Stack spacing={0.5}>
      {shareable && (
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: { xs: DENSITY.gapXs, sm: 1 } }}>
        {caption(t("share.title"))}
        <NativeShareButton url={url} title={title} text={title} label={t("share.native")} />
        {anchor(facebookShareUrl(url), t("share.facebook"), <SocialIcon network="facebook" size={20} />)}
        {anchor(whatsappShareUrl(title, url), t("share.whatsapp"), <WhatsAppIcon sx={SHARE_ICON_SX} aria-hidden="true" />)}
        <InstagramShareButton
          imageHref={imageHref}
          fileName={fileName}
          title={title}
          url={url}
          shareLabel={t("share.instagram")}
          downloadLabel={t("share.instagramDownload")}
        >
          <SocialIcon network="instagram" size={20} />
        </InstagramShareButton>
      </Stack>
      )}
      {calendar && (
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: { xs: DENSITY.gapXs, sm: 1 } }}>
          {caption(t("share.calendarTitle"))}
          {anchor(calendar.googleUrl, t("share.googleCalendar"), <EventAvailableIcon sx={SHARE_ICON_SX} aria-hidden="true" />)}
          {anchor(calendar.icsHref, t("share.ics"), <EventAvailableIcon sx={SHARE_ICON_SX} aria-hidden="true" />, true)}
        </Stack>
      )}
      {calendar && (
        /* The file is a copy of today (§674): said once, in the open, under the row. */
        <Typography variant="caption" color="text.secondary" component="p" data-testid="event-calendar-snapshot">
          {t("share.fileSnapshot")}
        </Typography>
      )}
      {/*
        The file's address, to copy (§674): a fold, closed, so the row stays one row. Google Calendar
        on the web takes it by «Din URL»; and a person who deleted the event in Google learns why
        the file will not add it again for 30 days (Google keeps the deleted entry, by its UID, in
        the calendar's Bin — the UID is the event's on purpose, §107, §174).
      */}
      {calendar?.fileAddress && (
        <Box component="details" data-testid="event-calendar-address" sx={{ ...DISCLOSURE_SX, "& > summary": { ...DISCLOSURE_SUMMARY_SX, fontSize: "0.8125rem", color: "text.secondary" } }}>
          <summary>
            <LinkIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("share.fileAddress")}
          </summary>
          <CalendarAddress
            id="event-calendar-file-address"
            address={calendar.fileAddress}
            label={t("share.fileAddressLabel")}
            copyLabel={t("share.copy")}
            copiedLabel={t("share.copied")}
            hints={[t("share.binHint")]}
          />
        </Box>
      )}
    </Stack>
  );
}
