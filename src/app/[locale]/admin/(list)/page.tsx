import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countRegistrationsByEvent,
  type EditableEvent,
  type EditableTranslation,
  listEventsForBackoffice,
} from "@/modules/content/events/repository";
import {
  canCreateEvent,
  canDeleteEvent,
  canManageRegistrations,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  REGISTRATION_MODE_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { bulkArchiveEventsAction, deleteEventAction, duplicateEventAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/** The bulk form sits below the table and owns the checkboxes inside it. */
const BULK_FORM = "bulk-archive";

type EventRow = { event: EditableEvent; translations: EditableTranslation[]; entries: number };

/**
 * What there is to edit.
 *
 * Events only. The CMS boundary (AGENTS.md §11.1, BR-REQ-050-01) is an allowlist of content
 * types, and articles, static pages and galleries are M5 proper — no interface here offers a
 * new route, a new layout or a new content type, because none exists to offer. It does offer a
 * new *event*, which is the one content type that exists.
 *
 * `requireStaff()` runs even though the layout already refused an anonymous request: a page is
 * a request of its own, and a guard that depends on a parent having run is a guard that
 * disappears the first time someone renders this page somewhere else.
 *
 * ## Why the delete button explains itself
 *
 * `deleteEvent` refuses any event with a registration against it — archiving is the answer
 * there — and the list used to offer the button anyway and let the refusal arrive afterwards as
 * an error code at the top of the page. The row now carries its registration count, so an
 * organizer is told "eleven people have registered" *before* pressing anything, and the button
 * is replaced by that sentence rather than silently missing. A missing control explains nothing;
 * a count is a reason somebody accepts. The server-side refusal is untouched and is still what
 * actually decides (BR-REQ-060-01).
 */
export default async function AdminEventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  const current = await searchParams;
  const { error, saved, archived, failed } = current;

  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const db = getDb();
  const [events, entriesByEvent] = await Promise.all([
    listEventsForBackoffice(db),
    countRegistrationsByEvent(db),
  ]);

  const rows: EventRow[] = events.map((row) => ({
    ...row,
    entries: entriesByEvent.get(row.event.id) ?? 0,
  }));

  const query = parseListQuery(current, {
    // The list's order is the club's own — featured first, then soonest — and it is the order an
    // organizer thinks in. A sortable column here would be sorting away the thing that puts the
    // next race at the top.
    sortable: [],
    defaultSort: "startsAt",
    defaultPerPage: 100,
  });

  const basePath = getPathname({ locale, href: "/admin" });

  const columns: readonly AdminColumn<EventRow>[] = [
    {
      key: "title",
      label: t("events.columnTitle"),
      primary: true,
      render: ({ event, translations }) => (
        <Stack spacing={0.5}>
          <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
            <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>
              {translations[0]?.title ?? event.id}
            </Link>
            {event.featured && <Chip size="small" color="primary" label={t("events.featured")} />}
          </Stack>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {translations.map((translation) => (
              <Typography key={translation.id} variant="body2" color="text.secondary">
                {/* The preview renders in the locale of its own URL, so the link forces the
                    translation's locale rather than the one the organizer is browsing in. */}
                <Link
                  locale={translation.locale}
                  href={{ pathname: "/preview/events/[id]", params: { id: event.id } }}
                >
                  {translation.locale.toUpperCase()} · {t("events.preview")}
                </Link>
              </Typography>
            ))}
          </Stack>
        </Stack>
      ),
    },
    {
      key: "status",
      label: t("events.columnStatus"),
      render: ({ event }) => (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
          {/* Publication is one state for the whole event now, so it is one chip. */}
          <Chip
            size="small"
            color={event.editorialStatus === "PUBLISHED" ? "success" : "default"}
            label={EDITORIAL_STATUS_LABEL[event.editorialStatus]}
          />
          {event.registrationMode !== "NONE" && (
            <Chip
              size="small"
              variant="outlined"
              label={REGISTRATION_MODE_LABEL[event.registrationMode]}
            />
          )}
        </Stack>
      ),
    },
    {
      key: "date",
      label: t("events.columnDate"),
      hideBelow: "md",
      render: ({ event }) =>
        format.dateTime(event.startsAt, {
          timeZone: event.timezone,
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
    },
    {
      key: "entries",
      label: t("events.columnEntries"),
      align: "right",
      hideBelow: "lg",
      render: ({ event, entries }) =>
        entries > 0 && canManageRegistrations(staffUser.role) ? (
          <Link href={{ pathname: "/admin/registrations", query: { eventId: event.id } }}>
            {entries}
          </Link>
        ) : (
          entries
        ),
    },
  ];

  return (
    <Stack spacing={3}>
      {/*
        The actions redirect back with `#admin-alert`, so the browser lands on the outcome
        rather than at the top of a list where a one-line alert is easy to miss. No JavaScript:
        it is a fragment in the URL the Server Action already redirects to, and the theme gives
        `html` a `scroll-padding-top` so the sticky site header cannot cover it on arrival.
      */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "eventsArchived" && (
          <Alert severity={Number(failed) > 0 ? "warning" : "success"}>
            {t("events.eventsArchived", { archived: archived ?? "0", failed: failed ?? "0" })}
          </Alert>
        )}
        {saved && saved !== "eventsArchived" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.events")}
        </Typography>

        {canCreateEvent(staffUser.role) && (
          // `component="a"` with a resolved path, not `component={Link}`: MUI's Button is a
          // Client Component, and passing a component reference from a Server Component to one
          // is refused by React outright.
          <Button
            component="a"
            href={getPathname({ locale, href: "/admin/events/new" })}
            variant="contained"
            size="small"
            sx={TAP_TARGET}
          >
            {t("events.new")}
          </Button>
        )}
      </Stack>

      <AdminTable
        caption={t("events.tableCaption")}
        columns={columns}
        rows={rows}
        rowKey={({ event }) => event.id}
        basePath={basePath}
        currentParams={{}}
        query={query}
        total={rows.length}
        labels={{
          results: t("list.results", { count: rows.length }),
          page: t("list.page", { page: query.page, pages: pageCount(rows.length, query.perPage) }),
          previous: t("list.previous"),
          next: t("list.next"),
          perPage: t("list.perPage"),
          actions: t("list.actions"),
          sortBy: (column) => t("list.sortBy", { column }),
        }}
        empty={<Typography variant="body1">{t("events.empty")}</Typography>}
        rowActions={({ event, translations, entries }) => (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 0.5 }}
          >
            {canCreateEvent(staffUser.role) && (
              <Checkbox
                name="eventRef"
                // The version travels with the tick, so a bulk archive still carries the version
                // each row was loaded with and a colleague's edit still wins a CONFLICT (§11.5).
                value={`${event.id}:${event.version}`}
                form={BULK_FORM}
                slotProps={{
                  input: {
                    "aria-label": t("events.selectEvent", {
                      title: translations[0]?.title ?? event.id,
                    }),
                  },
                }}
                sx={CHECKBOX_TAP_TARGET}
              />
            )}

            <Button
              component="a"
              href={getPathname({
                locale,
                href: { pathname: "/admin/events/[id]", params: { id: event.id } },
              })}
              variant="outlined"
              size="small"
              sx={TAP_TARGET}
            >
              {t("events.edit")}
            </Button>

            {/*
              Duplicate and Delete live behind a disclosure rather than sitting in the row.

              `<details>` rather than a menu component: an overflow menu is a client island
              and the standing rule keeps those to the few that earn it. This is the same
              affordance with no JavaScript at all — it opens on a tap, it closes on the
              next one, and a keyboard reaches it because a `<summary>` is focusable.
            */}
            {canCreateEvent(staffUser.role) && (
              <Box component="details">
                <Box
                  component="summary"
                  sx={{
                    listStyle: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 44,
                    px: 1.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: "divider",
                    fontSize: "0.8125rem",
                  }}
                >
                  {t("events.moreActions")}
                </Box>

                <Stack spacing={1} sx={{ mt: 1, alignItems: "flex-end" }}>
                  <Box component="form" action={duplicateEventAction}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="eventId" value={event.id} />
                    <ConfirmSubmitButton
                      label={t("editor.duplicate")}
                      title={t("confirm.duplicateTitle")}
                      body={t("confirm.duplicateBody")}
                      confirmLabel={t("editor.duplicate")}
                      cancelLabel={t("confirm.cancel")}
                    />
                  </Box>

                  {/*
                    Administrator only, and the service refuses any event that has a registration
                    against it. When it would refuse, the reason replaces the button: a count is
                    something an organizer can act on, and a button that fails is not.
                  */}
                  {canDeleteEvent(staffUser.role) &&
                    (entries > 0 ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ maxWidth: 260, textAlign: "right" }}
                      >
                        {t("events.deleteBlocked", { count: entries })}
                      </Typography>
                    ) : (
                      <Box component="form" action={deleteEventAction}>
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <ConfirmSubmitButton
                          label={t("editor.delete")}
                          title={t("confirm.deleteTitle")}
                          body={t("confirm.deleteBody")}
                          confirmLabel={t("editor.delete")}
                          cancelLabel={t("confirm.cancel")}
                          color="error"
                        />
                      </Box>
                    ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      />

      {rows.length > 0 && canCreateEvent(staffUser.role) && (
        <Box
          component="details"
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            px: 2,
            "& > summary": { cursor: "pointer", py: 1.5, minHeight: 44, listStyle: "revert" },
          }}
        >
          <Typography component="summary" variant="body2">
            {t("events.bulkArchiveTitle")}
          </Typography>
          <Box component="form" id={BULK_FORM} action={bulkArchiveEventsAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ pb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t("events.bulkArchiveHelp")}
              </Typography>
              <Box>
                <SubmitButton
                  label={t("events.bulkArchiveAction")}
                  pendingLabel={t("events.bulkArchivePending")}
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
