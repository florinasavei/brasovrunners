import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { findEventForRegistrationById } from "@/modules/events/repository";
import { readPublicAvailability } from "@/modules/registrations/service";
import ButtonLink from "@/shared/ui/ButtonLink";
import { registrationCta } from "../domain/registration-cta";
import { registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";

/**
 * The one way in to registration, on the two pages a visitor actually reads.
 *
 * The whole lifecycle existed before this component did and nothing linked to it: the door was
 * built and never hung. Exactly one state renders — a button, or a sentence saying why there
 * is none — because two of them on one screen is how somebody ends up on an organizer's form
 * for a race they could have entered here.
 *
 * The count comes from `readPublicAvailability`, which is the allocator's own formula
 * (AGENTS.md §10.6). Nothing here counts anything itself, and nothing here mutates: this is a
 * page render, not a capacity decision.
 */
export default async function RegistrationCta({ event, now }: { event: PublicEvent; now: Date }) {
  const t = await getTranslations("Event");
  const format = await getFormatter();

  /**
   * Only an open internal event costs a query.
   *
   * `capacity` is deliberately absent from the public columns, so the count needs the internal
   * row — and asking for it on every event page, including the three quarters of them that take
   * no registration at all, would be two round trips bought for nothing. `registrationCta`
   * re-derives the state from the same pure function below; calling it twice is cheaper than
   * the query this avoids.
   */
  let availablePlaces: number | null = null;
  if (event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN") {
    const db = getDb();
    const internal = await findEventForRegistrationById(db, event.id);
    if (internal) availablePlaces = await readPublicAvailability(db, internal, now);
  }

  const cta = registrationCta({ ...event, availablePlaces }, now);
  if (cta.kind === "NONE") return null;

  // 44px is the minimum tap target BR-REQ-041-01 criterion 6 names; MUI's medium button is
  // 36.5px, which passes on a mouse and fails on a thumb.
  const tapTarget = { minHeight: 44 };

  if (cta.kind === "EXTERNAL") {
    return (
      <Box sx={{ mt: 3 }}>
        <Button
          // `component="a"` with the organizer's own URL: this leaves the site, so it is a
          // plain anchor rather than the locale-aware Link. `nofollow` as well as `noopener
          // noreferrer` — the club does not vouch for an entry form it does not run.
          component="a"
          href={cta.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          variant="contained"
          sx={tapTarget}
        >
          {cta.provider
            ? t("cta.externalWithProvider", { provider: cta.provider })
            : t("cta.external")}
        </Button>
      </Box>
    );
  }

  if (cta.kind === "OPEN" || cta.kind === "FULL") {
    return (
      <Stack spacing={1} sx={{ mt: 3, alignItems: "flex-start" }}>
        <ButtonLink
          variant="contained"
          sx={tapTarget}
          href={{ pathname: "/events/[slug]/register", params: { slug: event.slug } }}
        >
          {cta.kind === "FULL" ? t("cta.joinWaitingList") : t("cta.register")}
        </ButtonLink>

        {/* An uncapped event shows no number at all (BR-REQ-034-01 criterion 4). */}
        {cta.kind === "FULL" ? (
          <Typography variant="body2" color="text.secondary">
            {t("cta.full")}
          </Typography>
        ) : (
          cta.availablePlaces !== null && (
            <Typography variant="body2" color="text.secondary">
              {t("cta.placesRemaining", { count: cta.availablePlaces })}
            </Typography>
          )
        )}
      </Stack>
    );
  }

  const sentence =
    cta.kind === "CANCELLED"
      ? t("cta.cancelled")
      : cta.kind === "CLOSED"
        ? t("cta.closed")
        : t("cta.opensOn", {
            // The event's own timezone, like every other time on the page: registration for a
            // Brașov race opens at a Brașov hour wherever the page is read.
            date: format.dateTime(cta.opensAt, {
              timeZone: event.timezone,
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          });

  return (
    <Typography variant="body1" sx={{ mt: 3, fontWeight: 500 }}>
      {sentence}
    </Typography>
  );
}
