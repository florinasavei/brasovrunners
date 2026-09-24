import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import type { Database } from "@/db/types";
import { computeOccupied } from "../domain/capacity";
import { countOccupied } from "../repository";
import { listQueueForEvent } from "../admin-repository";

/**
 * The queue of one event as the allocator sees it (`DECISIONS.md` §92; the owner: "I need to
 * see and simulate the waiting list"): the places, who holds them, and the waiting list in
 * the order it will be served. Read through the same counts the allocator uses
 * (`countOccupied`, `computeOccupied`), so this panel and the public "free places" can never
 * disagree.
 *
 * Administrator only, because it names people; rendered on the event page beside the test
 * registrations, which is the one way to fill it without ten mailboxes.
 */
export default async function QueuePanel<T extends Record<string, unknown>>({
  db,
  event,
  waiting,
  now,
}: {
  db: Database<T>;
  /** `timezone` is the event's own zone, which every time on the panel is written in (§349). */
  event: { id: string; capacity: number | null; waitlistCapacity: number | null; timezone: string };
  /** WAITLISTED rows — the page reads it once, for this panel and for the capacity field (§147). */
  waiting: number;
  now: Date;
}) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  /*
    Inside the chip's words ("loc oferit, până la vin., 20 nov. 2026, 10:00"), short (§349), and
    in the event's own zone (§369), like every other time of the event: the offer's deadline is
    the one the runner's email names (`render.ts`, the event's zone), and a panel reading the
    club's clock beside it would put two hours on one deadline for an event held elsewhere.
  */
  const when = (at: Date) => formatDay(at, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
  const counts = await countOccupied(db, event.id, now);
  const occupied = computeOccupied(counts);
  const rows = await listQueueForEvent(db, event.id);
  const free = event.capacity === null ? null : Math.max(0, event.capacity - occupied);
  const holds = counts.pendingDeclarationHolds + counts.unexpiredWaitlistOfferedHolds;
  /*
    The line as the allocator counts it (§348, `domain/waitlist.ts#waitlistLength`): everybody
    waiting, and the offers still open. An offer past its deadline that no sweep has expired yet
    holds nothing any more (`countOccupied` stopped counting it at the deadline), so it is not
    listed either — or the panel would show a row the title does not count, and an "offer until"
    a time already gone.
  */
  const line = rows.filter(
    (row) => row.status === "WAITLISTED" || (row.status === "WAITLIST_OFFERED" && row.holdExpiresAt !== null && row.holdExpiresAt > now),
  );
  /*
    "7 din 10" when the line has a limit (§348), counted from the rows listed underneath, so the
    title and the list never disagree, and the panel reads "10 din 10" exactly when the line
    takes nobody more. Only on a capped event: an uncapped one never waitlists anybody, whatever
    the limit's box holds.
  */
  const limit = event.capacity === null ? null : event.waitlistCapacity;

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
        {figure(t("queue.waiting"), waiting)}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("queue.holdsHelp")}
      </Typography>

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
              {row.status === "WAITLIST_OFFERED" && row.holdExpiresAt ? (
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
            </Box>
          ))}
        </Box>
      )}

      <Typography variant="body2" sx={{ mt: 2, whiteSpace: "pre-line" }}>
        {t("queue.simulate")}
      </Typography>
    </Box>
  );
}
