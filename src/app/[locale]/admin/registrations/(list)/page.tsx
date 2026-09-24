import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countRegistrationsForAdmin,
  summariseRegistrationsForAdmin,
  listEventsWithRegistrations,
  listRegistrationsForAdmin,
  listResubmissionMarks,
  REGISTRATION_SORT_KEYS,
  type RegistrationListRow,
  type RegistrationSortKey,
} from "@/modules/registrations/admin-repository";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { declarationAsksMinorToSignByLocale } from "@/modules/legal-documents/repository";
import { registrationStatus } from "@/db/schema/registrations";
import { journeyOf } from "@/modules/registrations/domain/journey";
import { printedNumbersACancelWouldVoid, raceNumberOf } from "@/modules/registrations/domain/race-number";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import { canManageRegistrations, canMessageParticipants, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import {
  buildListHref,
  parseListQuery,
  pageCount,
} from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import Panel from "@/shared/ui/Panel";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { countBibs, voidBibsFor } from "@/modules/registrations/bibs";
import { bulkCancelRegistrationsAction, bulkDeleteRegistrationsAction, markBibsPrintedAction, sendOutboxNowAction } from "../actions";
import { resendRegistrationEmailAction } from "../[id]/actions";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { NeverKeptField } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import {
  cancelRegistrationFromRowAction,
  checkInAction,
  confirmRegistrationNowAction,
  eraseRegistrationFromListAction,
  promoteRegistrationAction,
  setBibPrintedAction,
} from "../actions";
import { ALL_EVENTS, AUTOMATIC, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
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
/** Present for a screen reader, absent on screen (the usual clip pattern). */
const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, p: 0, m: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

export default async function AdminRegistrationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRegistrations(actor.role)) notFound();

  const current = await searchParams;
  const { eventId, status, clubMember, bounced, q, saved, error, cancelled, erased, failed, sent, erase, marked, voided } = current;
  // The printed numbers a bulk cancel just made void (§311), as the action wrote them: digits
  // and commas only, whatever the address bar says, and a race's worth at most.
  // A repeated key (`?voided=1&voided=2`) arrives as a list at runtime; only digits are ever read back.
  const voidedRaw: string = Array.isArray(voided) ? (voided as string[]).join(",") : (voided ?? "");
  const voidedNow = voidedRaw.split(",").filter((part) => /^\d{1,5}$/.test(part)).slice(0, 100);

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

    Unless a name was typed and no event chosen (§312): then every event, because somebody
    searching for a person must not be told "nobody" by a filter they never set.
  */
  const [volume, events] = await Promise.all([
    readEmailVolumeToday(db, new Date()),
    listEventsWithRegistrations(db),
  ]);
  const eventFilter = defaultEventFilter(eventId, events, q);
  filters.eventId = eventFilter.eventId;
  const featuredEvent = events.find((event) => event.featured) ?? null;

  const [rows, total, summary, bibs, voidBibs] = await Promise.all([
    listRegistrationsForAdmin(db, filters, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort as RegistrationSortKey,
      dir: query.dir,
    }),
    countRegistrationsForAdmin(db, filters),
    /*
      The counter (§246). Deliberately blind to the *status* filter: the strip's job is to say
      how this event stands, and one that emptied to a single number as soon as somebody
      filtered by "confirmate" would answer a question nobody asked. One grouped query, the
      same `WHERE` as the list, so the page costs one round trip more rather than five.
    */
    summariseRegistrationsForAdmin(db, { ...filters, status: undefined }),
    /*
      How many bibs this event has and how many are still unprinted (§264). One grouped count,
      and only when the list is about a single event — "all events" has no sheet to print, and
      the club's database bills compute time (§68).
    */
    filters.eventId ? countBibs(db, filters.eventId) : Promise.resolve({ total: 0, unprinted: 0 }),
    /*
      The printed bibs that belong to nobody any more (§311) — the numbers themselves, because
      the panel names each one as a link and there are a handful per race. `countBibs` cannot
      carry them: its scope is the sheet's, which is confirmed rows only, and that exclusion is
      the rule this list is the other half of.
    */
    filters.eventId ? voidBibsFor(db, filters.eventId) : Promise.resolve([]),
  ]);

  /*
    Who filled the form again, for the rows on this page only (§312): one grouped read of the
    audit trail keyed on the ids just fetched, so a page of twenty-five costs one query, not
    twenty-five. Beside the translations, which it does not depend on.
  */
  const [resubmissions, t, minorSigns] = await Promise.all([
    listResubmissionMarks(db, rows.map((row) => row.id)),
    getTranslations("Admin"),
    /*
      Whether "Confirmă pe hârtie" on a minor attests the minor's signature too (§330): the
      declaration in effect, per language, looked up by each row's own. Only when a minor is on
      the page — the confirmation's sentence is the only thing that reads it.
    */
    rows.some((row) => row.guardianName)
      ? declarationAsksMinorToSignByLocale(db, new Date())
      : Promise.resolve({ ro: false, en: false }),
  ]);

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
  /*
    The export's query names the scope the screen resolved, never the automatic one (§312,
    §15.10): the file is the set that was on screen when the button was pressed, even if the
    club features another event before the link is followed. The route runs the same
    `defaultEventFilter` over it, so `all` and a bookmarked link mean there what they mean here.
  */
  const exportQueryString = buildListHref("", listParams, { eventId: eventFilter.eventId ?? ALL_EVENTS }).replace(/^\?/, "");
  const hasFilters = Boolean(eventId || status || clubMember || bounced || q);
  /*
    Nobody chose a filter, yet the list is still narrowed: `defaultEventFilter` scoped it to the
    featured event with no URL parameter to show for it (§178). This is the shape §277 named —
    "the control that would have explained it, the event filter, was inside a fold §269 had
    closed" — so the fold below has to open, and say the scope, on this case too, not only on
    `hasFilters`.
  */
  const autoScopedToFeatured = !hasFilters && Boolean(eventFilter.eventId);

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
  /*
    Everything on this screen that *changes* a registration (§289).

    The page itself is open to whoever may read the list — the Organizer since the owner asked
    for it — so every verb that was implicitly Administrator's because the screen was has to say
    so for itself now: erasure, the bulk cancel, the resend, the printing marks and "send now".
    Each of them is refused again in its service (BR-REQ-060-01); this is what keeps a button off
    the screen instead of letting the refusal arrive afterwards as an error code, which is the
    complaint that started §289's sibling fix.
  */
  const mayManage = canManageRegistrations(actor.role);
  // What the bulk cancel would void among the rows it is showing (§311); said beside its help.
  const printedOnPage = printedNumbersACancelWouldVoid(rows);

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
          {/* The form filled again with the same address (§312): how often and when last, in the
              chip's own words, because a `title` never shows on a phone. The sentence with the
              full date is the hover text; the registration's timeline has each one. Shown to
              whoever reads the list, the Organizer too (§289) — it changes nothing. */}
          {(() => {
            const mark = resubmissions.get(row.id);
            if (!mark) return null;
            return (
              <Chip
                size="small"
                variant="outlined"
                data-testid="resubmitted-chip"
                label={t("registrations.resubmittedChip", {
                  count: mark.count,
                  date: formatDay(mark.lastAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }),
                })}
                title={t("registrations.resubmittedHint", {
                  count: mark.count,
                  date: formatDay(mark.lastAt, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" }),
                })}
              />
            );
          })()}
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
      // What "2*", a bold "1" and the tick mean (§313; the owner: "not sure what that is!") — a
      // tap-friendly hint, because the cell's own `title` never shows on a phone.
      hint: t("registrations.bibColumnHint"),
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
              // The containing block of the visually hidden "provizoriu" (§313). Without it that
              // absolutely positioned span escaped the table's horizontal scroll area — a scroller
              // is not a containing block unless positioned — and stretched the whole page to about
              // 600 px on a 320 px phone, so the browser zoomed out and every tap on the page landed
              // somewhere else (the race-day e2e on mobile, red on every qa push since #132).
              position: "relative",
              fontVariantNumeric: "tabular-nums",
              fontWeight: number.settled ? 700 : 500,
              color: number.settled ? "text.primary" : "text.secondary",
            }}
          >
            {number.value}
            {number.settled ? null : (
              <>
                <span aria-hidden="true">*</span>
                {/* The asterisk, said in a word to a screen reader, which would otherwise read "star". */}
                <Box component="span" sx={VISUALLY_HIDDEN}>{` ${t("registrations.bibProvisionalShort")}`}</Box>
              </>
            )}
            {/*
              Whether this bib is on paper (§264). A tick rather than a printer glyph, for the
              reason the editor's toolbar has words on it: the printer emoji renders as a broken
              box on the owner's own machine. It is the club's own record — set by the mark, never
              by a download — and it is only ever shown on a settled number, because a provisional
              one is printed nowhere.
            */}
            {number.settled && row.bibPrintedAt !== null && (
              <Box
                component="span"
                title={t("registrations.bibPrintedOn", {
                  date: formatDay(row.bibPrintedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
                })}
                sx={{ ml: 0.5, color: "success.main", fontWeight: 700 }}
                aria-label={t("registrations.bibPrinted")}
              >
                ✓
              </Box>
            )}
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
      render: (row) => formatDay(row.submittedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Every backoffice page gives this id to its alert region; the Server Actions redirect
          to `#admin-alert` so the browser lands on the outcome. The theme gives `html` a
          `scroll-padding-top` so the sticky site header cannot cover it after a long list. */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "registrationsErased" && (
          <Alert severity={Number(failed) > 0 ? "warning" : "success"}>
            {t("registrations.registrationsErased", { erased: erased ?? "0", failed: failed ?? "0" })}
          </Alert>
        )}
        {/* What the erase could not reach (§322): the copies outside the database, by hand. */}
        {((saved === "registrationsErased" && Number(erased) > 0) || saved === "registrationDeleted") && (
          <Alert severity="info" data-testid="erase-leftovers" sx={{ mt: 1 }}>
            {t("registrations.eraseLeftovers")}
          </Alert>
        )}
        {saved === "registrationsCancelled" && (
          <Alert severity={Number(failed) > 0 ? "warning" : "success"}>
            {t("registrations.registrationsCancelled", {
              cancelled: cancelled ?? "0",
              failed: failed ?? "0",
            })}
          </Alert>
        )}
        {/* The bibs this press has just made void, named where the club is looking (§311). */}
        {saved === "registrationsCancelled" && voidedNow.length > 0 && (
          <Alert severity="warning" data-testid="registrations-cancelled-voided" sx={{ mt: 1 }}>
            {t("registrations.registrationsCancelledPrinted", { numbers: voidedNow.join(", ") })}
          </Alert>
        )}
        {saved === "outboxSent" && (
          <Alert severity="success">{t("outbox.sentNow", { count: Number(sent ?? "0") })}</Alert>
        )}
        {saved === "registrationDeleted" && (
          <Alert severity="success">{t("registrations.registrationDeleted")}</Alert>
        )}
        {/* How many bibs the mark actually touched (§264) — "Salvat." would leave the club
            wondering whether it hit the batch it had just downloaded. */}
        {(saved === "bibsPrinted" || saved === "bibsUnprinted") && (
          <Alert severity="success">
            {t(saved === "bibsPrinted" ? "registrations.bibsPrintedAlert" : "registrations.bibsUnprintedAlert", {
              count: Number(marked ?? "0"),
            })}
          </Alert>
        )}
        {saved &&
          saved !== "registrationsCancelled" &&
          saved !== "registrationsErased" &&
          saved !== "outboxSent" &&
          saved !== "registrationDeleted" &&
          saved !== "bibsPrinted" &&
          saved !== "bibsUnprinted" && <Alert severity="success">{t("saved")}</Alert>}
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
      {mayManage && eraseTarget && (
        <Box
          component="section"
          id="erase-panel"
          tabIndex={-1}
          sx={{ border: 1, borderColor: "error.main", borderRadius: 1, px: 2, py: 2, scrollMarginTop: 16 }}
        >
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1, color: "error.main" }}>
            {t("registrations.eraseTitle", { name: eraseTarget.registeredName })}
          </Typography>
          {/* A refusal — the name mistyped — keeps the panel open with the reason still in its
              box; the typed name is asked again, because it is the guard (§180, §315). */}
          <ActionForm
            action={eraseRegistrationFromListAction}
            messages={await refusalMessages(
              { reason: t("registrations.deleteReason"), confirmName: t("registrations.eraseTypeName") },
              { confirmation: true },
            )}
            data-testid="erase-from-list-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={eraseTarget.id} />
            {/* Only the query, never a path: `actions.ts` rebuilds the path from `getPathname`,
                so this field can choose which rows come back and nothing else. */}
            <input type="hidden" name="listQuery" value={eraseReturnQuery} />
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {t("registrations.deleteHelp")}
              </Typography>
              {/* What the erase cannot reach (§322), read before the press as well as after it. */}
              <Typography variant="body2" color="text.secondary" data-testid="erase-leftovers-before">
                {t("registrations.eraseLeftovers")}
              </Typography>
              <RecallField
                name="reason"
                label={t("registrations.deleteReason")}
                // The one line that outlives the erasure (§322): why, never who.
                helperText={t("registrations.reasonNoIdentity")}
                required
                size="small"
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={{ maxWidth: 480 }}
              />
              {/* Never a `RecallField`: the typed name is not kept. `NeverKeptField` still
                  carries the id the summary's "check this field" link points at (§47). */}
              <NeverKeptField
                name="confirmName"
                label={t("registrations.eraseTypeName")}
                helperText={t("registrations.eraseTypeNameHelp", { name: eraseTarget.registeredName })}
                required
                size="small"
                autoComplete="off"
                sx={{ maxWidth: 480 }}
              />
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <GlyphSubmitButton
                  label={t("registrations.eraseAction")}
                  pendingLabel={t("registrations.erasePending")}
                  icon="erase"
                  incompleteHintNamed={t("forms.incompleteFirst")}
                  color="error"
                  variant="contained"
                />
                {/* A link, not a button: leaving the panel is a navigation, and it must work
                    for the same reader the panel itself was built for. */}
                <GlyphButton
                  icon="dismiss"
                  href={buildListHref(basePath, listParams, { erase: undefined, page: current.page })}
                  variant="text"
                  sx={TAP_TARGET}
                >
                  {t("confirm.cancel")}
                </GlyphButton>
              </Stack>
            </Stack>
          </ActionForm>
        </Box>
      )}

      {/*
        Why this screen has fewer buttons than the guide describes (§289).

        Said once, on the page, and not as a refusal after a press. The owner's complaint about
        the event editor was exactly this shape — "pot edita dar nu mi se salvează" — and the
        answer there and here is the same: name the rule where the reader is, rather than letting
        them find it by pressing something.
      */}
      {!mayManage && <Alert severity="info">{t("registrations.readOnlyNotice")}</Alert>}

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.registrations")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {/* BR-REQ-037-05: somebody asked at a run, and the club types it in for them. */}
          <GlyphButton
            icon="addPerson"
            href={`${getPathname({ locale, href: "/admin/registrations/new" })}${eventId ? `?eventId=${eventId}` : ""}`}
            variant="contained"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.new")}
          </GlyphButton>
          {/*
            The export takes the filters and not the page: a spreadsheet of whichever 25 rows
            happened to be on screen would be a quietly wrong file (§15.10). Set the event
            filter and the file is that race's start list, named after it (§172).

            Excel first, because that is what somebody opens: a bold frozen header, columns
            wide enough to read, dates that sort as dates. The comma-separated file stays for
            whoever is feeding it to something else.
          */}
          <GlyphButton
            icon="spreadsheet"
            href={`/api/admin/registrations/export?format=xlsx${exportQueryString ? `&${exportQueryString}` : ""}`}
            variant="outlined"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.exportExcel")}
          </GlyphButton>
          <GlyphButton
            icon="download"
            href={`/api/admin/registrations/export${exportQueryString ? `?${exportQueryString}` : ""}`}
            variant="text"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.export")}
          </GlyphButton>
          {/* With one event chosen, the organizer's own message to its registrants (§NNN) —
              the page lives under the event; this is the other door to it. */}
          {filters.eventId && canMessageParticipants(actor.role) && (
            <GlyphButton
              icon="announce"
              href={getPathname({ locale, href: { pathname: "/admin/events/[id]/mesaje", params: { id: filters.eventId } } })}
              variant="text"
              size="small"
              sx={TAP_TARGET}
            >
              {t("participantMessages.link")}
            </GlyphButton>
          )}
          {/* An access request arrives as an address, and this list searches by name (§322):
              the Administrator's own page for "everything held about this person". */}
          {mayManage && (
            <GlyphButton
              icon="personData"
              href={getPathname({ locale, href: "/admin/registrations/person" })}
              variant="text"
              size="small"
              sx={TAP_TARGET}
            >
              {t("registrations.personLink")}
            </GlyphButton>
          )}
        </Stack>
      </Stack>

      {/*
        The bibs of this event, as a batch (§264; the owner: "ar trebui să pot descărca BID-urile
        din pagina de înscrieri ca și batch! și să pot marca 'BID printat'").

        Here rather than only on the event's own bib page, because this is the screen the club
        works from on race week. Two presses, in the order the job is done: download the ones
        nobody has printed, then say they are printed. Deliberately not one press — the sheet is
        a GET so it can be saved, mailed to whoever has the printer and opened again, and a PDF
        that downloaded is not a bib that printed.

        Only with an event selected and only when it has numbers: an empty toolbar row would be
        two dead buttons on the screen the club uses most.

        The figures in the aside count **confirmed** registrations only — the sheet's own scope
        — and the sentence says so, because a cancelled registration keeps its settled number and
        its printed mark and would otherwise be the silent difference between "5 printed" and
        the six bibs in the box. Those are the void lines below (§311): one per number, sorted,
        each a link to the row it belongs to, and the panel stays open while there is one to pull. The panel
        renders for them even when every confirmed bib is gone, or the line would vanish with the
        very cancellation that produced it.
      */}
      {filters.eventId && (bibs.total > 0 || voidBibs.length > 0) && (
        <Panel
          title={t("panels.bibs")}
          aside={t("registrations.bibsPrintedCount", { printed: bibs.total - bibs.unprinted, total: bibs.total })}
          collapsible
          // Open while a bib waits for the printer or a printed one waits to be pulled (§311),
          // and after a batch was marked — the undo is in here (§336).
          openWhen={{
            attention: bibs.unprinted > 0 || voidBibs.length > 0,
            saved: saved === "bibsPrinted" || saved === "bibsUnprinted",
          }}
          id="registrations-bibs"
          data-testid="registrations-bibs"
        >
        {/*
          One line per bib, and the whole line is the link (§311): the number, whose it was, and
          what happened to it when — visible, because a `title` never shows on a phone and is not
          what a screen reader reads as the link's name. The state is said in the message's own
          language, one key per state, rather than through the backoffice's Romanian enum labels
          (§35), because here it is a word inside an English sentence.
        */}
        {voidBibs.length > 0 && (
          <Alert severity="warning" data-testid="registrations-void-bibs" sx={{ mb: bibs.total > 0 ? 1.5 : 0 }}>
            {t("registrations.bibsVoid", { count: voidBibs.length })}
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {voidBibs.map((bib) => (
                <Box
                  component="li"
                  key={bib.id}
                  sx={{ fontVariantNumeric: "tabular-nums", "& a": { display: "inline-flex", alignItems: "center", ...TAP_TARGET } }}
                >
                  <Link href={{ pathname: "/admin/registrations/[id]", params: { id: bib.id } }}>
                    {t(bib.status === "CANCELLED" ? "registrations.bibsVoidCancelled" : "registrations.bibsVoidExpired", {
                      number: bib.bibNumber,
                      name: bib.registeredName,
                      date: formatDay(bib.voidedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" }),
                    })}
                  </Link>
                </Box>
              ))}
            </Box>
          </Alert>
        )}
        {/*
          Each of the four wears its verb (§318; the owner: "I also need more icons, including on
          the Printing BID stuff"): the printer on the batch that goes to it, the PDF on the whole
          sheet, the double tick on "they are printed" and the struck-through tick on taking that
          back — the same two glyphs the row's "⋮" uses for one bib.
        */}
        {bibs.total > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
        >
          {bibs.unprinted > 0 && (
            <GlyphButton
              icon="print"
              href={`/api/admin/events/${filters.eventId}/bibs?locale=${locale}&only=unprinted`}
              variant="contained"
              size="small"
              sx={TAP_TARGET}
            >
              {t("registrations.bibsDownloadUnprinted", { count: bibs.unprinted })}
            </GlyphButton>
          )}
          <GlyphButton
            icon="pdf"
            href={`/api/admin/events/${filters.eventId}/bibs?locale=${locale}`}
            variant="outlined"
            size="small"
            sx={TAP_TARGET}
          >
            {t("registrations.bibsDownloadAll", { count: bibs.total })}
          </GlyphButton>
          {/* The downloads above are reads and belong to the Organizer too (§289); saying a
              sheet came out of the printer is a write, so it stays the Administrator's. */}
          {mayManage && bibs.unprinted > 0 && (
            <Box component="form" action={markBibsPrintedAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={filters.eventId} />
              <input type="hidden" name="only" value="unprinted" />
              <input type="hidden" name="listQuery" value={listQueryString} />
              <GlyphSubmitButton
                label={t("registrations.bibsMarkPrinted", { count: bibs.unprinted })}
                pendingLabel={t("registrations.bibsMarkPrintedPending")}
                icon="markPrinted"
                variant="text"
                compact
              />
            </Box>
          )}
          {mayManage && bibs.unprinted < bibs.total && (
            <Box component="form" action={markBibsPrintedAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={filters.eventId} />
              <input type="hidden" name="printed" value="0" />
              <input type="hidden" name="listQuery" value={listQueryString} />
              <GlyphSubmitButton
                label={t("registrations.bibsMarkAllUnprinted")}
                pendingLabel={t("registrations.bibsMarkPrintedPending")}
                icon="markUnprinted"
                variant="text"
                color="inherit"
                compact
              />
            </Box>
          )}
        </Stack>
        )}
        </Panel>
      )}

      {/*
        How this event stands, in one line (§246; the owner: "on the registrations tab I should
        have a counter"). The number the club means by "how many have signed up" first, then
        each state it is made of, then the test rows apart — a synthetic runner is never inside
        a number the club is given (§12.6), and the strip would otherwise disagree with the
        list beneath it, which does show them.
      */}
      <Panel
        title={t("panels.summary")}
        aside={
          filters.eventId
            ? t("registrations.summaryScopeEvent", {
                event: events.find((event) => event.id === filters.eventId)?.title ?? "",
              })
            : t("registrations.summaryScopeAll")
        }
        data-testid="registrations-summary"
      >
      <Stack
        direction="row"
        spacing={1}
        sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t("registrations.summaryTotal", { count: summary.real })}
        </Typography>
        {registrationStatus.enumValues
          .filter((value) => (summary.byStatus[value] ?? 0) > 0)
          .map((value) => (
            <Chip
              key={value}
              size="small"
              variant="outlined"
              label={`${REGISTRATION_STATUS_LABEL[value]}: ${summary.byStatus[value]}`}
            />
          ))}
        {summary.test > 0 && (
          <Chip size="small" variant="outlined" color="warning" label={t("registrations.summaryTest", { count: summary.test })} />
        )}
      </Stack>
      {/*
        Why this number and the tab's badge can differ (§277). The badge counts everybody signed
        up for anything still to come; this list opens on one event. Both are right and the pair
        reads as a contradiction, so the screen says which it is showing and offers the other.
      */}
      {filters.eventId && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("registrations.summaryScopeHelp")}{" "}
          <Box component="a" href={buildListHref(basePath, { ...listParams, eventId: ALL_EVENTS }, {})} sx={{ color: "primary.main" }}>
            {t("registrations.summaryScopeAllLink")}
          </Box>
        </Typography>
      )}
      </Panel>

      {/*
        The outbox, and the day's Mailgun counter (`DECISIONS.md` §80): what is waiting, what
        went out today against the free day's hundred, and "send now" for whoever does not want
        to wait for the monitor. The counter is the ceiling the button respects, and the number
        a newsletter would have to fit under.
      */}
      <Panel
        title={t("panels.outbox")}
        aside={t("outbox.waitingShort", { count: volume.waitingMessages })}
        collapsible
        openWhen={{ attention: volume.waitingMessages > 0, saved: saved === "outboxSent" }}
        id="registrations-outbox"
        data-testid="outbox-panel"
      >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
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
        {/* Only for the role that could press it (§289). Without this the else-branch below would
            tell an Organizer the allowance was spent, which is an answer to a question they were
            never offered — the count and the plan above are the read, and that is the whole
            panel for them. */}
        {!mayManage ? null : volume.waitingMessages > 0 && (volume.remaining === null || volume.remaining > 0) ? (
          <Box component="form" action={sendOutboxNowAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="listQuery" value={listQueryString} />
            <GlyphSubmitButton
              label={t("outbox.sendNow")}
              pendingLabel={t("outbox.sending")}
              ariaLabel={t("outbox.sendNowLong")}
              icon="send"
              variant="contained"
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {volume.waitingMessages === 0 ? t("outbox.nothingWaiting") : t("outbox.allowanceSpent")}
          </Typography>
        )}
      </Stack>
      </Panel>

      {/*
        A plain GET form, so filtering and searching are a URL an organizer can bookmark and
        come back to, and so both keep working with JavaScript off. `sort` and `dir` ride along
        as hidden fields: filtering should narrow the list, not silently re-sort it.
      */}
      <Panel
        title={t("panels.filters")}
        aside={
          hasFilters
            ? t("registrations.filtersInUse")
            : autoScopedToFeatured && featuredEvent
              ? t("registrations.filterAutoFeatured", { event: featuredEvent.title ?? featuredEvent.id })
              : // Closed and unfiltered (§336, folds start closed): the summary still says the list is whole.
                t("registrations.filtersNone")
        }
        collapsible
        // Open while the list is narrowed, so nobody loses a filter behind a fold (§269) —
        // including the automatic featured-event scope nobody chose in the address bar, which is
        // the exact shape §277 named and fixed elsewhere on this same screen; closed otherwise
        // (§336) — the list is what the screen is for.
        openWhen={{ inUse: hasFilters || autoScopedToFeatured }}
        id="registrations-filters"
        data-testid="registrations-filters"
      >
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
          {/*
            "Let the page decide" is an option of its own (§312), the empty value, and it is what
            the select shows and submits until somebody picks an event. Before, the select
            submitted the featured event's id on every press of "Filtrează", so the default
            became a choice nobody had made — and a name search stayed inside it. Its words say
            what it means *on this render*: the featured event, or every event while a name is
            being searched. `displayEmpty` so the empty value shows its words rather than a blank.
          */}
          <TextField
            select
            name="eventId"
            label={t("nav.events")}
            defaultValue={eventFilter.selected}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 220 }}
          >
            {featuredEvent && (
              <MenuItem value={AUTOMATIC}>
                {eventFilter.searchesEverywhere
                  ? t("registrations.filterAutoSearch")
                  : t("registrations.filterAutoFeatured", { event: featuredEvent.title ?? featuredEvent.id })}
              </MenuItem>
            )}
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
            <GlyphButton icon="filter" type="submit" variant="contained" sx={TAP_TARGET}>
              {t("registrations.filter")}
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

      {/* The scope a name search widened to, said where the results start (§312): one line, so
          the filter that used to be silent is never silent the other way either. */}
      {eventFilter.searchesEverywhere && (
        <Alert severity="info" data-testid="registrations-search-everywhere">
          {t("registrations.searchEverywhere")}
        </Alert>
      )}

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
            {/* The form it belongs to is only rendered for the Administrator (§289), and a
                checkbox naming a form that is not on the page is a tick that does nothing. */}
            {mayManage && (
              <Checkbox
                name="registrationId"
                value={row.id}
                form={BULK_FORM}
                slotProps={{
                  input: { "aria-label": t("registrations.selectRow", { name: row.registeredName }) },
                }}
                sx={CHECKBOX_TAP_TARGET}
              />
            )}
            {mayManage && deriveAllowedResendMessageType(row.status) && (
              <Box component="form" action={resendRegistrationEmailAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="registrationId" value={row.id} />
                {/*
                  No glyph here, unlike the registration's own full-size "Retrimite" (§318): on
                  a desktop the envelope made this button 24 pixels wider (84 → 108) and the
                  actions column with it (244 → 268), in a table already wider than a 1280-pixel
                  screen. The column was narrowed so eighty rows stay scannable, and a picture
                  of a verb the label already says is not worth undoing that.
                */}
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
              const verbs = rowVerbsFor(row.status, actor.role, {
                checkedIn: row.checkedInAt !== null,
                // A settled number is the only printable one (§214, §264).
                bib: { settled: row.bibNumber !== null, printed: row.bibPrintedAt !== null },
              });
              const hidden = (
                <>
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="registrationId" value={row.id} />
                </>
              );
              const items: RegistrationMenuItem[] = [
                {
                  kind: "link",
                  icon: "preview",
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
                    // A minor's paper carries two signatures, and the press attests both (§330) —
                    // where the declaration in effect asks the minor to sign; else the one sentence.
                    body:
                      row.guardianName && minorSigns[row.locale]
                        ? t("registrations.confirmOnPaperBodyMinor", { guardian: row.guardianName })
                        : t("registrations.confirmOnPaperBody"),
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
              if (verbs.includes("markBibPrinted")) {
                items.push({
                  kind: "submit",
                  icon: "markPrinted",
                  label: t("registrations.bibMarkPrinted"),
                  formId: `bib-printed-${row.id}`,
                });
              }
              if (verbs.includes("unmarkBibPrinted")) {
                items.push({
                  kind: "submit",
                  icon: "markUnprinted",
                  label: t("registrations.bibMarkUnprinted"),
                  formId: `bib-printed-${row.id}`,
                });
              }
              if (verbs.includes("cancel")) {
                // A printed bib is named before the press (§311): after this the number stays
                // retired and the paper has to come out of the pile.
                const printedWarning =
                  row.bibPrintedAt !== null && row.bibNumber !== null
                    ? `${t("confirm.cancelRegistrationPrintedBody", { number: row.bibNumber })} `
                    : "";
                items.push({
                  kind: "submit",
                  icon: "cancel",
                  label: t("registrations.cancel"),
                  formId: `cancel-${row.id}`,
                  color: "error",
                  confirm: {
                    title: t("registrations.cancel"),
                    body: `${printedWarning}${t("registrations.cancelBody")}`,
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
                    <Box component="form" id={`cancel-${row.id}`} action={cancelRegistrationFromRowAction} sx={{ display: "none" }}>
                      {hidden}
                    </Box>
                  )}
                  {(verbs.includes("markBibPrinted") || verbs.includes("unmarkBibPrinted")) && (
                    <Box component="form" id={`bib-printed-${row.id}`} action={setBibPrintedAction} sx={{ display: "none" }}>
                      {hidden}
                      <input type="hidden" name="printed" value={row.bibPrintedAt ? "0" : "1"} />
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

      {/* Cancel and erase in a batch: the Administrator's, like the single-row verbs above (§289).
          The shared box, amber: destructive, so it says so on its border and keeps the rest. */}
      {mayManage && rows.length > 0 && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, borderColor: "warning.light" }}>
          <Typography component="summary" variant="body2">
            {t("registrations.bulkCancelTitle")}
          </Typography>
          {/* A plain form, not an `ActionForm` (§315): its selection is the table's ticks, which a
              returned refusal could not refill — `bulkDeleteRegistrationsAction` says why. */}
          <Box component="form" id={BULK_FORM} action={bulkCancelRegistrationsAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            {/* Only the query, never a path: `actions.ts` rebuilds the path itself so this
                field cannot become an open redirect. */}
            <input type="hidden" name="listQuery" value={listQueryString} />
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {t("registrations.bulkCancelHelp")}
              </Typography>
              {/*
                The printed bibs this form could make void, named before the press (§311) — the
                single cancel's dialog does it per row, and this is the race-morning path. The ticked
                set exists only in the browser (plain checkboxes, no client island to count them),
                so the sentence names the printed numbers among the rows on this page, which is
                every row the form can reach; the banner afterwards names the ones it did void.
              */}
              {printedOnPage.length > 0 && (
                <Alert severity="warning" data-testid="bulk-cancel-printed">
                  {t("registrations.bulkCancelPrinted", { numbers: printedOnPage.join(", ") })}
                </Alert>
              )}
              {/* One reason for the batch, cancel or erase alike — kept in the trail (§322). */}
              <TextField
                name="reason"
                label={t("registrations.cancelReason")}
                helperText={t("registrations.reasonNoIdentity")}
                size="small"
                required
              />
              <Box>
                <GlyphSubmitButton
                  label={t("registrations.bulkCancelAction")}
                  pendingLabel={t("registrations.bulkCancelPending")}
                  icon="cancel"
                  color="warning"
                  variant="contained"
                />
              </Box>

              {/*
                Erasing the same selection (§287; the owner: "stergerea in batch ar trebui sa
                mearga! dar cu super extra confirmare!").

                In **this** form rather than a second one: a checkbox's `form` attribute names
                exactly one form, so one selection cannot feed two. The button carries the other
                action, and the count typed beside it is the confirmation the service insists on —
                a number the screen has just shown, which changes with the selection and therefore
                cannot become muscle memory the way a fixed word or a second "yes" does.
              */}
              <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
                <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                  {t("registrations.bulkEraseTitle")}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("registrations.bulkEraseHelp")}
                </Typography>
                {/* What the erase cannot reach (§322), for each person in the batch. */}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("registrations.eraseLeftovers")}
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" } }}>
                  <TextField
                    name="confirmCount"
                    label={t("registrations.bulkEraseConfirm")}
                    helperText={t("registrations.bulkEraseConfirmHelp")}
                    size="small"
                    inputMode="numeric"
                    slotProps={{ htmlInput: { pattern: "[0-9]{1,4}", maxLength: 4 } }}
                    sx={{ maxWidth: 260 }}
                  />
                  <ConfirmSubmitButton
                    formAction={bulkDeleteRegistrationsAction}
                    label={t("registrations.bulkEraseAction")}
                    icon="erase"
                    title={t("confirm.bulkEraseTitle")}
                    body={t("confirm.bulkEraseBody")}
                    confirmLabel={t("registrations.bulkEraseAction")}
                    cancelLabel={t("confirm.cancel")}
                    color="error"
                    variant="contained"
                  />
                </Stack>
              </Box>
            </Stack>
          </Box>
        </Box>
      )}
    </Stack>
  );
}
