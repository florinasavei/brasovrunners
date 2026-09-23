import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countDesk,
  findRegistrationByCheckinCode,
  isEventCompleted,
  listDeskRegistrations,
  listEventsAcceptingRegistrations,
  listEventsForDesk,
} from "@/modules/registrations/admin-repository";
import { isCheckinCode, normalizeCheckinCode } from "@/modules/registrations/checkin-code";
import DeskRow from "@/modules/registrations/ui/DeskRow";
import QrScanButton from "@/modules/registrations/ui/QrScanButton";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; q?: string; saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * The race-day desk (BR-REQ-037-07, BR-REQ-037-08; `DECISIONS.md` §67).
 *
 * One page, for the volunteer with the box of numbers: pick today's event, scan a QR or type a
 * code, a name or a number, and press the one button the row offers. Every staff role may open
 * it, because the desk is where a volunteer works, and it shows what a desk needs — a name, a
 * state, a number — and never an address. The steps of the whole process are on the page
 * itself, folded, so a volunteer who was handed a phone at 7am can read what to do.
 *
 * A GET reads and never writes: the search is a form with method="get", and every button on a
 * row is its own POST.
 */
export default async function DeskPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const { eventId: requestedEventId, q = "", saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const db = getDb();
  const now = new Date();

  // Today's events first; when nothing is within the window, every event taking entries, so
  // the desk can still be rehearsed a month early.
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const eventId = events.some((event) => event.id === requestedEventId)
    ? (requestedEventId as string)
    : events[0]?.id;

  // A code finds one runner at any event; anything else searches the chosen event.
  const code = normalizeCheckinCode(q);
  const byCode = isCheckinCode(code) ? await findRegistrationByCheckinCode(db, code, locale) : undefined;
  const rows = byCode ? [byCode] : eventId ? await listDeskRegistrations(db, { eventId, query: q, locale }) : [];
  const counts = eventId ? await countDesk(db, eventId) : null;
  // The race is over (§82): the rows still read, the buttons are gone, and the service refuses
  // a check-in anyway.
  const closed = eventId ? await isEventCompleted(db, eventId) : false;

  const codeHrefTemplate = getPathname({
    locale,
    href: { pathname: "/admin/checkin/[code]", params: { code: "__CODE__" } },
  });
  const walkInHref = eventId
    ? `${getPathname({ locale, href: "/admin/registrations/new" })}?eventId=${eventId}&back=desk`
    : null;

  return (
    <Stack spacing={3}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("desk.title")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved && <Alert severity="success">{t(`desk.saved.${saved}`)}</Alert>}
      </Box>

      {/* The whole process, on the page, folded: what happens before, at the table, and after. */}
      <Box component="details" sx={BOXED_DISCLOSURE_SX}>
        <Typography component="summary" variant="subtitle2">
          {t("desk.howTitle")}
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
          {(t.raw("desk.how") as string[]).map((step, index) => (
            <Typography component="li" variant="body2" key={index}>
              {step}
            </Typography>
          ))}
        </Box>
      </Box>

      {events.length === 0 ? (
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      ) : (
        <form method="get">
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
              {/* A native select: it works before hydration and on a phone with a flaky
                  signal, which is the desk's whole situation — the form is a GET anyway. */}
              <TextField
                select
                name="eventId"
                label={t("desk.event")}
                defaultValue={eventId}
                size="small"
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 240 }}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title ?? event.id} ·{" "}
                    {format.dateTime(event.startsAt, { timeZone: event.timezone, day: "numeric", month: "short" })}
                  </option>
                ))}
              </TextField>
              <TextField
                name="q"
                label={t("desk.search")}
                defaultValue={q}
                size="small"
                autoComplete="off"
                sx={{ flex: 1 }}
              />
              <GlyphButton icon="search" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                {t("desk.find")}
              </GlyphButton>
              <QrScanButton
                hrefTemplate={codeHrefTemplate}
                label={t("desk.scan")}
                closeLabel={t("confirm.cancel")}
                hint={t("desk.scanHint")}
                unreadableHint={t("desk.scanUnreadable")}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("desk.searchHelp")}
            </Typography>
          </Stack>
        </form>
      )}

      {counts && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <Chip label={t("desk.counts.confirmed", { n: counts.confirmed })} />
          <Chip
            color="success"
            variant={counts.checkedIn > 0 ? "filled" : "outlined"}
            label={t("desk.counts.checkedIn", { n: counts.checkedIn })}
          />
          {counts.withoutBib > 0 && (
            <Chip color="warning" variant="outlined" label={t("desk.counts.withoutBib", { n: counts.withoutBib })} />
          )}
          {counts.pending > 0 && (
            <Chip color="warning" variant="outlined" label={t("desk.counts.pending", { n: counts.pending })} />
          )}
          {walkInHref && (
            <GlyphButton icon="addPerson" href={walkInHref} variant="text" size="small" sx={{ minHeight: 44 }}>
              {t("desk.walkIn")}
            </GlyphButton>
          )}
        </Stack>
      )}

      {/* What the buttons on a row do, in one line, always visible (the owner: "I do not
          understand what to do here"). The folded steps above are the long version. */}
      {counts && !closed && (
        <Typography variant="body2" color="text.secondary">
          {t("desk.rowHelp")}
        </Typography>
      )}
      {closed && <Alert severity="info">{t("desk.closed")}</Alert>}
      {byCode && <Alert severity="info">{t("desk.foundByCode")}</Alert>}
      {rows.length === 0 && eventId ? (
        <Typography color="text.secondary">
          {isCheckinCode(code) ? t("desk.unknownCode") : t("desk.nobody")}
        </Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
          {rows.map((row) => (
            <DeskRow
              key={row.id}
              row={row}
              locale={locale}
              back="desk"
              eventId={eventId}
              q={q}
              showEvent={Boolean(byCode)}
              readOnly={closed}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
