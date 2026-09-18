import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { fromPlainText } from "@/modules/content/rich-text/domain/schema";
import { Link } from "@/i18n/navigation";
import type { EditableTranslation } from "../repository";

/**
 * One language's text, as inputs inside the editor's single form.
 *
 * Every field name is namespaced `translations.<locale>.<field>`, which is what lets one form
 * carry the event row and both languages without any of them colliding —
 * `admin/actions.ts#translationFieldsFrom` reads exactly these names back.
 *
 * Only what genuinely differs between the two languages is here: the title, the page address,
 * the short description and the two search-engine fields. The meeting point, the street address,
 * the difficulty and the cost are one value for the whole event and live in Settings above
 * (`DECISIONS.md` §36) — they were the same answer typed twice, not a translation.
 *
 * A read-only language renders its reason and no inputs at all, so a save posts nothing for it
 * and the server has nothing to refuse. The rule itself is asserted in the service regardless
 * (BR-REQ-060-01): this is what the organizer sees, not what protects the text.
 */
export default async function TranslationFieldsForm({
  translation,
  eventId,
  slugLocked,
  mayEdit,
}: {
  translation: EditableTranslation;
  eventId: string;
  /** AGENTS.md §11.5: the page address is stable once the event has been published. */
  slugLocked: boolean;
  mayEdit: boolean;
}) {
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Admin.richText");
  const name = (field: string) => `translations.${translation.locale}.${field}`;

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        {/* The preview renders in the locale of its own URL, so this forces the translation's
            language rather than the one the organizer is browsing in. */}
        <Link
          locale={translation.locale as "ro" | "en"}
          href={{ pathname: "/preview/events/[id]", params: { id: eventId } }}
        >
          {t("events.preview")}
        </Link>
        {" · "}
        {t("editor.version", { version: translation.version })}
      </Typography>

      {!mayEdit ? (
        <Alert severity="info">{t("editor.translationReadOnly")}</Alert>
      ) : (
        <>
          {/* The version this panel was rendered from. A save carrying a stale one fails the
              whole save, both languages and the event row together (BR-REQ-051-01 criterion 5). */}
          <input type="hidden" name={name("translationId")} value={translation.id} />
          <input type="hidden" name={name("expectedVersion")} value={translation.version} />
          {/* A locked slug is not sent by the disabled field, so it is sent here. */}
          {slugLocked && <input type="hidden" name={name("slug")} value={translation.slug} />}

          <TextField
            name={name("title")}
            label={t("editor.fields.title")}
            defaultValue={translation.title}
            required
          />
          <TextField
            name={name("slug")}
            label={t("editor.fields.slug")}
            defaultValue={translation.slug}
            helperText={slugLocked ? t("editor.slugLocked") : t("editor.slugHelp")}
            disabled={slugLocked}
            required={!slugLocked}
          />
          {/* The short description in the same editor (§73): a sentence or two, and a picture
              when the organizer wants one on the hero. Its words become the plain `excerpt`. */}
          <RichTextEditor
            name={name("excerptBody")}
            label={t("editor.fields.excerpt")}
            initialBody={translation.excerptJson ?? fromPlainText(translation.excerpt)}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.excerptHelp")}
          </Typography>
          {/* The description proper, in the same editor a standing page uses (§11.3, §71). */}
          <RichTextEditor
            name={name("body")}
            label={t("editor.fields.body")}
            initialBody={translation.bodyJson}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          {/* The rules (§96): what the declaration says they read on this page; linked from every
              email. Folded, and the editor mounts on opening — six editors at once made the page slow. */}
          <LazyRichTextEditor
            name={name("rules")}
            label={t("editor.fields.rules")}
            summary={t("editor.fields.rules")}
            emptyHint={t("editor.rulesEmpty")}
            initialBody={translation.rulesJson}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.rulesHelp")}
          </Typography>
          {/* The programme (§96): kit pickup, briefing, start, cut-offs — folded like the rules. */}
          <LazyRichTextEditor
            name={name("schedule")}
            label={t("editor.fields.schedule")}
            summary={t("editor.fields.schedule")}
            emptyHint={t("editor.rulesEmpty")}
            initialBody={translation.scheduleJson}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.scheduleHelp")}
          </Typography>
          {/* "What to bring": one line on the confirmation and the reminder (§81). */}
          <TextField
            name={name("checklist")}
            label={t("editor.fields.checklist")}
            helperText={t("editor.checklistHelp")}
            defaultValue={translation.checklist ?? ""}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.bodyHelp")}
          </Typography>
          <TextField
            name={name("seoTitle")}
            label={t("editor.fields.seoTitle")}
            defaultValue={translation.seoTitle ?? ""}
          />
          <TextField
            name={name("seoDescription")}
            label={t("editor.fields.seoDescription")}
            defaultValue={translation.seoDescription ?? ""}
            multiline
            minRows={2}
          />
        </>
      )}
    </Stack>
  );
}
