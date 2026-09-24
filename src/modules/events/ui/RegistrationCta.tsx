import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import { unstable_rethrow } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { cachedPublicAvailability } from "@/modules/public-cache/reads";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { accentOnHover } from "@/theme/surfaces";
import { publicFill, registrationCta } from "../domain/registration-cta";
import { registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { fillPhrase, waitlistRoomPhrase } from "./counted-phrases";

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
 * page render, not a capacity decision. "12 înscriși din 50 de locuri" (§NNN) is the same count
 * read against the event's own number of places — `publicFill`, arithmetic on the two numbers
 * this already holds, never a second query.
 */
export default async function RegistrationCta({
  event,
  now,
  raceWeek = false,
}: {
  event: PublicEvent;
  now: Date;
  /** The last seven days (§78): a closed window then says where to go instead of only "closed". */
  raceWeek?: boolean;
}) {
  const t = await getTranslations("Event");
  const format = await getFormatter();
  const locale = await getLocale();

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
  // The event's own number of places, from the same row the count was read against: the
  // "out of" of §NNN's sentence. Null for an uncapped event, and for every event not read here.
  let capacity: number | null = null;
  // The waiting list's room and limit (§NNN), off the same cached read; null for no limit.
  let waitlistRoom: number | null = null;
  let waitlistCapacity: number | null = null;
  if (event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN") {
    try {
      /*
        From the public cache (§NNN), and still the allocator's number for this instant: every
        registration that moves expires it, and the one input the clock changes — a waiting-list
        offer lapsing — is part of its key (`public-cache/reads.ts#cachedPublicAvailability`).
        Without it, an open race's page woke the database for every visitor during exactly the
        weeks the page is read most. The event's size comes back from the same cached read, off
        the same row the count was taken against.
      */
      const places = await cachedPublicAvailability(event.id, now);
      availablePlaces = places.availablePlaces;
      capacity = places.capacity;
      waitlistRoom = places.waitlistRoom;
      waitlistCapacity = places.waitlistCapacity;
    } catch (error) {
      /*
        The one thing on a page that is never served from a copy (§281).

        The rest of an event page — the date, the place, the rules, the programme — is the same
        facts it was an hour ago, and showing the last copy of those during an outage costs a
        reader nothing. How many places are left is not like that: it is the number somebody
        decides on, the allocator is the only thing that knows it (`AGENTS.md` §10.6), and a
        stale "3 locuri libere" sends a person through a form to be refused at the end of it.

        So when this one query cannot be answered, this one block says so and the page around it
        stands. A refresh is what fixes it, and it is offered as a link rather than a promise.
      */
      unstable_rethrow(error);
      console.error("[registration-cta] could not read the availability", error);
      return <CapacityUnknown slug={event.slug} />;
    }
  }

  const cta = registrationCta({ ...event, availablePlaces, waitlistRoom, waitlistCapacity }, now);
  if (cta.kind === "NONE") return null;

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
          sx={{ ...TAP_TARGET, ...accentOnHover }}
        >
          {cta.provider
            ? t("cta.externalWithProvider", { provider: cta.provider })
            : t("cta.external")}
        </Button>
      </Box>
    );
  }

  if (cta.kind === "OPEN" || cta.kind === "FULL") {
    // How full it is (§NNN): the free places read against the event's size. Null — and nothing
    // rendered — for an uncapped event, which shows no number at all (BR-REQ-034-01 criterion 4).
    const fill = publicFill(capacity, availablePlaces);
    return (
      <Stack spacing={1} sx={{ mt: 3, alignItems: "flex-start" }}>
        <ButtonLink
          variant="contained"
          // The one action the page exists for, so it is the one button that lights up under
          // a pointer (§166). Hover only, and only where hover is real: on a phone `:hover`
          // sticks after a tap and the button would stay lit for the rest of the visit.
          sx={{ ...TAP_TARGET, ...accentOnHover }}
          href={{ pathname: "/events/[slug]/register", params: { slug: event.slug } }}
        >
          {cta.kind === "FULL" ? t("cta.joinWaitingList") : t("cta.register")}
        </ButtonLink>

        {fill && (
          <Typography variant="body2" data-testid="registration-fill" sx={{ fontWeight: 600 }}>
            {fillPhrase(t, locale, fill)}
          </Typography>
        )}

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

        {/* The room left in a capped waiting list (§NNN); nothing for a list with no limit. */}
        {cta.kind === "FULL" && cta.waitlistRoom !== null && (
          <Typography variant="body2" data-testid="waitlist-room" sx={{ fontWeight: 600 }}>
            {waitlistRoomPhrase(t, locale, cta.waitlistRoom)}
          </Typography>
        )}
      </Stack>
    );
  }

  /*
    No place and nothing to join (§NNN): the waiting list is full, or the event keeps none. A
    sentence and no button — a button would lead to a form that refuses at the end of it — with
    how full the event is beside it, the same line the open state shows. The "anunță-mă" box is
    the page's own and is untouched by this: it belongs to a window not yet open.
  */
  if (cta.kind === "WAITLIST_FULL" || cta.kind === "FULL_NO_WAITLIST") {
    const fill = publicFill(capacity, availablePlaces);
    return (
      <Stack spacing={1} sx={{ mt: 3, alignItems: "flex-start" }}>
        <Typography variant="body1" data-testid="registration-full" sx={{ fontWeight: 500 }}>
          {cta.kind === "WAITLIST_FULL" ? t("cta.waitlistFull") : t("cta.fullNoWaitlist")}
        </Typography>
        {fill && (
          <Typography variant="body2" data-testid="registration-fill" sx={{ fontWeight: 600 }}>
            {fillPhrase(t, locale, fill)}
          </Typography>
        )}
      </Stack>
    );
  }

  const sentence =
    cta.kind === "CANCELLED"
      ? t("cta.cancelled")
      : cta.kind === "COMPLETED"
        ? t("cta.completed")
      : cta.kind === "CLOSED"
        ? raceWeek
          ? t("cta.closedRaceWeek")
          : t("cta.closed")
        : t("cta.opensOn", {
            // The event's own timezone, like every other time on the page: registration for a
            // Brașov race opens at a Brașov hour wherever the page is read.
            date: format.dateTime(cta.opensAt, {
              timeZone: event.timezone,
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit", hourCycle: "h23",
            }),
          });

  // The opening date is the one fact a visitor wants before the window (§146; the owner:
  // "first I advertise the event, then I need to let them know when registrations are
  // opened"): said at the size of the countdown, in the club's blue, wherever the button
  // will later stand — the hero and the event page alike. The other sentences stay quiet.
  if (cta.kind === "NOT_YET_OPEN") {
    return (
      <Typography
        variant="h3"
        component="p"
        data-testid="registration-opens-on"
        sx={{ mt: 3, fontSize: { xs: "1.125rem", sm: "1.25rem" }, fontWeight: 700, color: "primary.main" }}
      >
        {sentence}
      </Typography>
    );
  }

  return (
    <Typography variant="body1" sx={{ mt: 3, fontWeight: 500 }}>
      {sentence}
    </Typography>
  );
}

/**
 * What stands in for the button when the free places cannot be counted (§281).
 *
 * A warning rather than an error, and no button: offering "Înscrie-te" here would send somebody
 * to a form whose first act is the query that just failed. The link reloads this page, which is
 * the only thing that can change the answer.
 */
async function CapacityUnknown({ slug }: { slug: string }) {
  const t = await getTranslations("Offline");
  return (
    <Alert
      severity="warning"
      sx={{ mt: 3 }}
      action={
        // This page again, by its own address: the only thing that can change the answer is
        // asking the database a second time.
        <ButtonLink size="small" sx={TAP_TARGET} href={{ pathname: "/events/[slug]", params: { slug } }}>
          {t("capacityRetry")}
        </ButtonLink>
      }
    >
      {t("capacityUnknown")}
    </Alert>
  );
}
