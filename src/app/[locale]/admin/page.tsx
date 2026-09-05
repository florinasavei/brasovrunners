import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
import { canCreateEvent, canDeleteEvent } from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  REGISTRATION_MODE_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { deleteEventAction, duplicateEventAction } from "./actions";

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
 * Every row carries its own actions now. The title used to be the only way into the editor,
 * which reads as a list of headings rather than as a list of things you can do something to —
 * and on a phone a text link inside a card is a 20px target next to a 44px one.
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
      {/*
        The actions redirect back with `#admin-alert`, so the browser lands on the outcome
        rather than at the top of a list where a one-line alert is easy to miss. No JavaScript:
        it is a fragment in the URL the Server Action already redirects to.
      */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.events")}
        </Typography>

        {canCreateEvent(staffUser.role) && (
          // `component="a"` with a resolved path, not `component={Link}`: MUI's Button is a
          // Client Component, and passing a component reference from a Server Component to one
          // is refused by React outright.
          <Button
            component="a"
            href={getPathname({ locale, href: "/admin/events/new" })}
            variant="contained"
            size="small"
            sx={{ minHeight: 44 }}
          >
            {t("events.new")}
          </Button>
        )}
      </Stack>

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
                    label={EDITORIAL_STATUS_LABEL[event.editorialStatus]}
                  />
                  {event.featured && <Chip size="small" color="primary" label={t("events.featured")} />}
                  <Chip size="small" label={event.kind} />
                  {event.registrationMode !== "NONE" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={REGISTRATION_MODE_LABEL[event.registrationMode]}
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

                <Typography variant="h3" sx={{ fontSize: "1.125rem", mb: 1 }}>
                  <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>
                    {translations[0]?.title ?? event.id}
                  </Link>
                </Typography>

                <Stack spacing={0.5} sx={{ mb: 2 }}>
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

                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Button
                    component="a"
                    href={getPathname({
                      locale,
                      href: { pathname: "/admin/events/[id]", params: { id: event.id } },
                    })}
                    variant="outlined"
                    size="small"
                    sx={{ minHeight: 44 }}
                  >
                    {t("events.edit")}
                  </Button>

                  {/*
                    Duplicate and Delete live behind a disclosure rather than sitting in the row.

                    `<details>` rather than a menu component: an overflow menu is a client island
                    and the standing rule keeps those to the four that earn it. This is the same
                    affordance with no JavaScript at all — it opens on a tap, it closes on the
                    next one, and a keyboard reaches it because a `<summary>` is focusable.
                  */}
                  {canCreateEvent(staffUser.role) && (
                    <Box component="details" sx={{ position: "relative" }}>
                      <Box
                        component="summary"
                        sx={{
                          listStyle: "none",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: 44,
                          px: 1.5,
                          borderRadius: 1,
                          border: 1,
                          borderColor: "divider",
                          fontSize: "0.8125rem",
                        }}
                      >
                        {t("events.moreActions")}
                      </Box>

                      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                        <form action={duplicateEventAction}>
                          <input type="hidden" name="uiLocale" value={locale} />
                          <input type="hidden" name="eventId" value={event.id} />
                          <ConfirmSubmitButton
                            label={t("editor.duplicate")}
                            title={t("confirm.duplicateTitle")}
                            body={t("confirm.duplicateBody")}
                            confirmLabel={t("editor.duplicate")}
                            cancelLabel={t("confirm.cancel")}
                          />
                        </form>

                        {/* Administrator only, and the service refuses any event that has a
                            registration against it — archiving is the answer there. */}
                        {canDeleteEvent(staffUser.role) && (
                          <form action={deleteEventAction}>
                            <input type="hidden" name="uiLocale" value={locale} />
                            <input type="hidden" name="eventId" value={event.id} />
                            <ConfirmSubmitButton
                              label={t("editor.delete")}
                              title={t("confirm.deleteTitle")}
                              body={t("confirm.deleteBody")}
                              confirmLabel={t("editor.delete")}
                              cancelLabel={t("confirm.cancel")}
                              color="error"
                            />
                          </form>
                        )}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
