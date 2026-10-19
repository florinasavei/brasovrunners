import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateRsvpAskAudienceAction } from "@/app/[locale]/admin/settings/emails/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import RadioField from "@/shared/ui/RadioField";
import StatusChip from "@/shared/ui/StatusChip";
import type { RsvpAskAudienceState } from "@/modules/rsvp/ask-audience";
import { asksAnswerers, RSVP_ASK_AUDIENCES } from "@/modules/rsvp/domain/ask-audience";

type Props = {
  locale: Locale;
  state: RsvpAskAudienceState;
  /**
   * Whether the privacy notice in force describes the second audience too (`noticeDescribesRsvpAskAnswerers`): said beside the choice, so the
   * club that picks the earlier answerers learns at once that nobody of them is asked until the notice is approved (§NNN).
   */
  answerersDescribed: boolean;
  /** Administrator only (§291); `updateRsvpAskAudience` refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/**
 * «Cui îi trimitem întrebarea „Vii?"» (§NNN; the owner, 2026-10-19: «I need to set how these emails are sent»): who the day-before question
 * (§818) is asked of — **a choice, so three radios** (`RadioField`, the editor's «Clubul pe lista publică» is the model) in a named, folded card
 * beside «Răspunsurile din calendar» (both answer «what does the club send to whom»): the newsletter's subscribers of the topic (the default),
 * the people who answered «Vin!» at an earlier date of the same series, or both. One help line under each; the default's help says it is what the
 * platform did until now. The «Termene» fold «Înainte de start» sets WHEN, the editor's tick sets which events.
 *
 * **The second audience is gated twice, and the card says so**: by the privacy notice in force (a status chip in words and a glyph, never by
 * colour alone, with the link to «Texte legale» while it is silent) and by each person's own refusal («Nu mă mai întreba la seria aceasta», in
 * every such email). A Server Component with one form, its «Salvează», behind the §384 confirmation: from the save on, the addresses of a new
 * audience are used.
 */
export default async function RsvpAskAudiencePanel({ locale, state, answerersDescribed, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const chosen = state.audience;

  return (
    <Panel
      glyph="rsvp"
      title={t("emails.rsvpAskAudience.title")}
      intro={t("emails.rsvpAskAudience.intro")}
      aside={t(`emails.rsvpAskAudience.aside.${chosen}`)}
      collapsible
      openWhen={openWhen}
      id="rsvp-ask-audience"
      data-testid="rsvp-ask-audience"
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="rsvp-ask-audience-in-force">
        {t(`emails.rsvpAskAudience.inForce.${chosen}`)}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.rsvpAskAudience.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}
      {/* The gate, in words: what the notice in force says about the earlier answerers while the club has chosen them. */}
      {asksAnswerers(chosen) && (
        <Stack spacing={1} sx={{ mt: 1.5 }} data-testid="rsvp-ask-answerers-gate">
          <Box>
            <StatusChip
              color={answerersDescribed ? "success" : "warning"}
              glyph={answerersDescribed ? "done" : "open"}
              label={answerersDescribed ? t("emails.rsvpAskAudience.noticeDone") : t("emails.rsvpAskAudience.noticeOpen")}
            />
          </Box>
          {!answerersDescribed && (
            <Alert severity="warning" data-testid="rsvp-ask-answerers-silent">
              {t(`emails.rsvpAskAudience.noticeSilent.${chosen === "ANSWERERS" ? "ANSWERERS" : "BOTH"}`)}{" "}
              <Link href="/admin/legal" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("emails.rsvpAskAudience.noticeLink")}
              </Link>
            </Alert>
          )}
        </Stack>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.rsvpAskAudience.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateRsvpAskAudienceAction}
            messages={await refusalMessages({ audience: t("emails.rsvpAskAudience.field") })}
            confirm={{
              title: t("confirm.rsvpAskAudienceTitle"),
              body: t("confirm.rsvpAskAudienceBody"),
              confirmLabel: t("emails.rsvpAskAudience.save"),
              cancelLabel: words.cancel,
            }}
            // Several forms share «Emailuri»; this one's summary and box ids carry their own prefix.
            scope="rsvpAskAudience"
            data-testid="rsvp-ask-audience-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
              <Box role="radiogroup" aria-label={t("emails.rsvpAskAudience.field")} data-testid="rsvp-ask-audience-choices">
                {RSVP_ASK_AUDIENCES.map((choice) => (
                  <Box key={choice} sx={{ mb: 0.5 }}>
                    <RadioField name="audience" value={choice} defaultChecked={chosen === choice}>
                      {t(`emails.rsvpAskAudience.option.${choice}`)}
                    </RadioField>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6, mt: -0.5 }} data-testid={`rsvp-ask-audience-help-${choice}`}>
                      {t(`emails.rsvpAskAudience.help.${choice}`)}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Box>
                <GlyphSubmitButton label={t("emails.rsvpAskAudience.save")} pendingLabel={t("emails.rsvpAskAudience.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
