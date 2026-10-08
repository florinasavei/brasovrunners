import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateFeedbackFormsAction } from "@/app/[locale]/admin/pages/contact/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { branchesSwitchedOn, FEEDBACK_BRANCHES, type FeedbackBranch } from "@/modules/feedback/domain/branches";
import { SAFETY_NAME_MAX, type FeedbackSettingsState } from "@/modules/feedback/settings";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: FeedbackSettingsState;
  /** The privacy notice in force names `{{feedbackForms}}` in every language: without it nothing shows on the site. */
  noticeDescribes: boolean;
  /** Administrator only (§450); the service refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/**
 * «Spune-ne ceva» (§676) on «Pagini» → «Contact», under who receives «Scrie-ne»: per branch a switch
 * (off by default, each) and the one address that receives it, and the safety branch's first name —
 * the name the confidential form shows («Mesajul ajunge doar la {name}»). The contact recipients'
 * shape (§164): a Server Component, one form, a Save behind the §384 confirmation; read by everybody
 * who reads the club's content, written by the Administrator. The summary counts what is on.
 */
export default async function FeedbackFormsPanel({ locale, state, noticeDescribes, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const on = branchesSwitchedOn(state).length;
  const label = (branch: FeedbackBranch) => t(`emails.feedbackForms.branches.${branch}`);

  const boxLabels: Record<string, string> = { safetyName: t("emails.feedbackForms.safetyName") };
  for (const branch of FEEDBACK_BRANCHES) boxLabels[`${branch}To`] = t("emails.feedbackForms.toOf", { branch: label(branch) });

  return (
    <Panel
      glyph="feedback"
      title={t("emails.feedbackForms.title")}
      intro={t("emails.feedbackForms.intro")}
      aside={t("emails.feedbackForms.aside", { on, all: FEEDBACK_BRANCHES.length })}
      collapsible
      openWhen={openWhen}
      id="feedback-forms"
      data-testid="feedback-forms"
    >
      {on > 0 && !noticeDescribes && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="feedback-forms-notice">
          {t("emails.feedbackForms.noticeMissing")}
        </Alert>
      )}
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.feedbackForms.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <>
          <Box component="ul" sx={{ m: 0, mt: 1.5, pl: 3 }}>
            {FEEDBACK_BRANCHES.map((branch) => (
              <Typography component="li" variant="body2" key={branch}>
                {label(branch)}: {state[branch].on ? t("emails.feedbackForms.stateOn") : t("emails.feedbackForms.stateOff")}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("emails.feedbackForms.readOnly")}
          </Typography>
        </>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateFeedbackFormsAction}
            messages={await refusalMessages(boxLabels)}
            confirm={{
              title: t("confirm.feedbackFormsTitle"),
              body: t("confirm.feedbackFormsBody"),
              confirmLabel: t("emails.feedbackForms.save"),
              cancelLabel: words.cancel,
            }}
            scope="feedbackForms"
            data-testid="feedback-forms-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={2} sx={{ maxWidth: 520 }}>
              {FEEDBACK_BRANCHES.map((branch) => (
                <Box key={branch} component="fieldset" sx={{ border: 0, m: 0, p: 0 }} data-testid={`feedback-branch-${branch}`}>
                  <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
                    {label(branch)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t(`emails.feedbackForms.help.${branch}`)}
                  </Typography>
                  <CheckboxField name={`${branch}On`} defaultChecked={state[branch].on}>
                    {t("emails.feedbackForms.switch")}
                  </CheckboxField>
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    <RecallField
                      name={`${branch}To`}
                      type="email"
                      label={t("emails.feedbackForms.to")}
                      defaultValue={state[branch].to ?? ""}
                      size="small"
                      helperText={branch === "safety" ? t("emails.feedbackForms.toHelpSafety") : t("emails.feedbackForms.toHelp")}
                      slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off", spellCheck: false } }}
                    />
                    {branch === "safety" && (
                      <RecallField
                        name="safetyName"
                        label={t("emails.feedbackForms.safetyName")}
                        defaultValue={state.safety.name ?? ""}
                        size="small"
                        helperText={t("emails.feedbackForms.safetyNameHelp")}
                        slotProps={{ htmlInput: { maxLength: SAFETY_NAME_MAX, autoComplete: "off" } }}
                      />
                    )}
                  </Stack>
                </Box>
              ))}
              <Box>
                <GlyphSubmitButton label={t("emails.feedbackForms.save")} pendingLabel={t("emails.feedbackForms.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("emails.feedbackForms.roads")}
      </Typography>
    </Panel>
  );
}
