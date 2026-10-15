import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { updateFeedbackFormsAction } from "@/app/[locale]/admin/pages/contact/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { FEEDBACK_BRANCH_GLYPH } from "@/modules/feedback/ui/branch-glyph";
import { getPathname } from "@/i18n/navigation";
import { branchesSwitchedOn, FEEDBACK_BRANCHES, sendsToItself, type FeedbackBranch, type FeedbackRoads, type FeedbackVia } from "@/modules/feedback/domain/branches";
import { SAFETY_NAME_MAX, type FeedbackSettingsState } from "@/modules/feedback/settings";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import RoadChoice, { roadWords } from "./RoadChoice";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  locale: Locale;
  state: FeedbackSettingsState;
  /** The privacy notice in force names `{{feedbackForms}}` in every language: without it nothing shows on the site. */
  noticeDescribes: boolean;
  /** Administrator only (§450); the service refuses anybody else. */
  mayEdit: boolean;
  /** Which roads this deployment has (`feedbackRoads`): a road it lacks is greyed, with the steps that give it. */
  roads: FeedbackRoads;
  /** The privacy notice in force names `{{feedbackSafetyGmail}}` in every language (§772): until it does, Girl Zone's Gmail is greyed with a link to «Texte legale». */
  safetyGmailDescribed: boolean;
  /** The club's Gmail account that sends (`CONTACT_SMTP_USER`), or null: a form whose recipient is this very account is warned (§778). */
  gmailAccount?: string | null;
  openWhen?: FoldOpenWhen;
};

/** Where the steps of each road are: the row of «Sarcini» that carries them (`contactForm`: the club's Gmail, `liveEmail`: Mailgun). */
const STEPS_ROW: Readonly<Record<FeedbackVia, string>> = { gmail: "task-contactForm", mailgun: "task-liveEmail" };

/**
 * «Spune-ne ceva» (§676) on «Pagini» → «Contact», under who receives «Scrie-ne»: per branch a switch
 * (off by default, each) and the one address that receives it, and the safety branch's first name —
 * the name the confidential form shows («Mesajul ajunge doar la {name}»). The contact recipients'
 * shape (§164): a Server Component, one form, a Save behind the §384 confirmation; read by everybody
 * who reads the club's content, written by the Administrator. The summary counts what is on.
 *
 * Beside each form's recipient, «Prin ce trimitem» (§772, `RoadChoice`): two native radios — the club's
 * Gmail or Mailgun, Mailgun «recomandat» (§782, one line of why under the four pairs) — whose default, for a form with no saved road, is Mailgun where it transmits (`defaultViaFor`). A road this deployment lacks is greyed
 * with a sentence and a link to the steps in «Sarcini»; it stays checked when it is what was saved, so
 * the card shows what the form does, and a save leaves it as it was (`keepUnpostedVia`).
 */
export default async function FeedbackFormsPanel({ locale, state, noticeDescribes, mayEdit, roads, safetyGmailDescribed, gmailAccount = null, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const roadWordsOfCard = roadWords((key) => t(key as never));
  const on = branchesSwitchedOn(state).length;
  const label = (branch: FeedbackBranch) => t(`emails.feedbackForms.branches.${branch}`);
  const tasksPath = getPathname({ locale, href: "/admin/tasks" });
  const legalPath = getPathname({ locale, href: "/admin/legal" });
  /** Why a road cannot be newly chosen on this form, or null: the deployment lacks it, or (Girl Zone's Gmail) the notice does not say it yet. */
  const blocked = (branch: FeedbackBranch, via: FeedbackVia): "missing" | "notice" | null =>
    !roads[via] ? "missing" : branch === "safety" && via === "gmail" && !safetyGmailDescribed ? "notice" : null;

  /** Why Girl Zone's «dacă Mailgun pică» cannot be ticked: Gmail is not here, or the notice in force does not say it may carry her messages. */
  const fallbackBlocked: "missing" | "notice" | null = !roads.gmail ? "missing" : !safetyGmailDescribed ? "notice" : null;

  const boxLabels: Record<string, string> = { safetyName: t("emails.feedbackForms.safetyName") };
  for (const branch of FEEDBACK_BRANCHES) {
    boxLabels[`${branch}To`] = t("emails.feedbackForms.toOf", { branch: label(branch) });
    boxLabels[`${branch}Via`] = t("emails.feedbackForms.via.legendOf", { branch: label(branch) });
  }

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
                {label(branch)}: {state[branch].on ? t("emails.feedbackForms.stateOn") : t("emails.feedbackForms.stateOff")} ·{" "}
                {t(`emails.feedbackForms.via.state${state[branch].via === "gmail" ? "Gmail" : "Mailgun"}`)}
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
              {FEEDBACK_BRANCHES.map((branch, index) => {
                const Glyph = FEEDBACK_BRANCH_GLYPH[branch];
                return (
                  <Fragment key={branch}>
                    {/* A separator between the four forms (§716). */}
                    {index > 0 && <Divider data-testid="feedback-branch-divider" />}
                    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0 }} data-testid={`feedback-branch-${branch}`}>
                      <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
                        <Glyph aria-hidden="true" fontSize="small" sx={{ verticalAlign: "middle", mr: 1 }} />
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
                        {state[branch].via === "gmail" && sendsToItself(state[branch].to, gmailAccount) && (
                          <Typography variant="caption" color="warning.main" sx={{ display: "block" }} data-testid={`feedback-self-${branch}`}>
                            {t("emails.feedbackForms.selfRecipient")}
                          </Typography>
                        )}
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
                      {/* «Prin ce trimitem» (§772, §782): the radio pair both cards share (`RoadChoice`), never a toggle; the default is the form's own. */}
                      <RoadChoice
                        name={`${branch}Via`}
                        testId={`feedback-via-${branch}`}
                        current={state[branch].via}
                        words={roadWordsOfCard}
                        blocked={{ gmail: blocked(branch, "gmail"), mailgun: blocked(branch, "mailgun") }}
                        tasksPath={tasksPath}
                        legalPath={legalPath}
                        gmailCopyCaption={branch !== "safety"}
                      >
                        {branch === "safety" && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="feedback-via-safety-note">
                            {t("emails.feedbackForms.via.safetyNote")}
                          </Typography>
                        )}
                        {/* «Dacă Mailgun pică, trimite prin Gmail-ul clubului» (§778): a real tick, off by default, with the readers' note.
                            Drawn only while Girl Zone leaves by Mailgun: where the club chose Gmail for her the tick means nothing (Mailgun
                            takes over from Gmail with no tick), so what is saved only travels, in a hidden field. */}
                        {branch === "safety" && state.safety.via !== "mailgun" && state.safety.fallbackToGmail && <input type="hidden" name="safetyFallbackToGmail" value="on" />}
                        {branch === "safety" && state.safety.via === "mailgun" && (
                          <Box sx={{ mt: 1 }} data-testid="feedback-fallback">
                            <CheckboxField
                              name="safetyFallbackToGmail"
                              defaultChecked={state.safety.fallbackToGmail}
                              disabled={fallbackBlocked !== null}
                              help={t("emails.feedbackForms.via.fallbackHelp")}
                              helpTestId="feedback-fallback-help"
                            >
                              {t("emails.feedbackForms.via.fallback")}
                            </CheckboxField>
                            {fallbackBlocked !== null && state.safety.fallbackToGmail && <input type="hidden" name="safetyFallbackToGmail" value="on" />}
                            {fallbackBlocked === "notice" && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }} data-testid="feedback-fallback-notice">
                                {t("emails.feedbackForms.via.fallbackNotice")}{" "}
                                <MuiLink href={legalPath} sx={INLINE_TAP_TARGET}>
                                  {t("emails.feedbackForms.via.noticeSteps")}
                                </MuiLink>
                              </Typography>
                            )}
                            {fallbackBlocked === "missing" && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }} data-testid="feedback-fallback-missing">
                                {t("emails.feedbackForms.via.gmailMissing")}{" "}
                                <MuiLink href={`${tasksPath}#${STEPS_ROW.gmail}`} sx={INLINE_TAP_TARGET}>
                                  {t("emails.feedbackForms.via.steps")}
                                </MuiLink>
                              </Typography>
                            )}
                          </Box>
                        )}
                      </RoadChoice>
                    </Box>
                  </Fragment>
                );
              })}
              {/* Why Mailgun is the recommended road, once for the card (§782), under the four pairs. */}
              <Typography variant="body2" color="text.secondary" data-testid="feedback-via-why">
                {t("emails.feedbackForms.via.why")}
              </Typography>
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
