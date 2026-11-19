import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { listEventsAcceptingRegistrations, listEventsForDesk } from "@/modules/registrations/admin-repository";
import { canEditEventFields } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { RAFFLE_KINDS } from "@/modules/volunteers/domain/raffle";
import { canTakeRaffleList, readRaffleRoster } from "@/modules/volunteers/raffle-list";
import type { RaffleRosterRow } from "@/modules/volunteers/raffle-roster";
import CheckboxField from "@/shared/ui/CheckboxField";
import ChipLink from "@/shared/ui/ChipLink";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import PrintButton from "@/shared/ui/PrintButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import TickButton from "@/shared/ui/TickButton";
import { raffleDeleteEntryAction, raffleElitePresentAction, raffleExclusionAction, raffleSignUpAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; filter?: string; error?: string }>;
};

/** Reads the stored rows and is returned to right after every press. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The four views of the table: everybody, those taking part, those not, and those taking part who were there. */
const FILTERS = ["all", "in", "out", "present"] as const;
type Filter = (typeof FILTERS)[number];

/** What the paper leaves out: the tabs, the select, the filters, the buttons and every control of a row. */
const NOT_ON_PAPER = { "@media print": { display: "none" } } as const;
/** And what only the paper shows: the event's name over the table. */
const ONLY_ON_PAPER = { display: "none", "@media print": { display: "block" } } as const;

/** The refusals the page's alert says, by code — the rest are the generic ones the backoffice knows. */
const ALERT_CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "RAFFLE_SIGN_UP_CLOSED", "RAFFLE_NOT_ELIGIBLE", "RAFFLE_RULES_NOT_ACCEPTED"] as const;

/**
 * «Ziua cursei» → «Tombolă» (§984; the owner, 2026-11-18: «Tot pentru ziua cursei vreau să am un tab de tombolă unde să văd toți
 * participanții la tombolă», and «vreau să văd în dreptul fiecărei persoane dacă participă la tombolă»): everybody of one event's three
 * groups — the registrations still standing, the volunteers not cancelled, the lines of the elite list — in one table, by the number,
 * each with whether they take part and why not (`raffleParticipation`), how and when they signed up in the sign-up mode, and whether
 * they were there.
 *
 * Above it: the event's raffle settings in one line (who, how, open or closed — and why closed, when the settings alone would open
 * it), the counts — taking part by group, and how many of them were there —, the four filters «Toți», «Participă», «Nu participă»,
 * «Doar prezenții» (those taking part who were there, the present-only file's people) and the two files. Each row carries the
 * organizers' presses: «Înscrie» (STAFF; the sign-up mode with its gate open, the person eligible and not in, the acceptance's tick
 * beside it), «Scoate» / «Pune înapoi» (the exclusion, for the three kinds), «Șterge înscrierea» (asked first) and, on a line of the
 * elite list, «Prezent». Printed, it is the table without a control.
 *
 * The Organizer's and the Administrators' (`canTakeRaffleList`, §949: «doar adminul și organizatorul pot bifa și vedea asta»); anybody
 * else meets the 404 an unknown page gets, and every action and service asks again (BR-REQ-060-01). Nothing on it is public.
 */
export default async function RafflePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canTakeRaffleList(actor)) notFound();

  const { eventId: requestedEventId, filter: requestedFilter, error } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // The desk's own events (§67): today's first, else every event taking entries, so the raffle can be set up a week early.
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const event = events.find((candidate) => candidate.id === requestedEventId) ?? events[0];
  const eventId = event?.id;
  const filter: Filter = (FILTERS as readonly string[]).includes(requestedFilter ?? "") ? (requestedFilter as Filter) : "all";
  const errorCode = ALERT_CODES.find((code) => code === error);

  const roster = eventId ? await readRaffleRoster(db, actor, eventId, now) : null;
  const holds = roster?.settings.hasRaffle === true;
  const signUpMode = roster?.settings.signUp === true;
  const everybody = roster?.rows ?? [];
  const keeps = (value: Filter) => (row: RaffleRosterRow) =>
    value === "in" ? row.reason === "in" : value === "out" ? row.reason !== "in" : value === "present" ? row.reason === "in" && row.present : true;
  const rows = everybody.filter(keeps(filter));
  // How many each view holds, said on its pill.
  const filterCounts = Object.fromEntries(FILTERS.map((value) => [value, everybody.filter(keeps(value)).length])) as Record<Filter, number>;

  const eventLabel = (candidate: (typeof events)[number]) =>
    `${candidate.title ?? candidate.id} · ${typedStartOrNull(candidate) ? formatDay(candidate.startsAt, { locale, timeZone: candidate.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}`;
  const tabPath = getPathname({ locale, href: "/admin/checkin/tombola" });
  const filterHref = (value: Filter) => `${tabPath}?${new URLSearchParams({ ...(eventId ? { eventId } : {}), ...(value === "all" ? {} : { filter: value }) }).toString()}`;

  // What every form of a row posts besides its own boxes: the page's language, its event, the filter in force and the person.
  const hidden = (row: RaffleRosterRow) => (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId ?? ""} />
      <input type="hidden" name="filter" value={filter === "all" ? "" : filter} />
      <input type="hidden" name="table" value={row.ref.table} />
      <input type="hidden" name="personId" value={row.ref.id} />
    </>
  );

  // The settings in one line: who, how, open or closed — and, when the settings alone would open it, why it is closed.
  const settingsLine = roster
    ? [
        t("raffle.settings.who", {
          groups: RAFFLE_KINDS.filter((kind) => roster.settings.groups[kind]).map((kind) => t(`raffle.settings.groups.${kind}`)).join(", ") || t("raffle.settings.nobody"),
        }),
        signUpMode ? t("raffle.settings.signUp") : t("raffle.settings.automatic"),
        ...(signUpMode ? [roster.gateClosed === null ? t("raffle.settings.open") : t("raffle.settings.closed")] : []),
      ].join(" · ")
    : null;
  const closedWhy = roster && signUpMode && roster.settings.signUpOpen && roster.gateClosed !== null ? t("raffle.settings.why", { why: t(`raffle.settings.closedWhy.${roster.gateClosed}`) }) : null;

  const reasonWords = (row: RaffleRosterRow) => (row.reason === "in" ? t("raffle.yes") : `${t("raffle.no")} · ${t(`raffle.reasons.${row.reason}`)}`);

  const actions = (row: RaffleRosterRow): ReactNode => (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", ...NOT_ON_PAPER }}>
      {row.maySignUp && (
        <Box component="form" action={raffleSignUpAction} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }} data-testid="raffle-sign-up-form">
          {hidden(row)}
          <CheckboxField name="accepted" required dense requiredMessage={t("errors.RAFFLE_RULES_NOT_ACCEPTED")}>
            {t("raffle.accepted")}
          </CheckboxField>
          <GlyphButton icon="addPerson" type="submit" variant="outlined" size="small" sx={TAP_TARGET} aria-label={t("raffle.signUpFor", { name: row.name })} data-testid="raffle-sign-up">
            {t("raffle.signUpShort")}
          </GlyphButton>
        </Box>
      )}
      <Box component="form" action={raffleExclusionAction} data-testid="raffle-exclusion-form">
        {hidden(row)}
        <input type="hidden" name="inRaffle" value={row.inRaffle ? "0" : "1"} />
        <GlyphButton
          icon={row.inRaffle ? "tickOff" : "tickOn"}
          type="submit"
          variant="text"
          size="small"
          sx={TAP_TARGET}
          aria-label={t(row.inRaffle ? "raffle.takeOutFor" : "raffle.putBackFor", { name: row.name })}
          data-testid="raffle-exclusion"
        >
          {row.inRaffle ? t("raffle.takeOut") : t("raffle.putBack")}
        </GlyphButton>
      </Box>
      {row.signUp && (
        <Box component="form" action={raffleDeleteEntryAction} data-testid="raffle-delete-form">
          {hidden(row)}
          <input type="hidden" name="entryId" value={row.signUp.entryId} />
          <ConfirmSubmitButton
            label={t("raffle.delete")}
            ariaLabel={t("raffle.deleteFor", { name: row.name })}
            icon="delete"
            color="error"
            variant="text"
            size="small"
            title={t("raffle.deleteTitle", { name: row.name })}
            body={t("raffle.deleteBody")}
            confirmLabel={t("raffle.delete")}
            cancelLabel={t("raffle.cancel")}
          />
        </Box>
      )}
    </Stack>
  );

  const presentCell = (row: RaffleRosterRow): ReactNode =>
    // A line of the elite list: the organizers' own tick — the desk checks no line in. Everybody else: what the desk or the «Voluntari» list said.
    row.ref.table === "elite" ? (
      <>
        <Box component="form" action={raffleElitePresentAction} sx={NOT_ON_PAPER} data-testid="raffle-elite-present-form">
          {hidden(row)}
          <input type="hidden" name="present" value={row.present ? "0" : "1"} />
          <TickButton checked={row.present} aria-label={t("raffle.presentFor", { name: row.name })} data-testid="raffle-elite-present">
            {t("raffle.present")}
          </TickButton>
        </Box>
        <Box component="span" sx={ONLY_ON_PAPER}>
          {row.present ? t("raffle.yes") : t("raffle.no")}
        </Box>
      </>
    ) : row.present ? (
      t("raffle.yes")
    ) : (
      t("raffle.no")
    );

  const columns: AdminColumn<RaffleRosterRow>[] = [
    { key: "number", label: t("raffle.columns.number"), render: (row) => (row.number === null ? "—" : String(row.number)) },
    {
      key: "name",
      label: t("raffle.columns.name"),
      primary: true,
      // The row's address (`#raffle-<id>`, where a press comes back) is the table's `rowId`: AdminTable draws each row twice.
      render: (row) => (
        <Box component="span" sx={{ overflowWrap: "anywhere" }} data-testid="raffle-row-name">
          {row.name}
        </Box>
      ),
    },
    { key: "kind", label: t("raffle.columns.kind"), render: (row) => t(`registrations.raffle.kinds.${row.kind}`) },
    {
      key: "in",
      label: t("raffle.columns.in"),
      essential: true,
      render: (row) => (
        <Box component="span" data-testid="raffle-row-in" data-in={row.reason === "in" ? "1" : "0"} sx={{ fontWeight: row.reason === "in" ? 700 : 400 }}>
          {reasonWords(row)}
        </Box>
      ),
    },
    ...(signUpMode
      ? [
          {
            key: "how",
            label: t("raffle.columns.how"),
            render: (row: RaffleRosterRow) =>
              row.signUp ? t("raffle.signedUpAt", { method: t(`raffle.methods.${row.signUp.method}`), when: formatDay(row.signUp.at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }) }) : "—",
          } satisfies AdminColumn<RaffleRosterRow>,
        ]
      : []),
    { key: "present", label: t("raffle.columns.present"), render: presentCell },
  ];

  return (
    <Stack spacing={3}>
      {await raceDayTabs({ locale, active: "raffle", eventId, actor })}
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="raffle-title">
        {t("raffle.title")}
      </Typography>
      {event && (
        <Typography variant="subtitle1" sx={ONLY_ON_PAPER}>
          {eventLabel(event)}
        </Typography>
      )}

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }}>
        {errorCode && (
          <Alert severity="error" data-testid="raffle-error">
            {t(`errors.${errorCode}`)}
          </Alert>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER}>
        {t("raffle.intro")}
      </Typography>

      {events.length === 0 ? (
        <Alert severity="warning">{t("raffle.noEvent")}</Alert>
      ) : (
        <Box component="form" method="get" sx={NOT_ON_PAPER}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            {/* A native select, as on the desk: it works before hydration, and the form is a GET anyway. */}
            <TextField
              select
              name="eventId"
              label={t("raffle.event")}
              defaultValue={eventId}
              size="small"
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 240 }}
            >
              {events.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {eventLabel(candidate)}
                </option>
              ))}
            </TextField>
            <GlyphButton icon="search" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {t("raffle.show")}
            </GlyphButton>
          </Stack>
        </Box>
      )}

      {eventId && roster && !holds && (
        <Alert severity="info" data-testid="raffle-none">
          {t("raffle.noRaffle")}
        </Alert>
      )}

      {eventId && roster && holds && (
        <>
          <Stack spacing={0.5}>
            <Typography variant="body2" data-testid="raffle-settings-line">
              {settingsLine}
            </Typography>
            {closedWhy && (
              <Typography variant="body2" color="warning.main" data-testid="raffle-closed-why">
                {closedWhy}
              </Typography>
            )}
            {/* The settings are the editor's, whose save is the Administrator's (§542): the way there for who may press it. */}
            {canEditEventFields(actor) && (
              <Box sx={NOT_ON_PAPER}>
                <GlyphButton
                  icon="edit"
                  href={`${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } })}#box-bibs`}
                  variant="text"
                  size="small"
                  sx={TAP_TARGET}
                  data-testid="raffle-settings-edit"
                >
                  {t("raffle.settings.edit")}
                </GlyphButton>
              </Box>
            )}
          </Stack>

          <Typography variant="body2" data-testid="raffle-counts">
            {[
              t("raffle.counts.total", { count: String(roster.counts.total) }),
              ...RAFFLE_KINDS.filter((kind) => roster.settings.groups[kind]).map((kind) => t(`raffle.counts.${kind}`, { count: String(roster.counts.in[kind]) })),
              t("raffle.counts.present", { count: String(roster.counts.present) }),
            ].join(" · ")}
          </Typography>

          {/* The four views, the house's filter pills (`ChipLink`, as the «Voluntari» list's «Prezenți» and «Absenți»): each says how
              many it holds, the one in force is marked, and pressing it again is «Toți». «Doar prezenții» are the present-only file's people. */}
          <Stack component="nav" aria-label={t("raffle.filters.label")} direction="row" sx={{ flexWrap: "wrap", gap: 1, ...NOT_ON_PAPER }} data-testid="raffle-filters">
            {FILTERS.map((value) => (
              <Box component="span" key={value} data-testid={`raffle-filter-${value}`}>
                <ChipLink
                  href={filterHref(filter === value ? "all" : value)}
                  label={t(`raffle.filters.${value}`, { count: String(filterCounts[value]) })}
                  active={filter === value}
                  current={filter === value ? "page" : undefined}
                  keepScroll
                  wrap
                />
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={NOT_ON_PAPER}>
            {t("raffle.filters.presentHint")}
          </Typography>

          <Box id="raffle-rows" sx={{ scrollMarginTop: 16 }}>
            <AdminTable
              caption={t("raffle.title")}
              tableId="raffle-roster"
              columns={columns}
              rows={rows}
              rowKey={(row) => `${row.ref.table}-${row.ref.id}`}
              rowId={(row) => `raffle-${row.ref.id}`}
              basePath={tabPath}
              currentParams={{ eventId, ...(filter === "all" ? {} : { filter }) }}
              query={{ page: 1, perPage: Math.max(rows.length, 1), sort: "number", dir: "asc", offset: 0, limit: Math.max(rows.length, 1) }}
              total={rows.length}
              labels={{
                results: t("list.results", { count: rows.length }),
                page: t("list.page", { page: 1, pages: 1 }),
                previous: t("list.previous"),
                next: t("list.next"),
                perPage: t("list.perPage"),
                actions: t("raffle.columns.actions"),
                sortBy: (column) => t("list.sortBy", { column }),
              }}
              rowActions={actions}
              paged={false}
              printable
              empty={
                <Typography color="text.secondary" data-testid="raffle-empty">
                  {t("raffle.empty")}
                </Typography>
              }
            />
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexWrap: "wrap", gap: 1, ...NOT_ON_PAPER }}>
            <GlyphButton icon="download" href={`/api/admin/events/${eventId}/raffle?lang=${locale}`} variant="outlined" size="small" sx={TAP_TARGET} aria-label={t("registrations.raffle.buttonLabel")} data-testid="raffle-download">
              {t("registrations.raffle.button")}
            </GlyphButton>
            <GlyphButton icon="download" href={`/api/admin/events/${eventId}/raffle?present=1&lang=${locale}`} variant="outlined" size="small" sx={TAP_TARGET} aria-label={t("registrations.raffle.presentButtonLabel")} data-testid="raffle-download-present">
              {t("registrations.raffle.presentButton")}
            </GlyphButton>
            <PrintButton label={t("raffle.print")} />
          </Stack>
        </>
      )}
    </Stack>
  );
}
