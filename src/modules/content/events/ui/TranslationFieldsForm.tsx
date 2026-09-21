import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { fromPlainText } from "@/modules/content/rich-text/domain/schema";
import { Link } from "@/i18n/navigation";
import { EVENT_TYPES, type EventType, hasProgramme } from "@/modules/events/domain/event-type";
import { DISCLOSURE_SX } from "@/shared/ui/disclosure";
import type { EditableTranslation } from "../repository";
import OnlyForType from "./OnlyForType";

/**
 * One language's text, as inputs inside the editor's single form.
 *
 * Every field name is namespaced `translations.<locale>.<field>`, which is what lets one form
 * carry the event row and both languages without any of them colliding —
 * `admin/actions.ts#translationFieldsFrom` reads exactly these names back.
 *
 * Only what genuinely differs between the two languages is here: the title, the page address,
 * the two descriptions, the rules, the programme, the checklist and the two search-engine
 * fields. The meeting point, the street address, the difficulty and the cost are one value for
 * the whole event and live in the settings panels (`DECISIONS.md` §36) — they were the same
 * answer typed twice, not a translation.
 *
 * **The order is the order somebody writes in** (§170): the title, then the full description,
 * then the summary that the card and the shares carry, then the rules and the programme, then
 * what to bring. The address and the two search-engine fields are folded away at the bottom,
 * because they are set once and never looked at again.
 *
 * The summary used to sit above the description, which put a one-sentence box before the box
 * it summarises and left `Rezumat` empty on event after event — and an empty summary is what
 * refuses publication (`REQUIRED_PUBLIC_TRANSLATION_FIELDS`). It is second now, and it says on
 * its face that it is required.
 *
 * A read-only language renders its reason and no inputs at all, so a save posts nothing for it
 * and the server has nothing to refuse. The rule itself is asserted in the service regardless
 * (BR-REQ-060-01): this is what the organizer sees, not what protects the text.
 */
export default async function TranslationFieldsForm({
  translation,
  eventId,
  eventType,
  slugLocked,
  mayEdit,
}: {
  translation: EditableTranslation;
  eventId: string;
  /** What the event is: a group run has no programme to write (§111), so its editor is hidden. */
  eventType: EventType;
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

          {/* The description proper, in the same editor a standing page uses (§11.3, §71), and
              first: it is what the writer came here to write. */}
          <RichTextEditor
            name={name("body")}
            label={t("editor.fields.body")}
            initialBody={translation.bodyJson}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.bodyHelp")}
          </Typography>

          {/* The summary, under the description it summarises (§170). In the same editor (§73):
              a sentence or two, and a picture when the organizer wants one on the hero. Its
              words become the plain `excerpt`, which is what publication requires — so the
              label says "required" rather than the refusal saying it later. */}
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
          {/* The programme (§96): kit pickup, briefing, start, cut-offs — folded like the rules.
              Not on a group run (§111): it follows the type select in the settings panels, and
              the service stores no programme for one whatever this posts. */}
          <OnlyForType type={EVENT_TYPES.filter(hasProgramme)} selectName="event.type" initialType={eventType}>
            <Stack spacing={2}>
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
            </Stack>
          </OnlyForType>

          {/* "What to bring": one line on the confirmation and the reminder (§81). */}
          <TextField
            name={name("checklist")}
            label={t("editor.fields.checklist")}
            helperText={t("editor.checklistHelp")}
            defaultValue={translation.checklist ?? ""}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />

          {/* The page address and what a search engine shows, folded (§170): set once, then
              never looked at again. A published slug is locked anyway (§11.5), and the hidden
              input above is what carries it. */}
          <Box component="details" sx={DISCLOSURE_SX}>
            <Typography component="summary" variant="body2">
              {t("editor.seoSection")}
            </Typography>
            <Stack spacing={2} sx={{ pt: 1, pb: 1 }}>
              <TextField
                name={name("slug")}
                label={t("editor.fields.slug")}
                defaultValue={translation.slug}
                helperText={slugLocked ? t("editor.slugLocked") : t("editor.slugHelp")}
                disabled={slugLocked}
                required={!slugLocked}
              />
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
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}
