import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import { findEventForBibs, listBibs } from "@/modules/registrations/bibs";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * Every bib of one event as it will print, one picture each (`DECISIONS.md` §94) — on its own
 * page since 2026-09-18, because each picture is drawn on request and a grid of them on the
 * event page made every visit to the editor pay for it. Administrator only, like the sheet.
 */
export default async function EventBibsPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staffUser = await requireStaff();
  if (!canManageRegistrations(staffUser.role)) notFound();

  const db = getDb();
  const record = await findEventForEditing(db, id);
  if (!record) notFound();
  const event = await findEventForBibs(db, id, locale);
  const bibs = await listBibs(db, id);
  const t = await getTranslations("Admin");

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/events/[id]", params: { id } }}>{t("bibs.backToEvent")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("bibs.previewTitle", { event: event?.title ?? id, count: bibs.length })}
      </Typography>
      {bibs.length === 0 ? (
        <Typography color="text.secondary">{t("bibs.helpNone")}</Typography>
      ) : (
        <Box
          component="ul"
          sx={{
            listStyle: "none",
            p: 0,
            m: 0,
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
          }}
        >
          {bibs.map((bib) => (
            <Box component="li" key={bib.id}>
              <Box
                component="img"
                src={`/api/admin/events/${id}/bibs/preview?registration=${bib.id}&locale=${locale}`}
                alt={t("bibs.previewAlt", { number: bib.bibNumber, name: bib.registeredName })}
                width={900}
                height={600}
                loading="lazy"
                sx={{ width: "100%", height: "auto", display: "block", borderRadius: 1 }}
              />
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}
