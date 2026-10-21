import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { setVolunteerStateAction } from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ALL_EVENTS, AUTOMATIC, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
import { buildListHref, pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import {
  countVolunteersForAdmin,
  listEventsWithVolunteers,
  listRoleNames,
  listRolesWithCounts,
  listVolunteersForAdmin,
  summariseVolunteersForAdmin,
  UNASSIGNED,
  VOLUNTEER_SORT_KEYS,
  type VolunteerAdminFilters,
  type VolunteerAdminRow,
  type VolunteerSortKey,
} from "@/modules/volunteers/admin-list";
import { VOLUNTEER_STATES, type VolunteerState } from "@/modules/volunteers/domain/volunteer";
import { shortText, STATE_CHIP, volunteerHiddenFields } from "@/modules/volunteers/ui/VolunteerPerson";
import { isUuid } from "@/shared/ids";
import ChipLink from "@/shared/ui/ChipLink";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

function isVolunteerState(value: string | undefined): value is VolunteerState {
  return !!value && (VOLUNTEER_STATES as readonly string[]).includes(value);
}

/**
 * «Voluntari» (§NNN; the owner, 2026-10-21: «a nicer volunteers screen, similar to the participants area»): the
 * events' volunteers as one sorted, searched, server-paginated list (`AdminTable`, the registrations list's shape,
 * §312) — until now they were read only on each event's card, under the editor's seventeen boxes, one event at a
 * time. The same three roles as that card (`canManageVolunteers`), asserted here again and by the layout above for
 * the status code (BR-REQ-060-01); every verb posts to the card's own Server Actions, which ask the service for
 * the role once more, and comes back here (`returnTo`).
 *
 * The scope is the registrations list's (§178, §312): the featured event unless one is chosen, every event while a
 * name is searched and none chosen, «Toate evenimentele» one press away. The summary's pills are filters (§626).
 * A row's name opens the person's own page, where the whole block of the card stands — the contact, the roles
 * given and offered, the agreement, the guardian, «Modifică». The roles, the switches and the add-by-hand form
 * stay on the event's card, one link away: they belong to the event, not to a list across events.
 */
export default async function AdminVolunteersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageVolunteers(actor.role)) notFound();

  const current = await searchParams;
  const { eventId, state, role, q, volunteerError } = current;
  const query = parseListQuery(current, {
    sortable: VOLUNTEER_SORT_KEYS,
    // Newest offers first: the person somebody is asking about has usually just signed up.
    defaultSort: "since",
    defaultDir: "desc",
  });

  const db = getDb();
  // The events first: the default scope is derived from them (§178), as on the registrations list.
  const events = await listEventsWithVolunteers(db, locale);
  const eventFilter = defaultEventFilter(eventId, events, q);
  const featuredEvent = events.find((event) => event.featured) ?? null;
  const stateFilter = isVolunteerState(state) ? state : undefined;
  // A role of the chosen event, or «De repartizat»; anything else in the address is no filter.
  const roleFilter = role === UNASSIGNED || (role && isUuid(role)) ? role : undefined;
  const filters: VolunteerAdminFilters = {
    eventId: eventFilter.eventId,
    state: stateFilter,
    role: roleFilter,
    search: q || undefined,
  };

  const [rows, total, summary, eventRoles, t] = await Promise.all([
    listVolunteersForAdmin(db, filters, { limit: query.limit, offset: query.offset, sort: query.sort as VolunteerSortKey, dir: query.dir }, locale),
    countVolunteersForAdmin(db, filters),
    // Blind to the state and the role (§246's rule): the strip says how the scope stands, and its pills set those two.
    summariseVolunteersForAdmin(db, { eventId: filters.eventId, search: filters.search }),
    // The role select, with one event chosen: its roles and how many hold each.
    filters.eventId ? listRolesWithCounts(db, filters.eventId) : Promise.resolve([]),
    getTranslations("Admin"),
  ]);
  // The names of every role the page's rows name, given or offered — one read, whatever their events.
  const roleNames = await listRoleNames(db, [...new Set(rows.flatMap((row) => [...row.roleIds, ...row.choiceIds]))]);
  const roleName = (id: string) => {
    const names = roleNames.get(id);
    return names ? (locale === "en" ? names.nameEn : names.nameRo) : null;
  };
  const namesOf = (ids: readonly string[]) => ids.map(roleName).filter((name): name is string => name !== null);

  const basePath = getPathname({ locale, href: "/admin/volunteers" });
  /** Only the list-shaping keys travel with a sort link, a page link or a pill. */
  const listParams = {
    eventId: eventFilter.selected,
    state: stateFilter,
    role: roleFilter,
    q,
    sort: current.sort,
    dir: current.dir,
    page: current.page,
    perPage: current.perPage,
  };
  const listQueryString = buildListHref("", listParams, {}).replace(/^\?/, "");
  // A press on a row comes back to this page of the list, every filter kept (§NNN), so the row's new chip is in view.
  const returnTo = buildListHref(basePath, listParams, { page: current.page });
  const hasFilters = Boolean(eventId || stateFilter || roleFilter || q);
  const autoScopedToFeatured = !hasFilters && eventFilter.eventId !== undefined;
  const scopeEvent = events.find((event) => event.id === filters.eventId) ?? null;
  // The action's language-neutral code (AGENTS.md §14.3) becomes a sentence here; an unknown code says nothing.
  const errorCode = volunteerError && /^[A-Z_]{1,48}$/.test(volunteerError) && t.has(`errors.${volunteerError}`) ? volunteerError : null;

  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
  const eventCardHref = (id: string) => `${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } })}#box-volunteers`;
  const hidden = (row: VolunteerAdminRow) => volunteerHiddenFields({ locale, eventId: row.eventId, returnTo });

  /** One button that posts the state it wants (`setVolunteerStateAction`), as the card's (`VolunteerPerson`), never a toggle. */
  const stateButton = (row: VolunteerAdminRow, next: VolunteerState, label: string, icon: "confirm" | "cancel" | "undo") => (
    <Box component="form" action={setVolunteerStateAction} data-testid={`volunteer-${next.toLowerCase()}-form`}>
      {hidden(row)}
      <input type="hidden" name="volunteerId" value={row.id} />
      <input type="hidden" name="state" value={next} />
      <GlyphSubmitButton icon={icon} label={label} pendingLabel={label} ariaLabel={`${label}: ${shortText(row.name)}`} variant="outlined" />
    </Box>
  );

  const columns: readonly AdminColumn<VolunteerAdminRow>[] = [
    {
      key: "name",
      label: t("volunteers.screen.columnName"),
      sortable: true,
      initialDir: "asc",
      primary: true,
      render: (row) => (
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
          <Link href={{ pathname: "/admin/volunteers/[id]", params: { id: row.id } }} aria-label={t("volunteers.screen.openNamed", { name: row.name })}>
            {row.name}
          </Link>
          {/* Typed by an organizer rather than offered on the form (§754): said once, on the row. */}
          {row.source === "STAFF" && <StatusChip glyph="club" variant="outlined" label={t("volunteers.sources.STAFF")} testId="volunteer-staff-chip" />}
        </Stack>
      ),
    },
    {
      key: "state",
      label: t("volunteers.screen.columnState"),
      sortable: true,
      initialDir: "asc",
      essential: true,
      render: (row) => <StatusChip glyph={STATE_CHIP[row.state].glyph} color={STATE_CHIP[row.state].color} label={t(`volunteers.states.${row.state}`)} testId="volunteer-state" />,
    },
    {
      key: "given",
      label: t("volunteers.person.givenLine"),
      essential: true,
      render: (row) =>
        row.roleIds.length > 0 ? (
          <span data-testid="volunteer-given">{namesOf(row.roleIds).join(", ")}</span>
        ) : row.state === "CANCELLED" ? (
          <span aria-hidden>—</span>
        ) : (
          // «De repartizat» (§761): the offer nobody has placed yet, the same words as the card's heading.
          <StatusChip glyph="open" color="warning" variant="outlined" label={t("volunteers.unassigned.title")} testId="volunteer-unassigned" />
        ),
    },
    {
      key: "offered",
      label: t("volunteers.person.offeredFor"),
      hideBelow: "md",
      render: (row) => (row.choiceIds.length > 0 ? namesOf(row.choiceIds).join(", ") : <span aria-hidden>—</span>),
    },
    {
      key: "event",
      label: t("nav.events"),
      sortable: true,
      initialDir: "asc",
      hideBelow: "sm",
      render: (row) => (
        <Stack spacing={0} sx={{ alignItems: "flex-start" }}>
          <Box component="a" href={eventCardHref(row.eventId)} sx={{ color: "primary.main" }}>
            {row.eventTitle ?? row.eventId}
          </Box>
          {row.eventStartsAt && !row.eventDateToBeAnnounced && (
            <Typography variant="caption" color="text.secondary">
              {day(row.eventStartsAt)}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      key: "since",
      label: t("volunteers.screen.columnSince"),
      sortable: true,
      initialDir: "desc",
      hideBelow: "lg",
      render: (row) => day(row.createdAt),
    },
  ];

  /** A pill of the strip: a link to this list with the filter in the address; pressing the one in force clears it (§626). */
  const pill = (patch: { state?: VolunteerState; role?: string }, label: string, active: boolean) => (
    <ChipLink
      href={buildListHref(basePath, listParams, {
        state: "state" in patch ? (active ? undefined : patch.state) : undefined,
        role: "role" in patch ? (active ? undefined : patch.role) : undefined,
      })}
      label={label}
      active={active}
      current={active ? "page" : undefined}
      keepScroll
      wrap
    />
  );

  return (
    <Stack spacing={3}>
      {/* Every backoffice page gives this id to its alert region; the Server Actions redirect to `#admin-alert`. */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {errorCode && <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>}
      </Box>

      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.volunteers")}
        </Typography>
        {scopeEvent && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {/* The roles, the switches, the invitations and «Adaugă un voluntar de mână» stay on the event's card (§754, §761): one link to it. */}
            <GlyphButton icon="role" href={eventCardHref(scopeEvent.id)} variant="outlined" size="small" sx={TAP_TARGET} data-testid="volunteers-event-card">
              {t("volunteers.screen.eventCard")}
            </GlyphButton>
            {/* The event's file (§761): one row per volunteer, addresses included — the card's own links, here too; Excel first, the CSV for whoever feeds it to something else. */}
            <GlyphButton icon="spreadsheet" href={`/api/admin/events/${scopeEvent.id}/volunteers?format=xlsx&lang=${locale}`} variant="outlined" size="small" sx={TAP_TARGET} data-testid="volunteers-xlsx">
              {t("volunteers.excel")}
            </GlyphButton>
            <GlyphButton icon="download" href={`/api/admin/events/${scopeEvent.id}/volunteers?lang=${locale}`} variant="text" size="small" sx={TAP_TARGET} data-testid="volunteers-csv">
              {t("volunteers.csv")}
            </GlyphButton>
          </Stack>
        )}
      </Stack>

      {/*
        How the scope stands (§246's shape): everyone first, then each state, then how many wait for a role — every
        pill a filter (§626). The counts ignore the state and the role filters, so the strip never empties to the one
        number somebody filtered to.
      */}
      <Panel glyph="volunteers" title={t("volunteers.screen.summaryTitle")} aside={scopeEvent ? t("volunteers.screen.summaryScopeEvent", { event: scopeEvent.title ?? scopeEvent.id }) : t("volunteers.screen.summaryScopeAll")} data-testid="volunteers-summary">
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {pill({ state: undefined, role: undefined }, t("volunteers.screen.summaryTotal", { count: summary.total }), !stateFilter && !roleFilter)}
          {VOLUNTEER_STATES.filter((value) => summary.byState[value] > 0 || stateFilter === value).map((value) =>
            pill({ state: value }, `${t(`volunteers.states.${value}`)}: ${summary.byState[value]}`, stateFilter === value),
          )}
          {(summary.unassigned > 0 || roleFilter === UNASSIGNED) &&
            pill({ role: UNASSIGNED }, t("volunteers.screen.summaryUnassigned", { count: summary.unassigned }), roleFilter === UNASSIGNED)}
        </Stack>
        {scopeEvent && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("volunteers.screen.summaryScopeHelp")}{" "}
            <Box component="a" href={buildListHref(basePath, { ...listParams, eventId: ALL_EVENTS }, {})} sx={{ color: "primary.main" }}>
              {t("volunteers.screen.summaryScopeAllLink")}
            </Box>
          </Typography>
        )}
      </Panel>

      {/* A plain GET form: a filter is an address an organizer can bookmark, and it works with JavaScript off. */}
      <Panel
        glyph="filters"
        title={t("panels.filters")}
        aside={
          hasFilters
            ? t("volunteers.screen.filtersInUse")
            : autoScopedToFeatured && featuredEvent
              ? t("volunteers.screen.filterAutoFeatured", { event: featuredEvent.title ?? featuredEvent.id })
              : t("volunteers.screen.filtersNone")
        }
        collapsible
        // Open while the list is narrowed (§269), the automatic featured scope included (§277); closed otherwise (§336).
        openWhen={{ inUse: hasFilters || autoScopedToFeatured }}
        id="volunteers-filters"
        data-testid="volunteers-filters"
      >
        {/* Keyed by the address, so a pill's soft navigation starts the selects from what the new address says (§626). */}
        <Box component="form" key={listQueryString} method="get" action={basePath}>
          <input type="hidden" name="sort" value={query.sort} />
          <input type="hidden" name="dir" value={query.dir} />
          <input type="hidden" name="perPage" value={String(query.perPage)} />
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
            <TextField name="q" type="search" label={t("list.searchByName")} helperText={t("volunteers.screen.searchHelp")} defaultValue={q ?? ""} sx={{ minWidth: 260, flexGrow: 1 }} />
            {/* "Let the page decide" is the empty value (§312): the featured event, or every event while a name is searched. */}
            <TextField select name="eventId" label={t("nav.events")} defaultValue={eventFilter.selected} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 220 }}>
              {featuredEvent && (
                <MenuItem value={AUTOMATIC}>
                  {eventFilter.searchesEverywhere ? t("volunteers.screen.filterAutoSearch") : t("volunteers.screen.filterAutoFeatured", { event: featuredEvent.title ?? featuredEvent.id })}
                </MenuItem>
              )}
              <MenuItem value={ALL_EVENTS}>{t("volunteers.screen.filterAll")}</MenuItem>
              {events.map((event) => (
                <MenuItem key={event.id} value={event.id}>
                  {event.title ?? event.id}
                </MenuItem>
              ))}
            </TextField>
            <TextField select name="state" label={t("volunteers.screen.columnState")} defaultValue={stateFilter ?? ""} sx={{ minWidth: 200 }}>
              <MenuItem value="">{t("volunteers.screen.stateAll")}</MenuItem>
              {VOLUNTEER_STATES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`volunteers.states.${value}`)}
                </MenuItem>
              ))}
            </TextField>
            {/* The roles of one event (§761): who holds which, and «De repartizat»; across events there is no one set of roles. */}
            {filters.eventId && (
              <TextField select name="role" label={t("volunteers.person.givenLine")} defaultValue={roleFilter ?? ""} sx={{ minWidth: 220 }} data-testid="volunteers-filter-role">
                <MenuItem value="">{t("volunteers.screen.roleAll")}</MenuItem>
                <MenuItem value={UNASSIGNED}>{t("volunteers.screen.summaryUnassigned", { count: summary.unassigned })}</MenuItem>
                {eventRoles.map((eventRole) => (
                  <MenuItem key={eventRole.id} value={eventRole.id}>
                    {`${locale === "en" ? eventRole.nameEn : eventRole.nameRo} · ${eventRole.given}`}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Stack direction="row" spacing={1} sx={{ pt: 1, flexWrap: "wrap", gap: 1 }}>
              <GlyphButton icon="filter" type="submit" variant="contained" sx={TAP_TARGET}>
                {t("volunteers.screen.filter")}
              </GlyphButton>
              {hasFilters && (
                <GlyphButton icon="clearFilter" href={basePath} variant="text" sx={TAP_TARGET}>
                  {t("list.clear")}
                </GlyphButton>
              )}
            </Stack>
          </Stack>
        </Box>
      </Panel>

      {/* The scope a name search widened to, said where the results start (§312). */}
      {eventFilter.searchesEverywhere && (
        <Alert severity="info" data-testid="volunteers-search-everywhere">
          {t("volunteers.screen.searchEverywhere")}
        </Alert>
      )}

      <AdminTable
        caption={t("volunteers.screen.tableCaption")}
        tableId="volunteers"
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
        empty={<Typography variant="body1">{hasFilters ? t("volunteers.screen.emptyFiltered") : t("volunteers.screen.empty")}</Typography>}
        rowActions={(row) => (
          // The card's state verbs (§754), one line: confirm, cancel, or back to registered; the roles and the rest are on the person's page.
          <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "nowrap", gap: 0.5 }}>
            {row.state !== "CONFIRMED" && stateButton(row, "CONFIRMED", t("volunteers.confirm"), "confirm")}
            {row.state !== "CANCELLED" && stateButton(row, "CANCELLED", t("volunteers.cancel"), "cancel")}
            {row.state === "CANCELLED" && stateButton(row, "REGISTERED", t("volunteers.reopen"), "undo")}
          </Stack>
        )}
      />
    </Stack>
  );
}
