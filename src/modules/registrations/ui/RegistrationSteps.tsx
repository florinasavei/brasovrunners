import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import DrawIcon from "@mui/icons-material/Draw";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, deadlineWords, leadPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines } from "@/modules/public-cache/reads";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";

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
 * The numbers are the club's own deadlines (§NNN) — the very values the allocator gives a new
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
   * The event's own reminder lead (`events.reminder_hours_before`, §NNN): null is the club's, zero
   * is none — then the fourth step promises no reminder.
   */
  reminderHoursBefore?: number | null;
};

export default async function RegistrationSteps({ folded = false, window = null, reminderHoursBefore = null }: Props) {
  const t = await getTranslations("Registration");
  const locale = await getLocale();
  const deadlines = await cachedDeadlines();
  const words = deadlineWords(locale, deadlines);
  const reminderHours = reminderHoursFor({ reminderHoursBefore }, deadlines);
  const values = {
    confirmation: words.confirmation,
    hold: words.hold,
    offer: words.offer,
    reminder: reminderHours > 0 ? leadPhrase(locale, reminderHours) : "",
    opens: daysPhrase(locale, window?.opensDays ?? 0),
    deadline: daysPhrase(locale, window?.deadlineDays ?? 0),
  };
  const stepBody = (key: string) =>
    key === "declaration" && window
      ? t("steps.declaration.bodyLater", values)
      : key === "confirmed" && reminderHours === 0
        ? t("steps.confirmed.bodyNoReminder")
        : t(`steps.${key}.body`, values);

  const list = (
    <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {STEPS.map(({ key, Icon }, index) => (
        <Box component="li" key={key} sx={{ display: "grid", gridTemplateColumns: "40px 1fr", columnGap: 1.5, alignItems: "start" }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-hidden="true"
          >
            <Icon fontSize="small" />
          </Box>
          <Box>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {index + 1}. {t(`steps.${key}.title`)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {stepBody(key)}
            </Typography>
          </Box>
        </Box>
      ))}
      <Box component="li" sx={{ display: "grid", gridTemplateColumns: "40px 1fr", columnGap: 1.5, alignItems: "start" }}>
        <Box
          sx={{ width: 40, height: 40, borderRadius: "50%", bgcolor: "action.selected", display: "flex", alignItems: "center", justifyContent: "center" }}
          aria-hidden="true"
        >
          <HourglassTopIcon fontSize="small" />
        </Box>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {t("steps.waitingList.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("steps.waitingList.body", values)}
          </Typography>
        </Box>
      </Box>
    </Stack>
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
        {t("steps.title")}
      </Typography>
      <Box sx={{ pb: 2 }}>{list}</Box>
    </Box>
  );
}
