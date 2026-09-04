import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/shared/config/env";
import { distanceInKm } from "../domain/event-kind";
import { mapLinkFor } from "../domain/map-link";
import { registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";

/**
 * The facts a runner needs, as text.
 *
 * BR-REQ-070-03 criterion 2 requires date, start time, meeting point, cost and the
 * registration requirement to be present as text in the server HTML — not conveyed by an icon,
 * a colour, or an image. BR-REQ-041-01 criterion 2 requires them within the first screen at
 * 360px. Both are why this is a plain definition list near the top rather than a row of chips.
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

  const distance = distanceInKm(event.distanceMeters);
  const state = registrationState(event, now);
  // Coordinates first, a pasted URL as the override, and nothing at all when the club has
  // neither — the meeting point is then plain text, as it was before.
  const mapLink = mapLinkFor(event, env.MAP_LINK_BASE_URL);

  // The event's own timezone, not the server's or the reader's. A run in Brașov starts at its
  // local time regardless of where the page is opened.
  const time = (at: Date) =>
    format.dateTime(at, { timeZone: event.timezone, hour: "2-digit", minute: "2-digit" });

  const facts: Array<{ label: string; value: ReactNode }> = [
    {
      label: t("date"),
      value: format.dateTime(event.startsAt, {
        timeZone: event.timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    },
  ];

  /**
   * One time or two, each labelled for what it is.
   *
   * `starts_at` is when the event begins. For a race that is the gathering, and the gun time
   * is its own column — runners need both, and a single row labelled "start" would be read as
   * whichever one the reader was hoping for. When the club has stated only one time, only one
   * row appears, still labelled "start time" rather than inventing a gathering.
   */
  if (event.raceStartsAt) {
    facts.push({ label: t("gatheringTime"), value: time(event.startsAt) });
    facts.push({ label: t("raceStartTime"), value: time(event.raceStartsAt) });
  } else {
    facts.push({ label: t("startTime"), value: time(event.startsAt) });
  }

  /**
   * The map link is offered on the full page, never in a card.
   *
   * On the listing the whole card is one link (`CardLink`, for a 44px tap target), and an
   * anchor inside an anchor is invalid HTML — the browser silently splits the outer one, which
   * breaks the card and leaves a stray link a keyboard user lands on. The compact variant
   * therefore shows the meeting point as text, and the map link waits for the detail page,
   * where it is also on the address.
   */
  facts.push({
    label: t("meetingPoint"),
    value: variant === "full" && mapLink ? (
      <>
        {event.locationName}{" "}
        <Link
          href={mapLink}
          target="_blank"
          // The link goes to whatever map service the club already uses. `noopener` and
          // `noreferrer` stop the opened page reaching back through `window.opener` and stop
          // it learning which page sent the visitor.
          rel="noopener noreferrer"
          // A 44px target, like every other link on a phone (BR-REQ-041-01 criterion 6). Inline
          // text is about 20px tall, which is a link you miss while holding a phone and a bag.
          sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
        >
          {t("openMap")}
        </Link>
      </>
    ) : (
      event.locationName
    ),
  });

  if (distance !== null) {
    // format.number applies the locale's separators: "14,5" in Romanian, "14.5" in English.
    facts.push({
      label: t("distance"),
      value: t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }),
    });
  }
  if (variant === "full" && event.elevationGainMeters) {
    facts.push({
      label: t("elevation"),
      value: t("elevationM", { m: format.number(event.elevationGainMeters) }),
    });
  }
  if (variant === "full" && event.difficultyLabel) {
    facts.push({ label: t("difficulty"), value: event.difficultyLabel });
  }
  // Only when the club has stated one. Null means unstated, not free — guessing "free" on the
  // club's behalf is exactly the kind of invention AGENTS.md §1.2 forbids.
  if (event.costText) facts.push({ label: t("cost"), value: event.costText });

  facts.push({ label: t("registration"), value: t(`registrationState.${state}`) });

  return (
    <Stack component="dl" spacing={1} sx={{ my: 0 }}>
      {facts.map((fact) => (
        <Stack
          key={fact.label}
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 0, sm: 1 }}
          component="div"
        >
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
            {fact.label}
          </Typography>
          <Typography component="dd" variant="body1" sx={{ m: 0, fontWeight: 500 }}>
            {fact.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
