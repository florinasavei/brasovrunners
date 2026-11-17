import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { addVolunteerAction } from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { setVolunteerDecisionAction, setVolunteerKitAction, setVolunteerRaffleAction } from "@/app/[locale]/admin/volunteers/actions";
import { addVolunteerNoteFromListAction } from "@/app/[locale]/admin/volunteers/[id]/note-actions";
import { getDb } from "@/db/client";
import { VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { findEventForRegistrationById } from "@/modules/events/repository";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { findCurrentApprovedDocument, volunteerMinorsOpen } from "@/modules/legal-documents/repository";
import { readEmailSummaries } from "@/modules/notifications/email-summaries";
import EmailSummaryCell from "@/modules/notifications/ui/EmailSummary";
import { ALL_EVENTS, AUTOMATIC, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
import NotesMark from "@/modules/registrations/ui/NotesMark";
import { buildListHref, pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import { canManageRegistrations, canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import {
  countVolunteersForAdmin,
  kitFilterOf,
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
import { guardianAllowsConfirm, guardianAskOf, roleLabel, VOLUNTEER_DECISION_MAX, VOLUNTEER_STATES, type VolunteerState } from "@/modules/volunteers/domain/volunteer";
import { volunteerPersonContextOf } from "@/modules/volunteers/person-context";
import { DECISION_ANCHOR } from "@/modules/volunteers/ui/VolunteerDecisionCard";
import { GuardianVerbs, guardianChips, shortText, STATE_CHIP, VolunteerPersonFields, VolunteerStateForm, volunteerHiddenFields, volunteerPersonBoxes } from "@/modules/volunteers/ui/VolunteerPerson";
import { listVolunteerNotesForExport } from "@/modules/volunteers/volunteer-notes";
import { ROLE_EMAIL_SETTLE_MINUTES } from "@/modules/volunteers/volunteers";
import { confirmWords } from "@/shared/feedback/confirm-words";
import MailLine from "@/shared/feedback/MailLine";
import { actionKeyOf } from "@/shared/forms/action-key";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import { notesTip } from "@/shared/notes/note-text";
import ChipLink from "@/shared/ui/ChipLink";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import RowNoteDialog from "@/shared/ui/RowNoteDialog";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import TickButton from "@/shared/ui/TickButton";
import TipSpan from "@/shared/ui/TipSpan";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

function isVolunteerState(value: string | undefined): value is VolunteerState {
  return !!value && (VOLUNTEER_STATES as readonly string[]).includes(value);
}

/**
 * A person's message in the list's «Mesaj» column (§947): the words as typed, their line breaks kept, a few lines of a
 * sentence's width — the floor keeps a full table from squeezing it to a word a line (the registrations list's lesson,
 * §943), on the wide table only; a phone's card keeps its own width. `overflow-wrap`, not `word-break`: a word too long
 * for the cell still breaks, and the column is never counted as one character wide.
 */
const MESSAGE_CELL_SX = { display: "inline-block", minWidth: { xs: 0, md: "12rem" }, maxWidth: "26rem", whiteSpace: "pre-line", overflowWrap: "break-word" } as const;

/**
 * «Voluntari» (§839; the owner, 2026-10-21: «a nicer volunteers screen, similar to the participants area»): the
 * events' volunteers as one sorted, searched, server-paginated list (`AdminTable`, the registrations list's shape,
 * §312) — until now they were read only on each event's card, under the editor's seventeen boxes, one event at a
 * time. The same three roles as that card (`canManageVolunteers`), asserted here again and by the layout above for
 * the status code (BR-REQ-060-01); every verb posts to the card's own Server Actions, which ask the service for
 * the role once more, and comes back here (`returnTo`).
 *
 * The scope is the registrations list's (§178, §312): the featured event unless one is chosen, every event while a
 * name is searched and none chosen, «Toate evenimentele» one press away. The summary's pills are filters (§626).
 * A row's name opens the person's own page, where the whole block of the card stands — the contact, the roles
 * given and offered, the agreement, the guardian, «Modifică». The roles and the switches stay on the event's card,
 * one link away: they belong to the event, not to a list across events. «Adaugă un voluntar de mână» stands here too
 * while one event is in scope (§862; the owner, 2026-10-28: «as vrea sa pot adauga manual un voluntar si de aici»):
 * the card's own form, for that event, coming back to this list.
 */
export default async function AdminVolunteersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageVolunteers(actor.role)) notFound();

  const current = await searchParams;
  const { eventId, state, role, q, kit, volunteerError } = current;
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
  // «Are kit» (§904): «yes» or «no»; anything else in the address is no filter.
  const kitFilter = kitFilterOf(kit);
  const filters: VolunteerAdminFilters = {
    eventId: eventFilter.eventId,
    state: stateFilter,
    role: roleFilter,
    search: q || undefined,
    kit: kitFilter,
  };

  const [rows, total, summary, eventRoles, t] = await Promise.all([
    listVolunteersForAdmin(db, filters, { limit: query.limit, offset: query.offset, sort: query.sort as VolunteerSortKey, dir: query.dir }, locale),
    countVolunteersForAdmin(db, filters),
    // Blind to the state, the role and the kit (§246's rule): the strip says how the scope stands, and its pills set those filters.
    summariseVolunteersForAdmin(db, { eventId: filters.eventId, search: filters.search }),
    // The role select, with one event chosen: its roles and how many hold each.
    filters.eventId ? listRolesWithCounts(db, filters.eventId) : Promise.resolve([]),
    getTranslations("Admin"),
  ]);
  // The state buttons' words (§384): reopening a cancelled person who holds roles asks first, naming the email (`VolunteerStateForm`).
  const words = await confirmWords();
  // The words of every role the page's rows name, given or offered — one read, whatever their events — each with its category's (§904):
  // «Direcționare (Traseu)», as the card and the person's page say it, so a name standing in two categories is never printed twice alike.
  const [roleNames, rowNotes, emailSummaries] = await Promise.all([
    listRoleNames(db, [...new Set(rows.flatMap((row) => [...row.roleIds, ...row.choiceIds]))]),
    // «Note interne»: each row's live notes, newest first — ONE grouped read over the page's ids, never a query per row. The marker
    // says how many and, in its tooltip, the words (§945, as the registrations list's, §943). The service asks for the role again.
    listVolunteerNotesForExport(db, actor, rows.map((row) => row.id)),
    // «Emailuri» (§NNN): each row's three newest emails and how many it has in all — ONE read over the page's ids, and only for the
    // Administrator and the Superadministrator, whose the person's own «Emailuri» is (§915). For the Organizer the reader is not
    // called and the column is not drawn; the reader asks for the role again (BR-REQ-060-01).
    canManageRegistrations(actor) ? readEmailSummaries(db, actor, { volunteerIds: rows.map((row) => row.id) }) : Promise.resolve(null),
  ]);
  // The marker's tooltip (§945): the newest notes' words, each with its day and hour, the older ones counted — no author's name.
  const notesTipOf = (volunteerId: string) =>
    notesTip(
      rowNotes.get(volunteerId),
      (at) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }),
      (left) => t("registrations.notes.tipMore", { counted: t(`registrations.notes.count.${countForm(left, locale)}`, { count: left }) }),
    );
  // The dialog's refusals, cut to the sentences it can meet: the whole catalogue would travel with every row.
  const noteRefusal = await refusalMessages({ body: t("registrations.notes.label") }).then((all) => ({
    ...all,
    errors: Object.fromEntries(["NOTE_EMPTY", "NOTE_TOO_LONG", "NOT_FOUND", "FORBIDDEN"].map((code) => [code, all.errors[code]])),
  }));
  // «Decizie ziua cursei» (§954): its dialog's refusals, cut the same way — a line too long, a person deleted meanwhile, another
  // role, and a session that ended while the phone lay on the table: every answer the press can give, as a sentence.
  const decisionRefusal = await refusalMessages({ decision: t("volunteers.decision.label") }).then((all) => ({
    ...all,
    errors: Object.fromEntries(["VALIDATION_ERROR", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].map((code) => [code, all.errors[code]])),
  }));
  const roleName = (id: string) => {
    const words = roleNames.get(id);
    return words ? roleLabel(words, locale) : null;
  };
  const namesOf = (ids: readonly string[]) => ids.map(roleName).filter((name): name is string => name !== null);

  const basePath = getPathname({ locale, href: "/admin/volunteers" });
  /** Only the list-shaping keys travel with a sort link, a page link or a pill. */
  const listParams = {
    eventId: eventFilter.selected,
    state: stateFilter,
    role: roleFilter,
    q,
    kit: kitFilter === undefined ? undefined : kit,
    sort: current.sort,
    dir: current.dir,
    page: current.page,
    perPage: current.perPage,
  };
  const listQueryString = buildListHref("", listParams, {}).replace(/^\?/, "");
  // A press on a row comes back to this page of the list, every filter kept (§839), so the row's new chip is in view.
  const returnTo = buildListHref(basePath, listParams, { page: current.page });
  const hasFilters = Boolean(eventId || stateFilter || roleFilter || q || kitFilter !== undefined);
  const autoScopedToFeatured = !hasFilters && eventFilter.eventId !== undefined;
  const scopeEvent = events.find((event) => event.id === filters.eventId) ?? null;
  // «Adaugă un voluntar de mână» for the event in scope (§862): the context a person's page reads, coming back to this page of the list.
  const scopeEventRow = scopeEvent ? await findEventForRegistrationById(db, scopeEvent.id) : undefined;
  // «Punct» (§949): with one event chosen that has points on its route, each row says where its person stands — the point's place
  // in the route's order and its name, as «Planul voluntarilor» says them. One read for the page, never one per row.
  const pointNames = scopeEvent
    ? new Map(
        (await listCheckpoints(db, scopeEvent.id)).map((point, index) => [
          point.id,
          t("volunteers.plan.columnPoint", { number: index + 1, name: locale === "ro" ? point.nameRo : point.nameEn }),
        ]),
      )
    : new Map<string, string>();
  const [addContext, personBoxes] = scopeEventRow ? await Promise.all([volunteerPersonContextOf(db, scopeEventRow, locale, new Date(), returnTo), volunteerPersonBoxes(t)]) : [null, null];
  // The action's language-neutral code (AGENTS.md §14.3) becomes a sentence here; an unknown code says nothing.
  const errorCode = volunteerError && /^[A-Z_]{1,48}$/.test(volunteerError) && t.has(`errors.${volunteerError}`) ? volunteerError : null;

  // The parent's agreement on the rows of minors («Confirmarea minorilor din lista de voluntari»): the club's texts and the sheet's version are
  // read once for the page, and only when a row of it is a minor still waiting on a parent — never per row.
  const now = new Date();
  const waitsOnParent = rows.some((row) => guardianAskOf(row, true, now).kind !== "none");
  const minorsOpen = waitsOnParent ? await volunteerMinorsOpen(db, now) : false;
  const agreementDocumentIds: Partial<Record<Locale, string>> = {};
  if (minorsOpen) {
    for (const language of routing.locales) {
      const version = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, language, now);
      if (version) agreementDocumentIds[language] = version.id;
    }
  }

  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
  const eventCardHref = (id: string) => `${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } })}#box-volunteers`;
  const hidden = (row: VolunteerAdminRow) => volunteerHiddenFields({ locale, eventId: row.eventId, returnTo });
  const personHref = (row: VolunteerAdminRow) => getPathname({ locale, href: { pathname: "/admin/volunteers/[id]", params: { id: row.id } } });

  /**
   * «Note interne» in the name cell («Note interne» for volunteers, as the registrations list has it): the marker with the count when
   * somebody left a note — the link to the person's card, open, and under the pointer the notes' own words (§945; the owner, of «1
   * notă» on this list: «trebuie sa pot vedea comentariile pe hover») — and «Adaugă o notă», a dialog over the list that comes back to this
   * very page of it (`returnTo`, the list's validated way back); without JavaScript a link to the card. `AdminTable` draws each row
   * twice (the table and the phone cards): the dialog keeps its ids unique by itself (`useId`).
   */
  const notesOf = (row: VolunteerAdminRow) => {
    // The marker's number, from the same read as its tooltip's words.
    const noteCount = rowNotes.get(row.id)?.length ?? 0;
    const counted = t(`registrations.notes.count.${countForm(noteCount, locale)}`, { count: noteCount });
    return (
      <>
        {noteCount > 0 && (
          // The words under the pointer, without opening the person's page (§945): the newest notes, the rest counted.
          <TipSpan title={notesTipOf(row.id)}>
            <NotesMark label={counted} ariaLabel={t("registrations.notes.mark", { name: row.name, counted })} href={`${personHref(row)}#note-interne`} />
          </TipSpan>
        )}
        <RowNoteDialog
          action={addVolunteerNoteFromListAction}
          actionKey={actionKeyOf(addVolunteerNoteFromListAction)}
          messages={noteRefusal}
          fields={{ uiLocale: locale, eventId: row.eventId, volunteerId: row.id, returnTo }}
          fallbackHref={`${personHref(row)}#note-interne`}
          label={t("registrations.notes.add")}
          ariaLabel={t("registrations.notes.addFor", { name: row.name })}
          title={t("registrations.notes.dialog", { name: row.name })}
          help={t("registrations.notes.help")}
          boxName="body"
          boxLabel={t("registrations.notes.add")}
          limitText={t("registrations.notes.limit", { max: VOLUNTEER_NOTE_MAX })}
          max={VOLUNTEER_NOTE_MAX}
          saveLabel={t("registrations.notes.save")}
          cancelLabel={words.cancel}
          settledKey={String(noteCount)}
        />
      </>
    );
  };

  /**
   * «Decizie ziua cursei» in its cell (§954; the owner, 2026-11-16, minutes after the notes' column: «si la voluntar trebuie sa am
   * si decizie pt ziua cursei»): the organizers' one line as typed, in the «Mesaj» cell's own style, and under it — or alone
   * while there is none — the press that opens a dialog to write or change it: the row's own «Adaugă o notă» control with other
   * words (`RowNoteDialog`; strings only cross to it, the glyph by its name). The box opens on the line as it stands and may be
   * saved empty, which clears it. The save is `setVolunteerDecisionAction`, which comes back to this very page of the list
   * (`returnTo`); the page's own render instant in `settledKey` closes the dialog on every page drawn after a save, an
   * «unchanged» one too. Without JavaScript the press is a link to the person's page, where the same form stands. The accessible
   * name begins with the words the press shows (WCAG 2.5.3) and ends with the person's name.
   */
  const decisionOf = (row: VolunteerAdminRow) => {
    const label = t(row.raceDayDecision ? "volunteers.decision.change" : "volunteers.decision.write");
    return (
      // The words take the cell's width, so on a phone's card a long one wraps — and a word too long for the line breaks — inside
      // it; the press keeps to the side the card's values stand on (the right on a phone, the left in the table).
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        {row.raceDayDecision && (
          <Box component="span" data-testid="volunteer-decision" sx={MESSAGE_CELL_SX}>
            {row.raceDayDecision}
          </Box>
        )}
        <Box sx={{ alignSelf: { xs: "flex-end", md: "flex-start" }, maxWidth: "100%" }}>
          <RowNoteDialog
            action={setVolunteerDecisionAction}
            actionKey={actionKeyOf(setVolunteerDecisionAction)}
            messages={decisionRefusal}
            fields={{ uiLocale: locale, eventId: row.eventId, volunteerId: row.id, returnTo }}
            fallbackHref={`${personHref(row)}#${DECISION_ANCHOR}`}
            label={label}
            ariaLabel={`${label}: ${shortText(row.name)}`}
            title={t("volunteers.decision.dialog", { name: row.name })}
            help={t("volunteers.decision.help")}
            boxName="decision"
            boxLabel={t("volunteers.decision.label")}
            limitText={t("volunteers.decision.limit", { max: VOLUNTEER_DECISION_MAX })}
            max={VOLUNTEER_DECISION_MAX}
            saveLabel={t("volunteers.save")}
            cancelLabel={words.cancel}
            settledKey={`${row.raceDayDecision ?? ""}:${now.getTime()}`}
            defaultValue={row.raceDayDecision ?? ""}
            optional
            icon={row.raceDayDecision ? "edit" : "add"}
            testId="decision-open"
            dialogTestId="decision-dialog"
          />
        </Box>
      </Stack>
    );
  };

  /** One button that posts the state it wants, the card's own (`VolunteerStateForm`): never a toggle, and a reopening that emails asks first. */
  const stateButton = (row: VolunteerAdminRow, next: VolunteerState, label: string, icon: "confirm" | "cancel" | "undo") => (
    <VolunteerStateForm person={row} state={next} label={label} icon={icon} hidden={hidden(row)} words={words} t={t} />
  );

  /**
   * «Are kit» on the row (§904; the owner, 2026-11-03: «ar trebui să număr pe header câți au kit»): the house's one-press tick (`TickButton`,
   * §766) — a submit drawn as the checkbox, `role="checkbox"` and `aria-checked`, the words beside it — in a plain form that posts the state
   * it wants (`hasKit=1|0`), never a toggle; it works with scripts off and comes back to this page of the list. The service asks for the role.
   */
  const kitTick = (row: VolunteerAdminRow) => (
    <Box component="form" action={setVolunteerKitAction} data-testid="volunteer-kit-form">
      {hidden(row)}
      <input type="hidden" name="volunteerId" value={row.id} />
      <input type="hidden" name="hasKit" value={row.hasKit ? "0" : "1"} />
      <TickButton checked={row.hasKit} aria-label={`${t("volunteers.person.hasKit")}: ${shortText(row.name)}`} data-testid="volunteer-kit-tick">
        {t("volunteers.person.hasKit")}
      </TickButton>
    </Box>
  );

  /**
   * «Participă la tombolă» on a row (§949): the kit tick's own shape — a plain form posting the state it wants (`inRaffle=1|0`). Drawn
   * for an event that holds a raffle («Avem tombolă» in its editor); the service asks for the role.
   */
  const raffleTick = (row: VolunteerAdminRow) => (
    <Box component="form" action={setVolunteerRaffleAction} data-testid="volunteer-raffle-form">
      {hidden(row)}
      <input type="hidden" name="volunteerId" value={row.id} />
      <input type="hidden" name="inRaffle" value={row.inRaffle ? "0" : "1"} />
      <TickButton checked={row.inRaffle} aria-label={`${t("volunteers.screen.raffleTick")}: ${shortText(row.name)}`} data-testid="volunteer-raffle-tick">
        {t("volunteers.screen.raffleTick")}
      </TickButton>
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
          {notesOf(row)}
        </Stack>
      ),
    },
    {
      /*
        «Vârstă» (§947; the owner, 2026-11-16: «In lista de voluntari trebuie sa vad varsta si orasul»): the age on the event's day
        (§773) — the one the parent's agreement goes by —, a bare number as the registrations list says it (§660). «—» for a person who
        gave none. Until now both answers were read only on the person's page and in the files.
      */
      key: "age",
      label: t("registrations.columnAge"),
      hint: t("volunteers.screen.ageHint"),
      sortable: true,
      initialDir: "asc",
      render: (row) => (
        <Box component="span" data-testid="volunteer-age" sx={{ fontVariantNumeric: "tabular-nums", color: row.age === null ? "text.disabled" : "text.primary" }}>
          {row.age ?? "—"}
        </Box>
      ),
    },
    {
      // «Oraș» (§947): the city as the person typed it; «—» for a person who gave none.
      key: "city",
      label: t("registrations.columnCity"),
      sortable: true,
      initialDir: "asc",
      render: (row) => (
        // `overflow-wrap`, not `word-break` (§943's lesson): a full table would count the column as one character wide and
        // print «Sfântu Gheorghe» three letters to a line; a city breaks at its spaces, and only an unbroken word too long breaks inside.
        <Box component="span" data-testid="volunteer-city" sx={row.city === null ? { color: "text.disabled" } : { overflowWrap: "break-word" }}>
          {row.city ?? "—"}
        </Box>
      ),
    },
    {
      /*
        «Mesaj» (§947; the owner, 2026-11-16: «trebuie sa vad coloana de comentarii a voluntarilor in grid, sa stiu direct»): what
        the person wrote for the organizers on the form — at most `VOLUNTEER_MESSAGE_MAX` characters, so the whole of it, as typed,
        line breaks kept. Until now it was read only on the person's page and in the files. Nothing for whoever wrote none: an empty
        cell in the table, no line at all on a phone's card.
      */
      key: "message",
      label: t("volunteers.screen.columnMessage"),
      hint: t("volunteers.screen.messageHint"),
      omitEmptyOnPhone: true,
      render: (row) =>
        row.message ? (
          <Box component="span" data-testid="volunteer-message" sx={MESSAGE_CELL_SX}>
            {row.message}
          </Box>
        ) : null,
    },
    {
      /*
        «Note interne» (§950; the owner, 2026-11-16, of this list: «pe lângă mesajul nostru vreau să văd și notele interne ale
        noastre»): the organizers' own notes on the person, in the row itself — the words the marker's tooltip says (§945: the three
        newest, each with its day and hour, a long one cut, the older ones counted, no author), because a phone has no pointer to
        hold over a marker. From the list's one grouped read, so no query is added; nothing for a row with no note — an empty cell
        in the table, no line on a phone's card. The marker beside the name stays the way to the person's card, where every note
        is whole and says who wrote it.
      */
      key: "notes",
      label: t("volunteers.screen.columnNotes"),
      hint: t("volunteers.screen.notesHint"),
      omitEmptyOnPhone: true,
      render: (row) => {
        const said = notesTipOf(row.id);
        return said ? (
          <Box component="span" data-testid="volunteer-notes" sx={MESSAGE_CELL_SX}>
            {said}
          </Box>
        ) : null;
      },
    },
    {
      /*
        «Decizie ziua cursei» (§954), right after the organizers' notes: what THEY decided for the person on race day — «vine la
        8:00 la start», «rezervă» — one short line they keep current; not a note (a dated thread), not the state, not the person's
        answer. The cell is `decisionOf` above: the words and the press that writes or changes them. No `omitEmptyOnPhone`: the
        press lives in the cell, so a phone's card keeps the line for a row with no decision too. It neither sorts nor filters.
      */
      key: "decision",
      label: t("volunteers.decision.column"),
      hint: t("volunteers.decision.hint"),
      render: decisionOf,
    },
    {
      key: "state",
      label: t("volunteers.screen.columnState"),
      sortable: true,
      initialDir: "asc",
      essential: true,
      render: (row) => (
        <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
          <StatusChip glyph={STATE_CHIP[row.state].glyph} color={STATE_CHIP[row.state].color} label={t(`volunteers.states.${row.state}`)} testId="volunteer-state" />
          {/* A minor whose parent has not agreed: the person's block's own chips — the parent's agreement missing, or a link sent — never a second condition. */}
          {guardianAskOf(row, true, now).kind !== "none" && (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
              {guardianChips(row, now, t)}
            </Stack>
          )}
        </Stack>
      ),
    },
    /*
      «Emailuri» (§NNN; the owner, 2026-11-17, the morning after the volunteers were emailed their points: «Vreau sa vad mai clar ce
      mailuri a primit fiecare om»), right after the state: each person's three newest emails — which email, when it left, what
      became of it — and «și încă N emailuri», the link to the person's own «Emailuri» (§915), where every email stands with its
      tries. For the Administrator and the Superadministrator alone, as that fold is: for the Organizer no column is drawn and
      nothing is read (`emailSummaries` is null). No `omitEmptyOnPhone`: «niciun email» is an answer, on a phone's card too. It
      neither sorts nor filters.
    */
    ...(emailSummaries
      ? [
          {
            key: "emails",
            label: t("emails.summary.column"),
            hint: t("emails.summary.hint"),
            render: (row) => <EmailSummaryCell summary={emailSummaries.get(row.id)} href={`${personHref(row)}#emailuri`} personName={shortText(row.name)} locale={locale} t={t} />,
          } satisfies AdminColumn<VolunteerAdminRow>,
        ]
      : []),
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
    // Read here, set on «Planul voluntarilor»: a cancelled person keeps their point in case they come back, and shows none.
    ...(pointNames.size > 0
      ? [
          {
            key: "point",
            label: t("volunteers.plan.column"),
            hint: t("volunteers.plan.columnHint"),
            omitEmptyOnPhone: true,
            render: (row) =>
              row.checkpointId && row.state !== "CANCELLED" && pointNames.has(row.checkpointId) ? <span data-testid="volunteer-point">{pointNames.get(row.checkpointId)}</span> : null,
          } satisfies AdminColumn<VolunteerAdminRow>,
        ]
      : []),
    {
      key: "offered",
      label: t("volunteers.person.offeredFor"),
      hideBelow: "md",
      render: (row) => (row.choiceIds.length > 0 ? <span data-testid="volunteer-offered">{namesOf(row.choiceIds).join(", ")}</span> : <span aria-hidden>—</span>),
    },
    {
      // «Are kit» (§904): the tick itself, one press; «Cu kit» above counts the ticked who are not cancelled.
      key: "kit",
      label: t("volunteers.screen.columnKit"),
      render: kitTick,
    },
    // «Tombolă» (§949): with one event chosen that holds a raffle, whether each volunteer's number is on the raffle's list.
    ...(scopeEventRow?.hasRaffle
      ? [
          {
            key: "raffle",
            label: t("volunteers.screen.columnRaffle"),
            hint: t("volunteers.screen.raffleHint"),
            render: raffleTick,
          } satisfies AdminColumn<VolunteerAdminRow>,
        ]
      : []),
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
  const pill = (patch: { state?: VolunteerState; role?: string; kit?: "yes" }, label: string, active: boolean) => (
    <ChipLink
      href={buildListHref(basePath, listParams, {
        state: "state" in patch ? (active ? undefined : patch.state) : undefined,
        role: "role" in patch ? (active ? undefined : patch.role) : undefined,
        kit: "kit" in patch ? (active ? undefined : patch.kit) : undefined,
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
        {/* Every event's people in one workbook (§846), while no single event is chosen: the screen's own scope, one press. */}
        {!scopeEvent && events.length > 0 && (
          <GlyphButton icon="spreadsheet" href={`/api/admin/volunteers/export?lang=${locale}`} variant="outlined" size="small" sx={TAP_TARGET} data-testid="volunteers-xlsx-all">
            {t("volunteers.screen.excelAll")}
          </GlyphButton>
        )}
        {scopeEvent && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {/* The roles, the switches and the invitations stay on the event's card (§754, §761): one link to it. */}
            <GlyphButton icon="role" href={eventCardHref(scopeEvent.id)} variant="outlined" size="small" sx={TAP_TARGET} data-testid="volunteers-event-card">
              {t("volunteers.screen.eventCard")}
            </GlyphButton>
            {/* «Planul voluntarilor» (§949): who stands at which point of the route — the event's own page, built and printed there. */}
            <GlyphButton
              icon="route"
              href={getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: scopeEvent.id } } })}
              variant="outlined"
              size="small"
              sx={TAP_TARGET}
              data-testid="volunteers-plan"
            >
              {t("volunteers.plan.open")}
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
        How the scope stands (§246's shape): everyone first, then each state, then how many wait for a role and how many
        get a kit (§904) — every pill a filter (§626). The counts ignore the state, the role and the kit filters, so the
        strip never empties to the one number somebody filtered to.
      */}
      <Panel glyph="volunteers" title={t("volunteers.screen.summaryTitle")} aside={scopeEvent ? t("volunteers.screen.summaryScopeEvent", { event: scopeEvent.title ?? scopeEvent.id }) : t("volunteers.screen.summaryScopeAll")} data-testid="volunteers-summary">
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {pill({ state: undefined, role: undefined }, t("volunteers.screen.summaryTotal", { count: summary.total }), !stateFilter && !roleFilter && kitFilter === undefined)}
          {VOLUNTEER_STATES.filter((value) => summary.byState[value] > 0 || stateFilter === value).map((value) =>
            pill({ state: value }, `${t(`volunteers.states.${value}`)}: ${summary.byState[value]}`, stateFilter === value),
          )}
          {(summary.unassigned > 0 || roleFilter === UNASSIGNED) &&
            pill({ role: UNASSIGNED }, t("volunteers.screen.summaryUnassigned", { count: summary.unassigned }), roleFilter === UNASSIGNED)}
          {/* «Cu kit» (§904; the owner, 2026-11-03: «ar trebui să număr pe header câți au kit»): the ticked who are not cancelled, always said — a nought too. */}
          {pill({ kit: "yes" }, t("volunteers.screen.summaryKit", { count: summary.withKit }), kitFilter === true)}
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

      {/* A person the club enters by hand (§862): the event card's own form, for the event in scope, while it has a role to offer — as on the card. */}
      {scopeEvent && addContext && personBoxes && addContext.roles.length > 0 && (
        <Panel glyph="add" collapsible title={t("volunteers.person.addTitle")} aside={t("volunteers.screen.summaryScopeEvent", { event: scopeEvent.title ?? scopeEvent.id })} id="volunteers-add" data-testid="volunteers-add">
          <ActionForm action={addVolunteerAction} scope="volunteer-new" messages={personBoxes}>
            {volunteerHiddenFields(addContext)}
            <VolunteerPersonFields person={null} context={addContext} />
            {/* What the add may email (the design «telling the owner about every email a staff press sends», slice 3): the roles given, to the address typed. */}
            <Box sx={{ mt: 1.5 }}>
              {/* «Trimite emailul» (slice 4): a person entered with roles may be told them later, by the organizers. */}
              <MailLine text={t("mailLine.volunteerAdd", { minutes: String(ROLE_EMAIL_SETTLE_MINUTES) })} optOut={{ label: words.optOutLabel }} data-testid="volunteer-add-mail" />
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <GlyphSubmitButton label={t("volunteers.person.add")} pendingLabel={t("volunteers.person.adding")} icon="addPerson" />
            </Box>
          </ActionForm>
        </Panel>
      )}

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
                    {/* With its category (§904): «Direcționare (Traseu) · 2», never two lines that read the same. */}
                    {`${roleLabel(eventRole, locale)} · ${eventRole.given}`}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {/* «Are kit» (§904): the ticked, the others, or everyone — the «Cu kit» pill above sets the first. */}
            <TextField select name="kit" label={t("volunteers.screen.kitFilter")} defaultValue={kitFilter === undefined ? "" : kit} sx={{ minWidth: 200 }} data-testid="volunteers-filter-kit">
              <MenuItem value="">{t("volunteers.screen.kitAll")}</MenuItem>
              <MenuItem value="yes">{t("volunteers.screen.kitYes")}</MenuItem>
              <MenuItem value="no">{t("volunteers.screen.kitNo")}</MenuItem>
            </TextField>
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
        rowActions={(row) => {
          const ask = guardianAskOf(row, minorsOpen, now);
          return (
            <Stack spacing={1} sx={{ alignItems: "flex-end", minWidth: 0, ...(ask.kind === "none" ? {} : { maxWidth: 360 }) }}>
              {/* A minor whose parent has not agreed (§768, «Confirmarea minorilor din lista de voluntari»): the person's block's own verbs in place of «Confirmă», which the
                  server would refuse (`guardianAllowsConfirm`); with no parent's name, one sentence and the way to the page where «Modifică» takes it. */}
              {ask.kind === "ask" && (
                <GuardianVerbs person={row} ask={ask} locale={locale} eventId={row.eventId} agreementDocumentId={agreementDocumentIds[row.locale] ?? ""} hidden={hidden(row)} words={words} t={t} />
              )}
              {ask.kind === "closed" && (
                <Typography variant="body2" color="text.secondary" data-testid="volunteer-guardian-closed">
                  {t("volunteers.guardian.minorsClosed")}
                </Typography>
              )}
              {ask.kind === "noName" && (
                <Stack spacing={0.5} data-testid="volunteer-guardian-no-name">
                  <Typography variant="body2" color="text.secondary">
                    {t("volunteers.guardian.nameMissing")}
                  </Typography>
                  <Link
                    href={{ pathname: "/admin/volunteers/[id]", params: { id: row.id } }}
                    style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
                    data-testid="volunteer-guardian-no-name-link"
                  >
                    {t("volunteers.guardian.nameMissingOpen", { name: shortText(row.name) })}
                  </Link>
                </Stack>
              )}
              {/* The card's state verbs (§754), one line: confirm, cancel, or back to registered; the roles and the rest are on the person's page. */}
              <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: ask.kind === "none" ? "nowrap" : "wrap", gap: 0.5 }}>
                {row.state !== "CONFIRMED" && guardianAllowsConfirm(row) && stateButton(row, "CONFIRMED", t("volunteers.confirm"), "confirm")}
                {row.state !== "CANCELLED" && stateButton(row, "CANCELLED", t("volunteers.cancel"), "cancel")}
                {row.state === "CANCELLED" && stateButton(row, "REGISTERED", t("volunteers.reopen"), "undo")}
              </Stack>
            </Stack>
          );
        }}
      />
    </Stack>
  );
}
