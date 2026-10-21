import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { findVolunteerForAdmin } from "@/modules/volunteers/admin-list";
import { volunteerPersonContextOf } from "@/modules/volunteers/person-context";
import VolunteerPerson, { STATE_CHIP } from "@/modules/volunteers/ui/VolunteerPerson";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ volunteerError?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One volunteer (§NNN): the block the event's «Voluntari» card draws for them (`VolunteerPerson`) on a page of its
 * own — the contact, what they said about themselves, the roles given and offered with «Dă-i rolul …» and
 * «Ia-i rolul …», the agreement, the guardian, the state verbs and «Modifică» — reached from the list's row. The
 * same three roles as the card; an id nobody has, or a guessed one, is a 404 (BR-REQ-060-01). Every verb comes
 * back here (`returnTo`), the refused ones with their code in the address.
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
  const context = await volunteerPersonContextOf(db, person.event, locale, now, path);
  const { volunteerError } = await searchParams;
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

      <VolunteerPerson person={person} context={context} as="section" />
    </Stack>
  );
}
