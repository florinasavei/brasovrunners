import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay, formatTime, formatTimeWithSeconds } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventTitle } from "@/modules/content/events/repository";
import { startHeldBack } from "@/modules/events/domain/dated";
import { noticeDescribesResults, termsDescribeResults } from "@/modules/legal-documents/repository";
import { bandWordsFrom, categoryLabelOf } from "@/modules/results/category-words";
import { bandKeysOf, bandLabelOf, formatAgeBandStarts } from "@/modules/results/domain/age-bands";
import { awardsOf } from "@/modules/results/domain/awards";
import { resultsPublishState } from "@/modules/results/domain/from-start";
import { formatResultTime } from "@/modules/results/domain/result-time";
import { RESULT_STATUSES } from "@/modules/results/domain/ranking";
import { anonymousResultLabel } from "@/modules/results/domain/public-name";
import ImportFilePicker from "@/modules/results/ui/ImportFilePicker";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { type FinishHistoryEntry, readFinishHistory } from "@/modules/results/finish-history";
import { recordedTimesOffered, shownFinishTime } from "@/modules/results/domain/recorded-times";
import { readRecordedFinishTimes } from "@/modules/results/recorded-times";
import { plannedGunOf, readEventResults, type ResultRunner } from "@/modules/results/results";
import { CHOICE_BOX, CHOOSE_TIME_FORM_ID, chosenTimeValue, RESULTS_ALERT_ANCHOR } from "@/modules/results/rows";
import {
  DELETE_RESULT_FORM_ID,
  type PlaceView,
  type RecordedTimeView,
  type RegisteredLine,
  RegisteredResultLines,
  type ResultMark,
  ResultsHeader,
  type ResultWords,
  type TypedLine,
  TypedResultLines,
} from "@/modules/results/ui/ResultRows";
import { canEnterResults, canPublishResults, canResetResults } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { isDomainError } from "@/shared/errors/domain-error";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import ClockPickerHost from "@/shared/forms/pickers/ClockPickerHost";
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
import { chooseRecordedTimeAction, deleteEventResultAction, resetEventResultsAction, saveEventResultsAction, setResultAgeBandsAction, setResultAwardsAction, setResultDistanceAction, setResultPublicNoteAction, setResultsAllNamesAction, setResultsPublishedAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resultsError?: string; timeError?: string }>;
};

/** Reads the stored rows and is returned to right after a save. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The codes the page's banner says: a one-button form that has no boxes to keep redirects with `?resultsError=`. CONFLICT and
 * `RESULTS_RESET_AFTER_START` are «Resetează clasamentul»'s (§997) — the save says its own CONFLICT in place, so here the code is
 * the reset's and the banner says so in the reset's words.
 */
const BANNER_ERRORS = ["FORBIDDEN", "NOT_FOUND", "RESULTS_NOT_OPEN", "RESULTS_NOTICE", "RESULTS_TERMS", "CONFLICT", "RESULTS_RESET_AFTER_START"] as const;

/**
 * The codes a refused «Folosește» comes back with (§1012), in `?timeError=` — its own parameter, so its CONFLICT («the runner's line
 * changed since your page») is never said in the reset's words. Each is `errors.<code>`, but CONFLICT, `results.recorded.changed`.
 */
const TIME_ERRORS = ["FORBIDDEN", "NOT_FOUND", "RESULTS_NOT_OPEN", "CONFLICT", "RESULT_TIME_NOT_RECORDED", "RESULT_DISQUALIFIED"] as const;

/**
 * «Clasament» (`DECISIONS.md` §808; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»): one race's results, on
 * a page of their own under the event like its bibs and its messages — the event editor is long enough, and its «Înscrieri» card links here.
 *
 * ONE form, ONE «Salvează tot clasamentul» (§791's model): above the lines, «Importă din CSV» — a file or pasted text whose rows fill the
 * boxes and save nothing; then a line for every registered runner who holds a race number (the elites first, then the checked in), each with «Timp», «Status»,
 * «Timp cip» and «Notă», and the position the last save gave; then the runners the club types by hand. Each line's «Șterge» is the page's
 * one small form beside, asked first. The Administrator's tick «Clasamentul e public pe pagina evenimentului» is a form of its own: the
 * disclosure has its own gate (the privacy notice in force must describe the results) and its own audit row, and does not ride on a save.
 * «Descarcă clasamentul (CSV)» is the file, names included — the backoffice sees every name. At the foot, the Administrator's danger
 * card «Resetează clasamentul» (§997): before the planned start, one asked press wipes every result and the gun pressed on
 * «Cronometrare», the question counting what goes; after the start it is drawn disabled with the sentence why, for anybody else not
 * at all.
 *
 * Under a line's «Timp», «Timpi la sosire» (§1012): the times «Cronometrare» recorded for its number since the last reset — read with
 * the page's data, one query of the race's trail (`recorded-times.ts`) — drawn only when there is a choice and never on a «Descalificat»
 * line, each with who pressed it and when, «în clasament» on the one the line shows, and «Folosește» beside each other one: the page's
 * one hidden form, as «Șterge»'s, its question naming the time and the runner, the line's own fingerprint posted with it.
 *
 * Whoever enters results — the Organizer, the Administrator, the Superadministrator (`canEnterResults`); anybody else meets the 404 an
 * unknown page gets (BR-REQ-060-01), and every action asserts again. A group run has no results: the page says so and offers nothing.
 */
export default async function EventResultsPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { resultsError, timeError } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const actor = await requireStaff();
  if (!canEnterResults(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  let view: Awaited<ReturnType<typeof readEventResults>>;
  let recorded: Awaited<ReturnType<typeof readRecordedFinishTimes>>;
  try {
    // The race's results and, read with them, the times «Cronometrare» recorded for every number (§1012): one query of the race's trail.
    [view, recorded] = await Promise.all([readEventResults(db, actor, id), readRecordedFinishTimes(db, actor, id)]);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { event } = view;
  const title = (await findEventTitle(db, id, locale)) ?? "";
  const t = await getTranslations("Admin");

  const now = new Date();
  const zone = event.timezone || CLUB_TIME_ZONE;
  const takes = eventTakesResults(event.type);
  const mayPublish = canPublishResults(actor.role);
  const noticeDescribes = takes ? await noticeDescribesResults(db, now) : false;
  const termsDescribe = takes ? await termsDescribeResults(db, now) : false;
  const started = event.startsAt.getTime() <= now.getTime();
  // Whether the tick could be set now (§985): an Administrator, and the notice and the terms in force describing the results — else the
  // tick is refused, and the cards below say why; no sentence says it may be ticked before the race while it cannot.
  const canTick = mayPublish && noticeDescribes && termsDescribe;
  // The tick as the page says it (§985): off, «Public de la start» while ticked before the race — nothing shows until then — or «Public».
  const publishState = resultsPublishState(event, now);
  // The start's day and hour, as the site will show them — none while the date or the hour is to be announced (§533): the public read
  // has no start then, so nothing shows until it is announced, and the card says that instead of the hour stored.
  const startWords = startHeldBack(event) ? null : formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "short", position: "inline", withTime: true });
  const errorCode = BANNER_ERRORS.find((code) => code === resultsError);
  const timeErrorCode = TIME_ERRORS.find((code) => code === timeError);

  const eventPath = { pathname: "/admin/events/[id]", params: { id } } as const;
  const head = (
    <>
      {/* «Ziua cursei»'s tabs (§979): this page is «Clasament», for its own event; what follows is as it was. */}
      {await raceDayTabs({ locale, active: "results", eventId: id, actor })}
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
    pickTime: t("results.pickTime", { runner: "{runner}" }),
    pickChip: t("results.pickChip", { runner: "{runner}" }),
    delete: t("results.delete"),
    present: t("results.present"),
    nameless: t("results.nameless"),
    addRow: t("results.addRow"),
    typedRow: t("results.typedRow"),
    agreed: t("results.agreed"),
    agreedHelp: t("results.agreedHelp"),
    noPlace: t("results.noPlace"),
    noPlaceSettled: t("results.noPlaceSettled"),
    outOfRanking: t("results.outOfRanking"),
    recordedTitle: t("results.recorded.title"),
    recordedCurrent: t("results.recorded.current"),
    recordedUse: t("results.recorded.use"),
  };
  // The category in the Excel footer's own words (§787), under the race's own bands (§850): the template «{sex}, {band}» read raw, filled by the label.
  const statisticsWord = (statisticsKey: string) => t.raw(`registrations.statistics.${statisticsKey}`) as string;
  const categoryLabel = (key: string | null) => categoryLabelOf(key, statisticsWord, view.ageBandStarts);
  const bandLabel = (band: string) => bandLabelOf(band, view.ageBandStarts, bandWordsFrom(statisticsWord));

  const placeOf = (runner: ResultRunner): PlaceView | null => {
    const result = runner.result;
    if (!result || result.positionOverall === null) return null;
    const parts: string[] = [];
    if (result.positionSex !== null) parts.push(t("results.place.sex", { position: String(result.positionSex) }));
    if (result.positionCategory !== null && result.categoryKey !== null) parts.push(t("results.place.category", { category: categoryLabel(result.categoryKey), position: String(result.positionCategory) }));
    return { overall: String(result.positionOverall), detail: parts.join(" · ") };
  };
  // What the published results say of a line (§808): by name, «Participant #bib», or — an elite hors concours (§910) — nothing at all.
  // Out of the ranking by the club's tick (§910): said by the mark that brought the tick — an ambassador who is not an elite as such (§948).
  const publicLineOf = (runner: ResultRunner, anonymousLabel: string) =>
    runner.outOfRanking
      ? t(runner.ambassador && !runner.elite ? "results.publicLine.outOfRankingAmbassador" : "results.publicLine.outOfRanking")
      : runner.named
        ? t("results.publicLine.named")
        : t("results.publicLine.anonymous", { label: anonymousLabel });
  // Why a «Participant #…» line shows no name (§985, `publicNameReason`, read with `named`): under the line — or, while no approved
  // notice describes the results (the same reason for every line), once at the top of the page instead.
  const nobodyNamed = [...view.registered, ...view.typed].some((runner) => runner.nameReason === "noResultsNotice");
  const publicReasonOf = (runner: ResultRunner) => (runner.named || runner.outOfRanking || nobodyNamed ? undefined : t(`results.publicWhy.${runner.nameReason}`));
  // «Cu nume pe site: N din M» (§985): M, the lines the published results would show — a stored result, not an elite out of the ranking; N, those named.
  // «Comentariu public» (§1031): the lines written so far, by number, so the Administrator sees what the site prints.
  // «Distanța parcursă» (§1034): the runners' own distances so far, by number.
  const distances = [...view.registered, ...view.typed].flatMap((runner) => (runner.result?.distanceMeters ? [`#${runner.bibNumber}: ${runner.result.distanceMeters / 1000} km`] : []));
  const publicNotes = [...view.registered, ...view.typed].flatMap((runner) => (runner.result?.publicNote ? [`#${runner.bibNumber}: ${runner.result.publicNote}`] : []));
  const onSite = [...view.registered, ...view.typed].filter((runner) => runner.result !== null && !runner.outOfRanking);
  const namedOnSite = onSite.filter((runner) => runner.named).length;
  const valuesOf = (runner: ResultRunner) => ({
    time: formatResultTime(runner.result?.gunTimeMs),
    // A runner with no result yet shows the blank status; one with a result shows it — the line is saved exactly as drawn.
    status: runner.result?.status ?? "",
    chip: formatResultTime(runner.result?.chipTimeMs),
    note: runner.result?.note ?? "",
  });

  // The registration's marks (§948): «Elită» and «Ambasador» beside the runner, here and at «Premii» — the backoffice's alone.
  const marksOf = (runner: ResultRunner): ResultMark[] => [
    ...(runner.elite ? [{ glyph: "elite" as const, label: t("registrations.elite.chip") }] : []),
    ...(runner.ambassador ? [{ glyph: "ambassador" as const, label: t("registrations.ambassador.chip") }] : []),
  ];
  const marksByBib = new Map(view.registered.map((runner) => [runner.bibNumber, marksOf(runner)]));

  // Who last wrote a stored result (§986): «introdus de …» while it is as first written, «modificat de …» once changed; «cont șters» for an account gone.
  const writtenByOf = (runner: ResultRunner) =>
    runner.result ? t(runner.result.writtenBy.changed ? "timing.changedBy" : "timing.enteredBy", { name: runner.result.writtenBy.name ?? t("timing.accountGone") }) : undefined;
  // «Timpi la sosire» (§1012): a line's recorded times, worded, only when there is a choice (`recordedTimesOffered`) — more than one, or one
  // that is not the line's «Timp» — and never on a «Descalificat» line, changed by hand in «Stare». Each «Folosește» gets its own question
  // in the page's one hidden form, the time and the runner named, and posts its line's own fingerprint: only that line is guarded.
  const confirm = await confirmWords();
  const chooseQuestions: ConfirmSpec[] = [];
  const recordedOf = (runner: ResultRunner, runnerWords: string): RecordedTimeView[] | undefined => {
    const times = recorded.get(runner.bibNumber) ?? [];
    if (!recordedTimesOffered(times, runner.result)) return undefined;
    const current = shownFinishTime(runner.result);
    return times.map((time) => {
      const timeWords = formatResultTime(time.gunTimeMs);
      const choice = chosenTimeValue(runner.bibNumber, time.gunTimeMs, runner.lineFingerprint);
      const isCurrent = time.gunTimeMs === current;
      if (!isCurrent) {
        chooseQuestions.push({
          when: [{ field: CHOICE_BOX, equals: choice }],
          title: t("results.recorded.confirmTitle"),
          body: t("results.recorded.confirmBody", { time: timeWords, runner: runnerWords }),
          confirmLabel: t("results.recorded.use"),
          cancelLabel: confirm.cancel,
        });
      }
      return {
        time: timeWords,
        by: t("results.recorded.by", { name: time.by ?? t("timing.accountGone"), at: formatTimeWithSeconds(time.at, { locale, timeZone: zone }) }),
        current: isCurrent,
        choice,
        useLabel: t("results.recorded.useFor", { time: timeWords, runner: runnerWords }),
      };
    });
  };
  const registered: RegisteredLine[] = view.registered.map((runner) => ({
    bibNumber: runner.bibNumber,
    name: runner.name ?? "",
    present: runner.checkedIn,
    // What the published list would say of the runner — `publicResultName`'s own answer (the tick, a confirmed registration, a notice that
    // described the results), never a guess from the tick alone; an elite out of the ranking (§910) is not on it at all.
    publicLine: publicLineOf(runner, anonymousResultLabel(locale, runner.bibNumber, event.raceNumberFormat)),
    publicReason: publicReasonOf(runner),
    values: valuesOf(runner),
    place: placeOf(runner),
    hasResult: runner.result !== null,
    outOfRanking: runner.outOfRanking,
    marks: marksOf(runner),
    writtenBy: writtenByOf(runner),
    recorded: recordedOf(runner, `#${runner.bibNumber} ${runner.name ?? ""}`.trim()),
  }));
  const typed: TypedLine[] = view.typed.map((runner) => ({
    values: {
      bib: String(runner.bibNumber),
      name: runner.name ?? "",
      sex: runner.sex ?? "",
      birthDate: runner.birthDate ? runner.birthDate.split("-").reverse().join(".") : "",
      ...valuesOf(runner),
    },
    agreed: runner.nameAgreed === true,
    // The registered lines' caption, from the same answer (`publicResultName`): a tick saved while no notice describes the results names nobody yet.
    publicLine: publicLineOf(runner, anonymousResultLabel(locale, runner.bibNumber)),
    // A nameless line (an erased registration's) says why in its own sentence («Fără nume: …»).
    publicReason: runner.name === null ? undefined : publicReasonOf(runner),
    place: placeOf(runner),
    hasResult: true,
    outOfRanking: runner.outOfRanking,
    writtenBy: writtenByOf(runner),
    recorded: recordedOf(runner, `#${runner.bibNumber} ${runner.name ?? ""}`.trim()),
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
  labels["n[].agreed"] = words.agreed;
  const boxes = await refusalMessages(labels);
  const publishBoxes = await refusalMessages({ published: t("results.publish.label") });
  const categoriesBoxes = await refusalMessages({ ageBands: t("results.categories.label") });
  const awardsBoxes = await refusalMessages({ awardPlaces: t("results.awards.placesLabel"), awardCategories: t("results.awards.categoriesLabel") });

  // «Premii» (§850): the podium by sex — and by category when the race awards them — from the rows the page already holds, the ranking's own positions.
  const awardRules = { places: event.awardPlaces, categories: event.awardCategories };
  const awards = awardsOf(
    [...view.registered, ...view.typed].flatMap((runner) =>
      runner.result
        ? [{ bibNumber: runner.bibNumber, name: runner.name, sex: runner.sex, gunTimeMs: runner.result.gunTimeMs, positionSex: runner.result.positionSex, positionCategory: runner.result.positionCategory, categoryKey: runner.result.categoryKey }]
        : [],
    ),
    awardRules,
  );
  const bands = bandKeysOf(view.ageBandStarts);

  const total = view.counts.FINISHED + view.counts.DNF + view.counts.DNS + view.counts.DSQ;
  const downloadHref = `/api/admin/events/${id}/results?lang=${locale}`;

  // «Istoricul sosirilor» (§986): one line a write — when, who, what with the number and the time, and from where; the runner's
  // name read live beside the number (the trail stores none).
  const history = await readFinishHistory(db, actor, id);
  const historyLineWords = (line: FinishHistoryEntry): string => {
    const when = `${formatDay(line.at, { locale, timeZone: zone, style: "short" })}, ${formatTimeWithSeconds(line.at, { locale, timeZone: zone })}`;
    const what = line.what;
    const runner = (bib: number | null) => (bib === null ? "#?" : `#${bib}${line.liveName ? ` ${line.liveName}` : ""}`);
    const status = (value: string | null) => (value && (RESULT_STATUSES as readonly string[]).includes(value) ? t(`results.status.${value}`) : "");
    const statusAndTime = (value: string | null, ms: number | null) => (value === "FINISHED" && ms !== null ? `${status(value)}, ${formatResultTime(ms)}` : status(value));
    const instant = (at: Date | null) => (at === null ? "—" : formatTimeWithSeconds(at, { locale, timeZone: zone }));
    let words: string;
    switch (what.kind) {
      case "finish":
        words = t(what.turned ? "results.history.what.finishTurned" : "results.history.what.finish", { runner: runner(what.bibNumber), time: formatResultTime(what.gunTimeMs) || "—" });
        break;
      case "duplicate":
        // A press of a runner «Clasament» wrote off: the decision stays, said by its word; of a «Sosit», the first time stays.
        words =
          what.storedStatus !== "FINISHED" && status(what.storedStatus) !== ""
            ? t("results.history.what.kept", { runner: runner(what.bibNumber), time: formatResultTime(what.gunTimeMs) || "—", status: status(what.storedStatus) })
            : t("results.history.what.duplicate", { runner: runner(what.bibNumber), time: formatResultTime(what.gunTimeMs) || "—", stored: formatResultTime(what.storedGunTimeMs) || "—" });
        break;
      case "undo":
        words = t("results.history.what.undo", { runner: runner(what.bibNumber), time: formatResultTime(what.gunTimeMs) || "—" });
        break;
      case "created":
        words = t("results.history.what.created", { runner: runner(what.bibNumber), status: statusAndTime(what.status, what.gunTimeMs) });
        break;
      case "updated":
        words = t(what.boxes.length > 0 ? "results.history.what.updatedBoxes" : "results.history.what.updated", {
          runner: runner(what.bibNumber),
          status: statusAndTime(what.status, what.gunTimeMs),
          boxes: what.boxes.map((box) => t(`results.history.box.${box}`)).join(", "),
        });
        break;
      case "chosen":
        // «Folosește» (§1012): one of the times recorded at the line made the runner's.
        words = t("results.history.what.chosen", { runner: runner(what.bibNumber), time: formatResultTime(what.gunTimeMs) || "—" });
        break;
      case "deleted":
        words = t("results.history.what.deleted", { runner: runner(what.bibNumber), status: status(what.status) });
        break;
      case "gunSet":
        words = what.previous === null ? t("results.history.what.gunSet", { time: instant(what.at) }) : t("results.history.what.gunMoved", { time: instant(what.at), previous: instant(what.previous) });
        break;
      case "gunCleared":
        words = t("results.history.what.gunCleared", { previous: instant(what.previous) });
        break;
      case "reset": {
        // «Resetează clasamentul» (§997): how many results went, counted by `countForm`, and the gun with them when one was given.
        const count = what.results ?? 0;
        const reset = t(`results.history.what.reset.${countForm(count, locale)}`, { count: String(count) });
        words = what.gunCleared ? t("results.history.what.resetGun", { reset }) : reset;
        break;
      }
    }
    return t("results.history.line", { when, by: line.who ?? t("timing.accountGone"), what: words, where: t(`results.history.where.${line.where}`) });
  };

  // «Resetează clasamentul» (§997): the Administrator's card, open while the planned gun is ahead on the server's clock — a test «Start»
  // moves the line's gun, never the plan. The question counts what goes: the results, the gun when one was given, the phones' queue.
  const mayReset = canResetResults(actor.role);
  const resetOpen = plannedGunOf(event).getTime() > now.getTime();
  const resetGun = event.raceGunAt;
  const resetSomething = total > 0 || resetGun !== null;
  const resetGunTime = resetGun ? formatTime(resetGun, { locale, timeZone: zone }) : "";
  const resetBody = [
    ...(total > 0 ? [t(`results.reset.confirmCount.${countForm(total, locale)}`, { count: String(total) })] : []),
    ...(resetGun ? [t(total > 0 ? "results.reset.confirmGun" : "results.reset.confirmGunOnly", { time: resetGunTime })] : []),
    t("results.reset.confirmPhones"),
  ].join(" ");

  return (
    <Stack spacing={2}>
      {head}
      <Typography variant="body2" color="text.secondary">
        {t("results.intro")}
        <QuietHelp text={t("results.introMore")} />
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }} data-testid="results-summary">
        {RESULT_STATUSES.map((status) => (
          <StatusChip key={status} glyph={status === "FINISHED" ? "done" : status === "DNS" ? "didNotStart" : status === "DNF" ? "droppedOut" : "failed"} variant="outlined" label={t(`results.summary.${status}`, { count: String(view.counts[status]) })} />
        ))}
        <StatusChip glyph="wantsList" variant="outlined" label={t("results.namedCount", { named: String(namedOnSite), shown: String(onSite.length) })} testId="results-named-count" />
        <StatusChip
          glyph={publishState === "on" ? "visible" : publishState === "fromStart" ? "planned" : "hidden"}
          color={publishState === "on" ? "success" : publishState === "fromStart" ? "primary" : "default"}
          label={t(publishState === "on" ? "results.publish.stateOn" : publishState === "fromStart" ? "results.publish.stateFromStart" : "results.publish.stateOff")}
          testId="results-published-chip"
        />
      </Stack>
      {nobodyNamed && (
        <Alert severity="info" data-testid="results-names-nobody">
          {t("results.publicWhy.noResultsNotice")} <Link href="/admin/legal">{t("results.publish.gateLink")}</Link>
        </Alert>
      )}
      {!started && (
        <Alert severity="info" data-testid="results-not-started">
          {/* The tick is the Administrator's (`canPublishResults`), and only while the texts describe the results: anybody else is told only what they may do before the start. */}
          {t(canTick ? "results.notStarted" : "results.notStartedEnterOnly")}
        </Alert>
      )}
      {(errorCode || timeErrorCode) && (
        <Alert severity="error" id={RESULTS_ALERT_ANCHOR} tabIndex={-1} sx={{ scrollMarginTop: 16 }} data-testid="results-error">
          {/* A refused «Folosește» (§1012) says its own CONFLICT — the runner's line changed since the page was drawn —; a CONFLICT in
              `resultsError` is the reset's (§997): results arrived or the start changed since its page was drawn — nothing was wiped. */}
          {timeErrorCode
            ? timeErrorCode === "CONFLICT"
              ? t("results.recorded.changed")
              : t(`errors.${timeErrorCode}`)
            : errorCode === "CONFLICT"
              ? t("results.reset.changed")
              : t(`errors.${errorCode}`)}
        </Alert>
      )}

      {/* The page's ONE clock picker (§999), for every «Timp» and «Timp cip» of both panels: loaded on the first press, and outside the
          form, so nothing it draws is the form's. */}
      <ClockPickerHost words={{ help: t("results.picker.help"), ok: t("results.picker.ok"), cancel: t("results.picker.cancel") }}>
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

            {/* «Loc» in plain words (§985; the owner, 2026-11-18: «ce inseamna "Loc" aici?») — once, above both panels of lines, since a phone
                has no column header and a typed runner's line says «Loc:» too; nothing while there is no line at all. */}
            {(registered.length > 0 || typed.length > 0) && (
              <Typography variant="body2" color="text.secondary" data-testid="results-place-hint">
                {t("results.placeHint")}
                <QuietHelp text={t("results.placeHelp")} testId="results-place-help" />
              </Typography>
            )}

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
      </ClockPickerHost>

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

      {/* A line's «Folosește» under «Timpi la sosire» (§1012): one hidden form for the whole page, as «Șterge»'s; the button names it with
          `form=` and posts `choice=<number>:<milliseconds>:<the line's fingerprint>`. Asks first — each button its own question, the time
          and the runner named —; the line's own fingerprint, never the page's, so a line changed since changes nothing while another
          number's arrival at «Cronometrare» refuses nothing. Drawn only while some line offers a choice. */}
      {chooseQuestions.length > 0 && (
        <ActionForm
          id={CHOOSE_TIME_FORM_ID}
          hidden
          action={chooseRecordedTimeAction}
          confirm={[
            ...chooseQuestions,
            // Asked only of a press no question above names — none the page draws —, so no press goes unasked.
            { title: t("results.recorded.confirmTitle"), body: t("results.recorded.confirmBodyAny"), confirmLabel: t("results.recorded.use"), cancelLabel: confirm.cancel },
          ]}
          data-testid="results-choose-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={id} />
        </ActionForm>
      )}

      {/* «Categorii de vârstă» (§850): the ages the race's categories start at, a form of its own — a change ranks the stored rows again, not a save of them. */}
      <Panel glyph="filters" level={3} title={t("results.categories.title")} aside={t("results.categories.aside", { count: String(bands.length * 2) })} id="box-results-categories" data-testid="results-categories">
        <ActionForm action={setResultAgeBandsAction} scope="categories" messages={categoriesBoxes} data-testid="results-categories-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={id} />
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("results.categories.intro")}
              <QuietHelp text={t("results.categories.more")} />
            </Typography>
            <RecallField
              name="ageBands"
              label={t("results.categories.label")}
              defaultValue={view.ageBandsCustom ? formatAgeBandStarts(view.ageBandStarts) : ""}
              placeholder={t("results.categories.placeholder")}
              helperText={view.ageBandsCustom ? t("results.categories.stateCustom") : t("results.categories.stateDefault")}
              fullWidth
              size="small"
              slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off", "data-testid": "results-age-bands" } }}
            />
            <Typography variant="body2" data-testid="results-categories-preview">
              {t("results.categories.preview")}: {bands.map((band) => bandLabel(band)).join(" · ")}
            </Typography>
            <Box>
              <GlyphSubmitButton icon="save" variant="outlined" label={t("results.categories.save")} pendingLabel={t("results.categories.saving")} />
            </Box>
          </Stack>
        </ActionForm>
      </Panel>

      {/* «Premii» (§850): who stands on the podium, by sex and by category, read from the saved results — the list the awards are given from. */}
      <Panel glyph="badges" collapsible level={3} title={t("results.awards.title")} aside={t(event.awardCategories ? "results.awards.aside" : "results.awards.asideOverall", { places: String(event.awardPlaces) })} id="box-results-awards" openWhen={{ inUse: awards.length > 0 }} data-testid="results-awards">
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t("results.awards.intro")}
          </Typography>
          {/* The race's own rules (§850): how many places, and whether the categories are awarded — a form of its own, nothing of the results moves. */}
          <ActionForm action={setResultAwardsAction} scope="awards" messages={awardsBoxes} data-testid="results-awards-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={id} />
            <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              <RecallField
                name="awardPlaces"
                label={t("results.awards.placesLabel")}
                defaultValue={String(event.awardPlaces)}
                size="small"
                sx={{ width: 150 }}
                slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off", "data-testid": "results-award-places" } }}
              />
              <CheckboxField name="awardCategories" defaultChecked={event.awardCategories} help={t("results.awards.categoriesHelp")}>
                {t("results.awards.categoriesLabel")}
              </CheckboxField>
              <Box>
                <GlyphSubmitButton icon="save" variant="outlined" label={t("results.awards.save")} pendingLabel={t("results.awards.saving")} />
              </Box>
            </Stack>
          </ActionForm>
          {awards.length === 0 ? (
            <Typography variant="body2" data-testid="results-awards-empty">
              {t("results.awards.empty")}
            </Typography>
          ) : (
            <Box component="dl" sx={{ m: 0, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
              {awards.map((group) => (
                <Box key={group.kind === "sex" ? `sex-${group.sex}` : group.key} data-testid="results-award-group">
                  <Typography component="dt" variant="subtitle2">
                    {group.kind === "sex" ? t(group.sex === "FEMALE" ? "results.awards.overallFemale" : "results.awards.overallMale") : categoryLabel(group.key)}
                  </Typography>
                  {group.rows.map((row) => (
                    <Typography component="dd" variant="body2" key={row.bibNumber} sx={{ m: 0 }} data-testid="results-award-row">
                      {t("results.awards.place", { position: String(row.position) })} · #{row.bibNumber}
                      {row.name ? ` ${row.name}` : ""} · {formatResultTime(row.gunTimeMs)}
                      {/* Whose result it is (§948): an elite's or an ambassador's is said right on the podium's row, so the club decides the award knowing it. */}
                      {(marksByBib.get(row.bibNumber) ?? []).map((mark) => (
                        <Box component="span" key={mark.glyph} sx={{ ml: 0.75, display: "inline-flex", verticalAlign: "middle" }}>
                          <StatusChip glyph={mark.glyph} label={mark.label} color="secondary" variant="outlined" testId={`results-award-mark-${mark.glyph}`} />
                        </Box>
                      ))}
                    </Typography>
                  ))}
                </Box>
              ))}
            </Box>
          )}
        </Stack>
      </Panel>

      <Panel glyph="publication" level={3} title={t("results.publish.title")} aside={t(publishState === "on" ? "results.publish.stateOn" : publishState === "fromStart" ? "results.publish.stateFromStart" : "results.publish.stateOff")} id="box-results-publish" data-testid="results-publish">
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
          {/* Before the race (§985) the tick may be set: ticked, it says so with the start's day and hour; unticked, that it may be. Nothing shows before the start either way. */}
          {publishState === "fromStart" ? (
            <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }} data-testid="results-publish-from-start">
              <StatusChip glyph="planned" color="primary" variant="outlined" label={t("results.publish.stateFromStart")} testId="results-from-start-chip" />
              <Typography variant="body2">{startWords !== null ? t("results.publish.fromStart", { start: startWords }) : t("results.publish.fromStartUnannounced")}</Typography>
            </Stack>
          ) : (
            // «Poți bifa de pe acum» is said to whoever may tick it, while the texts allow it: the Organizer's card says «Doar un
            // administrator…» below, and the gates' own sentences above say what an Administrator must approve first.
            !started &&
            canTick && (
              <Alert severity="info" data-testid="results-publish-not-started">
                {startWords !== null ? t("results.publish.beforeStart", { start: startWords }) : t("results.publish.beforeStartUnannounced")}
              </Alert>
            )
          )}
          {mayPublish ? (
            <ActionForm
              action={setResultsPublishedAction}
              scope="publish"
              messages={publishBoxes}
              // Making the ranking public, and taking it off the site, ask first (§384): the first spec asks when the box is ticked, the second — no `when` — otherwise.
              confirm={[
                {
                  when: [{ field: "published", equals: "on" }],
                  title: t("results.publish.confirmOnTitle"),
                  // Before the race (§985) the question says the results show from the start, not now.
                  body: t(started ? "results.publish.confirmOnBody" : "results.publish.confirmOnBodyFromStart"),
                  confirmLabel: t("results.publish.save"),
                  cancelLabel: confirm.cancel,
                },
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
          {/* «Toate numele în clasament» (§1029): the Administrator's own switch, saved on its own and asked first both ways — it names runners who did not agree. */}
          {mayPublish && (
            <ActionForm
              action={setResultsAllNamesAction}
              confirm={[
                {
                  when: [{ field: "allNames", equals: "on" }],
                  title: t("results.allNames.confirmOnTitle"),
                  body: t("results.allNames.confirmOnBody"),
                  confirmLabel: t("results.publish.save"),
                  cancelLabel: confirm.cancel,
                },
                { title: t("results.allNames.confirmOffTitle"), body: t("results.allNames.confirmOffBody"), confirmLabel: t("results.publish.save"), cancelLabel: confirm.cancel },
              ]}
              data-testid="results-all-names-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={id} />
              <Stack spacing={1.5}>
                <CheckboxField name="allNames" defaultChecked={event.resultsAllNames} help={t("results.allNames.help")}>
                  {t("results.allNames.label")}
                </CheckboxField>
                <Box>
                  <GlyphSubmitButton icon="save" variant="outlined" label={t("results.publish.save")} pendingLabel={t("results.publish.saving")} />
                </Box>
              </Stack>
            </ActionForm>
          )}
        </Stack>
      </Panel>

      {/* «Comentariu public» (§1031): one line under one result on the site — the Administrators' own, saved on its own. */}
      {mayPublish && (
        <Panel glyph="description" collapsible level={3} title={t("results.publicNote.title")} id="box-results-public-note" data-testid="results-public-note">
          <ActionForm
            action={setResultPublicNoteAction}
            confirm={[{ title: t("results.publicNote.confirmTitle"), body: t("results.publicNote.confirmBody"), confirmLabel: t("results.publicNote.save"), cancelLabel: confirm.cancel }]}
            data-testid="results-public-note-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={id} />
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {t("results.publicNote.help")}
              </Typography>
              <RecallField name="bibNumber" label={t("results.publicNote.bib")} size="small" required inputMode="numeric" sx={{ maxWidth: 200 }} />
              <RecallField name="publicNote" label={t("results.publicNote.note")} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
              <Box>
                <GlyphSubmitButton icon="save" variant="outlined" label={t("results.publicNote.save")} pendingLabel={t("results.publicNote.saving")} />
              </Box>
              {publicNotes.length > 0 && (
                <Typography variant="body2" data-testid="results-public-notes">
                  {t("results.publicNote.current", { list: publicNotes.join(" · ") })}
                </Typography>
              )}
            </Stack>
          </ActionForm>
          {/* «Distanța parcursă» (§1034): one runner's own distance, the race's by default; the site's pace reads it. */}
          <ActionForm
            action={setResultDistanceAction}
            confirm={[{ title: t("results.distance.confirmTitle"), body: t("results.distance.confirmBody"), confirmLabel: t("results.distance.save"), cancelLabel: confirm.cancel }]}
            data-testid="results-distance-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={id} />
            <Stack spacing={1.5} sx={{ mt: 3 }}>
              <Typography variant="body2" color="text.secondary">
                {t("results.distance.help")}
              </Typography>
              <RecallField name="bibNumber" label={t("results.publicNote.bib")} size="small" required inputMode="numeric" sx={{ maxWidth: 200 }} />
              <RecallField name="distanceKm" label={t("results.distance.km")} size="small" inputMode="decimal" sx={{ maxWidth: 200 }} />
              <Box>
                <GlyphSubmitButton icon="save" variant="outlined" label={t("results.distance.save")} pendingLabel={t("results.publicNote.saving")} />
              </Box>
              {distances.length > 0 && (
                <Typography variant="body2" data-testid="results-distances">
                  {t("results.distance.current", { list: distances.join(" · ") })}
                </Typography>
              )}
            </Stack>
          </ActionForm>
        </Panel>
      )}

      {/* «Istoricul sosirilor» (§986): every write of the race's results — the line's presses, duplicates and undos, this page's saves, «Start» — newest first, with who. */}
      <Panel glyph="history" collapsible level={3} title={t("results.history.title")} aside={t(`results.history.count.${countForm(history.lines.length, locale)}`, { count: String(history.lines.length) })} id="box-results-history" data-testid="results-history">
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {t("results.history.intro")}
          </Typography>
          {history.lines.length === 0 ? (
            <Typography variant="body2" data-testid="results-history-empty">
              {t("results.history.empty")}
            </Typography>
          ) : (
            <Box component="ol" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.5 }}>
              {history.lines.map((line) => (
                <Typography component="li" variant="body2" key={line.id} sx={{ overflowWrap: "anywhere" }} data-testid="results-history-line" data-where={line.where}>
                  {historyLineWords(line)}
                </Typography>
              ))}
            </Box>
          )}
          {history.limited && (
            <Typography variant="caption" color="text.secondary">
              {t("results.history.limited", { count: String(history.lines.length) })}
            </Typography>
          )}
        </Stack>
      </Panel>

      <Box>
        {/* «Cronometrare» (§986, in «Sosire»'s place, §850): «Ziua cursei»'s finish line — a number or an elite pressed as the runner crosses. */}
        <GlyphButton icon="checkIn" href={`${getPathname({ locale, href: "/admin/checkin/cronometrare" })}?eventId=${id}`} variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="results-finish-link">
          {t("results.finish.link")}
        </GlyphButton>
      </Box>
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

      {/*
        «Resetează clasamentul» (§997): the page's one card that destroys, at its foot, a closed fold whose border says so (`Panel`'s
        `danger`, the registration's erase card's shape). The Administrator's alone (`canResetResults`; the action and the service ask
        again). Before the planned start: one press, asked first, posting what the page drew — the count and the gun —, so a page
        older than another result wipes nothing. With nothing to wipe, or once the planned start has passed, the button is drawn
        disabled with the sentence why.
      */}
      {mayReset && (
        <Panel
          glyph="erase"
          level={3}
          collapsible
          tone="danger"
          title={t("results.reset.title")}
          aside={t("results.reset.aside")}
          intro={t("results.reset.intro")}
          introMore={t("results.reset.introMore")}
          id="box-results-reset"
          data-testid="results-reset"
        >
          {resetOpen && resetSomething ? (
            <ActionForm
              action={resetEventResultsAction}
              confirm={{ title: t("results.reset.confirmTitle"), body: resetBody, confirmLabel: t("results.reset.button"), cancelLabel: confirm.cancel, destructive: true }}
              data-testid="results-reset-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={id} />
              {/* What the page drew: a reset from a page older than another result, or than another «Start», is refused (CONFLICT). */}
              <input type="hidden" name="results" value={String(total)} />
              <input type="hidden" name="seenGunAtMs" value={resetGun ? String(resetGun.getTime()) : ""} />
              <Box>
                <GlyphSubmitButton icon="reset" color="error" variant="outlined" label={t("results.reset.button")} pendingLabel={t("results.reset.pending")} />
              </Box>
            </ActionForm>
          ) : (
            <Stack spacing={1}>
              <Box>
                <GlyphButton icon="reset" color="error" variant="outlined" disabled sx={{ minHeight: 44 }} data-testid="results-reset-disabled">
                  {t("results.reset.button")}
                </GlyphButton>
              </Box>
              <Typography variant="body2" color="text.secondary" data-testid="results-reset-why">
                {t(resetOpen ? "results.reset.nothing" : "results.reset.afterStart")}
              </Typography>
            </Stack>
          )}
        </Panel>
      )}
    </Stack>
  );
}
