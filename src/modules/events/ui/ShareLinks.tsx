import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";

/**
 * Share this event (`DECISIONS.md` §90): Facebook and WhatsApp take the link and show the
 * card drawn by `opengraph-image.tsx`; Instagram takes no link, so the third item is the same
 * card as a square picture to save and post. Three plain links, no script — the networks'
 * own share addresses, which need nothing loaded from them.
 */
type Props = {
  url: string;
  title: string;
  imageHref: string;
  /** "Add to calendar" (§107): the `.ics` to download and Google's own add-event address. */
  calendar?: { icsHref: string; googleUrl: string };
};

export default async function ShareLinks({ url, title, imageHref, calendar }: Props) {
  const t = await getTranslations("Event");
  const link = (href: string, label: string, icon: ReactNode, download = false) => (
    <Link
      href={href}
      target={download ? undefined : "_blank"}
      rel={download ? undefined : "noopener noreferrer"}
      download={download ? true : undefined}
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44 }}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", alignItems: "center", rowGap: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
        {t("share.title")}
      </Typography>
      {link(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        t("share.facebook"),
        <SocialIcon network="facebook" size={20} />,
      )}
      {link(
        `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
        t("share.whatsapp"),
        <WhatsAppIcon sx={{ fontSize: 20, color: "#25D366" }} aria-hidden="true" />,
      )}
      {link(imageHref, t("share.instagram"), <SocialIcon network="instagram" size={20} />, true)}
      {calendar && link(calendar.googleUrl, t("share.googleCalendar"), <EventAvailableIcon sx={{ fontSize: 20 }} aria-hidden="true" />)}
      {calendar && link(calendar.icsHref, t("share.ics"), <EventAvailableIcon sx={{ fontSize: 20 }} aria-hidden="true" />, true)}
    </Stack>
  );
}
