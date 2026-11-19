import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readEmailHistory } from "@/modules/notifications/email-history";
import EmailHistoryPanel from "@/modules/notifications/ui/EmailHistory";
import NotesCard from "@/modules/registrations/ui/NotesCard";
import { canManageRegistrations, canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { findVolunteerForAdmin } from "@/modules/volunteers/admin-list";
import { volunteerPersonContextOf } from "@/modules/volunteers/person-context";
import TurnIntoRunnerPanel from "@/modules/volunteers/ui/TurnIntoRunnerPanel";
import VolunteerDecisionCard from "@/modules/volunteers/ui/VolunteerDecisionCard";
import VolunteerPerson, { STATE_CHIP, volunteerHiddenFields } from "@/modules/volunteers/ui/VolunteerPerson";
import { listVolunteerNotes } from "@/modules/volunteers/volunteer-notes";
import { canTakeRaffleList } from "@/modules/volunteers/raffle-list";
import { readRaffleLine } from "@/modules/volunteers/raffle-roster";
import { raffleVolunteerLine } from "@/modules/volunteers/ui/RaffleLines";
import { raffleSignUpAction } from "../../checkin/tombola/actions";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import TickButton from "@/shared/ui/TickButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { turnVolunteerIntoRunnerAction } from "../../registrations/actions";
import { setVolunteerDecisionAction, setVolunteerKitAction, setVolunteerPresentAction } from "../actions";
import { addVolunteerNoteAction, deleteVolunteerNoteAction, editVolunteerNoteAction } from "./note-actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ volunteerError?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One volunteer (§839): the block the event's «Voluntari» card draws for them (`VolunteerPerson`) on a page of its
 * own — the contact, what they said about themselves, the roles given and offered with «Dă-i rolul …» and
 * «Ia-i rolul …», the agreement, the guardian, the state verbs and «Modifică» — reached from the list's row. The
 * same three roles as the card; an id nobody has, or a guessed one, is a 404 (BR-REQ-060-01). Every verb comes
 * back here (`returnTo`), the refused ones with their code in the address.
 *
 * «Note interne» stands first, right under the heading block («Note interne» for volunteers, the registration's page's shape):
 * what the organizers tell each other about the person, newest first, each with its author and its day and hour, open by itself
 * when there is one, after its own save, change or delete (`saved`) and for `#note-interne`; closed on «nicio notă» otherwise.
 * Each note the reader may change has «Modifică» beside «Șterge» (§964), a fold with the note's words. Its presses are
 * `note-actions.ts`.
 *
 * «Decizie pentru ziua cursei» (§954) stands right after it, still before the person's block: the organizers' one line about
 * what they decided for the person on race day, with the form that writes it (`VolunteerDecisionCard`, `../actions.ts`).
 *
 * Under the person's block, for the Administrator alone: «Transformă în alergător» (§948, `TurnIntoRunnerPanel`).
 */
export default async function AdminVolunteerPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageVolunteers(actor.role)) notFound();
  if (!isUuid(id)) notFound();

  const db = getDb();
  const now = new Date();
  const person = await findVolunteerForAdmin(db, id, locale);
  if (!person) notFound();

  const t = await getTranslations("Admin");
  const path = getPathname({ locale, href: { pathname: "/admin/volunteers/[id]", params: { id } } });
  const [context, emails, notes] = await Promise.all([
    volunteerPersonContextOf(db, person.event, locale, now, path),
    // «Emailuri» (§915): read only for the Administrator and the Superadministrator; the reader asks again.
    canManageRegistrations(actor) ? readEmailHistory(db, actor, { volunteerId: person.id }, now) : Promise.resolve(null),
    // «Note interne»: the person's live notes, newest first; the service asks for the role again.
    listVolunteerNotes(db, actor, person.id),
  ]);
  // The raffle's line (§984), for the organizers — the roles that take the raffle's file — of an event that holds one.
  const raffle = canTakeRaffleList(actor) ? await readRaffleLine(db, { table: "volunteer", id: person.id }, now) : null;
  const { volunteerError, saved } = await searchParams;
  const errorCode = volunteerError && /^[A-Z_]{1,48}$/.test(volunteerError) && t.has(`errors.${volunteerError}`) ? volunteerError : null;
  const eventCardHref = `${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: person.eventId } } })}#box-volunteers`;
  const when = person.eventStartsAt && !person.eventDateToBeAnnounced ? formatDay(person.eventStartsAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }) : null;

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/volunteers", query: { eventId: person.eventId } }}>{t("volunteers.screen.backToList")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {errorCode && <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {person.name}
        </Typography>
        <StatusChip glyph={STATE_CHIP[person.state].glyph} color={STATE_CHIP[person.state].color} label={t(`volunteers.states.${person.state}`)} testId="volunteer-state" />
        {/*
          «Prezent» (§983; the owner, 2026-11-18: «La voluntari trebuie să trec prezent/absent ca să pot face tombola doar pentru cei
          prezenți»): the list's one-press tick beside the name, before «Are kit» as the list's columns stand — the same plain form and
          action, posting the state it wants (`present=1|0`), working with scripts off and coming back here (`returnTo`). Unticked is
          absent. The service asks for the role again (`canManageVolunteers`).
        */}
        <Box component="form" action={setVolunteerPresentAction} data-testid="volunteer-page-present-form">
          {volunteerHiddenFields({ locale, eventId: person.eventId, returnTo: path })}
          <input type="hidden" name="volunteerId" value={person.id} />
          <input type="hidden" name="present" value={person.present ? "0" : "1"} />
          <TickButton checked={person.present} data-testid="volunteer-page-present-tick">
            {t("volunteers.presence.tick")}
          </TickButton>
        </Box>
        {/*
          «Are kit» (§971; the owner, 2026-11-17, on this page: «nu pot bifa aici că are kit»): the list's one-press tick (§904) beside
          the name — before, it sat only inside «Modifică» at the page's foot. The same plain form and action as the list's row: it
          posts the state it wants (`hasKit=1|0`), never a toggle, works with scripts off, and comes back here (`returnTo`). The
          service asks for the role again (`canManageVolunteers`).
        */}
        <Box component="form" action={setVolunteerKitAction} data-testid="volunteer-page-kit-form">
          {volunteerHiddenFields({ locale, eventId: person.eventId, returnTo: path })}
          <input type="hidden" name="volunteerId" value={person.id} />
          <input type="hidden" name="hasKit" value={person.hasKit ? "0" : "1"} />
          <TickButton checked={person.hasKit} data-testid="volunteer-page-kit-tick">
            {t("volunteers.person.hasKit")}
          </TickButton>
        </Box>
      </Stack>

      {/* Which event, and the way to its card: the roles, the switches and the add-by-hand form live there (§754, §761). */}
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="body2" color="text.secondary" data-testid="volunteer-event-line">
          {t("volunteers.screen.eventLine", { event: person.eventTitle ?? person.eventId, when: when ?? "" })}
        </Typography>
        <GlyphButton icon="role" href={eventCardHref} variant="text" size="small" sx={TAP_TARGET} data-testid="volunteers-event-card">
          {t("volunteers.screen.eventCard")}
        </GlyphButton>
      </Stack>

      {/* The raffle (§984): whether the person takes part, in one line, and the organizers' «Înscrie la tombolă» while the sign-up is open. */}
      {raffle && (await raffleVolunteerLine({ line: raffle, locale, eventId: person.eventId, volunteerId: person.id, name: person.name, action: raffleSignUpAction }))}

      {/* «Note interne» first, before the person's block: what the organizers left about the person is read before anything else. */}
      <NotesCard
        locale={locale}
        owner={{ field: "volunteerId", id: person.id }}
        max={VOLUNTEER_NOTE_MAX}
        authorGone={t("volunteers.notes.authorUnknown")}
        notes={notes}
        addAction={addVolunteerNoteAction}
        deleteAction={deleteVolunteerNoteAction}
        editAction={editVolunteerNoteAction}
        opened={saved === "noteAdded" || saved === "noteDeleted" || saved === "noteEdited"}
      />

      {/*
        «Decizie pentru ziua cursei» (§954): the organizers' part of the page, beside their notes and before the person's own
        block — what THEY decided for the person on race day, and the form that writes it. The «Voluntari» list's dialog posts
        to the same action; this one comes back here (`path`), and the list's press lands on this card when no script runs.
      */}
      <VolunteerDecisionCard locale={locale} person={person} returnTo={path} action={setVolunteerDecisionAction} />

      <VolunteerPerson person={person} context={context} as="section" />

      {/*
        «Transformă în alergător» (§948): the person entered on the race's official waiting list and cancelled here, in one
        press. The Administrator's alone — the Organizer, who opens this page for the roles, gets no fold, and the service
        refuses — on an event that takes registrations on the site and has not started, for a person who is not cancelled.
      */}
      {canManageRegistrations(actor.role) && person.state !== "CANCELLED" && person.event.registrationMode === "INTERNAL" && person.event.startsAt.getTime() > now.getTime() && (
        <TurnIntoRunnerPanel locale={locale} eventId={person.eventId} volunteerId={person.id} name={person.name} email={person.email} toRunnerAction={turnVolunteerIntoRunnerAction} />
      )}

      {/*
        «Emailuri» (§915): every email the outbox holds for this volunteer — their own and their parent's link, by the
        payload's `volunteerId` as «Emailuri azi» joins them — newest first, each with its tries, when it was queued and by
        what, what became of it; closed, its line saying how many and the latest. The Administrator's and the
        Superadministrator's alone: the Organizer, who opens this page for the roles, gets no fold, and the reader refuses.
      */}
      {emails && <EmailHistoryPanel locale={locale} history={emails} now={now} title="person" level={3} id="emailuri" data-testid="volunteer-emails" />}
    </Stack>
  );
}
