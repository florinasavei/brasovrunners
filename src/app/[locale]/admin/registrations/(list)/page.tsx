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
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
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
import { bulkCancelRegistrationsAction } from "../actions";
import { resendRegistrationEmailAction } from "../[id]/actions";

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
  const { eventId, status, clubMember, q, saved, error, cancelled, failed } = current;

  const query = parseListQuery(current, {
    sortable: REGISTRATION_SORT_KEYS,
    // Newest first: the registration somebody is asking about is almost always a recent one.
    defaultSort: "submitted",
    defaultDir: "desc",
  });

  const filters = {
    eventId: eventId || undefined,
    status: isRegistrationStatus(status) ? status : undefined,
    // One-way: it narrows to the people who ticked the box and never to the ones who did not
    // (`admin-repository.ts` says why).
    clubMemberDeclared: clubMember === "1" || undefined,
    search: q || undefined,
  };

  const db = getDb();
  const [rows, total, events] = await Promise.all([
    listRegistrationsForAdmin(db, filters, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort as RegistrationSortKey,
      dir: query.dir,
    }),
    countRegistrationsForAdmin(db, filters),
    listEventsWithRegistrations(db),
  ]);

  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const basePath = getPathname({ locale, href: "/admin/registrations" });
  /** Only the list-shaping keys travel with a sort link or a page link. */
  const listParams = {
    eventId,
    status,
    clubMember,
    q,
    sort: current.sort,
    dir: current.dir,
    page: current.page,
    perPage: current.perPage,
  };
  const listQueryString = buildListHref("", listParams, {}).replace(/^\?/, "");
  const hasFilters = Boolean(eventId || status || clubMember || q);

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
      render: (row) => format.dateTime(row.submittedAt, { dateStyle: "medium", timeStyle: "short" }),
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
        {saved && saved !== "registrationsCancelled" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

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
            happened to be on screen would be a quietly wrong file (§15.10).
          */}
          <Button
            component="a"
            href={`/api/admin/registrations/export${listQueryString ? `?${listQueryString}` : ""}`}
            variant="outlined"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.export")}
          </Button>
        </Stack>
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
            defaultValue={eventId ?? ""}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
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
                  label={t("registrations.resendShort")}
                  pendingLabel={t("registrations.resendShort")}
                  ariaLabel={t("registrations.resend")}
                  variant="outlined"
                />
              </Box>
            )}
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
