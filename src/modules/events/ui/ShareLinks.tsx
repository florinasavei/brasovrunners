import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";
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
  calendar?: { icsHref: string; googleUrl: string };
};

export default async function ShareLinks({ url, title, imageHref, fileName, calendar }: Props) {
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
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
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
      {calendar && (
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
          {caption(t("share.calendarTitle"))}
          {anchor(calendar.googleUrl, t("share.googleCalendar"), <EventAvailableIcon sx={SHARE_ICON_SX} aria-hidden="true" />)}
          {anchor(calendar.icsHref, t("share.ics"), <EventAvailableIcon sx={SHARE_ICON_SX} aria-hidden="true" />, true)}
        </Stack>
      )}
    </Stack>
  );
}
