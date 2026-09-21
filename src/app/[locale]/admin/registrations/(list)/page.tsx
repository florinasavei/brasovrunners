import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countRegistrationsForAdmin,
  listEventsWithRegistrations,
  listRegistrationsForAdmin,
  REGISTRATION_SORT_KEYS,
  type RegistrationListRow,
  type RegistrationSortKey,
} from "@/modules/registrations/admin-repository";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { registrationStatus } from "@/db/schema/registrations";
import { journeyOf } from "@/modules/registrations/domain/journey";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import {
  buildListHref,
  parseListQuery,
  pageCount,
} from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { bulkCancelRegistrationsAction, sendOutboxNowAction } from "../actions";
import { resendRegistrationEmailAction } from "../[id]/actions";
import {
  cancelRegistrationAction,
  checkInAction,
  confirmRegistrationNowAction,
  eraseRegistrationFromListAction,
  promoteRegistrationAction,
} from "../actions";
import { ALL_EVENTS, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
import { rowVerbsFor } from "@/modules/registrations/domain/row-verbs";
import RegistrationRowMenu, { type RegistrationMenuItem } from "@/modules/registrations/ui/RegistrationRowMenu";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/** The id of the bulk form, which lives below the table but owns the checkboxes inside it. */
const BULK_FORM = "bulk-cancel";

function isRegistrationStatus(value: string | undefined): value is RegistrationStatus {
  return !!value && (registrationStatus.enumValues as readonly string[]).includes(value);
}

/**
 * Who is registered, and for what (BR-REQ-060-01, BR-REQ-070-01). Administrator only — §10.2
 * reserves "registrations, participants, waitlist... exports" to that role, and no other role
 * gets a hint that this screen exists: an Author or Editor guessing the URL gets 404, the same
 * pattern `admin/staff/page.tsx` uses.
 *
 * Never shows an email address in a list a wider staff role could stumble onto — the delivery
 * address is shown here, on this Administrator-only page, and nowhere public
 * (`privacy/public-surface.test.ts` is what proves that this stays true).
 *
 * ## What changed, and why it had to
 *
 * This was a stack of cards, one per registration, each carrying three inline forms. With eighty
 * people on an event it was a page an organizer scrolled rather than read, there was no way to
 * find one person short of the browser's own find-in-page, and every row of every season was
 * fetched to render it. BR-REQ-041-01 criterion 7 asks for exactly the thing it could not do:
 * find a participant by name on a phone and read their status without scrolling sideways.
 *
 * Now it is a sorted, searched, server-paginated table (`AdminTable`, which documents why it is
 * not a data grid). The row still carries the cheap verbs. The two that need a typed reason moved:
 * cancelling several at once is the bulk form below the table, and everything about one person —
 * rename, cancel, erase — is on their own page, which is where §15.11's four verbs live in full.
 */
export default async function AdminRegistrationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const current = await searchParams;
  const { eventId, status, clubMember, bounced, q, saved, error, cancelled, failed, sent, erase } = current;

  const query = parseListQuery(current, {
    sortable: REGISTRATION_SORT_KEYS,
    // Newest first: the registration somebody is asking about is almost always a recent one.
    defaultSort: "submitted",
    defaultDir: "desc",
  });

  const filters: {
    eventId?: string;
    status?: RegistrationStatus;
    clubMemberDeclared?: true;
    emailBounced?: true;
    search?: string;
  } = {
    status: isRegistrationStatus(status) ? status : undefined,
    // One-way: it narrows to the people who ticked the box and never to the ones who did not
    // (`admin-repository.ts` says why).
    clubMemberDeclared: clubMember === "1" || undefined,
    emailBounced: bounced === "1" || undefined,
    search: q || undefined,
  };

  const db = getDb();
  /*
    The events come first now, because the default filter is derived from them (§178): with no
    eventId in the query the list is about the club's featured event, which is the one anybody
    opening this page is asking about. "Toate evenimentele" stays one press away as `all`.
  */
  const [volume, events] = await Promise.all([
    readEmailVolumeToday(db, new Date()),
    listEventsWithRegistrations(db),
  ]);
  const eventFilter = defaultEventFilter(eventId, events);
  filters.eventId = eventFilter.eventId;

  const [rows, total] = await Promise.all([
    listRegistrationsForAdmin(db, filters, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort as RegistrationSortKey,
      dir: query.dir,
    }),
    countRegistrationsForAdmin(db, filters),
  ]);

  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const basePath = getPathname({ locale, href: "/admin/registrations" });
  /** Only the list-shaping keys travel with a sort link or a page link. */
  const listParams = {
    eventId: eventFilter.selected,
    status,
    clubMember,
    bounced,
    q,
    sort: current.sort,
    dir: current.dir,
    page: current.page,
    perPage: current.perPage,
  };
  const listQueryString = buildListHref("", listParams, {}).replace(/^\?/, "");
  const hasFilters = Boolean(eventId || status || clubMember || bounced || q);

  /*
    Where the erase panel opens, and where it closes back to (§180).

    `page` is patched in explicitly on both, because `buildListHref` drops it by default — right
    for a filter or a sort, which should land you on the first page of the new list, and wrong
    here: erasing the third row of page four must come back to page four, not to page one.
  */
  const eraseHref = (registrationId: string): string =>
    `${buildListHref(basePath, listParams, { erase: registrationId, page: current.page })}#erase-panel`;
  const eraseReturnQuery = buildListHref("", listParams, { page: current.page }).replace(/^\?/, "");

  /*
    The row the panel is about — found among the rows already fetched, never fetched by id.

    That is the whole guard on the query parameter, and it is enough: a row that is not on the
    page in front of you cannot be named, so `?erase=<some other id>` opens nothing, and the
    name the panel asks to have typed is a name that is genuinely on screen. `requireStaffRole`
    in the action is what actually refuses the erasure (BR-REQ-060-01); this decides only what
    is drawn.
  */
  const eraseTarget = erase ? (rows.find((row) => row.id === erase) ?? null) : null;
  const mayErase = canManageRegistrations(actor.role);

  const columns: readonly AdminColumn<RegistrationListRow>[] = [
    {
      key: "name",
      label: t("registrations.columnName"),
      sortable: true,
      initialDir: "asc",
      primary: true,
      render: (row) => (
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
          <Link
            href={{ pathname: "/admin/registrations/[id]", params: { id: row.id } }}
            aria-label={t("registrations.openNamed", { name: row.registeredName })}
          >
            {row.registeredName}
          </Link>
          {/* Unmistakable wherever a registration is listed, so a demonstration queue is never
              read as real sign-ups (`DECISIONS.md` §30). The export omits these rows entirely. */}
          {row.kind === "TEST" && (
            <Chip size="small" color="warning" label={t("registrations.testKind")} />
          )}
          {/* BR-REQ-031-06. "Declared" in both languages, because this is what the person wrote
              about themselves and not something the club checked. */}
          {row.clubMemberDeclared && (
            <Chip
              size="small"
              color="info"
              variant="outlined"
              label={t("registrations.clubMemberChip")}
            />
          )}
          {/* "Is my name on the site?" is asked of the club, not of the platform (§186). Marked
              only when the answer is no: on an event that publishes a list most rows are on it,
              and a chip on every row is a chip nobody reads. On an event with no published list
              the mark is still true — it says what this person asked for, whatever the club
              later switches on. */}
          {row.listOptOut && (
            <Chip
              size="small"
              variant="outlined"
              label={t("registrations.notOnPublicList")}
            />
          )}
        </Stack>
      ),
    },
    {
      key: "status",
      label: t("registrations.columnStatus"),
      sortable: true,
      render: (row) => <Chip size="small" label={REGISTRATION_STATUS_LABEL[row.status]} />,
    },
    {
      // The owner's "what step each participant is in" (§145): steps done out of six and the
      // last one done, from the same derivation the registration's page shows in full.
      // Not sortable — the status column beside it is the ordered one.
      key: "journey",
      label: t("registrations.columnJourney"),
      // "3/6" cannot say what the six are (§200).
      hint: t("registrations.journey.legend"),
      // The number the runner has, settled or not (§214): the chip said "nr. 42" and would
      // otherwise say nothing at all for everybody registered before the window closes.
      render: (row) => <StaffJourney journey={journeyOf(row)} bibNumber={raceNumberOf(row)?.value ?? null} variant="compact" />,
    },
    {
      /*
        The race number, as its own column (§173; the owner: "și nu văd BID-ul"). It was inside
        the journey chip, which is where somebody looks for "how far along are they" and not for
        "which number is this". On race morning it is the column the list is read by.
      */
      key: "bib",
      label: t("registrations.columnBib"),
      sortable: true,
      /*
        Whichever number the runner has (§214). Before the window closes it is the provisional
        one, shown in a lighter weight with an asterisk and explained by the column's own hint:
        the club needs to see it — that is the whole reason it exists — and also needs to know
        it is not the one to print.
      */
      render: (row) => {
        const number = raceNumberOf(row);
        if (number === null) {
          return (
            <Box component="span" sx={{ color: "text.disabled" }}>
              —
            </Box>
          );
        }
        return (
          <Box
            component="span"
            title={number.settled ? undefined : t("registrations.bibProvisional")}
            sx={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: number.settled ? 700 : 500,
              color: number.settled ? "text.primary" : "text.secondary",
            }}
          >
            {number.value}
            {number.settled ? "" : "*"}
          </Box>
        );
      },
    },
    {
      key: "event",
      label: t("registrations.columnEvent"),
      sortable: true,
      initialDir: "asc",
      render: (row) => row.eventTitle ?? row.eventId,
    },
    {
      key: "email",
      label: t("registrations.columnEmail"),
      hideBelow: "lg",
      render: (row) => (
        <Box component="span" sx={{ wordBreak: "break-all" }}>
          {row.participantEmail}
        </Box>
      ),
    },
    {
      key: "submitted",
      label: t("registrations.columnSubmitted"),
      sortable: true,
      initialDir: "desc",
      hideBelow: "lg",
      render: (row) => format.dateTime(row.submittedAt, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Every backoffice page gives this id to its alert region; the Server Actions redirect
          to `#admin-alert` so the browser lands on the outcome. The theme gives `html` a
          `scroll-padding-top` so the sticky site header cannot cover it after a long list. */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "registrationsCancelled" && (
          <Alert severity={Number(failed) > 0 ? "warning" : "success"}>
            {t("registrations.registrationsCancelled", {
              cancelled: cancelled ?? "0",
              failed: failed ?? "0",
            })}
          </Alert>
        )}
        {saved === "outboxSent" && (
          <Alert severity="success">{t("outbox.sentNow", { count: Number(sent ?? "0") })}</Alert>
        )}
        {saved === "registrationDeleted" && (
          <Alert severity="success">{t("registrations.registrationDeleted")}</Alert>
        )}
        {saved &&
          saved !== "registrationsCancelled" &&
          saved !== "outboxSent" &&
          saved !== "registrationDeleted" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      {/*
        The erase panel (§180). The owner, three times: "vreau sa pot sterge si participantii".

        Why it is a panel on the page and not a dialog in the row menu. Erasing is the one verb
        here that cannot be undone — it takes the declaration, the address and, when this was
        their last registration, the participant. A dialog with a button is answered yes by
        reflex, and in a list where the row you meant and the row above it are one line apart,
        the reflex is how the wrong person gets erased. So the confirmation is a transcription:
        the name on the row, typed. You cannot type it by reflex and you cannot type it while
        looking at the wrong row.

        And why it is a *page*, reached by a plain link with the row's id in the query, rather
        than state inside the client island. With JavaScript off the "⋮" menu never opens, so a
        dialog inside it would make erasure unreachable — the rule is that a form works without
        JavaScript, and a confirmation is part of the form. This is a link, a server-rendered
        form and a redirect: identical with JavaScript and without it. The `<noscript>` link in
        the row is only there because the *menu* needs JavaScript to open; the panel it leads to
        never did.
      */}
      {mayErase && eraseTarget && (
        <Box
          component="section"
          id="erase-panel"
          tabIndex={-1}
          sx={{ border: 1, borderColor: "error.main", borderRadius: 1, px: 2, py: 2, scrollMarginTop: 16 }}
        >
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1, color: "error.main" }}>
            {t("registrations.eraseTitle", { name: eraseTarget.registeredName })}
          </Typography>
          <Box component="form" action={eraseRegistrationFromListAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={eraseTarget.id} />
            {/* Only the query, never a path: `actions.ts` rebuilds the path from `getPathname`,
                so this field can choose which rows come back and nothing else. */}
            <input type="hidden" name="listQuery" value={eraseReturnQuery} />
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {t("registrations.deleteHelp")}
              </Typography>
              <TextField
                name="reason"
                label={t("registrations.deleteReason")}
                required
                size="small"
                sx={{ maxWidth: 480 }}
              />
              <TextField
                name="confirmName"
                label={t("registrations.eraseTypeName")}
                helperText={t("registrations.eraseTypeNameHelp", { name: eraseTarget.registeredName })}
                required
                size="small"
                autoComplete="off"
                sx={{ maxWidth: 480 }}
              />
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <SubmitButton
                  label={t("registrations.eraseAction")}
                  pendingLabel={t("registrations.erasePending")}
                  color="error"
                  variant="contained"
                />
                {/* A link, not a button: leaving the panel is a navigation, and it must work
                    for the same reader the panel itself was built for. */}
                <Button
                  component="a"
                  href={buildListHref(basePath, listParams, { erase: undefined, page: current.page })}
                  variant="text"
                  sx={TAP_TARGET}
                >
                  {t("confirm.cancel")}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Box>
      )}

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.registrations")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {/* BR-REQ-037-05: somebody asked at a run, and the club types it in for them. */}
          <Button
            component="a"
            href={`${getPathname({ locale, href: "/admin/registrations/new" })}${eventId ? `?eventId=${eventId}` : ""}`}
            variant="contained"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.new")}
          </Button>
          {/*
            The export takes the filters and not the page: a spreadsheet of whichever 25 rows
            happened to be on screen would be a quietly wrong file (§15.10). Set the event
            filter and the file is that race's start list, named after it (§172).

            Excel first, because that is what somebody opens: a bold frozen header, columns
            wide enough to read, dates that sort as dates. The comma-separated file stays for
            whoever is feeding it to something else.
          */}
          <Button
            component="a"
            href={`/api/admin/registrations/export?format=xlsx${listQueryString ? `&${listQueryString}` : ""}`}
            variant="outlined"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.exportExcel")}
          </Button>
          <Button
            component="a"
            href={`/api/admin/registrations/export${listQueryString ? `?${listQueryString}` : ""}`}
            variant="text"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.export")}
          </Button>
        </Stack>
      </Stack>

      {/*
        The outbox, and the day's Mailgun counter (`DECISIONS.md` §80): what is waiting, what
        went out today against the free day's hundred, and "send now" for whoever does not want
        to wait for the monitor. The counter is the ceiling the button respects, and the number
        a newsletter would have to fit under.
      */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, border: 1, borderColor: "divider", borderRadius: 1, px: 2, py: 1.5 }}
        data-testid="outbox-panel"
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {t(`outbox.status.${volume.period}`, {
            waiting: volume.waitingMessages,
            sent: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
            allowance: volume.allowance ?? "",
            remaining: volume.remaining ?? "",
            plan: volume.planName,
          })}
        </Typography>
        {/* The button only when there is something to send and room to send it: a disabled
            button cannot say why (`SubmitButton`'s own rule), a sentence can. */}
        {volume.waitingMessages > 0 && (volume.remaining === null || volume.remaining > 0) ? (
          <Box component="form" action={sendOutboxNowAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="listQuery" value={listQueryString} />
            <SubmitButton
              label={t("outbox.sendNow")}
              pendingLabel={t("outbox.sending")}
              ariaLabel={t("outbox.sendNowLong")}
              variant="contained"
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {volume.waitingMessages === 0 ? t("outbox.nothingWaiting") : t("outbox.allowanceSpent")}
          </Typography>
        )}
      </Stack>

      {/*
        A plain GET form, so filtering and searching are a URL an organizer can bookmark and
        come back to, and so both keep working with JavaScript off. `sort` and `dir` ride along
        as hidden fields: filtering should narrow the list, not silently re-sort it.
      */}
      <Box component="form" method="get" action={basePath}>
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        <input type="hidden" name="perPage" value={String(query.perPage)} />
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
          {/* BR-REQ-041-01 criterion 7. First, and widest, because on race morning it is the
              only one that gets used. */}
          <TextField
            name="q"
            type="search"
            label={t("list.searchByName")}
            helperText={t("registrations.searchHelp")}
            defaultValue={q ?? ""}
            sx={{ minWidth: 260, flexGrow: 1 }}
          />
          <TextField
            select
            name="eventId"
            label={t("nav.events")}
            defaultValue={eventFilter.selected}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value={ALL_EVENTS}>{t("registrations.filterAll")}</MenuItem>
            {events.map((event) => (
              <MenuItem key={event.id} value={event.id}>
                {event.title ?? event.id}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            name="clubMember"
            label={t("registrations.clubMemberLabel")}
            defaultValue={clubMember === "1" ? "1" : ""}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
            <MenuItem value="1">{t("registrations.clubMemberOnly")}</MenuItem>
          </TextField>
          {/* Who never got the email (§76, §83): the rows to call. */}
          <TextField
            select
            name="bounced"
            label={t("registrations.bouncedLabel")}
            defaultValue={bounced === "1" ? "1" : ""}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
            <MenuItem value="1">{t("registrations.bouncedOnly")}</MenuItem>
          </TextField>
          <TextField
            select
            name="status"
            label={t("registrations.statusLabel")}
            defaultValue={status ?? ""}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
            {registrationStatus.enumValues.map((value) => (
              <MenuItem key={value} value={value}>
                {REGISTRATION_STATUS_LABEL[value]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ pt: 1, flexWrap: "wrap", gap: 1 }}>
            <Button type="submit" variant="contained" sx={TAP_TARGET}>
              {t("registrations.filter")}
            </Button>
            {hasFilters && (
              <Button component="a" href={basePath} variant="text" sx={TAP_TARGET}>
                {t("list.clear")}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      <AdminTable
        caption={t("registrations.tableCaption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        basePath={basePath}
        currentParams={listParams}
        query={query}
        total={total}
        labels={{
          results: t("list.results", { count: total }),
          page: t("list.page", { page: query.page, pages: pageCount(total, query.perPage) }),
          previous: t("list.previous"),
          next: t("list.next"),
          perPage: t("list.perPage"),
          actions: t("list.actions"),
          sortBy: (column) => t("list.sortBy", { column }),
        }}
        empty={
          <Typography variant="body1">
            {hasFilters ? t("registrations.emptyFiltered") : t("registrations.empty")}
          </Typography>
        }
        rowActions={(row) => (
          /*
            One line, never wrapped. These wrapped onto three rows inside the actions cell and
            each registration became about 160 pixels tall — four rows filled a laptop screen, on
            the list whose whole purpose is to make eighty of them scannable. The row's name is
            already the link into the registration, so the "open" button that used to sit here
            was a second copy of it costing a line.
          */
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "nowrap", gap: 0.5 }}
          >
            {/*
              The checkbox belongs to the bulk form below the table, not to any form around the
              row — `form=` is what lets one form own controls that sit outside it, which is the
              only way to have both a bulk action and per-row forms without nesting one inside
              the other, which HTML forbids.
            */}
            <Checkbox
              name="registrationId"
              value={row.id}
              form={BULK_FORM}
              slotProps={{
                input: { "aria-label": t("registrations.selectRow", { name: row.registeredName }) },
              }}
              sx={CHECKBOX_TAP_TARGET}
            />
            {deriveAllowedResendMessageType(row.status) && (
              <Box component="form" action={resendRegistrationEmailAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="registrationId" value={row.id} />
                <SubmitButton
                  label={row.status === "CONFIRMED" ? t("registrations.resendQr") : t("registrations.resendShort")}
                  pendingLabel={row.status === "CONFIRMED" ? t("registrations.resendQr") : t("registrations.resendShort")}
                  ariaLabel={row.status === "CONFIRMED" ? t("registrations.resendQrLong") : t("registrations.resend")}
                  variant="outlined"
                  // One per row, in a narrow column: the 44-pixel floor and a wrapping label
                  // together made every row seventy pixels tall in a list whose whole purpose
                  // is to make eighty of them scannable. The full sentence is still the
                  // accessible name.
                  compact
                />
              </Box>
            )}
            {/*
              The rest of the verbs behind "⋮" (§178). Each is a hidden form the Server Component
              renders, already carrying its action and its fields; the menu only decides which one
              to submit. Which verbs appear is `rowVerbsFor`, a pure function tested against the
              state machine — and every one of them is authorized again in its own service, so
              this is a courtesy and not a gate (BR-REQ-060-01).
            */}
            {(() => {
              const verbs = rowVerbsFor(row.status, actor.role, { checkedIn: row.checkedInAt !== null });
              const hidden = (
                <>
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="registrationId" value={row.id} />
                </>
              );
              const items: RegistrationMenuItem[] = [
                {
                  kind: "link",
                  icon: "open",
                  label: t("registrations.openRow"),
                  href: getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: row.id } } }),
                },
              ];
              if (verbs.includes("confirmOnPaper")) {
                items.push({
                  kind: "submit",
                  icon: "confirm",
                  label: t("desk.confirmOnPaper"),
                  formId: `confirm-${row.id}`,
                  confirm: {
                    title: t("desk.confirmOnPaper"),
                    body: t("registrations.confirmOnPaperBody"),
                    confirmLabel: t("desk.confirmOnPaper"),
                  },
                });
              }
              if (verbs.includes("givePlace")) {
                items.push({ kind: "submit", icon: "place", label: t("desk.givePlace"), formId: `place-${row.id}` });
              }
              if (verbs.includes("checkIn")) {
                items.push({ kind: "submit", icon: "checkIn", label: t("desk.checkIn"), formId: `checkin-${row.id}` });
              }
              if (verbs.includes("undoCheckIn")) {
                items.push({ kind: "submit", icon: "undo", label: t("desk.undoCheckIn"), formId: `checkin-${row.id}` });
              }
              if (verbs.includes("cancel")) {
                items.push({
                  kind: "submit",
                  icon: "cancel",
                  label: t("registrations.cancel"),
                  formId: `cancel-${row.id}`,
                  color: "error",
                  confirm: {
                    title: t("registrations.cancel"),
                    body: t("registrations.cancelBody"),
                    confirmLabel: t("registrations.cancel"),
                  },
                });
              }
              /*
                Last, below a rule, in the error colour (§180). A link and not a submit: there is
                no hidden form to post, because erasing asks for two things nobody can put in a
                hidden field — a reason and the row's name, typed. It opens the panel at the top
                of this page instead, which is a plain server-rendered form and therefore the
                same experience with JavaScript and without it.
              */
              if (verbs.includes("erase")) {
                items.push({
                  kind: "link",
                  icon: "erase",
                  label: t("registrations.erase"),
                  href: eraseHref(row.id),
                  color: "error",
                  separated: true,
                });
              }
              return (
                <>
                  {verbs.includes("confirmOnPaper") && (
                    <Box component="form" id={`confirm-${row.id}`} action={confirmRegistrationNowAction} sx={{ display: "none" }}>
                      {hidden}
                    </Box>
                  )}
                  {verbs.includes("givePlace") && (
                    <Box component="form" id={`place-${row.id}`} action={promoteRegistrationAction} sx={{ display: "none" }}>
                      {hidden}
                    </Box>
                  )}
                  {(verbs.includes("checkIn") || verbs.includes("undoCheckIn")) && (
                    <Box component="form" id={`checkin-${row.id}`} action={checkInAction} sx={{ display: "none" }}>
                      {hidden}
                      <input type="hidden" name="direction" value={row.checkedInAt ? "undo" : "in"} />
                    </Box>
                  )}
                  {verbs.includes("cancel") && (
                    <Box component="form" id={`cancel-${row.id}`} action={cancelRegistrationAction} sx={{ display: "none" }}>
                      {hidden}
                    </Box>
                  )}
                  <RegistrationRowMenu
                    ariaLabel={t("registrations.rowActions", { name: row.registeredName })}
                    cancelLabel={t("confirm.cancel")}
                    items={items}
                  />
                  {/*
                    Erasing is the one verb on this row that has to survive JavaScript being off,
                    because it is the one the owner reached for and could not find. The "⋮" menu
                    is a client island: with no JavaScript it never opens, and every verb inside
                    it is reachable instead from the registration's own page — every verb except
                    this one, which is the point of the work.

                    `<noscript>` is markup the server already sent, so this costs no bytes of
                    JavaScript and nothing at all when JavaScript is on, where the browser does
                    not render it. It points at the same href the menu item does, and the panel
                    it opens is the same panel. Nothing is duplicated but the way in.

                    An element inside `<noscript>` is safe here, which is worth writing down
                    because it does not look it: with scripting enabled a browser parses the
                    contents of `<noscript>` as plain text rather than as DOM, which is the shape
                    a hydration mismatch is usually made of. React 19 handles it deliberately —
                    `shouldSetTextContent` is true for `noscript`, so `beginWork` reconciles it
                    with `null` children and never builds fibers for what is inside, and the
                    hydration-diff warning is skipped for the same elements. The server renders
                    the real `<a>`, checked, and the client never looks at it.
                  */}
                  {verbs.includes("erase") && (
                    <noscript>
                      <a href={eraseHref(row.id)}>{t("registrations.erase")}</a>
                    </noscript>
                  )}
                </>
              );
            })()}
          </Stack>
        )}
      />

      {rows.length > 0 && (
        <Box
          component="details"
          sx={{
            border: 1,
            borderColor: "warning.light",
            borderRadius: 1,
            px: 2,
            "& > summary": { cursor: "pointer", py: 1.5, minHeight: 44, listStyle: "revert" },
          }}
        >
          <Typography component="summary" variant="body2">
            {t("registrations.bulkCancelTitle")}
          </Typography>
          <Box component="form" id={BULK_FORM} action={bulkCancelRegistrationsAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            {/* Only the query, never a path: `actions.ts` rebuilds the path itself so this
                field cannot become an open redirect. */}
            <input type="hidden" name="listQuery" value={listQueryString} />
            <Stack spacing={1.5} sx={{ pb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t("registrations.bulkCancelHelp")}
              </Typography>
              <TextField name="reason" label={t("registrations.cancelReason")} size="small" required />
              <Box>
                <SubmitButton
                  label={t("registrations.bulkCancelAction")}
                  pendingLabel={t("registrations.bulkCancelPending")}
                  color="warning"
                  variant="contained"
                />
              </Box>
            </Stack>
          </Box>
        </Box>
      )}
    </Stack>
  );
}
