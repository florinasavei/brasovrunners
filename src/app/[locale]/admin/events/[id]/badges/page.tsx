import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { badgePictureStamp } from "@/modules/volunteers/badges/badge-design";
import { BADGE_COUNT_MAX, BADGE_REFUSED_PARAM, BADGE_TOTAL_MAX, findEventForBadges, listBadgeRoles } from "@/modules/volunteers/badges/badges";
import BadgeDesignPanel from "@/modules/volunteers/badges/ui/BadgeDesignPanel";
import BadgePrintPanel from "@/modules/volunteers/badges/ui/BadgePrintPanel";
import BadgeRoleColours from "@/modules/volunteers/badges/ui/BadgeRoleColours";
import { isUuid } from "@/shared/ids";

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ [BADGE_REFUSED_PARAM]?: string }> };

/**
 * «Ecusoane pentru voluntari» (§764; the owner, 2026-10-14: «Și trebuie să putem face design și printa
 * ecusoane de voluntari (similar cu BIB-urile)», then «Badge-urile sunt de obicei mai mici și mai lungi și
 * fără nume, numele îl scriem manual cu markerul»): an event's volunteer badges, on a page of their own
 * under the event like its bibs — the event editor is long enough, and the «Voluntari» card links here
 * with one button.
 *
 * Three cards: «Cum arată ecusonul» (the designer, with its live preview), «Culorile rolurilor» (each
 * role's band) and «Tipărire» (per role, with spares and the badges «fără rol»). Whoever designs the
 * badges — the Organizer, the Administrator and the Superadministrator (`canDesignVolunteerBadges`),
 * asserted here, in the actions, the service and both routes; anyone else meets the 404 an unknown page
 * gets. A print the route refused comes back here with `?refused=` and an alert that says why. No volunteer is read on this page: a badge carries a role, never a person.
 */
export default async function EventBadgesPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { [BADGE_REFUSED_PARAM]: refused } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staffUser = await requireStaff();
  if (!canDesignVolunteerBadges(staffUser.role)) notFound();
  if (!isUuid(id)) notFound();

  const db = getDb();
  const event = await findEventForBadges(db, id, locale);
  if (!event) notFound();
  const roles = await listBadgeRoles(db, id);
  const t = await getTranslations("Admin");
  // The designer's sample is drawn for the first role (or «fără rol»); its saved name and colour are in the address.
  const sampleRole = roles[0]?.id ?? "none";
  const version = badgePictureStamp([event.title, roles.map((role) => [role.id, role.nameRo, role.nameEn, role.colour])]);

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/events/[id]", params: { id } }}>{t("badges.backToEvent")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("badges.title", { event: event.title })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("badges.intro")}
      </Typography>
      {(refused === "number" || refused === "total") && (
        <Alert severity="error" data-testid="badge-print-refused">
          {refused === "number" ? t("badges.print.refusedNumber", { max: String(BADGE_COUNT_MAX) }) : t("badges.print.refusedTotal", { total: String(BADGE_TOTAL_MAX) })}
        </Alert>
      )}
      <BadgeDesignPanel eventId={id} locale={locale} design={event.design} dropped={event.dropped} sampleRole={sampleRole} version={version} />
      <BadgeRoleColours eventId={id} locale={locale} roles={roles} design={event.design} />
      <BadgePrintPanel eventId={id} locale={locale} design={event.design} roles={roles} eventTitle={event.title} refused={refused === "number" || refused === "total"} />
    </Stack>
  );
}
