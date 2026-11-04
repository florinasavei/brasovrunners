import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventTitle } from "@/modules/content/events/repository";
import { confirmationDueAtStart, confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { readRacePlan } from "@/modules/registrations/race-plan";
import CapacityHistory from "@/modules/registrations/ui/CapacityHistory";
import KitCount from "@/modules/registrations/ui/KitCount";
import OrderTotals from "@/modules/registrations/ui/OrderTotals";
import { PlaceDeadlineText, placeDeadlineLines } from "@/modules/registrations/ui/PlaceDeadlines";
import PlaceOutlook from "@/modules/registrations/ui/PlaceOutlook";
import PublicNowLine from "@/modules/registrations/ui/PublicNowLine";
import RacePlanTable from "@/modules/registrations/ui/RacePlanTable";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";

type Props = { params: Promise<{ locale: string; id: string }> };

/** Read live on every visit: the places are the allocator's of this minute. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Planul locurilor» (§NNN; the owner, 2026-11-03, choosing «one plan page per race» among four place controls for the
 * 21 November race): one event's places on one page, read only — five cards, each the subject's glyph before its
 * heading, every one but «Locuri» a fold closed on a summary line:
 *
 * 1. **«Locuri»** — `PlaceOutlook` and `PublicNowLine` exactly as the registrations list draws them, the tick
 *    «Înscrieri publice deschise» said rather than offered (no action is handed down here).
 * 2. **«Pe categorii»** — `RacePlanTable`: inside the places by kind, from the same outlook so the two never disagree;
 *    outside them the special guests, their invitations, the elite list and the volunteers with a kit; everybody who
 *    runs — the places taken, the special guests and the elite list's lines, a registration marked elite once; both lists.
 * 3. **«Termene»** — the sentences of «Când se pierde un loc» (`placeDeadlineLines`), closed on the declaration's deadline.
 * 4. **«De comandat»** — `KitCount` (the registrations' kits now), then `OrderTotals`: every kit needed now with the
 *    elite list and the volunteers, the kits and race numbers if every place fills (the parts written out), and the race
 *    numbers given, with the door to «Numerele de concurs».
 * 5. **«Istoric capacitate»** — `CapacityHistory`, closed on «N schimbări · ultima …».
 *
 * Whoever may read the registrations (`canReadRegistrations`: the Organizer, the Administrator, the Superadministrator),
 * asserted here and again in `readRacePlan`; anybody else, a malformed id and an unknown event get the 404 a typed
 * address to a page that does not exist gets (BR-REQ-060-01). An event that takes no registration on this site gets one
 * sentence. Server Components only: no polling, no verb.
 */
export default async function RacePlanPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRegistrations(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  const now = new Date();
  let plan;
  try {
    plan = await readRacePlan(db, actor, id, now);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const [title, t] = await Promise.all([findEventTitle(db, id, locale), getTranslations("Admin")]);

  const head = (
    <>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/events/[id]", params: { id } }}>{t("racePlan.backToEvent")}</Link>
        {" · "}
        <Link href={{ pathname: "/admin/registrations", query: { eventId: id } }}>{t("racePlan.toRegistrations")}</Link>
      </Typography>
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="race-plan-title">
        {t("racePlan.title", { event: title ?? "" })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("racePlan.intro")}
        <QuietHelp text={t("racePlan.introMore")} />
      </Typography>
    </>
  );

  if (!plan.internal) {
    return (
      <Stack spacing={2}>
        {head}
        <Alert severity="info" data-testid="race-plan-not-here">
          {t("racePlan.notHere")}
        </Alert>
      </Stack>
    );
  }

  const { event, outlook, door, rows, totals, kits, volunteersWithKit, kitsNow, eliteEntries, placeDeadlines, bibs, history } = plan;
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

  // «Pe categorii»'s closed line: the places taken, the people outside them, everybody who runs and both lists.
  const lists = (rows.lists.find((row) => row.key === "waiting")?.count ?? 0) + (rows.lists.find((row) => row.key === "internal")?.count ?? 0);
  const occupied = rows.inside.find((row) => row.key === "occupied")?.count ?? 0;
  const outside = rows.outside.find((row) => row.key === "outside")?.count ?? 0;
  const runners = rows.runners.find((row) => row.key === "runnersNow")?.count ?? 0;
  const categoriesAside =
    event.capacity === null
      ? t("racePlan.categories.asideUncapped", { occupied, outside, runners, lists })
      : t("racePlan.categories.aside", { occupied, capacity: event.capacity, outside, runners, lists });

  // «Termene»: the sentences of «Când se pierde un loc», closed on the declaration's own deadline.
  const deadlineLines = placeDeadlines
    ? placeDeadlineLines({ ...placeDeadlines, now, timeZone: CLUB_TIME_ZONE, locale, t: (key, values) => t(key, values) })
    : [];
  const confirmation = placeDeadlines ? confirmationWindow(placeDeadlines.event) : null;
  const deadlinesAside =
    !placeDeadlines || !confirmation
      ? t("racePlan.deadlines.asideNoWindow")
      : confirmationDueAtStart({ at: confirmation.deadline, startsAt: placeDeadlines.event.startsAt })
        ? t("racePlan.deadlines.asideAtStart")
        : t("racePlan.deadlines.asideWindow", { due: day(confirmation.deadline) });

  const orderAside = totals
    ? t("racePlan.order.aside", { kits: totals.kits.total, bibs: totals.bibs.total })
    : t("racePlan.order.asideUncapped", { kits: kitsNow.total });

  const historyAside =
    history.count > 0 && history.lastAt
      ? t(`capacityHistory.summary.${countForm(history.count, locale)}`, { count: history.count, date: day(history.lastAt) })
      : t("capacityHistory.none");

  return (
    <Stack spacing={2}>
      {head}

      <Panel glyph="registration" title={t("racePlan.places.title")} data-testid="race-plan-places">
        {outlook ? (
          <PlaceOutlook outlook={outlook} locale={locale} elites={eliteEntries} door={door ? { door, eventId: id, locale, listQuery: "" } : undefined} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" data-testid="race-plan-uncapped">
              {t("racePlan.places.uncapped")}
            </Typography>
            {door && <PublicNowLine door={door} eventId={id} locale={locale} listQuery="" spaceAbove={1} />}
          </>
        )}
      </Panel>

      <Panel glyph="summary" collapsible title={t("racePlan.categories.title")} aside={categoriesAside} data-testid="race-plan-categories">
        <RacePlanTable rows={rows} />
      </Panel>

      <Panel glyph="deadlines" collapsible title={t("racePlan.deadlines.title")} aside={deadlinesAside} data-testid="race-plan-deadlines">
        {deadlineLines.length > 0 ? (
          <PlaceDeadlineText lines={deadlineLines} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("racePlan.deadlines.nothing")}
          </Typography>
        )}
      </Panel>

      <Panel glyph="kit" collapsible title={t("racePlan.order.title")} aside={orderAside} data-testid="race-plan-order-panel">
        <KitCount kits={kits} locale={locale} volunteers={volunteersWithKit} elites={eliteEntries} />
        <OrderTotals now={kitsNow} totals={totals} bibs={bibs} eliteEntries={eliteEntries} eventId={id} locale={locale} />
      </Panel>

      <Panel
        glyph="history"
        collapsible
        title={t("capacityHistory.title")}
        intro={t("capacityHistory.intro")}
        introMore={t("capacityHistory.introMore")}
        aside={historyAside}
        data-testid="race-plan-history"
      >
        <CapacityHistory history={history} locale={locale} />
      </Panel>
    </Stack>
  );
}
