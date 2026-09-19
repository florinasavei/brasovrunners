import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countConfirmedAndCheckedInByEvent,
  countRegistrationsByEvent,
  type EditableEvent,
  type EditableTranslation,
  listEventsForBackoffice,
} from "@/modules/content/events/repository";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditTexts,
  canManageRegistrations,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  REGISTRATION_MODE_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import EventRowMenu from "@/modules/content/events/ui/EventRowMenu";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import PencilIcon from "@/shared/ui/PencilIcon";
import {
  bulkArchiveEventsAction,
  bulkPublishEventsAction,
  deleteEventAction,
  duplicateEventAction,
} from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/** The bulk form sits below the table and owns the checkboxes inside it. */
const BULK_FORM = "bulk-archive";

type EventRow = {
  event: EditableEvent;
  translations: EditableTranslation[];
  entries: number;
  /** Confirmed and here, shown on race day (§83): the desk's own two numbers. */
  desk: { confirmed: number; checkedIn: number } | null;
};

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
  // A volunteer's backoffice is the desk (§103): `/admin` takes them there rather than to a list
  // of events they may neither write nor configure. The tabs offer them the same two sections.
  if (!canEditTexts(staffUser.role)) redirect(getPathname({ locale, href: "/admin/checkin" }));
  const current = await searchParams;
  const { error, saved, archived, failed, created, published } = current;

  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const db = getDb();
  const now = new Date();
  const [events, entriesByEvent, deskByEvent] = await Promise.all([
    listEventsForBackoffice(db),
    countRegistrationsByEvent(db),
    countConfirmedAndCheckedInByEvent(db),
  ]);

  // Race day, give or take: from the day before the start to the day after (§83).
  const DAY = 24 * 60 * 60_000;
  const rows: EventRow[] = events.map((row) => ({
    ...row,
    entries: entriesByEvent.get(row.event.id) ?? 0,
    desk:
      Math.abs(row.event.startsAt.getTime() - now.getTime()) <= DAY && row.event.registrationMode === "INTERNAL"
        ? (deskByEvent.get(row.event.id) ?? { confirmed: 0, checkedIn: 0 })
        : null,
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
      render: ({ event, entries, desk }) => (
        <>
          {entries > 0 && canManageRegistrations(staffUser.role) ? (
            <Link href={{ pathname: "/admin/registrations", query: { eventId: event.id } }}>
              {entries}
            </Link>
          ) : (
            entries
          )}
          {/* Race day: confirmed and here, the desk's numbers, beside the total (§83). */}
          {desk && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {t("events.deskCounts", { confirmed: desk.confirmed, checkedIn: desk.checkedIn })}
            </Typography>
          )}
        </>
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
        {saved === "eventsRepeated" && (
          <Alert severity="success">{t("events.eventsRepeated", { created: created ?? "0" })}</Alert>
        )}
        {saved === "eventsPublished" && (
          <Alert severity={Number(failed) > 0 ? "warning" : "success"}>
            {t("events.eventsPublished", { published: published ?? "0", failed: failed ?? "0" })}
          </Alert>
        )}
        {saved && saved !== "eventsArchived" && saved !== "eventsRepeated" && saved !== "eventsPublished" && (
          <Alert severity="success">{t("saved")}</Alert>
        )}
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
            // Dense, not the participant journey's 44px: a backoffice list is read by a
            // person who scans it, and "the buttons are huge" was the owner's review of the
            // phone rendering. Sentence case, because shouting is not a size.
            sx={{ textTransform: "none", minHeight: 36 }}
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

            {/*
              The pen, with the word from `sm` up: on a phone the row has a checkbox, this and
              the disclosure to fit, and an outlined "EDITEAZĂ" took a third of it. The
              accessible name is the full sentence either way.
            */}
            <Button
              component="a"
              href={getPathname({
                locale,
                href: { pathname: "/admin/events/[id]", params: { id: event.id } },
              })}
              variant="outlined"
              size="small"
              aria-label={t("events.editNamed", { title: translations[0]?.title ?? event.id })}
              title={t("events.edit")}
              sx={{ textTransform: "none", minHeight: 40, minWidth: 40, px: { xs: 1, sm: 1.5 }, gap: 0.75 }}
            >
              <PencilIcon />
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {t("events.edit")}
              </Box>
            </Button>

            {/*
              Duplicate, Delete, the preview and the registrations behind "⋮" — a context menu
              (`EventRowMenu`). The verbs are the two hidden forms beside it, each a Server
              Action the menu submits after its confirmation; the role and the version guard
              stay on the server.
            */}
            {canCreateEvent(staffUser.role) && (
              <>
                <form id={`duplicate-${event.id}`} action={duplicateEventAction} hidden>
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="eventId" value={event.id} />
                </form>
                {canDeleteEvent(staffUser.role) && entries === 0 && (
                  <form id={`delete-${event.id}`} action={deleteEventAction} hidden>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="eventId" value={event.id} />
                  </form>
                )}
                <EventRowMenu
                  ariaLabel={t("events.moreActions")}
                  cancelLabel={t("confirm.cancel")}
                  items={[
                    {
                      kind: "link",
                      label: t("events.preview"),
                      href: getPathname({ locale, href: { pathname: "/preview/events/[id]", params: { id: event.id } } }),
                    },
                    {
                      kind: "link",
                      label: t("events.registrationsLink", { count: entries }),
                      href: `${getPathname({ locale, href: "/admin/registrations" })}?eventId=${event.id}`,
                    },
                    {
                      kind: "submit",
                      label: t("editor.duplicate"),
                      formId: `duplicate-${event.id}`,
                      confirm: {
                        title: t("confirm.duplicateTitle"),
                        body: t("confirm.duplicateBody"),
                        confirmLabel: t("editor.duplicate"),
                      },
                    },
                    // Administrator only, and the service refuses an event with registrations
                    // against it: the reason replaces the verb, because a count is something an
                    // organizer can act on and a button that fails is not.
                    ...(canDeleteEvent(staffUser.role)
                      ? entries > 0
                        ? [{ kind: "note" as const, label: t("events.deleteBlocked", { count: entries }) }]
                        : [
                            {
                              kind: "submit" as const,
                              label: t("editor.delete"),
                              formId: `delete-${event.id}`,
                              color: "error" as const,
                              confirm: {
                                title: t("confirm.deleteTitle"),
                                body: t("confirm.deleteBody"),
                                confirmLabel: t("editor.delete"),
                              },
                            },
                          ]
                      : []),
                  ]}
                />
              </>
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
            {t("events.bulkTitle")}
          </Typography>
          <Box component="form" id={BULK_FORM} action={bulkArchiveEventsAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ pb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t("events.bulkHelp")}
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
                {/* The same selection, two verbs: a series made as drafts is published here
                    (BR-REQ-050-02 criterion 7), a season that is over is archived here. */}
                <Button type="submit" formAction={bulkPublishEventsAction} variant="contained" sx={{ minHeight: 44 }}>
                  {t("events.bulkPublishAction")}
                </Button>
                <SubmitButton
                  label={t("events.bulkArchiveAction")}
                  pendingLabel={t("events.bulkArchivePending")}
                  variant="outlined"
                />
              </Stack>
            </Stack>
          </Box>
        </Box>
      )}
    </Stack>
  );
}
