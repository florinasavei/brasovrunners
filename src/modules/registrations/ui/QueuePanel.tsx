import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Database } from "@/db/types";
import { deadlineWords } from "@/modules/deadlines/domain/duration-words";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import { computeOccupied } from "../domain/capacity";
import { countOccupied } from "../repository";
import { listFamilyReservationsForEvent, listQueueForEvent } from "../admin-repository";
import { familyOf } from "../family-marker";
import FamilyChip from "./FamilyChip";
import OfferPlaceButton from "./OfferPlaceButton";
import QuietHelp from "@/shared/ui/QuietHelp";
import ActionForm from "@/shared/forms/ActionForm";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { FormOutcome } from "@/shared/forms/outcome";
import { offerDeadlineIfMadeNow } from "../give-place-tip";

/**
 * The queue of one event as the allocator sees it (`DECISIONS.md` §92; the owner: "I need to
 * see and simulate the waiting list"): the places, who holds them, and the waiting list in
 * the order it will be served. Read through the same counts the allocator uses
 * (`countOccupied`, `computeOccupied`), so this panel and the public "free places" can never
 * disagree.
 *
 * Administrator only, because it names people; rendered on the event page beside the test
 * registrations, which is the one way to fill it without ten mailboxes.
 *
 * Each waiting row carries «Trimite-i oferta» for the Administrator (`offerAction`, §NNN): the ordinary
 * offer to the person chosen, ahead of the line — the way places are handed out on an event whose
 * offers do not go out on their own. Drawn while registration is open (an offer after the close would
 * already be lapsed); the service asserts the role and decides again under the lock.
 */
export default async function QueuePanel<T extends Record<string, unknown>>({
  db,
  event,
  waiting,
  now,
  offerAction,
}: {
  db: Database<T>;
  /** `timezone` is the event's own zone, which every time on the panel is written in (§349). */
  event: { id: string; capacity: number | null; waitlistCapacity: number | null; timezone: string };
  /** WAITLISTED rows — the page reads it once, for this panel and for the capacity field (§147). */
  waiting: number;
  now: Date;
  /**
   * «Trimite-i oferta» on each waiting row (§NNN): the page hands its Server Action down only to a
   * role that may send it (`canManageRegistrations`); absent, no row carries the button.
   */
  offerAction?: (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;
}) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  // The hold and the offer the help sentences name: the club's (§377), the lengths new ones get.
  const words = deadlineWords(locale, await deadlinesForThisRequest());
  /*
    Inside the chip's words ("loc oferit, până la vin., 20 nov. 2026, 10:00"), short (§349), and
    in the event's own zone (§369), like every other time of the event: the offer's deadline is
    the one the runner's email names (`render.ts`, the event's zone), and a panel reading the
    club's clock beside it would put two hours on one deadline for an event held elsewhere.
  */
  const when = (at: Date) => formatDay(at, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
  const counts = await countOccupied(db, event.id, now);
  const occupied = computeOccupied(counts);
  const rows = await listQueueForEvent(db, event.id, now);
  const free = event.capacity === null ? null : Math.max(0, event.capacity - occupied);
  // A family's reserved places count as held (§543): the same count the public page and the allocator read.
  const holds = counts.pendingDeclarationHolds + counts.unexpiredWaitlistOfferedHolds + counts.familyReservations + counts.familyPlaceHolds;
  const reserved = await listFamilyReservationsForEvent(db, event.id, now);
  const family = await familyOf(db, reserved);
  /*
    The line as the allocator counts it (§348, `domain/waitlist.ts#waitlistLength`): everybody
    waiting, and the offers still open — an offer before its deadline, or one whose email is still
    queued (§520: its clock starts when the email leaves, so `countOccupied` keeps counting it past
    the stored deadline; listed here since §531). An offer past its deadline with its email gone holds nothing any more,
    so it is not listed either — or the panel would show a row the title does not count, and an
    "offer until" a time already gone.
  */
  const line = rows.filter(
    (row) =>
      row.status === "WAITLISTED" ||
      (row.status === "WAITLIST_OFFERED" && (row.offerEmailQueued || (row.holdExpiresAt !== null && row.holdExpiresAt > now))),
  );
  /*
    "7 din 10" when the line has a limit (§348), counted from the rows listed underneath, so the
    title and the list never disagree, and the panel reads "10 din 10" exactly when the line
    takes nobody more. Only on a capped event: an uncapped one never waitlists anybody, whatever
    the limit's box holds.
  */
  const limit = event.capacity === null ? null : event.waitlistCapacity;
  // «Trimite-i oferta»'s deadline and the dialog's words (§NNN), read once for every row, and only
  // where a row can carry the button: null after the close, when no row does.
  const offerUntil = offerAction && line.some((row) => row.status === "WAITLISTED") ? await offerDeadlineIfMadeNow(event.id, locale) : null;
  const dialog = offerUntil ? await confirmWords() : null;

  const figure = (label: string, value: string | number) => (
    <Box sx={{ minWidth: 96 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Box>
  );

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 1.5, mb: 2 }}>
        {figure(t("queue.capacity"), event.capacity ?? t("queue.unlimited"))}
        {figure(t("queue.confirmed"), counts.confirmed)}
        {figure(t("queue.holds"), holds)}
        {figure(t("queue.free"), free ?? "∞")}
        {/*
          The open offers (§NNN), beside the free places and the people waiting: the count the public
          card reads «1 loc oferit din lista de așteptare» from (`readPublicPlaces`'s `offered`, the
          same `countOccupied` field), so the panel and the card agree. Already among «Rezervate».
        */}
        {figure(t("queue.offeredFigure"), counts.unexpiredWaitlistOfferedHolds)}
        {figure(t("queue.waiting"), waiting)}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("queue.holdsHelp", { hold: words.hold, offer: words.offer })}
        <QuietHelp text={t("queue.holdsHelpMore")} />
      </Typography>

      {/*
        The places families reserved at their forms (§543; the owner, 2026-09-28: «să rezerv 3 locuri și
        așa să se calculeze pe site»): each person, the family marker, and until when the place is held —
        and whether the family's one email is still queued, which moves nothing: the deadline is the
        sitting's, fixed by its first form.
      */}
      {reserved.length > 0 && (
        <Box sx={{ mb: 2 }} data-testid="queue-family-reservations">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
            <FamilyRestroomIcon fontSize="small" aria-hidden="true" />
            {t(`queue.familyTitle.${countForm(reserved.length, locale)}`, { count: reserved.length })}
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 0, listStyle: "none" }}>
            {reserved.map((row) => (
              <Box
                component="li"
                key={row.id}
                data-testid="queue-family-reservation"
                sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}
              >
                <Box component="span" sx={{ flex: 1, minWidth: 160 }}>
                  {row.registeredName}
                  {row.kind === "TEST" && <Chip size="small" label={t("queue.test")} sx={{ ml: 1 }} />}
                </Box>
                <FamilyChip label={t("registrations.familyChip")} members={(family.get(row.id) ?? []).map((member) => ({ name: member.name }))} />
                <Chip
                  size="small"
                  color="warning"
                  label={row.holdExpiresAt === null ? t("queue.familyQueuedNoDeadline") : t(row.emailQueued ? "queue.familyQueued" : "queue.familyUntil", { until: when(row.holdExpiresAt) })}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {/*
        The places family sittings hold for forms that wrote no registration (§543; §39): counted like a
        reservation, naming nobody, until the sitting's deadline or its email's confirmation.
      */}
      {counts.familyPlaceHolds > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 0.75 }} data-testid="queue-family-place-holds">
          <FamilyRestroomIcon fontSize="small" aria-hidden="true" />
          {t(`queue.familyHeld.${countForm(counts.familyPlaceHolds, locale)}`, { count: counts.familyPlaceHolds })}
        </Typography>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
        <HourglassTopIcon fontSize="small" aria-hidden="true" />
        {limit === null ? t("queue.lineTitle", { count: line.length }) : t("queue.lineTitleLimited", { count: line.length, limit })}
      </Typography>
      {line.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {limit === 0 ? t("queue.lineNone") : t("queue.lineEmpty")}
        </Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, pl: 0, listStyle: "none" }}>
          {line.map((row, index) => (
            <Box
              component="li"
              key={row.id}
              sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}
            >
              <Box component="span" sx={{ width: 28, fontWeight: 700, color: "text.secondary" }}>
                {index + 1}.
              </Box>
              <Box component="span" sx={{ flex: 1, minWidth: 160 }}>
                {row.registeredName}
                {row.kind === "TEST" && <Chip size="small" label={t("queue.test")} sx={{ ml: 1 }} />}
              </Box>
              {row.status === "WAITLIST_OFFERED" && row.offerEmailQueued ? (
                // The stored deadline moves when the email leaves (§513, §520): no time to show yet.
                <Chip size="small" color="warning" label={t("queue.offeredQueued")} />
              ) : row.status === "WAITLIST_OFFERED" && row.holdExpiresAt ? (
                <Chip
                  size="small"
                  color="warning"
                  label={t("queue.offered", { until: when(row.holdExpiresAt) })}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {row.waitlistedAt
                    ? t("queue.since", { when: when(row.waitlistedAt) })
                    : ""}
                </Typography>
              )}
              {row.status === "WAITLISTED" && offerAction && offerUntil && dialog && (
                <ActionForm
                  action={offerAction}
                  confirm={{
                    title: t("confirm.offerPlaceTitle"),
                    body: t("confirm.offerPlaceBody", { name: row.registeredName, message: t("emails.types.WAITLIST_SPOT_OFFER"), deadline: offerUntil }),
                    ...(row.kind === "TEST" ? {} : { email: dialog.email(1) }),
                    confirmLabel: t("desk.offerPlace"),
                    cancelLabel: dialog.cancel,
                  }}
                  data-testid="queue-offer-form"
                >
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="registrationId" value={row.id} />
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="back" value="event" />
                  {/* On a full event, an «i» says why the press will be refused (§592): one read per event. */}
                  <OfferPlaceButton eventId={event.id} size="small" />
                </ActionForm>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Typography variant="body2" sx={{ mt: 2, whiteSpace: "pre-line" }}>
        {t("queue.simulate")}
        <QuietHelp text={t("queue.simulateMore", { hold: words.hold })} />
      </Typography>
    </Box>
  );
}
