import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import DrawIcon from "@mui/icons-material/Draw";
import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import GavelIcon from "@mui/icons-material/Gavel";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { type Deadlines, reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, deadlineWords, leadPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines, cachedFamilyRegistrationOpen, cachedRefusalDisclosed } from "@/modules/public-cache/reads";
import { confirmationDueAtStart, confirmationDueWords } from "@/modules/registrations/domain/hold-deadlines";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { StepItem, StepList } from "@/shared/ui/StepList";

const STEPS = [
  { key: "form", Icon: PersonAddIcon },
  { key: "email", Icon: MarkEmailReadIcon },
  { key: "declaration", Icon: DrawIcon },
  { key: "confirmed", Icon: QrCode2Icon },
  { key: "raceDay", Icon: ConfirmationNumberIcon },
] as const;

/**
 * How registering works, in five steps and one aside about the waiting list — on the form
 * and, folded, on the event page (`DECISIONS.md` §91; the owner: "it must be super clear for
 * users what the flow is").
 *
 * The numbers are the club's own deadlines (§377) — the very values the allocator gives a new
 * hold or offer, read from the data cache so a visitor wakes no database (§333) — so this can never
 * promise a deadline the allocator does not keep, and they are words that agree with the number
 * ("30 de minute", "o oră"). Each step has a glyph, because the same five appear in the emails and
 * at the desk and a reader should recognise where they are.
 */
type Props = {
  folded?: boolean;
  /**
   * The event's participation window (§104), when it has one that is still ahead: the third
   * step then says "confirm a week before" rather than "sign within thirty minutes".
   */
  window?: { opensDays: number; deadlineDays: number } | null;
  /**
   * The event's own reminder lead (`events.reminder_hours_before`, §377): null is the club's, zero
   * is none — then the fourth step promises no reminder.
   */
  reminderHoursBefore?: number | null;
  /**
   * The club's deadlines and whether the family flow is on, read by the caller — the editor's
   * preview before saving (§579), which reads them from the database and never through the public
   * cache. Absent everywhere a visitor reads: the data cache's, as above.
   */
  settings?: RegistrationStepsSettings;
};

/**
 * What the editor's preview reads from the database for the steps (§579): the club's deadlines,
 * whether the family flow is on, and whether the terms in force carry the club's right to refuse a
 * registration (§636, `termsDescribeRefusal`).
 */
export type RegistrationStepsSettings = { deadlines: Deadlines; familyOpen: boolean; refusalOn: boolean };

/**
 * Whether the terms in force carry the club's right to refuse (§636), for a visitor: the public
 * cache's reading. Optional, like the form's other gated sentences: unread, the fold is today's.
 */
async function refusalDisclosed(): Promise<boolean> {
  try {
    return await cachedRefusalDisclosed(new Date());
  } catch (failure) {
    unstable_rethrow(failure);
    return false;
  }
}

export default async function RegistrationSteps({ folded = false, window = null, reminderHoursBefore = null, settings }: Props) {
  const t = await getTranslations("Registration");
  const locale = await getLocale();
  const [deadlines, familyOpen, refusalOn] = settings
    ? [settings.deadlines, settings.familyOpen, settings.refusalOn]
    : await Promise.all([cachedDeadlines(), cachedFamilyRegistrationOpen(), refusalDisclosed()]);
  const words = deadlineWords(locale, deadlines);
  const reminderHours = reminderHoursFor({ reminderHoursBefore }, deadlines);
  const values = {
    confirmation: words.confirmation,
    hold: words.hold,
    offer: words.offer,
    reminder: reminderHours > 0 ? leadPhrase(locale, reminderHours) : "",
    opens: daysPhrase(locale, window?.opensDays ?? 0),
    // "cu 2 zile înainte de start" / "la start" (§407): the one helper decides which.
    due: confirmationDueWords(locale, window?.deadlineDays ?? 0),
  };
  const stepBody = (key: string) =>
    key === "declaration" && window
      ? confirmationDueAtStart({ days: window.deadlineDays })
        ? t("steps.declaration.bodyLaterAtStart", values)
        : t("steps.declaration.bodyLater", values)
      : key === "confirmed" && reminderHours === 0
        ? t("steps.confirmed.bodyNoReminder")
        : t(`steps.${key}.body`, values);

  const list = (
    <StepList>
      {STEPS.map(({ key, Icon }, index) => (
        <StepItem key={key} icon={<Icon fontSize="small" />} title={`${index + 1}. ${t(`steps.${key}.title`)}`} body={stepBody(key)} />
      ))}
      <StepItem tone="quiet" icon={<HourglassTopIcon fontSize="small" />} title={t("steps.waitingList.title")} body={t("steps.waitingList.body", values)} />
      {/*
        A family on one address (§389; the owner: "document this … then that person can receive up
        to 4 QR codes"): the one way to add a second runner is to send the form again, and the next
        step arrives by email. Said only once the schema allows it (`family-gate.ts`) — before that,
        sending the form again only re-sends the first person's message, and this would promise
        something else. A sentence about the flow, never about any address: it reads the same to
        everybody (§39).
      */}
      {familyOpen && (
        <StepItem tone="quiet" testId="steps-family" icon={<FamilyRestroomIcon fontSize="small" />} title={t("steps.family.title")} body={t("steps.family.body")} />
      )}
      {/*
        The club's right to refuse a registration (§636; the owner, 2026-10-02: «La edițiile următoare
        trebuie sa aducă [= să apară] că organizatorul își rezervă dreptul de a refuza înscrieri»), the
        terms' five grounds summed up — said only while the terms in force, in every language, carry them
        (`describesRefusal`; §618: nothing is said that the terms in force do not say). Without them
        the fold is exactly what it was.
      */}
      {refusalOn && (
        <StepItem tone="quiet" testId="steps-refusal" icon={<GavelIcon fontSize="small" />} title={t("steps.refusal.title")} body={t("steps.refusal.body")} />
      )}
    </StepList>
  );

  if (!folded) {
    return (
      <Box component="section" aria-labelledby="registration-steps-title">
        <Typography id="registration-steps-title" component="h2" variant="h2" sx={{ fontSize: "1.125rem", mb: 1.5 }}>
          {t("steps.title")}
        </Typography>
        {list}
      </Box>
    );
  }

  return (
    <Box
      component="details"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5, fontWeight: 600 },
        ...DISCLOSURE_OPEN_ARROW,
      }}
    >
      <Typography component="summary" variant="body1">
        <FormatListNumberedIcon aria-hidden sx={FOLD_GLYPH_SX} />
        {t("steps.title")}
      </Typography>
      <Box sx={{ pb: 2 }}>{list}</Box>
    </Box>
  );
}
