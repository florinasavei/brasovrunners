import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateLiveStreamAction } from "@/app/[locale]/admin/settings/appearance/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { LIVE_STREAM_URL_MAX } from "@/modules/appearance/domain/live-stream";
import type { LiveStreamState } from "@/modules/appearance/live-stream";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: LiveStreamState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** Why the fold opens on arrival (§336). */
  openWhen?: FoldOpenWhen;
};

/**
 * «În direct pe YouTube» (§NNN): the live-broadcast notice on every public page — a tick box
 * that switches it on, and the broadcast's YouTube address the notice links to. The shape of
 * «Tema» beside it (§708): a Server Component, one form, Save behind the §384 confirmation, a
 * fold closed on arrival with the state in force on its line («Pornit» / «Oprit»). A role that
 * may not change it reads the state. The tick is a real tick box (§766), never a switch; the
 * address is kept while the notice is off, so the next broadcast is one tick and one save.
 */
export default async function LiveStreamPanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const stateWord = t(`liveStream.state.${state.setting.on ? "on" : "off"}`);

  return (
    <Panel glyph="liveStream" collapsible title={t("liveStream.title")} aside={stateWord} intro={t("liveStream.intro")} introMore={t("liveStream.introMore")} id="live-stream" data-testid="live-stream" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="live-stream-current">
        {t("liveStream.current", { state: stateWord })}
      </Typography>
      {state.setting.url && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }} data-testid="live-stream-current-url">
          {state.setting.url}
        </Typography>
      )}
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("liveStream.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("liveStream.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateLiveStreamAction}
            messages={await refusalMessages({ url: t("liveStream.url.label") })}
            confirm={{
              title: t("confirm.liveStreamTitle"),
              body: t("confirm.liveStreamBody"),
              confirmLabel: t("liveStream.save"),
              cancelLabel: words.cancel,
            }}
            scope="liveStream"
            data-testid="live-stream-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, cursor: "pointer" }} data-testid="live-stream-on">
                <RecallCheckbox name="on" defaultChecked={state.setting.on} style={{ width: 20, height: 20, flexShrink: 0 }} />
                <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                  {t("liveStream.on")}
                </Typography>
              </Box>
              <RecallField
                name="url"
                label={t("liveStream.url.label")}
                helperText={t("liveStream.url.help")}
                fullWidth
                defaultValue={state.setting.url ?? ""}
                slotProps={{ htmlInput: { maxLength: LIVE_STREAM_URL_MAX, inputMode: "url", spellCheck: false, autoCapitalize: "none", "data-testid": "live-stream-url" }, inputLabel: { shrink: true } }}
              />
              <Typography variant="caption" color="text.secondary">
                {t("liveStream.scope")}
              </Typography>
              <Box>
                <GlyphSubmitButton label={t("liveStream.save")} pendingLabel={t("liveStream.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
