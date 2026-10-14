import DownloadIcon from "@mui/icons-material/Download";
import type { ReactNode } from "react";
import { AppleLogo, GoogleLogo, OutlookLogo } from "./calendar-app-logos";

/**
 * The five doors into a person's calendar, named once (§767, amending §733 and §720): the
 * subscription panel's rows (`SubscribeBox`, the whole feed) and the event page's «Adaugă în
 * calendar» pills (`ShareLinks`, one event) say the same five things in the same order, with the
 * same words and the same mark before them — so neither keeps a list of names of its own.
 *
 * - `google` — Google Calendar's own add link;
 * - `apple` — Apple Calendar: the feed's `webcal://` in the panel, the event's `.ics` on the page
 *   (on an Apple device the file opens in Calendar);
 * - `outlook` — Outlook.com, a personal account;
 * - `outlookWork` — Outlook on Microsoft 365, a work or school account;
 * - `ics` — the file to download.
 *
 * Where the words live: `Events.calendar.look.subscribe.<id>` in both catalogues
 * (`CALENDAR_TARGET_NAMESPACE`); a caller reads them with
 * `getTranslations(CALENDAR_TARGET_NAMESPACE)`. The marks are made on the server, as elements, and
 * are drawn by Server Components only — never handed to a client island (`AGENTS.md` §14.1).
 */
export const CALENDAR_TARGETS = ["google", "apple", "outlook", "outlookWork", "ics"] as const;

export type CalendarTarget = (typeof CALENDAR_TARGETS)[number];

/** The catalogue's namespace that holds the five words, one key per target. */
export const CALENDAR_TARGET_NAMESPACE = "Events.calendar.look.subscribe";

/**
 * The mark before a target's words: the app's own logo, and the download arrow for the file.
 * `data-row-glyph` tells `SubscribeBox` to colour the arrow in the quiet ink, as it always did;
 * the pills read it as the glyph the same way.
 */
export function calendarTargetMark(target: CalendarTarget): ReactNode {
  switch (target) {
    case "google":
      return <GoogleLogo />;
    case "apple":
      return <AppleLogo />;
    case "outlook":
    case "outlookWork":
      return <OutlookLogo />;
    case "ics":
      return <DownloadIcon data-row-glyph aria-hidden="true" />;
  }
}
