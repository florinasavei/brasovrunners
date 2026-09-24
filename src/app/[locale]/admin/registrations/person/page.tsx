import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { openPersonLookup, PERSON_LOOKUP_MINUTES, viewPersonData } from "@/modules/registrations/person-data";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { lookUpPersonAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Everything held about one person (§322): the answer to "what do you have about me" (art. 15
 * GDPR), and the list to go through before an erasure.
 *
 * Administrator only, asserted here and again in `person-data.ts`: it puts the whole of a person
 * on one screen, the health note included. The address is typed into a form that posts it, and
 * comes back in the URL only sealed; a sealed lookup older than half an hour asks for the address
 * again rather than opening. Every stored column is shown as stored — this is the record, not a
 * summary of it — and the JSON beside it is the same data as a file, recorded when it is taken.
 */
export default async function PersonDataPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const { q, error } = await searchParams;
  const t = await getTranslations("Admin");
  const now = new Date();
  const canonicalEmail = q ? openPersonLookup(q, now) : null;
  const data = canonicalEmail ? await viewPersonData(getDb(), actor, canonicalEmail, now) : null;
  const pagePath = getPathname({ locale, href: "/admin/registrations/person" });

  /** One stored value as text: dates in the reader's format, objects as JSON, empties as a dash. */
  const show = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    // A timestamp in the short form with its time (§349); a birth date is a stored string and
    // is shown as it is stored.
    if (value instanceof Date) return formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  /** Every column of a row, in the order the table stores them. */
  const fields = (row: object) => (
    <Box component="dl" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(160px, max-content) 1fr" }, columnGap: 2, rowGap: 0.25, m: 0 }}>
      {Object.entries(row).map(([key, value]) => (
        <Box key={key} sx={{ display: "contents" }}>
          <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {key}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
            {show(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{t("registrations.backToList")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("person.title")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {q && !canonicalEmail && <Alert severity="warning">{t("person.expired", { minutes: PERSON_LOOKUP_MINUTES })}</Alert>}
      </Box>

      {!data ? (
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <Typography variant="body2" color="text.secondary">
            {t("person.intro")}
          </Typography>
          <form action={lookUpPersonAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
              <TextField name="email" type="email" label={t("person.email")} required autoComplete="off" sx={{ flex: 1 }} />
              <Button type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("person.lookUp")}
              </Button>
            </Stack>
          </form>
        </Stack>
      ) : (
        <Stack spacing={3}>
          <Stack spacing={0.5}>
            <Typography variant="body2">{t("person.canonical", { email: data.canonicalEmail })}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("person.audited")}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {/* A GET for a file, like the registrations export; the lookup travels sealed. */}
            <Button
              component="a"
              href={`/api/admin/registrations/person?q=${encodeURIComponent(q ?? "")}`}
              variant="outlined"
              sx={{ minHeight: 44 }}
            >
              {t("person.downloadJson")}
            </Button>
            <Button component="a" href={pagePath} variant="text" sx={{ minHeight: 44 }}>
              {t("person.newSearch")}
            </Button>
          </Stack>

          {!data.participant && data.announcementRequests.length === 0 ? (
            <Alert severity="info">{t("person.notFound")}</Alert>
          ) : (
            <>
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.participant")}
                </Typography>
                {data.participant ? fields(data.participant) : <Typography variant="body2">{t("person.none")}</Typography>}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.registrations", { count: data.registrations.length })}
                </Typography>
                {data.registrations.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.registrations.map((registration) => (
                      <Box key={registration.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          <Link href={{ pathname: "/admin/registrations/[id]", params: { id: registration.id } }}>
                            {registration.eventTitle ?? registration.eventId} · {registration.status}
                          </Link>
                        </Typography>
                        {fields(registration)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.acceptances", { count: data.declarationAcceptances.length })}
                </Typography>
                {data.declarationAcceptances.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.declarationAcceptances.map((acceptance) => (
                      <Box key={acceptance.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        {fields(acceptance)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.messages", { count: data.messages.length })}
                </Typography>
                {data.messages.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.messages.map((message, index) => (
                    <Typography key={index} variant="body2" color="text.secondary">
                      {show(message.createdAt)} · {message.messageType} · {message.status}
                      {message.sentAt ? ` · ${show(message.sentAt)}` : ""}
                    </Typography>
                  ))
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.interests", { count: data.announcementRequests.length })}
                </Typography>
                {data.announcementRequests.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.announcementRequests.map((request, index) => (
                    <Typography key={index} variant="body2" color="text.secondary">
                      {show(request.createdAt)} · {request.eventTitle ?? request.eventId} · {request.deliveryEmail} · {request.locale}
                    </Typography>
                  ))
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.audit", { count: data.auditTrail.length })}
                </Typography>
                {data.auditTrail.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.auditTrail.map((entry, index) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {show(entry.createdAt)} · {entry.action} · {entry.actorName ?? "—"}
                      {entry.metadata && Object.keys(entry.metadata as object).length > 0 ? ` · ${JSON.stringify(entry.metadata)}` : ""}
                    </Typography>
                  ))
                )}
              </Box>
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}
