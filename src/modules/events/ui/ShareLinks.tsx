import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";
import NativeShareButton from "./NativeShareButton";

/**
 * Share this event (`DECISIONS.md` §90, §140): the phone's own share sheet where there is
 * one, then Facebook and WhatsApp, which take the link and show the card drawn by
 * `opengraph-image.tsx`; Instagram takes no link, so its button is the same card as a
 * square picture to save and post. Beside them, "add to calendar" (§107): Google's own
 * add-event address and the `.ics`. Buttons rather than a line of text links (the owner:
 * "share should look nicer"); the icons are children, never a prop across the boundary
 * (`AGENTS.md` §14.1).
 */
type Props = {
  url: string;
  title: string;
  imageHref: string;
  calendar?: { icsHref: string; googleUrl: string };
};

export default async function ShareLinks({ url, title, imageHref, calendar }: Props) {
  const t = await getTranslations("Event");
  const button = (href: string, label: string, icon: ReactNode, download = false) => (
    <Button
      component="a"
      href={href}
      target={download ? undefined : "_blank"}
      rel={download ? undefined : "noopener noreferrer"}
      download={download ? true : undefined}
      variant="outlined"
      size="small"
      sx={{ minHeight: 44, gap: 0.75, borderRadius: 22, px: 1.5 }}
    >
      {icon}
      {label}
    </Button>
  );
  const label = (text: string) => (
    <Typography variant="body2" color="text.secondary" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center", mr: 0.5 }}>
      {text}
    </Typography>
  );
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        {label(t("share.title"))}
        <NativeShareButton url={url} title={title} text={title} label={t("share.native")} />
        {button(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, t("share.facebook"), <SocialIcon network="facebook" size={20} />)}
        {button(`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`, t("share.whatsapp"), <WhatsAppIcon sx={{ fontSize: 20 }} aria-hidden="true" />)}
        {button(imageHref, t("share.instagram"), <SocialIcon network="instagram" size={20} />, true)}
      </Stack>
      {calendar && (
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
          {label(t("share.calendarTitle"))}
          {button(calendar.googleUrl, t("share.googleCalendar"), <EventAvailableIcon sx={{ fontSize: 20 }} aria-hidden="true" />)}
          {button(calendar.icsHref, t("share.ics"), <EventAvailableIcon sx={{ fontSize: 20 }} aria-hidden="true" />, true)}
        </Stack>
      )}
    </Stack>
  );
}
