import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateDeadlinesAction } from "@/app/[locale]/admin/emails/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { DeadlinesState } from "../deadlines";
import { DEADLINE_KEYS, DEADLINE_RULES } from "../domain/deadlines";
import { deadlineWords } from "../domain/duration-words";

type Props = {
  locale: Locale;
  state: DeadlinesState;
  /**
   * Whether the reader may change them (§291's two gates): everybody who opens the page reads the
   * numbers in force; the form is the Administrator's, and `updateDeadlines` refuses anybody else.
   */
  mayEdit: boolean;
  /** Why the fold opens by itself: this panel's save just landed (§336). */
  openWhen?: FoldOpenWhen;
};

/**
 * "Termene" (§377): the club's deadlines, one box each, on `/admin/emails` — above the messages
 * whose when-lines and previews state them, so a changed number is read back in the next card
 * down. A Server Component with one form, the Mailgun plan's shape (§100): every box a whole
 * number with the bounds the service enforces (`DEADLINE_RULES`), carried as `min`/`max` so the
 * browser refuses "0 hours" before the server does (§315); the closed line says the four a
 * participant meets most.
 */
export default async function DeadlinesPanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const { deadlines, updatedAt } = state;
  const words = deadlineWords(locale, deadlines);
  const labels = Object.fromEntries(DEADLINE_KEYS.map((key) => [key, t(`emails.deadlines.fields.${key}`)]));

  return (
    <Panel
      title={t("emails.deadlines.title")}
      intro={t("emails.deadlines.intro")}
      aside={t("emails.deadlines.aside", {
        confirmation: words.confirmation,
        hold: words.hold,
        offer: words.offer,
        reminder: words.reminder ?? t("emails.deadlines.reminderOff"),
      })}
      collapsible
      openWhen={openWhen}
      id="deadlines"
      data-testid="deadlines"
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("emails.deadlines.legal")}
      </Typography>
      {updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t("emails.deadlines.updatedAt", {
            when: formatDay(updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Stack component="dl" spacing={0.5} sx={{ m: 0 }}>
          {DEADLINE_KEYS.map((key) => (
            <Box key={key} sx={{ display: "flex", flexWrap: "wrap", columnGap: 1 }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {labels[key]}:
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 600 }} data-testid={`deadline-${key}`}>
                {deadlines[key]}
              </Typography>
            </Box>
          ))}
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {t("emails.deadlines.readOnly")}
          </Typography>
        </Stack>
      ) : (
        /* A refused save comes back with every box as typed (§315); `scope` keeps its ids apart from the page's other forms. */
        <ActionForm action={updateDeadlinesAction} messages={await refusalMessages(labels)} scope="deadlines" data-testid="deadlines-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
            {DEADLINE_KEYS.map((key) => {
              const rule = DEADLINE_RULES[key];
              return (
                <RecallField
                  key={key}
                  name={key}
                  type="number"
                  label={labels[key]}
                  defaultValue={deadlines[key]}
                  size="small"
                  required
                  helperText={`${t(`emails.deadlines.help.${key}`)} ${t("emails.deadlines.bounds", { min: rule.min, max: rule.max, default: rule.default })}`}
                  slotProps={{ htmlInput: { min: rule.min, max: rule.max, step: 1, inputMode: "numeric" } }}
                />
              );
            })}
            <Box>
              <GlyphSubmitButton label={t("emails.deadlines.save")} pendingLabel={t("emails.deadlines.saving")} icon="save" />
            </Box>
          </Stack>
        </ActionForm>
      )}
    </Panel>
  );
}
