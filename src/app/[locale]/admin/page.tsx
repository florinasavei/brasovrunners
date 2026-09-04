import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { listEventsForBackoffice } from "@/modules/content/events/repository";
import { requireStaff } from "@/modules/staff-identity/session";

export const dynamic = "force-dynamic";

/**
 * What there is to edit.
 *
 * Events only. The CMS boundary (AGENTS.md §11.1, BR-REQ-050-01) is an allowlist of content
 * types, and articles, static pages and galleries are M5 proper — no interface here offers a
 * new route, a new layout or a new content type, because none exists to offer.
 *
 * `requireStaff()` runs even though the layout already refused an anonymous request: a page is
 * a request of its own, and a guard that depends on a parent having run is a guard that
 * disappears the first time someone renders this page somewhere else.
 */
export default async function AdminEventsPage() {
  await requireStaff();

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const events = await listEventsForBackoffice(getDb());

  if (events.length === 0) {
    return <Typography variant="body1">{t("events.empty")}</Typography>;
  }

  return (
    <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {events.map(({ event, translations }) => (
        <Card key={event.id} component="li" variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
              {event.featured && <Chip size="small" color="primary" label={t("events.featured")} />}
              <Chip size="small" label={event.kind} />
              <Chip
                size="small"
                variant="outlined"
                label={format.dateTime(event.startsAt, {
                  timeZone: event.timezone,
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
            </Stack>

            <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 1 }}>
              <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>
                {translations[0]?.title ?? event.id}
              </Link>
            </Typography>

            <Stack spacing={0.5}>
              {translations.map((translation) => (
                <Typography key={translation.id} variant="body2" color="text.secondary">
                  {translation.locale.toUpperCase()} · {t(`status.${translation.editorialStatus}`)} ·{" "}
                  {/* The preview renders in the locale of its own URL, so the link forces the
                      translation's locale rather than the one the organizer is browsing in. */}
                  <Link
                    locale={translation.locale}
                    href={{ pathname: "/preview/events/[id]", params: { id: event.id } }}
                  >
                    {t("events.preview")}
                  </Link>
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
