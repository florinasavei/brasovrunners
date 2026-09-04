import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listEventsForBackoffice } from "@/modules/content/events/repository";
import { canCreateEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { duplicateEventAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

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
 */
export default async function AdminEventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  const { error, saved } = await searchParams;

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const events = await listEventsForBackoffice(getDb());

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      {saved && <Alert severity="success">{t("saved")}</Alert>}

      {canCreateEvent(staffUser.role) && (
        <Stack direction="row">
          {/* `component="a"` with a resolved path, not `component={Link}`: MUI's Button is a
              Client Component, and passing a component reference from a Server Component to one
              is refused by React outright. */}
          <Button
            component="a"
            href={getPathname({ locale, href: "/admin/events/new" })}
            variant="contained"
            size="small"
          >
            {t("events.new")}
          </Button>
        </Stack>
      )}

      {events.length === 0 ? (
        <Typography variant="body1">{t("events.empty")}</Typography>
      ) : (
        <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {events.map(({ event, translations }) => (
            <Card key={event.id} component="li" variant="outlined">
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  {/* Publication is one state for the whole event now, so it is one chip. */}
                  <Chip
                    size="small"
                    color={event.editorialStatus === "PUBLISHED" ? "success" : "default"}
                    label={t(`status.${event.editorialStatus}`)}
                  />
                  {event.featured && <Chip size="small" color="primary" label={t("events.featured")} />}
                  <Chip size="small" label={event.kind} />
                  {event.registrationMode !== "NONE" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(`registrationMode.${event.registrationMode}`)}
                    />
                  )}
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

                <Stack spacing={0.5} sx={{ mb: 1 }}>
                  {translations.map((translation) => (
                    <Typography key={translation.id} variant="body2" color="text.secondary">
                      {translation.locale.toUpperCase()} · {translation.title} ·{" "}
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

                {canCreateEvent(staffUser.role) && (
                  <form action={duplicateEventAction}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="eventId" value={event.id} />
                    <Button type="submit" size="small" variant="text">
                      {t("editor.duplicate")}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
