import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing, findEventTitle, listSeriesDates } from "@/modules/content/events/repository";
import { editionDifference, usualOf } from "@/modules/events/domain/series";
import { type ScopeDate, SeriesScopeBox, SeriesScopeProvider } from "@/modules/content/events/ui/SeriesScope";
import { editionNote, ruleSentence } from "@/modules/events/ui/series-sentence";
import { describeIncompleteLocales, missingPublicEventFields } from "@/modules/content/events/service";
import { BibPrintCard, BibPrintForms } from "@/modules/content/events/ui/boxes/BibPrint";
import { riskMark } from "@/modules/content/events/ui/boxes/box-kit";
import CourseBox from "@/modules/content/events/ui/boxes/CourseBox";
import CoHostsBox from "@/modules/content/events/ui/boxes/CoHostsBox";
import KindBox from "@/modules/content/events/ui/boxes/KindBox";
import LinksBox from "@/modules/content/events/ui/boxes/LinksBox";
import PlaceBox from "@/modules/content/events/ui/boxes/PlaceBox";
import ProgrammeBox from "@/modules/content/events/ui/boxes/ProgrammeBox";
import PromotionBox from "@/modules/content/events/ui/boxes/PromotionBox";
import RegistrationBox from "@/modules/content/events/ui/boxes/RegistrationBox";
import StatusBox from "@/modules/content/events/ui/boxes/StatusBox";
import { AddressBox, DescriptionBox, RulesBox, TitleSummaryBox } from "@/modules/content/events/ui/boxes/TextBoxes";
import WhenBox from "@/modules/content/events/ui/boxes/WhenBox";
import { summaryDate, summaryDateTime } from "@/modules/content/events/ui/box-summaries";
import EventEditorLayout, { EditorGroup } from "@/modules/content/events/ui/EventEditorLayout";
import { IdenticalTextsList, RevealLink } from "@/modules/content/events/ui/MissingForPublish";
import { EventNoticeUpdateFields } from "@/modules/content/events/ui/EventNoticeFields";
import RecurrenceSeriesPanel from "@/modules/content/events/ui/RecurrenceSeriesPanel";
import RepeatFields from "@/modules/content/events/ui/RepeatFields";
import RepeatToggle from "@/modules/content/events/ui/RepeatToggle";
import { TranslationHiddenFields } from "@/modules/content/events/ui/TranslationFields";
import { EVENT_NOTICE_TEXT_MAX } from "@/modules/events/domain/event-changes";
import { countEventNoticeRecipients } from "@/modules/notifications/event-notices";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { declarationAsksMinorToSign, listApprovedVersions } from "@/modules/legal-documents/repository";
import { areTestRegistrationsAvailable, MAX_TEST_REGISTRATIONS_PER_BATCH } from "@/modules/registrations/test-registrations";
import {
  allowedTransitions,
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canEditTranslation,
  canManageRegistrations,
  canReadContent,
  canReadRegistrations,
  canManageTestRegistrations,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_TRANSITION_ICON,
  EDITORIAL_TRANSITION_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { eventFormFieldLabels, identicalTextLabels } from "@/modules/content/events/ui/field-labels";
import { identicalTexts, storedTextReader } from "@/modules/content/events/ui/publish-check";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { countBibs } from "@/modules/registrations/bibs";
import { countInterests } from "@/modules/registrations/interest";
import { countEligibleWaitlisted, countRegistrationsForEvent, countTestRegistrationsForEvent } from "@/modules/registrations/repository";
import QueuePanel from "@/modules/registrations/ui/QueuePanel";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import {
  addTestRegistrationsAction,
  deleteEventAction,
  assignBibNumbersAction,
  sendEventThanksAction,
  duplicateEventAction,
  repeatEventAction,
  removeTestRegistrationsAction,
  saveEventAndTranslationsAction,
  setRepeatPublishAction,
  withdrawInterestAction,
  stopRepeatAction,
  transitionEventAction,
} from "../../actions";
import { countForm } from "@/i18n/count-form";
import { upcomingRegistrationOpening } from "@/modules/events/domain/registration-window";
import { HORIZON_DAYS, readRepeatRule } from "@/modules/events/domain/repeat";
import { fromWallTimeInput, toWallTimeInput, wallClockWeekday } from "@/modules/events/domain/zoned-time";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; assigned?: string; total?: string; created?: string; applied?: string; offered?: string; notConfirmed?: string; test?: string; notPublished?: string; announced?: string; notice?: string; queued?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * The one editing screen (BR-REQ-050-01, BR-REQ-051-01), as boxes (§350; the owner asked for "a
 * WordPress-like editor", and then for it to read like the event's fact sheet).
 *
 * **The same page as the create form** (`EventEditorLayout`): a side column — Publicare and
 * Recurență, first on a phone, pinned on the right from `md` up — and a main column of boxes in
 * three labelled groups: "Evenimentul" (what kind — with its three cards inside it, the status, the
 * course and the links and files, §358 — title and summary, description), "Ziua evenimentului și
 * participanții" (date and time, place, programme, rules, registration), "Parteneri și prezentare"
 * (partners, promotion, page address), then the always-open Salvare. The create page nests the
 * same three cards in the same box. Each box answers one question and its closed line shows the answer, so the
 * editor opens as a fact sheet and one opens only the box to change. Every box with per-language
 * text has its own Română | English tabs; there is no page-wide language switch, so a shared
 * setting never hides behind a language tab.
 *
 * **One form, one save, one transaction** (`saveEventAndTranslations`, §28, §36): the main column
 * is one `ActionForm` carrying the event row and every language the reader may edit, whichever box
 * each input sits in; a stale version anywhere fails the whole save as a CONFLICT. The side
 * column's publication moves and recurrence actions are forms of their own, **siblings** of the
 * save form — HTML forms cannot nest — and so are the two small forms the bib card's immediate
 * actions post (`form="bib-assign"`, `form="bib-download"`). Below the grid, what is operations
 * rather than settings: the registrations received, and duplicate or delete.
 *
 * **Once people have registered** (real ones: a test row is counted nowhere the club looks,
 * §12.6), the five boxes whose change reaches them — date, place, programme, registration, and
 * the status card inside "Ce fel de eveniment" — are amber, wear the count, and say in one line
 * what a change does. "Ce fel de eveniment" is amber and wears the count too, closed, because the
 * status card is inside it (§358); the sentence stays in the card.
 *
 * The interface hides what a role may not do, and that is a courtesy rather than the rule — every
 * button here is checked again in the action behind it (BR-REQ-060-01). A role that may not read
 * the club's content (the volunteer: the desk only) is sent back to the list.
 */
export default async function EditEventPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The volunteer's backoffice is the desk (§103): the editor is not theirs to read.
  if (!canReadContent(staffUser.role)) redirect(getPathname({ locale, href: "/admin" }));
  const { error, saved, assigned, total, notConfirmed, test, created, applied, offered, notPublished: notPublishedParam, announced, notice: noticeParam, queued } = await searchParams;
  // What the save told the participants (§331), matched against the words there are — the query
  // string is typed by anybody, and it reaches `t("editor.notice.<x>")`.
  const noticeOutcome = (["update", "none", "cancelled", "cancelledQuiet", "cancelledNobody"] as const).find((kind) => kind === noticeParam);
  const queuedCount = /^\d+$/.test(queued ?? "") ? (queued as string) : "0";
  // How many test rows went in before the waiting list's limit stopped the batch (§348).
  const stoppedCount = /^\d+$/.test(created ?? "") ? Number(created) : 0;
  // Why "create and publish" stopped at the draft (§315): a domain code, matched against the
  // codes there are — a query string is typed by anybody, and it reaches `t("errors.<x>")`.
  const notPublished = (["FORBIDDEN", "VALIDATION_ERROR", "CONFLICT", "NOT_FOUND"] as const).find((code) => code === notPublishedParam);

  const db = getDb();
  const record = await findEventForEditing(db, id);
  if (!record) notFound();
  const { event, translations } = record;
  const internal = event.registrationMode === "INTERNAL";
  // How many numbers this event has, and how many wait for the printer, for the bib card.
  const bibCounts = canReadRegistrations(staffUser.role) && internal ? await countBibs(db, event.id) : null;

  const declarations = await listApprovedVersions(db, "EVENT_DECLARATION", locale);
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const now = new Date();
  // "1 dată", "7 date", "20 de date" (§341), for the banners that count a series' dates. The
  // count arrives in the query string, so anything that is not a number reads as none.
  const countOf = (raw: string | undefined) => (Number.isFinite(Number(raw)) ? Number(raw) : 0);
  const datesWords = (raw: string | undefined) => tEvent(`series.count.${countForm(countOf(raw), locale)}`, { count: countOf(raw) });
  /*
    The minor's paper form (§330) only where the declaration in effect, in the language the form
    prints in, asks the minor to sign.
  */
  const minorFormOffered = canReadRegistrations(staffUser.role) && internal ? await declarationAsksMinorToSign(db, locale, now) : false;
  // The language endonyms are shared with the public switcher.
  const tSite = await getTranslations("Site");

  const transitions = allowedTransitions(
    staffUser.role,
    event.editorialStatus,
    translations.some((translation) => translation.authorStaffUserId === staffUser.id),
  );
  const live = isLiveContent(event.editorialStatus);
  const slugLocked = event.publishedAt !== null;
  const incomplete = describeIncompleteLocales(translations);
  // The meeting point is the event's now, not each language's (`DECISIONS.md` §36).
  const missingOnEvent = missingPublicEventFields(event);
  const maySaveSettings = canEditEventFields(staffUser.role);
  const mayChangeSeries = canCreateEvent(staffUser.role);

  // Administrator only, and never in production; only where there is a queue to fill (§111).
  const mayFillTheQueue = canManageTestRegistrations(staffUser.role) && areTestRegistrationsAvailable() && internal;

  // "Anunță-mă" (§146): while the window is ahead, how many addresses wait for the announcement.
  const interestsWaiting =
    canManageRegistrations(staffUser.role) && upcomingRegistrationOpening(event, now) !== null ? await countInterests(db, event.id) : null;

  // The waiting list's length, for the queue and for the sentence under "Număr de locuri" (§147).
  const waiting = internal && (maySaveSettings || canReadRegistrations(staffUser.role)) ? await countEligibleWaitlisted(db, event.id) : 0;

  /*
    "Anunță participanții despre schimbare", and the cancellation's "tell them" (§331): how many
    would be emailed, said before the press, and what that costs against the plan (§100).
  */
  const noticeRecipients = maySaveSettings && internal ? await countEventNoticeRecipients(db, event.id) : { real: 0, test: 0 };
  const noticeVolume = noticeRecipients.real + noticeRecipients.test > 0 ? await readEmailVolumeToday(db, now) : null;
  const noticeMessages = noticeVolume ? String(noticeRecipients.real * (1 + noticeVolume.participantBccCount) + noticeRecipients.test) : "0";
  const noticeAllowance = !noticeVolume
    ? ""
    : noticeVolume.remaining === null
      ? t("editor.notice.allowanceNone", { plan: noticeVolume.planName })
      : t(noticeVolume.period === "day" ? "editor.notice.allowanceDay" : "editor.notice.allowanceMonth", {
          plan: noticeVolume.planName,
          remaining: String(noticeVolume.remaining),
        });
  const noticeTestNote = noticeRecipients.test > 0 ? ` ${t("editor.notice.countTest", { test: String(noticeRecipients.test) })}` : "";

  /*
    Who registered: the real ones mark the boxes a change reaches (§350; `AGENTS.md` §12.6 — a test
    row is counted nowhere the club looks), and the total decides whether Delete is offered (§170).
  */
  const registered = {
    total: await countRegistrationsForEvent(db, event.id),
    test: await countTestRegistrationsForEvent(db, event.id),
  };
  const realCount = registered.total - registered.test;
  const risk = await riskMark(realCount, locale);

  /** Romanian first, then English — `routing.locales` order, the order the club works in. */
  const orderedTranslations = routing.locales
    .map((contentLocale) => translations.find((row) => row.locale === contentLocale))
    .filter((row) => row !== undefined);

  const mayEditTranslation = (translation: (typeof translations)[number]) =>
    canEditTranslation(staffUser.role, { editorialStatus: event.editorialStatus, authorStaffUserId: translation.authorStaffUserId }, staffUser.id);
  const languages = orderedTranslations.map((translation) => ({
    translation,
    mayEdit: mayEditTranslation(translation),
    label: tSite(`languageName.${translation.locale as "ro" | "en"}`),
  }));
  const mayEditSomeText = languages.some((entry) => entry.mayEdit);
  const maySaveAnything = maySaveSettings || mayEditSomeText;

  // A standing series (§122): the rule on the source, and every date of it.
  const source = event.repeatOf ? ((await findEventForEditing(db, event.repeatOf))?.event ?? null) : event;
  const repeatRule = readRepeatRule(source?.repeatRule ?? null);
  const inSeries = event.repeatOf !== null || readRepeatRule(event.repeatRule) !== null;
  const seriesTitle = event.repeatOf ? await findEventTitle(db, event.repeatOf, locale) : null;
  const seriesDates = inSeries ? await listSeriesDates(db, event.repeatOf ?? event.id) : [];
  const usual = usualOf(seriesDates);
  /*
    Every date of the series as the site writes it (`src/i18n/dates.ts`, §350 weekday on every
    date): the short form with its time where it starts a line or a link — "Mie., 7 oct. 2026,
    18:30" — and in lower case inside the Salvare box's sentence, in the reader's language and
    each date's own zone. Rendered here and handed to the islands as strings (§324).
  */
  const dateLabel = (member: { startsAt: Date; timezone: string }) => summaryDateTime(member.startsAt, member.timezone, locale);
  const scopeDates: ScopeDate[] = await Promise.all(
    seriesDates.map(async (member) => ({
      id: member.id,
      href: getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: member.id } } }),
      label: dateLabel(member),
      day: summaryDate(member.startsAt, member.timezone, locale, "inline"),
      note: await editionNote(editionDifference(member, usual)),
    })),
  );
  const position = seriesDates.findIndex((member) => member.id === event.id);
  const ruleEnded = repeatRule?.until ? new Date(`${repeatRule.until}T23:59:59`).getTime() < now.getTime() : false;
  const ruleWords = repeatRule && source ? await ruleSentence(repeatRule, source, source.timezone, locale) : null;
  // A `date` column, read as the calendar day it names (no zone to move it), inside the rule's sentence.
  const untilWords = repeatRule?.until ? formatCalendarDay(repeatRule.until, { locale, style: "short", position: "inline" }) : null;
  const ruleLine = ruleWords
    ? untilWords
      ? t(ruleEnded ? "editor.repeatRuleEnded" : "editor.repeatRuleUntil", { sentence: ruleWords, until: untilWords })
      : t("editor.repeatRuleForever", { sentence: ruleWords })
    : null;
  // Midnight today on the event's own clock, not "24 hours ago": that would list yesterday
  // evening's run among the next dates.
  const startOfToday = fromWallTimeInput(`${toWallTimeInput(now, event.timezone).slice(0, 10)}T00:00`, event.timezone) ?? now;
  const upcoming = seriesDates
    .filter((member) => member.startsAt.getTime() >= startOfToday.getTime())
    .slice(0, 5)
    .map((member) => ({ id: member.id, label: dateLabel(member), current: member.id === event.id }));

  /*
    "Ce lipsește pentru publicare", in the words on the screen (§170, §350): each gap named by the
    box and the tab that hold it, and linked to the box itself.
  */
  const languageName = (code: string) => tSite(`languageName.${code as "ro" | "en"}`);
  const gapLines = [
    ...incomplete.flatMap((entry) =>
      entry.missing.map((field) => {
        if (field === "slug") return { label: `${t("editor.boxes.address.title")} › ${languageName(entry.locale)} › ${t("editor.fields.slug")}`, name: `translations.${entry.locale}.slug` };
        if (field === "excerpt") return { label: `${t("editor.boxes.titleSummary.title")} › ${languageName(entry.locale)} › ${t("editor.boxes.summaryLabel")}`, name: `translations.${entry.locale}.excerptBody` };
        if (field === "title") return { label: `${t("editor.boxes.titleSummary.title")} › ${languageName(entry.locale)} › ${t("editor.fields.title")}`, name: `translations.${entry.locale}.title` };
        return { label: `${t("editor.boxes.titleSummary.title")} › ${languageName(entry.locale)} › ${t("editor.tabMissing")}`, name: `translations.${entry.locale}.title` };
      }),
    ),
    ...missingOnEvent.map(() => ({ label: `${t("editor.boxes.place.title")} › ${t("editor.fields.locationName")}`, name: "event.locationName" })),
  ];
  const missingDetail = gapLines.map((line) => line.label).join(" · ");
  /*
    And what publication does not refuse but a reader would notice (§354, bilingual everywhere):
    a long text whose English says the Romanian word for word — the English "Happy Monday" date
    carries the Romanian description today. Read from what is stored, like the gaps above; the
    boxes themselves re-read it as it is typed.
  */
  const identicalInEvent = identicalTexts(storedTextReader(orderedTranslations, readCoHosts(event)), routing.locales);
  const identicalLabels = identicalInEvent.length > 0 ? await identicalTextLabels() : null;

  // The words the save form's refusal summary needs, and the label of every box it can name.
  const refusal = await refusalMessages(await eventFormFieldLabels());

  // Keyed on the dates, so a series made a moment ago on this same page opens with its ticks.
  const seriesKey = scopeDates.map((date) => date.id).join(",");

  const noticeLabels = {
    notify: t("editor.notice.notify"),
    notifyHelp:
      noticeRecipients.real + noticeRecipients.test === 0
        ? t("editor.notice.countNone")
        : `${t("editor.notice.count", { count: String(noticeRecipients.real), messages: noticeMessages, allowance: noticeAllowance })}${noticeTestNote}${inSeries ? ` ${t("editor.notice.countSeries")}` : ""}`,
    note: t("editor.notice.note"),
    noteHelp: t("editor.notice.noteHelp", { max: String(EVENT_NOTICE_TEXT_MAX) }),
    cancelTitle: t("editor.notice.cancelTitle"),
    cancelIntro: t("editor.notice.cancelIntro"),
    cancelReason: t("editor.notice.cancelReason"),
    cancelReasonHelp: t("editor.notice.cancelReasonHelp", { max: String(EVENT_NOTICE_TEXT_MAX) }),
    cancelNotify: t("editor.notice.cancelNotify"),
    cancelNotifyHelp:
      noticeRecipients.real + noticeRecipients.test === 0
        ? t("editor.notice.cancelCountNone")
        : `${t("editor.notice.cancelCount", { count: String(noticeRecipients.real), messages: noticeMessages, allowance: noticeAllowance })}${noticeTestNote}`,
    // The note and the reason are written in both languages (§354, bilingual everywhere), each box
    // named in its own language like every Română | English tab on this page.
    languageRo: tSite("languageName.ro"),
    languageEn: tSite("languageName.en"),
    identical: t("editor.identical.warning"),
  };
  const notice = { labels: noticeLabels, offerNotice: internal, maxLength: EVENT_NOTICE_TEXT_MAX };
  const box = { event, mayEditSettings: maySaveSettings } as const;
  const heading = orderedTranslations[0]?.title || t("editor.untitled");
  const thanksDue = canManageRegistrations(staffUser.role) && internal && event.eventStatus !== "CANCELLED" && event.startsAt.getTime() <= now.getTime();

  return (
    <SeriesScopeProvider key={seriesKey} dates={scopeDates} currentId={event.id}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="body2">
            <Link href="/admin">{t("backToEvents")}</Link>
          </Typography>
        </Box>

        {/* The event's own name, then what it is right now (§350). */}
        <Box>
          <Typography variant="h2" sx={{ fontSize: "1.35rem", mb: 1 }} data-testid="editor-heading">
            {heading}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            <Chip size="small" label={EDITORIAL_STATUS_LABEL[event.editorialStatus]} />
            <Chip size="small" variant="outlined" label={t("editor.version", { version: event.version })} />
            {inSeries && position >= 0 && (
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={t("editor.series.headerChip", { position: String(position + 1), count: String(seriesDates.length), title: seriesTitle ?? heading })}
              />
            )}
          </Stack>
        </Box>

        <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
          {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
          {saved === "bibsAssigned" && (
            /* Nothing assigned is an answer too (§286). */
            <Alert severity={assigned === "0" ? "info" : "success"}>
              {assigned === "0"
                ? t("bibs.assignedNone", { notConfirmed: notConfirmed ?? "0", test: test ?? "0" })
                : t("bibs.assigned", { assigned: assigned ?? "0", total: total ?? "0" })}
            </Alert>
          )}
          {saved === "created" && created && !notPublished && <Alert severity="success">{t("editor.createdWithSeries", { dates: datesWords(created) })}</Alert>}
          {/* Created and published in one press (§315), the series with it when there is one. */}
          {saved === "createdPublished" && (
            <Alert severity="success">{created ? t("editor.createdPublishedWithSeries", { dates: datesWords(created) }) : t("editor.createdPublished")}</Alert>
          )}
          {/* Created, but the second button could not publish: the draft stands, and this says
              exactly what it still needs, in the Publicare box's words. */}
          {saved === "created" && notPublished && (
            <Alert severity="warning" data-testid="created-not-published">
              {notPublished === "FORBIDDEN"
                ? t("editor.createdNotPublishedRole")
                : missingDetail
                  ? t("editor.createdNotPublished", { detail: missingDetail })
                  : t("editor.createdNotPublishedOther", { reason: t(`errors.${notPublished}`) })}
              {created ? ` ${t("editor.createdWithSeries", { dates: datesWords(created) })}` : ""}
            </Alert>
          )}
          {saved === "eventsRepeated" && (
            <Alert severity="success">
              {t(countOf(created) === 1 ? "events.eventsRepeatedOne" : "events.eventsRepeatedMany", {
                dates: datesWords(created),
                until: formatDay(new Date(now.getTime() + HORIZON_DAYS * 86_400_000), { locale, timeZone: event.timezone, style: "short", position: "inline" }),
              })}
            </Alert>
          )}
          {saved === "repeatStopped" && <Alert severity="success">{t("editor.repeatStopped")}</Alert>}
          {saved === "repeatPublishOn" && <Alert severity="success">{t("editor.repeatPublishStarted")}</Alert>}
          {saved === "repeatPublishOff" && <Alert severity="success">{t("editor.repeatPublishStopped")}</Alert>}
          {saved === "interestRemoved" && <Alert severity="success">{t("queue.interestRemoved")}</Alert>}
          {saved === "interestNotFound" && <Alert severity="info">{t("queue.interestNotFound")}</Alert>}
          {saved === "eventSeries" && (
            <Alert severity="success">
              {offered
                ? t(countOf(applied) === 1 ? "editor.savedSeriesOfferedOne" : "editor.savedSeriesOfferedMany", { dates: datesWords(applied), offered })
                : t(countOf(applied) === 1 ? "editor.savedSeriesOne" : "editor.savedSeriesMany", { dates: datesWords(applied) })}
            </Alert>
          )}
          {saved === "event" && offered && <Alert severity="success">{t("editor.savedOffered", { offered })}</Alert>}
          {/* A batch of test rows that met the waiting list's limit part-way (§350, the waiting-list
              cap): how many went in, and that the rest were refused as a real registration would be.
              A counted phrase — "1 înscriere", "19 înscrieri", "20 de înscrieri". */}
          {saved === "testRegistrationsStopped" && (
            <Alert severity="info">{t(`testRegistrations.stoppedAtLimit.${countForm(stoppedCount, locale)}`, { created: stoppedCount })}</Alert>
          )}
          {/* What the save told the participants (§331), under whichever banner the save gave. */}
          {noticeOutcome && (
            <Alert severity={noticeOutcome === "none" || noticeOutcome === "cancelledQuiet" ? "info" : "success"} sx={{ mt: 1 }} data-testid="notice-outcome">
              {t(`editor.notice.outcome.${noticeOutcome}`, { queued: queuedCount })}
            </Alert>
          )}
          {saved &&
            !["bibsAssigned", "eventsRepeated", "repeatStopped", "repeatPublishOn", "repeatPublishOff", "eventSeries", "interestRemoved", "interestNotFound", "createdPublished", "testRegistrationsStopped"].includes(saved) &&
            !(saved === "created" && (created || notPublished)) &&
            !(saved === "event" && offered) && <Alert severity="success">{t("saved")}</Alert>}
          {/* The save that announced the place (§328): public from now on, and nobody was told. */}
          {announced === "1" && (saved === "event" || saved === "eventSeries") && (
            <Alert severity="info" data-testid="place-announced">
              {live ? t("editor.placeAnnouncedLive") : t("editor.placeAnnouncedDraft")}
            </Alert>
          )}
        </Box>

        <EventEditorLayout
          side={
            <>
              {/* S1 — open: the state is the first thing checked (§170). Its own forms: a transition
                  is not an edit, and it carries only the event's version. */}
              {/* The state and the version are the chips under the page's heading, once: a second
                  copy here was two answers to one question on a phone's first screen. */}
              <Panel collapsible openWhen={{ primary: true }} id="box-publication" title={t("editor.publicationSection")}>
                <Stack spacing={1.5}>
                  {live && <Alert severity="warning">{t("editor.liveWarning")}</Alert>}
                  {gapLines.length > 0 && (
                    <Box data-testid="missing-for-publish">
                      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }}>
                        {t("editor.publication.missingTitle")}
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {gapLines.map((line) => (
                          <li key={`${line.name}-${line.label}`}>
                            <RevealLink name={line.name}>{line.label}</RevealLink>
                          </li>
                        ))}
                      </Box>
                    </Box>
                  )}
                  {identicalLabels && <IdenticalTextsList items={identicalInEvent} labels={identicalLabels} title={t("editor.identical.listTitle")} />}
                  {/* The previews, each language in its own locale, with the version it shows. */}
                  <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1.5, alignItems: "center" }}>
                    <Typography variant="body2" color="text.secondary">
                      {t("editor.publication.preview")}
                    </Typography>
                    {orderedTranslations.map((translation) => (
                      <Link
                        key={translation.id}
                        locale={translation.locale as "ro" | "en"}
                        href={{ pathname: "/preview/events/[id]", params: { id: event.id } }}
                        style={{ display: "inline-block", padding: "10px 0" }}
                      >
                        {languageName(translation.locale)} ({t("editor.version", { version: translation.version })})
                      </Link>
                    ))}
                  </Stack>
                  {transitions.length > 0 ? (
                    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                      {transitions.map((to) => (
                        <form action={transitionEventAction} key={to}>
                          <input type="hidden" name="uiLocale" value={locale} />
                          <input type="hidden" name="eventId" value={event.id} />
                          <input type="hidden" name="expectedVersion" value={event.version} />
                          <input type="hidden" name="to" value={to} />
                          {/* Archiving takes the event off the site in both languages; it asks first. */}
                          {to === "ARCHIVED" ? (
                            <ConfirmSubmitButton
                              label={EDITORIAL_TRANSITION_LABEL[to]}
                              icon={EDITORIAL_TRANSITION_ICON[to]}
                              title={t("confirm.archiveTitle")}
                              body={t("confirm.archiveBody")}
                              confirmLabel={EDITORIAL_TRANSITION_LABEL[to]}
                              cancelLabel={t("confirm.cancel")}
                            />
                          ) : (
                            <GlyphButton icon={EDITORIAL_TRANSITION_ICON[to]} type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                              {EDITORIAL_TRANSITION_LABEL[to]}
                            </GlyphButton>
                          )}
                        </form>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("editor.publication.adminOnly")}
                    </Typography>
                  )}
                </Stack>
              </Panel>

              {/* S2 — Recurență: the series' whole story from any of its dates, or the form that
                  starts one. */}
              {inSeries ? (
                <RecurrenceSeriesPanel
                  locale={locale}
                  eventId={event.id}
                  sourceId={event.repeatOf ?? event.id}
                  seriesTitle={seriesTitle ?? heading}
                  position={position + 1}
                  count={seriesDates.length}
                  previous={position > 0 ? { id: seriesDates[position - 1].id, label: dateLabel(seriesDates[position - 1]) } : null}
                  next={position >= 0 && position < seriesDates.length - 1 ? { id: seriesDates[position + 1].id, label: dateLabel(seriesDates[position + 1]) } : null}
                  ruleSentence={ruleLine}
                  publish={repeatRule?.publish ?? false}
                  sourceLive={source ? isLiveContent(source.editorialStatus) : false}
                  ended={ruleEnded}
                  upcoming={upcoming}
                  lastCreated={seriesDates.length > 0 ? dateLabel(seriesDates[seriesDates.length - 1]) : null}
                  mayChange={mayChangeSeries}
                  actions={{ setRepeatPublish: setRepeatPublishAction, stopRepeat: stopRepeatAction }}
                />
              ) : (
                <Panel collapsible id="box-recurrence" title={t("editor.boxes.recurrence.title")} aside={t("editor.boxes.recurrence.none")}>
                  <Stack spacing={1.5}>
                    {mayChangeSeries ? (
                      /* A refused rule — an end before the event — comes back as it was chosen (§315). */
                      <ActionForm
                        action={repeatEventAction}
                        messages={await refusalMessages({
                          repeatOn: t("editor.repeatOn"),
                          cadence: t("editor.repeatCadence"),
                          until: t("editor.repeatUntil"),
                          weekday: t("editor.repeatWeekdays"),
                        })}
                        scope="repeat"
                        data-testid="repeat-form"
                      >
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <RepeatToggle name="repeatOn" label={t("editor.repeatOn")}>
                          <RepeatFields
                            ownWeekday={wallClockWeekday(event.startsAt, event.timezone)}
                            startTime={toWallTimeInput(event.startsAt, event.timezone).slice(11, 16)}
                            draftSource={!live}
                          />
                          <Box sx={{ mt: 2 }}>
                            <ConfirmSubmitButton
                              label={t("editor.repeat")}
                              icon="repeat"
                              title={t("confirm.repeatTitle")}
                              body={t("confirm.repeatBody")}
                              confirmLabel={t("editor.repeat")}
                              cancelLabel={t("confirm.cancel")}
                            />
                          </Box>
                        </RepeatToggle>
                      </ActionForm>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {t("editor.repeatAdminOnly")}
                      </Typography>
                    )}
                    <Panel collapsible level={3} title={t("editor.repeatHelpSummary")}>
                      <Typography variant="body2" color="text.secondary">
                        {t("editor.repeatHelp")}
                      </Typography>
                    </Panel>
                  </Stack>
                </Panel>
              )}
            </>
          }
          main={
            <>
              {/* Settings and texts: one form, one save — and a refusal that keeps every box (§315). */}
              <ActionForm action={saveEventAndTranslationsAction} messages={refusal} id="event-save-form" data-testid="event-save-form">
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                {/* The event row's version — and its presence is the signal that this save touches the
                    row at all: a role without settings rights posts none, and the service writes no
                    event row. Recalled after a refusal, never re-read (§315). */}
                {maySaveSettings && <RecallHidden name="event.expectedVersion" value={event.version} />}
                {/* Every language the reader may write: its row and the version it was drawn from. */}
                {languages.filter((entry) => entry.mayEdit).map((entry) => (
                  <TranslationHiddenFields key={entry.translation.locale} translation={entry.translation} />
                ))}

                <Stack spacing={2}>
                  <EditorGroup label={t("editor.groups.event")} />
                  {/* 1 — the type, and inside it the three cards about the event itself (§358):
                      1.1 the status, 1.2 the course, 1.3 the links and files. */}
                  <KindBox {...box} risk={risk} registered={realCount} locale={locale}>
                    <StatusBox {...box} risk={risk} notice={notice} />
                    <CourseBox {...box} />
                    <LinksBox {...box} locale={locale} />
                  </KindBox>
                  <TitleSummaryBox languages={languages} creating={false} />
                  <DescriptionBox languages={languages} />

                  <EditorGroup label={t("editor.groups.day")} />
                  <WhenBox {...box} risk={risk} inSeries={inSeries} />
                  <PlaceBox {...box} risk={risk} languages={languages} />
                  <ProgrammeBox {...box} risk={risk} languages={languages} />
                  <RulesBox languages={languages} />
                  <RegistrationBox
                    {...box}
                    risk={risk}
                    declarations={declarations}
                    waiting={waiting}
                    bibCounts={bibCounts}
                    locale={locale}
                    now={now}
                    bibPrint={
                      bibCounts ? (
                        <BibPrintCard
                          eventId={event.id}
                          total={bibCounts.total}
                          unprinted={bibCounts.unprinted}
                          mayAssign={canManageRegistrations(staffUser.role)}
                          onlyTest={registered.total > 0 && registered.test === registered.total}
                          attention={bibCounts.unprinted > 0 && event.startsAt.getTime() - now.getTime() <= 7 * 86_400_000 && event.startsAt.getTime() >= now.getTime()}
                        />
                      ) : null
                    }
                  />

                  <EditorGroup label={t("editor.groups.details")} />
                  <CoHostsBox {...box} locale={locale} />
                  <PromotionBox {...box} />
                  <AddressBox languages={languages} slugLocked={slugLocked} creating={false} />

                  {/* 15 — always open: which dates, who is told, the live tick, and the one button.
                      A required tick in a closed box would be a Save that silently does nothing. */}
                  {maySaveAnything && (
                    <Panel static id="box-save" title={t("editor.boxes.save.title")}>
                      <Stack spacing={2}>
                        {/* What this save covers, for the role whose save covers half the form. */}
                        {maySaveSettings && !mayEditSomeText && (
                          <Typography variant="body2" color="text.secondary">
                            {t("editor.saveCoversSettingsOnly")}
                          </Typography>
                        )}
                        {/* A date of a series: which dates, in words, "this and the following" first. */}
                        {inSeries && maySaveSettings && <SeriesScopeBox locale={locale} />}
                        {/* Whether the participants hear about this save (§331), with the count. */}
                        {maySaveSettings && (
                          <EventNoticeUpdateFields
                            statusSelectName="event.eventStatus"
                            initialStatus={event.eventStatus}
                            wasCancelled={event.eventStatus === "CANCELLED"}
                            offerNotice={internal}
                            maxLength={EVENT_NOTICE_TEXT_MAX}
                            labels={noticeLabels}
                          />
                        )}
                        {/* BR-REQ-051-01 criterion 4: required, the last thing above the button. */}
                        {live && (
                          <CheckboxField name="acknowledgeLiveEdit" required>
                            {t("editor.acknowledgeLive")}
                          </CheckboxField>
                        )}
                        {/* Only the button is sticky while the long form scrolls, above the footer's bar. */}
                        <Box
                          sx={{
                            position: "sticky",
                            bottom: 44,
                            zIndex: 2,
                            bgcolor: "background.paper",
                            py: 1,
                            borderTop: 1,
                            borderColor: "divider",
                          }}
                        >
                          <GlyphSubmitButton
                            label={t("editor.save")}
                            pendingLabel={t("editor.saving")}
                            icon="save"
                            incompleteHint={live ? t("editor.acknowledgeLiveHint") : undefined}
                            incompleteHintNamed={t("forms.incompleteFirst")}
                            size="medium"
                          />
                        </Box>
                      </Stack>
                    </Panel>
                  )}
                </Stack>
              </ActionForm>
              {/* The bib card's two immediate actions post these, never the save above. */}
              {bibCounts && <BibPrintForms eventId={event.id} locale={locale} mayAssign={canManageRegistrations(staffUser.role)} assignAction={assignBibNumbersAction} />}
            </>
          }
          below={
            <Stack spacing={2}>
              {/* 16 — who registered, and what to do with them now: operations, never "Salvează".
                  Organizer and up read (§289); the verbs inside ask for the Administrator. */}
              {canReadRegistrations(staffUser.role) && internal && (
                <>
                  <EditorGroup label={t("editor.immediateActions")} />
                  <Panel
                    collapsible
                    id="box-received"
                    title={t("editor.boxes.received.title")}
                    aside={t("editor.boxes.received.summary", { count: realCount, waiting })}
                    openWhen={{ attention: thanksDue && !event.thanksSentAt }}
                  >
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
                        {canManageRegistrations(staffUser.role) && (
                          <GlyphButton icon="addPerson" href={`${getPathname({ locale, href: "/admin/registrations/new" })}?eventId=${event.id}`} variant="outlined" size="small" sx={{ minHeight: 44 }}>
                            {t("registrations.new")}
                          </GlyphButton>
                        )}
                        <GlyphButton icon="registrations" href={`${getPathname({ locale, href: "/admin/registrations" })}?eventId=${event.id}`} variant="text" size="small" sx={{ minHeight: 44 }}>
                          {t("registrations.viewForEvent")}
                        </GlyphButton>
                        {/* The emergency sheet (§322): the Organizer is the one on the course with it. */}
                        <GlyphButton
                          icon="emergency"
                          href={getPathname({ locale, href: { pathname: "/admin/events/[id]/urgente", params: { id: event.id } } })}
                          variant="text"
                          size="small"
                          sx={{ minHeight: 44 }}
                        >
                          {t("events.emergencySheet")}
                        </GlyphButton>
                        <GlyphButton icon="pdf" href={`/api/admin/events/${event.id}/declarations?locale=${locale}`} variant="text" size="small" sx={{ minHeight: 44 }}>
                          {t("registrations.declarationsPdf")}
                        </GlyphButton>
                        <GlyphButton icon="print" href={`/api/admin/events/${event.id}/declaration-form?locale=${locale}`} variant="text" size="small" sx={{ minHeight: 44 }}>
                          {t("registrations.declarationForm")}
                        </GlyphButton>
                        {minorFormOffered && (
                          <GlyphButton icon="print" href={`/api/admin/events/${event.id}/declaration-form?locale=${locale}&for=minor`} variant="text" size="small" sx={{ minHeight: 44 }}>
                            {t("registrations.declarationFormMinor")}
                          </GlyphButton>
                        )}
                        {/* The desk for this event (BR-REQ-037-08): where race morning happens. */}
                        <GlyphButton icon="desk" href={`${getPathname({ locale, href: "/admin/checkin" })}?eventId=${event.id}`} variant="text" size="small" sx={{ minHeight: 44 }}>
                          {t("desk.title")}
                        </GlyphButton>
                      </Stack>

                      {/* 16.1 — the queue as the allocator sees it, and the waiting list in its order (§92). */}
                      <Panel collapsible level={3} id="box-queue" title={t("editor.boxes.queue.title")} aside={waiting > 0 ? t("editor.boxes.queue.waiting", { waiting }) : undefined}>
                        <QueuePanel db={db} event={{ id: event.id, capacity: event.capacity, waitlistCapacity: event.waitlistCapacity }} waiting={waiting} now={now} />
                        {interestsWaiting !== null && (
                          <Box sx={{ mt: 3 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {t("queue.interestTitle", { count: interestsWaiting })}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                              {t("queue.interestHelp")}
                            </Typography>
                            {/* An address the service refuses comes back in its box (§315). */}
                            <ActionForm action={withdrawInterestAction} messages={await refusalMessages({ email: t("queue.interestEmail") })} scope="interest" data-testid="interest-withdraw-form">
                              <input type="hidden" name="uiLocale" value={locale} />
                              <input type="hidden" name="eventId" value={event.id} />
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                                <RecallField name="email" type="email" label={t("queue.interestEmail")} required size="small" sx={{ minWidth: 260 }} />
                                <GlyphButton icon="delete" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                                  {t("queue.interestRemove")}
                                </GlyphButton>
                              </Stack>
                            </ActionForm>
                          </Box>
                        )}
                      </Panel>

                      {/* 16.2 — the thank-you after the race (§82): once, by hand, after the start. */}
                      {thanksDue && (
                        <Panel collapsible level={3} id="box-thanks" title={t("editor.boxes.thanks.title")} openWhen={{ attention: !event.thanksSentAt }}>
                          {event.thanksSentAt ? (
                            <Typography variant="body2" color="text.secondary">
                              {t("thanks.sentOn", { date: formatDay(event.thanksSentAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) })}
                            </Typography>
                          ) : (
                            // A refused link comes back in its box (§315).
                            <ActionForm action={sendEventThanksAction} messages={await refusalMessages({ url: t("thanks.url") })} scope="thanks" data-testid="thanks-form">
                              <input type="hidden" name="uiLocale" value={locale} />
                              <input type="hidden" name="eventId" value={event.id} />
                              <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
                                <Typography variant="body2" color="text.secondary">
                                  {t("thanks.help")}
                                </Typography>
                                <RecallField
                                  name="url"
                                  type="url"
                                  label={t("thanks.url")}
                                  helperText={t("thanks.urlHelp")}
                                  size="small"
                                  slotProps={{ htmlInput: { pattern: "[Hh][Tt][Tt][Pp][Ss]://.*", maxLength: 2048 } }}
                                />
                                <Box>
                                  <ConfirmSubmitButton
                                    label={t("thanks.send")}
                                    icon="send"
                                    title={t("thanks.confirmTitle")}
                                    body={t("thanks.confirmBody")}
                                    confirmLabel={t("thanks.send")}
                                    cancelLabel={t("confirm.cancel")}
                                    variant="contained"
                                  />
                                </Box>
                              </Stack>
                            </ActionForm>
                          )}
                        </Panel>
                      )}

                      {/* 16.3 — test registrations: Administrator, never in production (§30). */}
                      {mayFillTheQueue && (
                        <Panel collapsible level={3} id="box-test-registrations" title={t("editor.boxes.testRegs.title")} aside={registered.test > 0 ? String(registered.test) : undefined}>
                          <Alert severity="info" sx={{ mb: 2 }}>
                            {t("testRegistrations.explanation")}
                          </Alert>
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
                            {/* The service's bounds as the browser's, and a refused count back in its box (§315). */}
                            <ActionForm action={addTestRegistrationsAction} messages={await refusalMessages({ count: t("testRegistrations.count") })} scope="test" data-testid="test-registrations-form">
                              <input type="hidden" name="uiLocale" value={locale} />
                              <input type="hidden" name="eventId" value={event.id} />
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                <RecallField
                                  name="count"
                                  label={t("testRegistrations.count")}
                                  defaultValue="3"
                                  type="number"
                                  required
                                  size="small"
                                  slotProps={{ htmlInput: { min: 1, max: MAX_TEST_REGISTRATIONS_PER_BATCH, step: 1, inputMode: "numeric" } }}
                                  sx={{ width: 120 }}
                                />
                                <GlyphButton icon="add" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                                  {t("testRegistrations.add")}
                                </GlyphButton>
                              </Stack>
                            </ActionForm>
                            <form action={removeTestRegistrationsAction}>
                              <input type="hidden" name="uiLocale" value={locale} />
                              <input type="hidden" name="eventId" value={event.id} />
                              <ConfirmSubmitButton
                                label={t("testRegistrations.remove")}
                                icon="delete"
                                title={t("confirm.removeTestTitle")}
                                body={t("confirm.removeTestBody")}
                                confirmLabel={t("testRegistrations.remove")}
                                cancelLabel={t("confirm.cancel")}
                                color="warning"
                              />
                            </form>
                          </Stack>
                        </Panel>
                      )}
                    </Stack>
                  </Panel>
                </>
              )}

              {/* 17 — commands, not edits: their own forms, outside the save; Administrator and up. */}
              {(mayChangeSeries || canDeleteEvent(staffUser.role)) && (
                <Panel collapsible tone="danger" id="box-copy-delete" title={t("editor.boxes.copyDelete.title")} aside={t("editor.boxes.copyDelete.summary")}>
                  <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
                    {mayChangeSeries && (
                      <form action={duplicateEventAction}>
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <ConfirmSubmitButton
                          label={t("editor.duplicate")}
                          icon="duplicate"
                          title={t("confirm.duplicateTitle")}
                          body={t("confirm.duplicateBody")}
                          confirmLabel={t("editor.duplicate")}
                          cancelLabel={t("confirm.cancel")}
                        />
                      </form>
                    )}
                    {/* Deletion is refused for any event with a registration: the count replaces the
                        button (§170), and archiving is the answer for an event that happened. */}
                    {canDeleteEvent(staffUser.role) &&
                      (registered.total > 0 ? (
                        <Alert severity="info" sx={{ flex: "1 1 320px" }}>
                          {registered.test === registered.total
                            ? t("editor.deleteBlockedByTest", { count: registered.total })
                            : t("events.deleteBlocked", { count: registered.total })}
                        </Alert>
                      ) : (
                        <form action={deleteEventAction}>
                          <input type="hidden" name="uiLocale" value={locale} />
                          <input type="hidden" name="eventId" value={event.id} />
                          <ConfirmSubmitButton
                            label={t("editor.delete")}
                            icon="delete"
                            title={t("confirm.deleteTitle")}
                            body={t("confirm.deleteBody")}
                            confirmLabel={t("editor.delete")}
                            cancelLabel={t("confirm.cancel")}
                            color="error"
                          />
                        </form>
                      ))}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t("editor.deleteHelp")}
                  </Typography>
                </Panel>
              )}
            </Stack>
          }
        />
      </Stack>
    </SeriesScopeProvider>
  );
}
