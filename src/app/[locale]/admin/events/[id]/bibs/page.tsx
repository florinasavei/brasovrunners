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
import { BIB_IMAGE } from "@/modules/registrations/bib-geometry";
import { findEventForBibs, listBibs } from "@/modules/registrations/bibs";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * Every bib of one event as it will print, one picture each (`DECISIONS.md` §94) — on its own
 * page since 2026-09-18, because each picture is drawn on request and a grid of them on the
 * event page made every visit to the editor pay for it.
 *
 * Whoever may read the registrations, like the sheet (§289; the owner: "organizer should also be
 * able to see BIDs and export them"). Assigning the numbers and marking them printed stay the
 * Administrator's, on the screens those verbs live on.
 */
export default async function EventBibsPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staffUser = await requireStaff();
  if (!canReadRegistrations(staffUser.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§NNN).
  if (!isUuid(id)) notFound();

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
      {/*
        The whole field on one A4 sheet, on the page that shows the whole field (§189).

        The download already existed on the event's own editor, several folds down, and the owner
        — standing on this page, looking at every number he wanted to print — asked for it again:
        "vreau să pot exporta toate BID-urile!". A verb belongs where its object is.

        A plain link to the route, so it works with JavaScript off and so the browser handles the
        PDF the way the reader's browser handles PDFs.
      */}
      {bibs.length > 0 && (
        <Box>
          <GlyphButton
            icon="pdf"
            href={`/api/admin/events/${id}/bibs?locale=${locale}`}
            variant="contained"
            sx={{ minHeight: 44 }}
          >
            {t("bibs.downloadAll", { count: bibs.length })}
          </GlyphButton>
        </Box>
      )}
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
              {/* No rounded corner: the picture draws the paper's edge itself (A5 bibs, §338), and
                  a radius here clipped that edge's corners — as the editor preview and the desk row
                  no longer do either. */}
              <Box
                component="img"
                src={`/api/admin/events/${id}/bibs/preview?registration=${bib.id}&locale=${locale}`}
                alt={t("bibs.previewAlt", { number: bib.bibNumber, name: bib.registeredName })}
                width={BIB_IMAGE.width}
                height={BIB_IMAGE.height}
                loading="lazy"
                sx={{ width: "100%", height: "auto", display: "block" }}
              />
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}
