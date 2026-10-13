import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { FIELD_LABELS } from "@/modules/content/events/transfer/diff";
import { MAX_EVENT_FILE_BYTES } from "@/modules/content/events/transfer/file-format";
import { MEDIA_ROLE_KEYS } from "@/modules/content/events/transfer/media";
import EventImportPanel, { type EventImportWords } from "@/modules/content/events/transfer/ui/EventImportPanel";
import { canTransferEvents } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";
/** The Server Actions this page calls fetch, check and store a handful of pictures; the platform's ten seconds are not enough (the pictures' upload routes ask the same). */
export const maxDuration = 60;

const FORMS = ["one", "few", "other"] as const;

/**
 * «Importă un eveniment (JSON)» (§751): a file made with «Exportă evenimentul (JSON)» in the editor,
 * brought in as a new draft or written over an existing event after its diff.
 *
 * The Administrator's, as the services behind it assert (`canTransferEvents`); a role that may not is
 * shown the same 404 an unknown page gets, the courtesy half of a rule the server holds. Every word
 * the island says is rendered here in the reader's language and handed down as strings, the way the
 * route GPX field gets its own — there is nothing for the client's catalogue to carry.
 */
export default async function ImportEventPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  if (!canTransferEvents(staffUser.role)) notFound();

  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");

  /** The three forms of a counted phrase, raw: the island fills `{count}` itself. */
  const counted = (key: string) => Object.fromEntries(FORMS.map((form) => [form, t.raw(`${key}.${form}`) as string])) as Record<(typeof FORMS)[number], string>;
  const raw = (key: string) => t.raw(key) as string;

  const words: EventImportWords = {
    choose: t("eventJson.choose"),
    chooseAgain: t("eventJson.chooseAgain"),
    chooseHelp: t("eventJson.chooseHelp", { size: Math.round(MAX_EVENT_FILE_BYTES / 1000) }),
    reading: t("eventJson.reading"),
    failed: t("eventJson.failed"),
    summaryHeading: t("eventJson.summary.heading"),
    summaryFrom: raw("eventJson.summary.from"),
    summaryWhen: raw("eventJson.summary.when"),
    summaryWhenNone: t("eventJson.summary.whenNone"),
    summaryMedia: counted("eventJson.summary.media"),
    summarySeries: t("eventJson.summary.series"),
    modeHeading: t("eventJson.mode.heading"),
    asNewTitle: t("eventJson.asNew.title"),
    asNewHelp: t("eventJson.asNew.help"),
    asNewSlugs: raw("eventJson.asNew.slugs"),
    asNewSuffixed: t("eventJson.asNew.suffixed"),
    asNewAction: t("eventJson.asNew.action"),
    asNewWorking: t("eventJson.asNew.working"),
    asNewDone: t("eventJson.asNew.done"),
    overTitle: t("eventJson.over.title"),
    overHelp: t("eventJson.over.help"),
    overPick: t("eventJson.over.pick"),
    overPickNone: t("eventJson.over.pickNone"),
    overOption: raw("eventJson.over.option"),
    overStatus: Object.fromEntries((["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const).map((status) => [status, t(`eventJson.over.status.${status}`)])),
    overRegistrations: counted("eventJson.over.registrations"),
    overDiffHeading: raw("eventJson.over.diffHeading"),
    overNothing: t("eventJson.over.nothing"),
    overNow: t("eventJson.over.now"),
    overIncoming: t("eventJson.over.incoming"),
    overSlugsKept: t("eventJson.over.slugsKept"),
    overMediaHeading: t("eventJson.over.mediaHeading"),
    overMediaState: { same: t("eventJson.over.media.same"), copy: t("eventJson.over.media.copy"), unverifiable: t("eventJson.over.media.unverifiable") },
    overPublished: t("eventJson.over.published"),
    overPeople: raw("eventJson.over.people"),
    overConfirm: t("eventJson.over.confirm"),
    overProductionHeading: t("eventJson.over.production.heading"),
    overProductionBody: raw("eventJson.over.production.body"),
    overProductionLabel: t("eventJson.over.production.label"),
    overAction: t("eventJson.over.action"),
    overWorking: t("eventJson.over.working"),
    overDone: counted("eventJson.over.done"),
    overOffered: raw("eventJson.over.offered"),
    open: t("eventJson.open"),
    mediaProblemsHeading: t("eventJson.problems.heading"),
    mediaProblems: {
      refused: t("eventJson.problems.refused"),
      unverifiable: t("eventJson.problems.unverifiable"),
      unreachable: t("eventJson.problems.unreachable"),
      tooLarge: t("eventJson.problems.tooLarge"),
      sizeMismatch: t("eventJson.problems.sizeMismatch"),
      hashMismatch: t("eventJson.problems.hashMismatch"),
      notAPicture: t("eventJson.problems.notAPicture"),
      noStorage: t("eventJson.problems.noStorage"),
    },
    notes: { slugSuffixed: raw("eventJson.notes.slugSuffixed"), publicListOff: t("eventJson.notes.publicListOff"), seriesNotApplied: t("eventJson.notes.seriesNotApplied") },
    languages: { ro: tSite("languageName.ro"), en: tSite("languageName.en") },
    roles: Object.fromEntries(MEDIA_ROLE_KEYS.map((role) => [role, t(`eventJson.roles.${role}`)])),
    fields: Object.fromEntries(FIELD_LABELS.map((label) => [label, t(`eventJson.fields.${label}`)])),
    errors: Object.fromEntries(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "UNAUTHENTICATED"].map((code) => [code, t(`errors.${code}`)])),
    refusals: Object.fromEntries((["tooLarge", "notJson", "notAnEventFile", "unknownVersion", "invalid"] as const).map((refusal) => [refusal, t(`eventJson.refusals.${refusal}`)])),
    values: {
      empty: t("eventJson.values.empty"),
      yes: t("eventJson.values.yes"),
      no: t("eventJson.values.no"),
      picture: t("eventJson.values.picture"),
      pictureLoose: t("eventJson.values.pictureLoose"),
      pictures: counted("eventJson.values.pictures"),
    },
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Typography variant="body2">
        <Link href="/admin">{t("eventJson.back")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("eventJson.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("eventJson.intro")}
      </Typography>
      <EventImportPanel locale={locale} production={env.APP_ENV === "production"} maxBytes={MAX_EVENT_FILE_BYTES} words={words} />
    </Stack>
  );
}
