import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";
import { distanceInKm, isStravaLink } from "../domain/event-type";
import { registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { COST_GLYPH, DIFFICULTY_GLYPH } from "./glyphs";

/**
 * The facts of an event, in three lines: when, where, and the route in numbers.
 *
 * Nine labelled rows — date, gathering time, race start, meeting point, distance, climb,
 * difficulty, cost, registration — were a table a reader had to scan top to bottom to answer
 * "when and where do I show up". The owner's word on it (2026-09-18): "these details should be
 * better organised; the UX must be simple and easy." So the same facts are grouped by the
 * question they answer, each line a row of short pieces separated by a middle dot, and the
 * labels are the questions: *când*, *unde*, *traseu*. Still a `<dl>`, so a screen reader hears
 * the question before the answer; the separators are hidden from it.
 *
 * Registration is not a fact of the event but a state of the moment, and the button beneath
 * these lines says it (`RegistrationCta`) — except for an event with no registration at all,
 * which has no button and deserves the one sentence "no registration needed". The compact
 * variant on a listing card has no button either, so there the state is the last piece.
 */
export default async function EventFacts({
  event,
  now,
  variant = "full",
}: {
  event: PublicEvent;
  now: Date;
  variant?: "full" | "compact";
}) {
  const t = await getTranslations("Event");
  const format = await getFormatter();
  const compact = variant === "compact";

  const distance = distanceInKm(event.distanceMeters);
  const state = registrationState(event, now);

  // The event's own timezone, not the server's or the reader's. A run in Brașov starts at its
  // local time regardless of where the page is opened.
  const time = (at: Date) =>
    format.dateTime(at, { timeZone: event.timezone, hour: "2-digit", minute: "2-digit" });
  const date = format.dateTime(event.startsAt, {
    timeZone: event.timezone,
    weekday: "long",
    day: "numeric",
    month: compact ? "short" : "long",
    year: "numeric",
  });

  // A 44px target, like every other link on a phone (BR-REQ-041-01 criterion 6). `noopener`
  // and `noreferrer` stop the opened page reaching back through `window.opener` and stop it
  // learning which page sent the visitor (`DECISIONS.md` §61 on the Strava mark: the mark
  // decorates, the words are the link, and never Strava's script).
  const outLink = (href: string, label: string, strava = false) => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44 }}
    >
      {strava && <SocialIcon network="strava" size={18} />}
      {label}
    </Link>
  );

  // A word with its glyph in front, for the closed sets (§112); the word is what is read.
  const withGlyph = (Icon: typeof CalendarMonthIcon, word: string) => (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
      {word}
    </Box>
  );

  /* When: the date, then the times — a race has two, each named; anything else has one. */
  const when: ReactNode[] = [<strong key="date">{date}</strong>];
  if (event.raceStartsAt) {
    when.push(t("gatheringAt", { time: time(event.startsAt) }), t("raceStartAt", { time: time(event.raceStartsAt) }));
  } else {
    when.push(time(event.startsAt));
  }

  /* Where: the meeting point, and the map when the organizer pasted one. */
  const where: ReactNode[] = [];
  if (event.locationName) where.push(event.locationName);
  if (!compact && event.mapUrl) where.push(outLink(event.mapUrl, t("openMap")));

  /* The route in numbers, in the reader's own language for the two enums (migration `0018`);
     cost only when the club has stated one — null means unstated, not free (AGENTS.md §1.2). */
  const route: ReactNode[] = [];
  if (distance !== null) {
    // format.number applies the locale's separators: "14,5" in Romanian, "14.5" in English.
    route.push(t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }));
  }
  if (event.elevationGainMeters) route.push(t("elevationM", { m: format.number(event.elevationGainMeters) }));
  // The two closed sets carry their glyphs (§112): bars for how hard, a coin for the cost.
  if (event.difficulty) route.push(withGlyph(DIFFICULTY_GLYPH[event.difficulty], t(`difficultyValues.${event.difficulty}`)));
  if (event.costType) route.push(withGlyph(COST_GLYPH[event.costType], t(`costValues.${event.costType}`)));
  if (!compact && event.routeUrl) route.push(outLink(event.routeUrl, t("openRoute"), isStravaLink(event.routeUrl)));
  if (!compact && event.stravaEventUrl) route.push(outLink(event.stravaEventUrl, t("openStravaEvent"), true));

  const pieces = (items: ReactNode[]) => (
    <Box component="span" sx={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <Box component="span" aria-hidden="true" sx={{ color: "text.disabled" }}>
              ·
            </Box>
          )}
          <span>{item}</span>
        </Fragment>
      ))}
    </Box>
  );

  // A glyph beside each question (the owner, 2026-09-18: "more icons in the app"), decorative:
  // the label is the word, the glyph is what the eye finds first on a card.
  const glyph = (Icon: typeof CalendarMonthIcon) => (
    <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary", verticalAlign: "-3px", mr: 0.5 }} />
  );

  if (compact) {
    // Two plain lines on a card: no labels, the state of registration as the last piece.
    const second = [...where, ...route, t(`registrationState.${state}`)];
    return (
      <Box>
        <Typography variant="body2">
          {glyph(CalendarMonthIcon)}
          {pieces(when)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {glyph(PlaceIcon)}
          {pieces(second)}
        </Typography>
      </Box>
    );
  }

  const lines: Array<{ label: string; icon: typeof CalendarMonthIcon; value: ReactNode[] }> = [
    { label: t("when"), icon: CalendarMonthIcon, value: when },
  ];
  if (where.length > 0) lines.push({ label: t("where"), icon: PlaceIcon, value: where });
  if (route.length > 0) lines.push({ label: t("route"), icon: RouteIcon, value: route });
  if (state === "NOT_APPLICABLE") {
    lines.push({ label: t("registration"), icon: HowToRegIcon, value: [t("registrationState.NOT_APPLICABLE")] });
  }

  return (
    <Box
      component="dl"
      sx={{
        my: 0,
        display: "grid",
        // The label column sizes to the longest label and stops there; on a phone the pair
        // still shares one line, which is what saves the height.
        gridTemplateColumns: "auto 1fr",
        columnGap: 2,
        rowGap: 1,
        alignItems: "baseline",
      }}
    >
      {lines.map((line) => (
        <Fragment key={line.label}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {glyph(line.icon)}
            {line.label}
          </Typography>
          <Typography component="dd" variant="body1" sx={{ m: 0 }}>
            {pieces(line.value)}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}
