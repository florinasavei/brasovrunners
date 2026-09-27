import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateTranslationBudgetAction } from "@/app/[locale]/admin/tasks/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { TranslationBudgetState } from "../budget";
import type { CreditReading } from "../credit";
import { TRANSLATION_BUDGET_RULE } from "../domain/budget";

type Props = {
  locale: Locale;
  state: TranslationBudgetState;
  /** Characters sent since the club's midnight, from the audit rows (`budget.ts`). */
  usedToday: number;
  /** Is a translator configured here (`TRANSLATE_PROVIDER` and `DEEPL_API_KEY`)? */
  configured: boolean;
  /** DeepL's credit from its own meter (§NNN): given once, so used and left, with its level. */
  credit: CreditReading;
  mayEdit: boolean;
};

const CREDIT_COLOR = { ok: "text.secondary", watch: "warning.main", low: "error.main", spent: "error.main" } as const;

/**
 * «Tradu din română» — how much of it the club spends a day (`DECISIONS.md` §464), beside the
 * other brakes on Costuri and built like them (`JobCadencePanel`): one form, the service asserting
 * the role and writing the audit row, a refusal handed back as the form's state (§315), one
 * question first (§384). It says what is spent today, what is used and left of the key's one-time DeepL credit (§NNN, DeepL's own figure), and that
 * only the club's own texts are ever sent.
 */
export default async function TranslationBudgetPanel({ locale, state, usedToday, configured, credit, mayEdit }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const number = (value: number) => value.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB");
  const clock = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

  return (
    <Panel title={t("tasks.translationBudget.title")} intro={t("tasks.translationBudget.intro")} data-testid="translation-budget">
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="translation-budget-in-force">
        {state.budget.dailyCharacters === 0
          ? t("tasks.translationBudget.inForce.off")
          : t("tasks.translationBudget.inForce.daily", { count: number(state.budget.dailyCharacters) })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="translation-budget-today">
        {t("tasks.translationBudget.today", { used: number(usedToday), budget: number(state.budget.dailyCharacters) })}
      </Typography>
      {/* The credit, as DeepL's own meter states it (§NNN): the daily figure above is the club's brake, this is what is left at all. */}
      {credit.ok ? (
        <Typography variant="body2" color={CREDIT_COLOR[credit.credit.level]} sx={{ mt: 0.5 }} data-testid="translation-credit" data-level={credit.credit.level}>
          {t("tasks.translationBudget.credit.line", {
            used: number(credit.credit.used),
            limit: number(credit.credit.limit),
            remaining: number(credit.credit.remaining),
          })}
          {credit.credit.level !== "ok" && ` ${t(`tasks.translationBudget.credit.level.${credit.credit.level}`)}`}
        </Typography>
      ) : (
        credit.reason !== "unconfigured" && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="translation-credit" data-level="unknown">
            {t(`tasks.translationBudget.credit.unread.${credit.reason}`)}
          </Typography>
        )
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t(configured ? "tasks.translationBudget.configured" : "tasks.translationBudget.notConfigured")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("tasks.translationBudget.privacy")}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("tasks.translationBudget.updatedAt", { when: clock(state.updatedAt) })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("tasks.translationBudget.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateTranslationBudgetAction}
            messages={await refusalMessages({ dailyCharacters: t("tasks.translationBudget.field") })}
            confirm={{
              title: t("confirm.translationBudgetTitle"),
              body: t("confirm.translationBudgetBody"),
              confirmLabel: t("tasks.translationBudget.save"),
              cancelLabel: words.cancel,
            }}
            scope="translation-budget"
            data-testid="translation-budget-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
              <RecallField
                name="dailyCharacters"
                label={t("tasks.translationBudget.field")}
                defaultValue={String(state.budget.dailyCharacters)}
                size="small"
                helperText={t("tasks.translationBudget.fieldHelp", { max: number(TRANSLATION_BUDGET_RULE.max) })}
                slotProps={{
                  htmlInput: { inputMode: "numeric", pattern: "[0-9]*", min: TRANSLATION_BUDGET_RULE.min, max: TRANSLATION_BUDGET_RULE.max, required: true },
                }}
              />
              <Box>
                <GlyphSubmitButton
                  label={t("tasks.translationBudget.save")}
                  pendingLabel={t("tasks.translationBudget.saving")}
                  icon="save"
                />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
