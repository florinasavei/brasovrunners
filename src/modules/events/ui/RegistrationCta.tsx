import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import type { PublicEvent } from "../repository";
import { fillPhrase, waitlistRoomPhrase } from "./counted-phrases";
import { readRegistrationDoor } from "./registration-door";
import RegistrationDoorButton, { doorButtonLabel } from "./RegistrationDoorButton";

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
 * page render, not a capacity decision. "12 înscriși din 50 de locuri" (§346) is the same count
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
  const locale = await getLocale();

  /*
    The state and the count, read once (`registration-door.ts`, shared with the listing card since
    §NNN): only an open internal event costs a read, from the public cache (§333), and it is still
    the allocator's number for this instant. When that one read cannot be answered (§281), this one
    block says so and the page around it stands. A refresh is what fixes it, and it is offered as a
    link rather than a promise.
  */
  const door = await readRegistrationDoor(event, now);
  if (door.kind === "UNKNOWN") return <CapacityUnknown slug={event.slug} />;
  const { cta, fill } = door;
  if (cta.kind === "NONE") return null;

  if (cta.kind === "EXTERNAL") {
    return (
      <Box sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 } }}>
        <RegistrationDoorButton slug={event.slug} cta={cta} label={doorButtonLabel(t, cta)} />
      </Box>
    );
  }

  if (cta.kind === "OPEN" || cta.kind === "FULL") {
    // How full it is (§346): the free places read against the event's size. Null — and nothing
    // rendered — for an uncapped event, which shows no number at all (BR-REQ-034-01 criterion 4).
    return (
      <Stack spacing={1} sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 }, alignItems: "flex-start" }}>
        <RegistrationDoorButton slug={event.slug} cta={cta} label={doorButtonLabel(t, cta)} />

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

        {/* The room left in a capped waiting list (§348); nothing for a list with no limit. */}
        {cta.kind === "FULL" && cta.waitlistRoom !== null && (
          <Typography variant="body2" data-testid="waitlist-room" sx={{ fontWeight: 600 }}>
            {waitlistRoomPhrase(t, locale, cta.waitlistRoom)}
          </Typography>
        )}
      </Stack>
    );
  }

  /*
    No place and nothing to join (§348): the waiting list is full, or the event keeps none. A
    sentence and no button — a button would lead to a form that refuses at the end of it — with
    how full the event is beside it, the same line the open state shows. The "anunță-mă" box is
    the page's own and is untouched by this: it belongs to a window not yet open.
  */
  if (cta.kind === "WAITLIST_FULL" || cta.kind === "FULL_NO_WAITLIST") {
    return (
      <Stack spacing={1} sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 }, alignItems: "flex-start" }}>
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
            // Inside the sentence, so the weekday keeps its lower case (§349).
            date: formatDay(cta.opensAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" }),
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
        sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 }, fontSize: { xs: "1.125rem", sm: "1.25rem" }, fontWeight: 700, color: "primary.main" }}
      >
        {sentence}
      </Typography>
    );
  }

  return (
    <Typography variant="body1" sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 }, fontWeight: 500 }}>
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
      sx={{ mt: { xs: DENSITY.sectionGap, sm: 3 } }}
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
