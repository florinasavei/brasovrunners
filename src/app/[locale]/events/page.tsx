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
import FeaturedEventHero from "@/modules/events/ui/FeaturedEventHero";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import CardLink from "@/shared/ui/CardLink";
import JsonLd from "@/shared/ui/JsonLd";
import { findLatestPastEvent, listUpcomingEvents } from "@/modules/events/repository";

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
  const tSite = await getTranslations("Site");
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed, or about where the line between past and upcoming falls.
  const now = new Date();
  const db = getDb();
  const upcoming = await listUpcomingEvents(db, locale, now);
  // Only asked for when there is nothing to lead with: between seasons an empty page reads as
  // a broken site, so the last event that happened stands in, dated.
  const latestPast = upcoming.length === 0 ? await findLatestPastEvent(db, locale, now) : undefined;
  const events = upcoming.length > 0 ? upcoming : latestPast ? [latestPast] : [];

  /**
   * The club's lead event, shown in full above the list.
   *
   * Taken from the rows already fetched rather than queried again: `listUpcomingEvents` orders
   * featured first, so if there is one it is the first row. It is then dropped from the list
   * below — the same event as both the hero and the first card reads as a duplicate, not as
   * emphasis.
   */
  const featured = upcoming.length > 0 && upcoming[0].featured ? upcoming[0] : undefined;
  const listed = featured ? events.filter((event) => event.id !== featured.id) : events;

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      {/*
        BR-REQ-052-02 criterion 1 asks the homepage to carry one SportsOrganization block, and
        this page is now the homepage — the site root redirects here. Incomplete by design:
        logo and sameAs are absent until the club supplies them. See structured-data.ts.
      */}
      <JsonLd data={sportsOrganizationJsonLd(tSite("name"))} />

      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {t("intro")}
      </Typography>

      {upcoming.length === 0 && latestPast && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("noUpcoming")}
        </Alert>
      )}

      {featured && <FeaturedEventHero event={featured} now={now} />}

      {listed.length === 0 ? (
        !featured && <Alert severity="info">{t("empty")}</Alert>
      ) : (
        <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {listed.map((event) => (
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
