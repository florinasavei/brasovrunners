import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventTitle } from "@/modules/content/events/repository";
import { formatResultTime } from "@/modules/results/domain/result-time";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { gunOf, readFinishPage } from "@/modules/results/results";
import FinishClock from "@/modules/results/ui/FinishClock";
import { canEnterResults } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import { recordFinishAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; finishError?: string }>;
};

/** Reads the stored rows and is returned to right after every press. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** How many of the latest finishers the page lists. */
const RECENT = 15;

/** The codes the page's banner says, for a refusal that had no box to come back to. */
const BANNER_ERRORS = ["FORBIDDEN", "NOT_FOUND"] as const;

/**
 * «Sosire» (§NNN; the owner, 2026-10-24: «how do we register the runners when they finish?»): the finish line's page, under «Clasament».
 * One box and one button — the race number typed as the runner crosses, «Sosit» pressed, the time since the gun stamped by the service
 * (`recordFinish`) — then the page again with the box empty for the next runner and one sentence saying who and what time. Under it the
 * clock since the gun, ticking (`FinishClock`, the page's one island), and «Ultimii sosiți», the latest recorded first, so a volunteer sees
 * the last press stuck. Everything else — a correction, a runner no registration holds, the states, the publish — stays on «Clasament».
 *
 * Whoever enters results (`canEnterResults`); anybody else meets the 404 an unknown page gets (BR-REQ-060-01), and the action asserts
 * again. A group run has no finish line: the page says so and offers nothing.
 */
export default async function FinishPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { ok, finishError } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const actor = await requireStaff();
  if (!canEnterResults(actor.role)) notFound();
  if (!isUuid(id)) notFound();

  const db = getDb();
  let view;
  try {
    view = await readFinishPage(db, actor, id, RECENT);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { event } = view;
  const title = (await findEventTitle(db, id, locale)) ?? "";
  const t = await getTranslations("Admin");
  const now = new Date();
  const gun = gunOf(event);
  const started = now.getTime() > gun.getTime();
  const errorCode = BANNER_ERRORS.find((code) => code === finishError);
  const okBib = /^\d{1,6}$/.test(ok ?? "") ? Number(ok) : null;
  const justRecorded = okBib === null ? undefined : view.recent.find((row) => row.bibNumber === okBib);

  const resultsPath = { pathname: "/admin/events/[id]/results", params: { id } } as const;
  const head = (
    <>
      <Typography variant="body2">
        <Link href={resultsPath}>{t("results.finish.backToResults")}</Link>
      </Typography>
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="finish-title">
        {t("results.finish.title", { event: title })}
      </Typography>
    </>
  );

  if (!eventTakesResults(event.type)) {
    return (
      <Stack spacing={2}>
        {head}
        <Alert severity="info" data-testid="results-not-race">
          {t("results.notRace")}
        </Alert>
      </Stack>
    );
  }

  const boxes = await refusalMessages({ bib: t("results.finish.bibLabel") });
  const line = (row: { bibNumber: number; name: string | null; gunTimeMs: number; positionOverall: number | null }, key: "recorded" | "recordedNameless" | "recent.line" | "recent.lineNameless") =>
    t(`results.finish.${key}`, { bib: String(row.bibNumber), name: row.name ?? "", time: formatResultTime(row.gunTimeMs), position: row.positionOverall === null ? "—" : String(row.positionOverall) });

  return (
    <Stack spacing={2}>
      {head}
      <Typography variant="body2" color="text.secondary">
        {t("results.finish.intro")}
        <QuietHelp text={t("results.finish.more")} />
      </Typography>
      <Typography variant="body2" data-testid="finish-gun">
        {t("results.finish.gun", { time: formatDay(gun, { locale, timeZone: event.timezone || CLUB_TIME_ZONE, style: "short", position: "inline", withTime: true }) })}
      </Typography>
      {started ? (
        <FinishClock gunAtMs={gun.getTime()} nowMs={now.getTime()} label={t("results.finish.elapsed", { time: "{time}" })} />
      ) : (
        <Alert severity="info" data-testid="finish-not-started">
          {t("results.finish.notStarted")}
        </Alert>
      )}
      {errorCode && (
        <Alert severity="error" data-testid="finish-error">
          {t(`errors.${errorCode}`)}
        </Alert>
      )}
      {justRecorded && (
        <Alert severity="success" data-testid="finish-recorded">
          {line(justRecorded, justRecorded.name ? "recorded" : "recordedNameless")}
        </Alert>
      )}

      {/* The one form: a number and «Sosit», drawn once the gun has gone (the service refuses a press before it anyway). With scripts off the page comes back with `?ok=`; with them the same, through the action's redirect. */}
      {started && (
      <ActionForm action={recordFinishAction} scope="finish" messages={boxes} data-testid="finish-form">
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={id} />
        <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
          <RecallField
            name="bib"
            label={t("results.finish.bibLabel")}
            defaultValue=""
            autoFocus
            size="medium"
            sx={{ minWidth: 180, "& input": { fontSize: "1.5rem", fontVariantNumeric: "tabular-nums" } }}
            slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off", enterKeyHint: "done", "data-testid": "finish-bib" } }}
          />
          <Box sx={{ pt: 0.5 }}>
            <GlyphSubmitButton icon="checkIn" label={t("results.finish.record")} pendingLabel={t("results.finish.recording")} />
          </Box>
        </Stack>
      </ActionForm>
      )}

      <Panel glyph="results" level={3} title={t("results.finish.recent.title")} aside={t("results.finish.recent.aside", { finished: String(view.finished), withNumber: String(view.withNumber) })} id="box-finish-recent" data-testid="finish-recent">
        {view.recent.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="finish-recent-empty">
            {t("results.finish.recent.empty")}
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.5 }}>
            {view.recent.map((row) => (
              <Typography component="li" variant="body2" key={row.bibNumber} data-testid="finish-recent-row" data-bib={row.bibNumber}>
                {line(row, row.name ? "recent.line" : "recent.lineNameless")}
              </Typography>
            ))}
          </Box>
        )}
      </Panel>
    </Stack>
  );
}
