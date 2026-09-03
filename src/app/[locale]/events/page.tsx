import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import EventFacts from "@/modules/events/ui/EventFacts";
import CardLink from "@/shared/ui/CardLink";
import { listPublishedEvents } from "@/modules/events/repository";

type Props = { params: Promise<{ locale: string }> };

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
 */
export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Events" });
  return { title: t("title"), description: t("intro") };
}

export default async function EventsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const events = await listPublishedEvents(getDb(), locale);
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed.
  const now = new Date();

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {t("intro")}
      </Typography>

      {events.length === 0 ? (
        <Alert severity="info">{t("empty")}</Alert>
      ) : (
        <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {events.map((event) => (
            <Card key={event.id} component="li" variant="outlined">
              <CardLink href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}>
                <CardContent>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}
                  >
                    <Chip size="small" label={tEvent(`kind.${event.kind}`)} />
                    {/* BR-REQ-020-01 criterion 2: a cancelled event stays listed and says so. */}
                    {event.eventStatus === "CANCELLED" && (
                      <Chip size="small" color="error" label={tEvent("cancelled")} />
                    )}
                  </Stack>

                  <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                    {event.title}
                  </Typography>

                  {event.excerpt && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {event.excerpt}
                    </Typography>
                  )}

                  <EventFacts event={event} now={now} variant="compact" />
                </CardContent>
              </CardLink>
            </Card>
          ))}
        </Stack>
      )}
    </Container>
  );
}
