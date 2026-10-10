import AddCircleIcon from "@mui/icons-material/AddCircle";
import EditIcon from "@mui/icons-material/Edit";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { TEAM_BOX_BODY_MAX, TEAM_BOX_TITLE_MAX } from "@/modules/content/team/fields";
import type { AdminTeamBox } from "@/modules/content/team/repository";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import { createTeamBoxAction, deleteTeamBoxAction, moveTeamBoxAction, saveTeamBoxAction, setTeamBoxVisibleAction } from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;
type RichLabels = ReturnType<typeof richTextEditorLabels>;

/**
 * «Casetele paginii» (§NNN): the titled texts under the chart of «Echipa» — one fold under the
 * cards' list, closed until opened (§336), the count on its line, in the shape of the discount
 * codes' card (§552). Each box is a row with its title, its state and its verbs, and its boxes in a
 * fold of their own: the title in both languages and the text in the rich-text editor, one fold
 * per language that mounts its editor only when opened (§96, §474). Every control is offered only
 * to the role its action asserts, and the service asserts it again (BR-REQ-060-01): writing is the
 * Redactor's and the Administrator's (`mayEdit`); «Pe site», taking off and deleting a shown box
 * are the Administrator's (`mayShow`), asked first (§384). A refusal names its box and keeps what
 * was typed (§315).
 */
export default function BoxesCard({
  boxes,
  locale,
  words: t,
  cancel,
  messages,
  rich,
  mayEdit,
  mayShow,
}: {
  boxes: readonly AdminTeamBox[];
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  rich: RichLabels;
  mayEdit: boolean;
  mayShow: boolean;
}) {
  const count = t(`team.boxes.count.${countForm(boxes.length, locale)}`, { count: boxes.length });
  return (
    <Box component="details" id="team-boxes" sx={{ ...BOXED_DISCLOSURE_SX, scrollMarginTop: 16 }} data-testid="team-boxes">
      <summary>
        <ViewAgendaIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
        {t("team.boxes.heading")} · {count}
      </summary>
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("team.boxes.help")}
        </Typography>

        {mayEdit && (
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <summary>
              <AddCircleIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              {t("team.boxes.add")}
            </summary>
            <ActionForm action={createTeamBoxAction} messages={messages} scope="box-new" data-testid="team-box-create-form">
              <input type="hidden" name="uiLocale" value={locale} />
              <BoxFields box={null} words={t} rich={rich} />
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("team.boxes.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
              </Box>
            </ActionForm>
          </Box>
        )}

        {boxes.length === 0 ? (
          <Typography variant="body2" data-testid="team-boxes-empty">
            {t("team.boxes.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("team.boxes.listLabel")}>
            {boxes.map((box, index) => (
              <BoxRow
                key={box.id}
                box={box}
                first={index === 0}
                last={index === boxes.length - 1}
                locale={locale}
                words={t}
                cancel={cancel}
                messages={messages}
                rich={rich}
                mayEdit={mayEdit}
                mayShow={mayShow}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function BoxRow({
  box,
  first,
  last,
  locale,
  words: t,
  cancel,
  messages,
  rich,
  mayEdit,
  mayShow,
}: {
  box: AdminTeamBox;
  first: boolean;
  last: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  rich: RichLabels;
  mayEdit: boolean;
  mayShow: boolean;
}) {
  const title = locale === "ro" ? box.titleRo : box.titleEn;
  const mayDelete = mayEdit && (!box.visible || mayShow);
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="boxId" value={box.id} />
    </>
  );
  return (
    <Box component="li" id={`team-box-${box.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
        {title}
      </Typography>
      <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
        <Chip size="small" color={box.visible ? "success" : "default"} label={box.visible ? t("team.visible") : t("team.hidden")} />
        {(box.bodyRo === null) !== (box.bodyEn === null) && <Chip size="small" variant="outlined" color="warning" label={t("team.oneLanguage")} />}
        {box.bodyRo === null && box.bodyEn === null && <Chip size="small" variant="outlined" label={t("team.boxes.noText")} />}
      </Stack>

      <Stack direction="row" sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
        {mayEdit && !first && (
          <Box component="form" action={moveTeamBoxAction}>
            {hidden}
            <input type="hidden" name="direction" value="up" />
            <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("team.boxes.moveUp", { title })} />
          </Box>
        )}
        {mayEdit && !last && (
          <Box component="form" action={moveTeamBoxAction}>
            {hidden}
            <input type="hidden" name="direction" value="down" />
            <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("team.boxes.moveDown", { title })} />
          </Box>
        )}
        {mayShow && (
          // Putting a box on the site, or taking it off, asks first (§384).
          <ActionForm
            action={setTeamBoxVisibleAction}
            confirm={
              box.visible
                ? { title: t("team.boxes.hideTitle", { title }), body: t("team.boxes.hideBody"), confirmLabel: t("team.hide"), cancelLabel: cancel, destructive: true }
                : { title: t("team.boxes.showTitle", { title }), body: t("team.boxes.showBody"), confirmLabel: t("team.show"), cancelLabel: cancel }
            }
          >
            {hidden}
            <input type="hidden" name="expectedVersion" value={box.version} />
            <input type="hidden" name="visible" value={box.visible ? "false" : "true"} />
            <GlyphButton icon={box.visible ? "unpublish" : "publish"} type="submit" variant="outlined" color={box.visible ? "warning" : "primary"} sx={{ minHeight: 44 }}>
              {box.visible ? t("team.hide") : t("team.show")}
            </GlyphButton>
          </ActionForm>
        )}
        {mayDelete && (
          <ActionForm
            action={deleteTeamBoxAction}
            confirm={{ title: t("team.boxes.deleteTitle", { title }), body: t("team.boxes.deleteBody"), confirmLabel: t("team.boxes.delete"), cancelLabel: cancel, destructive: true }}
          >
            {hidden}
            <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
              {t("team.boxes.delete")}
            </GlyphButton>
          </ActionForm>
        )}
      </Stack>

      {mayEdit && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>
            <EditIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("team.boxes.edit")}
          </summary>
          <ActionForm action={saveTeamBoxAction} messages={messages} scope={`b${box.id.slice(0, 8)}`} data-testid={`team-box-save-${box.id}`}>
            {hidden}
            <RecallHidden name="expectedVersion" value={box.version} />
            <BoxFields box={box} words={t} rich={rich} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Box>
  );
}

/**
 * The boxes of a box, for adding one and for writing one: the title Română and English side by side
 * from `sm` — both, always — then the text in the rich-text editor, one fold per language, both
 * languages or neither (§352), with a bio's allowlist: a picture (a partner's logo) is one, a table
 * is not. «Copiază și tradu tot: RO → EN» (§464, §482) fills the English from the Romanian.
 */
function BoxFields({ box, words: t, rich }: { box: AdminTeamBox | null; words: Words; rich: RichLabels }) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Stack spacing={2}>
      <TranslateAllButton />
      <Box sx={pairSx}>
        <RecallField
          name="titleRo"
          label={t("team.boxes.titleRo")}
          required
          fullWidth
          defaultValue={box?.titleRo ?? ""}
          helperText={t("team.boxes.titleHelp")}
          slotProps={{ htmlInput: { maxLength: TEAM_BOX_TITLE_MAX, lang: "ro" } }}
        />
        <RecallField
          name="titleEn"
          label={t("team.boxes.titleEn")}
          required
          fullWidth
          defaultValue={box?.titleEn ?? ""}
          helperText={t("team.boxes.titleEnHelp")}
          slotProps={{ htmlInput: { maxLength: TEAM_BOX_TITLE_MAX, lang: "en" } }}
        />
      </Box>
      <Stack spacing={1.5}>
        <LazyRichTextEditor
          name="bodyRoBody"
          label={t("team.boxes.bodyRo")}
          summary={t("team.boxes.bodyRo")}
          emptyHint={t("team.textEmpty")}
          initialBody={box?.bodyRo ?? null}
          accessibleSuffix="RO"
          features={{ media: true, tables: false }}
          labels={rich}
        />
        <LazyRichTextEditor
          name="bodyEnBody"
          label={t("team.boxes.bodyEn")}
          summary={t("team.boxes.bodyEn")}
          emptyHint={t("team.textEmpty")}
          initialBody={box?.bodyEn ?? null}
          accessibleSuffix="EN"
          features={{ media: true, tables: false }}
          labels={rich}
        />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {t("team.boxes.bodyHelp", { max: TEAM_BOX_BODY_MAX })}
        </Typography>
      </Stack>
    </Stack>
  );
}
