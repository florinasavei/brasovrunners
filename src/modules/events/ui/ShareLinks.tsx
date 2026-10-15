import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LinkIcon from "@mui/icons-material/Link";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import SocialIcon from "@/shared/ui/SocialIcon";
import CalendarAddress from "./CalendarAddress";
import { paletteWash } from "@/modules/feedback/ui/branch-glyph";
import { facebookShareUrl, whatsappShareUrl } from "../share-links";
import { CALENDAR_TARGET_NAMESPACE, CALENDAR_TARGETS, calendarTargetMark, type CalendarTarget } from "./calendar-targets";
import CalendarFoldClose from "./CalendarFoldClose";
import InstagramShareButton from "./InstagramShareButton";
import NativeShareButton from "./NativeShareButton";
import { CALENDAR_PILL_LEFT_VAR, DROPDOWN_PANEL_SURFACE_SX, SHARE_PILL_SX, SHARE_ROW_GAP } from "./share-pill";

/**
 * Share this event (`DECISIONS.md` §90, §140): the phone's own share sheet where there is
 * one, then Facebook and WhatsApp, which take the link and show the card drawn by
 * `opengraph-image.tsx`; Instagram takes no link, so its button hands the same card as a
 * square picture to the share sheet where a phone can take one, and offers it as a download
 * everywhere else (`InstagramShareButton`). Beside them, "add to calendar" (§107): the same five
 * doors as the subscription panel (§767, `calendar-targets.tsx` — one source for their words and
 * marks): Google's own add-event address, the `.ics` for Apple Calendar, Outlook.com and Outlook
 * for work or school (each its own compose window, `outlookCalendarUrl`), and the `.ics` to download.
 * Behind one small pill, «Adaugă în calendar» (§772, amending §767; the owner, 2026-10-14: «asta ar
 * trebui să fie collapsed, că nu vedem tot șirul de opțiuni»): a native `<details>`, closed, whose
 * summary is the pill — the calendar's glyph, the words, a chevron that turns — and whose body holds the
 * five doors on one wrapping line, the file's note and the file's address. No script: it opens with
 * the click, the Enter key and the space bar, and with scripts off.
 *
 * One row (§NNN, amending §767 and §772; the owner, 2026-10-15: «These should be inline to save
 * space»): the caption, the networks and, last, the calendar pill are one wrapping line of the same small
 * pill, and the fold's body is a dropdown panel anchored under the pill, out of the flow, so opening it
 * pushes nothing. With scripts off the panel is the same CSS and opens and closes by the pill; with scripts
 * `CalendarFoldClose` adds Escape and a press outside.
 *
 * The network buttons are anchors rendered here, on the server, with the event's absolute
 * address built from `APP_BASE_URL` (`../share-links.ts`): a plain `<a target="_blank">` is
 * what every browser opens on a tap, where iOS Safari refuses a popup opened by script.
 * Buttons rather than a line of text links (the owner: "share should look nicer"), small ones
 * (`share-pill.ts`, §767: «way too big»); the icons are children, never a prop across the
 * boundary (`AGENTS.md` §14.1).
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
   * "Add to calendar" (§107): one address per door, built on the server for this one event
   * (`googleCalendarUrl`, `outlookCalendarUrl`; `icsHref` is the file, which Apple Calendar opens).
   * `fileAddress` is the `.ics`'s absolute address, drawn in a fold under the row to copy (§674) —
   * absent on a members' event, whose file opens with a session only.
   */
  calendar?: { icsHref: string; googleUrl: string; outlookUrl: string; outlookWorkUrl: string; fileAddress?: string };
  /**
   * False on an event for the members alone (§552): its link opens for a member only, and its
   * share pictures answer 404 — so no Facebook, WhatsApp or Instagram button, the calendar kept.
   */
  shareable?: boolean;
};

/** How a link opens: `blank`: another site, in a new tab; `self`: our own file, left to the browser (Apple's phones open it in Calendar); `download`: saved. */
type Open = "blank" | "self" | "download";

/** Where each of the five doors goes for this event, and how it opens: Apple's and the download's is the one file. */
function calendarDoor(calendar: NonNullable<Props["calendar"]>, id: CalendarTarget): { href: string; open: Open } {
  switch (id) {
    case "google":
      return { href: calendar.googleUrl, open: "blank" };
    case "outlook":
      return { href: calendar.outlookUrl, open: "blank" };
    case "outlookWork":
      return { href: calendar.outlookWorkUrl, open: "blank" };
    case "apple":
      return { href: calendar.icsHref, open: "self" };
    case "ics":
      return { href: calendar.icsHref, open: "download" };
  }
}

/**
 * The calendar fold's summary (§772): the share row's own small pill (`SHARE_PILL_SX`: 28 pixels, the
 * 0.8125rem word, the 18-pixel glyph, the four-pixel tap band above and below) drawn on a `<summary>`, in the
 * outlined button's look from theme tokens. The browser's marker is hidden — the pill's own chevron says
 * it opens, and turns when it has — and `display` is a flex box that does not stretch to the row. A plain
 * object in this file: a Server Component hands sx an object, never a function (`AGENTS.md` §14.1).
 */
const CALENDAR_PILL_SX = {
  ...SHARE_PILL_SX,
  // MUI's button is border-box; a bare `<summary>` is not, and its 28 pixels would read 34 beside the others (§NNN).
  boxSizing: "border-box",
  display: "flex",
  width: "fit-content",
  alignItems: "center",
  cursor: "pointer",
  listStyle: "none",
  border: 1,
  // The outlined button's own tokens (MUI 9: the border at half the main colour, a primary tint on hover): the doors it opens read as its kin.
  borderColor: paletteWash("primary", 50),
  color: "primary.main",
  fontWeight: 500,
  userSelect: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { content: '""' },
  "&:hover": { borderColor: "primary.main", bgcolor: paletteWash("primary", 4) },
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
  "details[open] > & [data-chevron]": { transform: "rotate(180deg)" },
} as const;

/** The calendar fold's id: `CalendarFoldClose` finds the fold by it. */
const CALENDAR_FOLD_ID = "event-calendar";

/**
 * The calendar fold's body as a dropdown panel (§NNN): out of the flow, so opening it never moves the pills
 * (the row, `position: relative`, is its containing block). `top` stays auto — the panel sits where it would
 * have flowed, right under the summary, whichever line of the wrapped row the pill is on. Its width is 26rem
 * at most and never more than the row's own, and its left edge is the pill's (`CalendarFoldClose` writes the
 * pill's offset into `CALENDAR_PILL_LEFT_VAR`) pulled back so the panel's right edge never passes the row's:
 * inside the viewport at 320 pixels whatever line the pill wrapped to. Without the script the variable is
 * absent, the left edge is the row's own, and the panel is still inside the page. Its own surface, border and
 * shadow from theme tokens, above what follows it. A plain object (`AGENTS.md` §14.1).
 */
const CALENDAR_PANEL_WIDTH = "min(26rem, 100%)";
const CALENDAR_PANEL_SX = {
  position: "absolute",
  left: `min(var(${CALENDAR_PILL_LEFT_VAR}, 0px), calc(100% - ${CALENDAR_PANEL_WIDTH}))`,
  // Above the site footer's always-visible bar (1000): on a short page the panel hangs past the end of the page
  // and would otherwise slide under the bar. Below the header (1100).
  zIndex: 1001,
  mt: SHARE_ROW_GAP,
  boxSizing: "border-box",
  width: CALENDAR_PANEL_WIDTH,
  ...DROPDOWN_PANEL_SURFACE_SX,
  p: 1.5,
  boxShadow: 3,
} as const;

export default async function ShareLinks({ url, title, imageHref, fileName, calendar, shareable = true }: Props) {
  const t = await getTranslations("Event");
  const doors = await getTranslations(CALENDAR_TARGET_NAMESPACE);
  const anchor = (href: string, label: string, icon: ReactNode, open: Open = "blank") => (
    <Button
      component="a"
      href={href}
      target={open === "blank" ? "_blank" : undefined}
      rel={open === "blank" ? "noopener noreferrer" : undefined}
      download={open === "download" ? true : undefined}
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
      sx={{ minHeight: 28, display: "inline-flex", alignItems: "center", mr: 0.5 }}
    >
      {text}
    </Typography>
  );
  return (
    /*
      ONE wrapping row (§NNN, amending §767 and §772; the owner, 2026-10-15: «These should be inline to save
      space»): the caption, the networks and, last, the calendar pill, all the same 28-pixel pill with its tap
      band, eight pixels apart. The row is the containing block of the calendar panel, so the panel can never
      reach past the row's own width — a phone's 320 included.
    */
    <Stack direction="row" data-testid="event-share-row" sx={{ position: "relative", flexWrap: "wrap", alignItems: "center", gap: SHARE_ROW_GAP }}>
      {shareable && (
        <>
          {caption(t("share.title"))}
          <NativeShareButton url={url} title={title} text={title} label={t("share.native")} />
          {anchor(facebookShareUrl(url), t("share.facebook"), <SocialIcon network="facebook" size={18} />)}
          {anchor(whatsappShareUrl(title, url), t("share.whatsapp"), <WhatsAppIcon aria-hidden="true" />)}
          <InstagramShareButton
            imageHref={imageHref}
            fileName={fileName}
            title={title}
            url={url}
            shareLabel={t("share.instagram")}
            downloadLabel={t("share.instagramDownload")}
          >
            <SocialIcon network="instagram" size={18} />
          </InstagramShareButton>
        </>
      )}
      {calendar && (
        /*
          «Adaugă în calendar» (§772, §NNN): ONE pill, a native fold closed on arrival, the last pill of the row.
          Its body is a dropdown panel under the row, out of the flow: opening it moves nothing. The pill is the
          `<summary>`: keyboard-reachable and toggled by Enter and Space, and it works with scripts off — the
          panel is plain CSS, so without scripts it opens the same way and closes by the pill; with scripts,
          `CalendarFoldClose` adds Escape and a press outside.
        */
        <Box component="details" id={CALENDAR_FOLD_ID} data-testid="event-calendar">
          <Box component="summary" data-testid="event-calendar-toggle" sx={CALENDAR_PILL_SX}>
            <CalendarMonthIcon aria-hidden="true" />
            {t("share.calendarTitle")}
            <ExpandMoreIcon aria-hidden="true" data-chevron="" sx={{ transition: "transform 150ms" }} />
          </Box>
          <Stack spacing={SHARE_ROW_GAP} data-testid="event-calendar-panel" sx={CALENDAR_PANEL_SX}>
            <Stack direction="row" data-testid="event-calendar-doors" sx={{ flexWrap: "wrap", alignItems: "center", gap: SHARE_ROW_GAP }}>
              {CALENDAR_TARGETS.map((id) => {
                const { href, open } = calendarDoor(calendar, id);
                return <Fragment key={id}>{anchor(href, doors(id), calendarTargetMark(id), open)}</Fragment>;
              })}
            </Stack>
            {/* The file is a copy of today (§674): said once, under the doors it is about. */}
            <Typography variant="caption" color="text.secondary" component="p" data-testid="event-calendar-snapshot">
              {t("share.fileSnapshot")}
            </Typography>
            {/*
              The file's address, to copy (§674): a fold inside the panel, closed. Google Calendar
              on the web takes it by «Din URL»; and a person who deleted the event in Google learns why
              the file will not add it again for 30 days (Google keeps the deleted entry, by its UID, in
              the calendar's Bin — the UID is the event's on purpose, §107, §174).
            */}
            {calendar.fileAddress && (
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
          <CalendarFoldClose foldId={CALENDAR_FOLD_ID} />
        </Box>
      )}
    </Stack>
  );
}
