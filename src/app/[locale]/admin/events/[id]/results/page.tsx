import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventTitle } from "@/modules/content/events/repository";
import { noticeDescribesResults, termsDescribeResults } from "@/modules/legal-documents/repository";
import { categoryLabelOf } from "@/modules/results/category-words";
import { formatResultTime } from "@/modules/results/domain/result-time";
import { RESULT_STATUSES } from "@/modules/results/domain/ranking";
import { anonymousResultLabel } from "@/modules/results/domain/public-name";
import ImportFilePicker from "@/modules/results/ui/ImportFilePicker";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { readEventResults, type ResultRunner } from "@/modules/results/results";
import {
  DELETE_RESULT_FORM_ID,
  type PlaceView,
  type RegisteredLine,
  RegisteredResultLines,
  ResultsHeader,
  type ResultWords,
  type TypedLine,
  TypedResultLines,
} from "@/modules/results/ui/ResultRows";
import { canEnterResults, canPublishResults } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import StatusChip from "@/shared/ui/StatusChip";
import { VISUALLY_HIDDEN } from "@/shared/ui/visually-hidden";
import { deleteEventResultAction, saveEventResultsAction, setResultsPublishedAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resultsError?: string }>;
};

/** The chip glyph of each state in the summary (`status-glyphs.ts`): done, did not start, dropped out, disqualified. */
const SUMMARY_GLYPH = { FINISHED: "done", DNS: "didNotStart", DNF: "droppedOut", DSQ: "failed" } as const;

/** Reads the stored rows and is returned to right after a save. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The codes the page's banner says: a one-button form that has no boxes to keep redirects with `?resultsError=`. */
const BANNER_ERRORS = ["FORBIDDEN", "NOT_FOUND", "RESULTS_NOT_OPEN", "RESULTS_NOTICE", "RESULTS_TERMS", "RESULTS_NOT_STARTED"] as const;

/**
 * «Clasament» (`DECISIONS.md` §NNN; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»): one race's results, on
 * a page of their own under the event like its bibs and its messages — the event editor is long enough, and its «Înscrieri» card links here.
 *
 * ONE form, ONE «Salvează tot clasamentul» (§791's model): above the lines, «Importă din CSV» — a file or pasted text whose rows fill the
 * boxes and save nothing; then a line for every registered runner who holds a race number (checked in first), each with «Timp», «Status»,
 * «Timp cip» and «Notă», and the position the last save gave; then the runners the club types by hand. Each line's «Șterge» is the page's
 * one small form beside, asked first. The Administrator's tick «Clasamentul e public pe pagina evenimentului» is a form of its own: the
 * disclosure has its own gate (the privacy notice in force must describe the results) and its own audit row, and does not ride on a save.
 * «Descarcă clasamentul (CSV)» is the file, names included — the backoffice sees every name.
 *
 * Whoever enters results — the Organizer, the Administrator, the Superadministrator (`canEnterResults`); anybody else meets the 404 an
 * unknown page gets (BR-REQ-060-01), and every action asserts again. A group run has no results: the page says so and offers nothing.
 */
export default async function EventResultsPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { resultsError } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const actor = await requireStaff();
  if (!canEnterResults(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  let view;
  try {
    view = await readEventResults(db, actor, id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { event } = view;
  const title = (await findEventTitle(db, id, locale)) ?? "";
  const t = await getTranslations("Admin");
  
  const now = new Date();
  const takes = eventTakesResults(event.type);
  const mayPublish = canPublishResults(actor.role);
  const noticeDescribes = takes ? await noticeDescribesResults(db, now) : false;
  const termsDescribe = takes ? await termsDescribeResults(db, now) : false;
  const started = event.startsAt.getTime() <= now.getTime();
  const errorCode = BANNER_ERRORS.find((code) => code === resultsError);

  const eventPath = { pathname: "/admin/events/[id]", params: { id } } as const;
  const head = (
    <>
      <Typography variant="body2">
        <Link href={eventPath}>{t("results.backToEvent")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }} data-testid="results-title">
        {t("results.title", { event: title })}
      </Typography>
    </>
  );

  if (!takes) {
    return (
      <Stack spacing={2}>
        {head}
        <Alert severity="info" data-testid="results-not-race">
          {t("results.notRace")}
        </Alert>
      </Stack>
    );
  }

  // ---- The words, once -------------------------------------------------------------------------------------
  const statusOptions = [{ value: "", label: t("results.status.none") }, ...RESULT_STATUSES.map((status) => ({ value: status, label: t(`results.status.${status}`) }))];
  const words: ResultWords = {
    time: t("results.col.time"),
    status: t("results.col.status"),
    chip: t("results.col.chip"),
    note: t("results.col.note"),
    bib: t("results.col.bib"),
    name: t("results.col.name"),
    sex: t("results.col.sex"),
    birthDate: t("results.col.birthDate"),
    place: t("results.col.place"),
    timePlaceholder: t("results.timePlaceholder"),
    birthDatePlaceholder: t("results.birthDatePlaceholder"),
    statusOptions,
    sexOptions: [
      { value: "", label: t("results.col.sexNone") },
      { value: "FEMALE", label: t("registrations.statistics.sexFemale") },
      { value: "MALE", label: t("registrations.statistics.sexMale") },
    ],
    deleteFor: t("results.deleteFor", { runner: "{runner}" }),
    delete: t("results.delete"),
    present: t("results.present"),
    nameless: t("results.nameless"),
    addRow: t("results.addRow"),
    typedRow: t("results.typedRow"),
    noPlace: t("results.noPlace"),
    noPlaceSettled: t("results.noPlaceSettled"),
  };
  // The category in the Excel footer's own words (§787): the template «{sex}, {band}» read raw, filled by the label.
  const categoryLabel = (key: string | null) => categoryLabelOf(key, (statisticsKey) => t.raw(`registrations.statistics.${statisticsKey}`) as string);

  const placeOf = (runner: ResultRunner): PlaceView | null => {
    const result = runner.result;
    if (!result || result.positionOverall === null) return null;
    const parts: string[] = [];
    if (result.positionSex !== null) parts.push(t("results.place.sex", { position: String(result.positionSex) }));
    if (result.positionCategory !== null && result.categoryKey !== null) parts.push(t("results.place.category", { category: categoryLabel(result.categoryKey), position: String(result.positionCategory) }));
    return { overall: String(result.positionOverall), detail: parts.join(" · ") };
  };
  const valuesOf = (runner: ResultRunner) => ({
    time: formatResultTime(runner.result?.gunTimeMs),
    // A runner with no result yet shows the blank status; one with a result shows it — the line is saved exactly as drawn.
    status: runner.result?.status ?? "",
    chip: formatResultTime(runner.result?.chipTimeMs),
    note: runner.result?.note ?? "",
  });

  const registered: RegisteredLine[] = view.registered.map((runner) => ({
    bibNumber: runner.bibNumber,
    name: runner.name ?? "",
    present: runner.checkedIn,
    // What the published list would say of the runner — `publicResultName`'s own answer (the tick, a confirmed registration, a notice that
    // described the results), never a guess from the tick alone.
    publicLine: runner.named ? t("results.publicLine.named") : t("results.publicLine.anonymous", { label: anonymousResultLabel(locale, runner.bibNumber) }),
    values: valuesOf(runner),
    place: placeOf(runner),
    hasResult: runner.result !== null,
  }));
  const typed: TypedLine[] = view.typed.map((runner) => ({
    values: {
      bib: String(runner.bibNumber),
      name: runner.name ?? "",
      sex: runner.sex ?? "",
      birthDate: runner.birthDate ? runner.birthDate.split("-").reverse().join(".") : "",
      ...valuesOf(runner),
    },
    place: placeOf(runner),
    hasResult: true,
  }));

  // ---- The refusal summary's labels, by the unindexed name of a box (`fieldLabelOf`) ------------------------------
  const labels: Record<string, string> = { importText: t("results.import.textLabel") };
  for (const kind of ["r", "n"] as const) {
    labels[`${kind}[].time`] = words.time;
    labels[`${kind}[].status`] = words.status;
    labels[`${kind}[].chip`] = words.chip;
    labels[`${kind}[].note`] = words.note;
  }
  labels["n[].bib"] = words.bib;
  labels["n[].name"] = words.name;
  labels["n[].sex"] = words.sex;
  labels["n[].birthDate"] = words.birthDate;
  const boxes = await refusalMessages(labels);
  const publishBoxes = await refusalMessages({ published: t("results.publish.label") });
  const confirm = await confirmWords();

  const total = view.counts.FINISHED + view.counts.DNF + view.counts.DNS + view.counts.DSQ;
  const downloadHref = `/api/admin/events/${id}/results?lang=${locale}`;

  return (
    <Stack spacing={2}>
      {head}
      <Typography variant="body2" color="text.secondary">
        {t("results.intro")}
        <QuietHelp text={t("results.introMore")} />
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }} data-testid="results-summary">
        {RESULT_STATUSES.map((status) => (
          <StatusChip key={status} glyph={SUMMARY_GLYPH[status]} variant="outlined" label={t(`results.summary.${status}`, { count: String(view.counts[status]) })} />
        ))}
        <StatusChip glyph={event.resultsPublished ? "visible" : "hidden"} color={event.resultsPublished ? "success" : "default"} label={event.resultsPublished ? t("results.publish.stateOn") : t("results.publish.stateOff")} testId="results-published-chip" />
      </Stack>
      {!started && (
        <Alert severity="info" data-testid="results-not-started">
          {t("results.notStarted")}
        </Alert>
      )}
      {errorCode && (
        <Alert severity="error" data-testid="results-error">
          {t(`errors.${errorCode}`)}
        </Alert>
      )}

      {/* The one form of the page: the import box, the registered runners' lines, the typed ones and the one «Salvează tot clasamentul». */}
      <ActionForm action={saveEventResultsAction} scope="results" messages={boxes} data-testid="results-form">
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={id} />
        {/* What the stored rows were when the page was drawn: a form older than another session's save is refused, not written over it. */}
        <RecallHidden name="fingerprint" value={view.fingerprint} />
        {/* The default of the form: Enter in a box saves, and never imports — the import button below comes first in the page. */}
        <Box component="button" type="submit" name="intent" value="save" tabIndex={-1} aria-hidden="true" sx={{ ...VISUALLY_HIDDEN, opacity: 0 }} />
        <Stack spacing={2}>
          <Panel glyph="importCsv" collapsible level={3} title={t("results.import.title")} aside={t("results.import.aside")} id="box-results-import" data-testid="results-import">
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {t("results.import.intro")}
                <QuietHelp text={t("results.import.more")} />
              </Typography>
              <RecallField
                name="importText"
                label={t("results.import.textLabel")}
                multiline
                minRows={4}
                fullWidth
                size="small"
                defaultValue=""
                slotProps={{ htmlInput: { spellCheck: false, autoComplete: "off", "data-testid": "results-import-text" } }}
              />
              <Typography variant="body2">{t("results.import.fileLabel")}</Typography>
              <ImportFilePicker words={{ choose: t("results.import.fileChoose"), chooseAgain: t("results.import.fileChooseAgain"), none: t("results.import.fileNone") }} />
              <Box>
                <GlyphSubmitButton icon="upload" variant="outlined" name="intent" value="import" label={t("results.import.button")} pendingLabel={t("results.import.pending")} />
              </Box>
            </Stack>
          </Panel>

          <Panel glyph="results" level={3} title={t("results.registered.title")} aside={t("results.registered.aside", { count: String(registered.length) })} id="box-results-registered" data-testid="results-registered">
            {registered.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="results-registered-empty">
                {t("results.registered.empty")}
              </Typography>
            ) : (
              <>
                <ResultsHeader words={words} />
                <RegisteredResultLines lines={registered} words={words} />
              </>
            )}
          </Panel>

          <Panel glyph="invite" collapsible level={3} title={t("results.typed.title")} aside={t("results.typed.aside", { count: String(typed.length) })} id="box-results-typed" openWhen={{ inUse: typed.length > 0 }} data-testid="results-typed">
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {t("results.typed.intro")}
              </Typography>
              <TypedResultLines lines={typed} words={words} />
            </Stack>
          </Panel>

          <Box>
            <GlyphSubmitButton icon="save" name="intent" value="save" label={t("results.save")} pendingLabel={t("results.saving")} slowHint={t("results.slow")} />
          </Box>
        </Stack>
      </ActionForm>

      {/* A line's «Șterge»: one hidden form for the whole page; the button names it with `form=` and posts its number. Asks first (§384). */}
      <ActionForm
        id={DELETE_RESULT_FORM_ID}
        hidden
        action={deleteEventResultAction}
        confirm={{
          title: t("results.deleteTitle"),
          body: t("results.deleteBody", { bibNumber: "{bibNumber}" }),
          fillFrom: ["bibNumber"],
          confirmLabel: t("results.delete"),
          cancelLabel: confirm.cancel,
          destructive: true,
        }}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={id} />
      </ActionForm>

      <Panel glyph="publication" level={3} title={t("results.publish.title")} aside={event.resultsPublished ? t("results.publish.stateOn") : t("results.publish.stateOff")} id="box-results-publish" data-testid="results-publish">
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t("results.publish.help")}
          </Typography>
          {!noticeDescribes && (
            <Alert severity="info" data-testid="results-notice-missing">
              {t("results.publish.gate")}{" "}
              <Link href="/admin/legal">{t("results.publish.gateLink")}</Link>
            </Alert>
          )}
          {!termsDescribe && (
            <Alert severity="info" data-testid="results-terms-missing">
              {t("results.publish.gateTerms")}{" "}
              <Link href="/admin/legal">{t("results.publish.gateLink")}</Link>
            </Alert>
          )}
          {!started && (
            <Alert severity="info" data-testid="results-publish-not-started">
              {t("results.publish.gateStart")}
            </Alert>
          )}
          {mayPublish ? (
            <ActionForm
              action={setResultsPublishedAction}
              scope="publish"
              messages={publishBoxes}
              // Making the ranking public, and taking it off the site, ask first (§384): the first spec asks when the box is ticked, the second — no `when` — otherwise.
              confirm={[
                { when: [{ field: "published", equals: "on" }], title: t("results.publish.confirmOnTitle"), body: t("results.publish.confirmOnBody"), confirmLabel: t("results.publish.save"), cancelLabel: confirm.cancel },
                { title: t("results.publish.confirmOffTitle"), body: t("results.publish.confirmOffBody"), confirmLabel: t("results.publish.save"), cancelLabel: confirm.cancel },
              ]}
              data-testid="results-publish-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={id} />
              <Stack spacing={1.5}>
                <CheckboxField name="published" defaultChecked={event.resultsPublished} help={total === 0 ? t("results.publish.empty") : undefined}>
                  {t("results.publish.label")}
                </CheckboxField>
                <Box>
                  <GlyphSubmitButton icon="save" variant="outlined" label={t("results.publish.save")} pendingLabel={t("results.publish.saving")} />
                </Box>
              </Stack>
            </ActionForm>
          ) : (
            <Typography variant="body2" data-testid="results-publish-admin-only">
              {t("results.publish.adminOnly")}
            </Typography>
          )}
        </Stack>
      </Panel>

      <Box>
        <GlyphButton icon="download" href={downloadHref} variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="results-export">
          {t("results.export")}
        </GlyphButton>
      </Box>
      <Box>
        {/* The path is `getPathname`'s own, with the query after it: a string href goes through the localizer again, so it is a button on a plain `href`. */}
        <GlyphButton icon="registrations" href={`${getPathname({ locale, href: "/admin/registrations" })}?eventId=${id}`} variant="text" size="small" sx={{ minHeight: 44 }} data-testid="results-registrations-link">
          {t("results.registrationsLink")}
        </GlyphButton>
      </Box>
    </Stack>
  );
}
