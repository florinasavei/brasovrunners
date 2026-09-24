import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { fromPlainText, isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import type { Locale } from "@/i18n/routing";
import { EVENT_TYPES, type EventType, hasProgramme } from "@/modules/events/domain/event-type";
import { type TranslationFieldName, translationInputConstraints } from "../constraints";
import type { EditableTranslation } from "../repository";
import OnlyForType from "./OnlyForType";

/**
 * The rich-text editor's control names, read once here for the four text boxes that mount it: the
 * catalogue's dotted namespace in one place rather than once per box.
 */
async function editorLabels() {
  return richTextEditorLabels(await getTranslations("Admin.richText"));
}

/**
 * One language's text, split by the box of the event editor that asks for it (§350).
 *
 * The editor used to hold a language in one tab of one "Conținut" panel — the title, the place's
 * name, the summary, the description, the rules, the programme's notes, what to bring and the
 * page address, in the order somebody writes in (§260). Now every box that has per-language text
 * has its own Română | English tabs, and each piece here renders only its own fields, with the
 * same `name("…")` and the same `RecallField` as before — so `admin/actions.ts#translationInputFrom`
 * reads exactly what it always read, from whichever box posted it. A box hidden by type hides its
 * inputs; it never omits them: a language the person may edit posts every one of its fields, or
 * the save would write "" over what a hidden box held.
 *
 * A language the person may not edit renders no inputs at all — not the hidden ids either
 * (`TranslationHiddenFields` is not rendered for it) — so a save posts nothing for that language
 * and the server has nothing to refuse (BR-REQ-060-01): short fields as text, rich texts as
 * "completat / gol", and the box says whose words they are.
 */

/**
 * What a piece needs of a translation: the stored row, or a blank one for the create form, whose
 * `id` and `version` are then absent.
 */
export type TranslationDraft = Pick<
  EditableTranslation,
  | "locale"
  | "slug"
  | "title"
  | "excerpt"
  | "excerptJson"
  | "bodyJson"
  | "rulesJson"
  | "scheduleJson"
  | "checklist"
  | "locationName"
  | "seoTitle"
  | "seoDescription"
> &
  Partial<Pick<EditableTranslation, "id" | "version">>;

/** The empty language of an event being created: every field blank, no row behind it. */
export function blankTranslation(locale: Locale): TranslationDraft {
  return {
    locale,
    slug: "",
    title: "",
    excerpt: null,
    excerptJson: null,
    bodyJson: null,
    rulesJson: null,
    scheduleJson: null,
    checklist: null,
    locationName: null,
    seoTitle: null,
    seoDescription: null,
  };
}

type PieceProps = { translation: TranslationDraft; mayEdit: boolean };

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: TranslationFieldName) {
  return textFieldConstraints(translationInputConstraints(field));
}

const named = (translation: TranslationDraft) => (field: string) => `translations.${translation.locale}.${field}`;

/** A stored document's state in two words, for a reader who may not change it. */
async function documentState(value: unknown): Promise<string> {
  const t = await getTranslations("Admin");
  return isRichTextEmpty(readRichText(value)) ? t("editor.boxes.summary.empty") : t("editor.boxes.summary.filled");
}

/** One read-only line: the field's label, then its value or its state. */
function ReadOnlyLine({ label, value }: { label: string; value: string }) {
  return (
    <Typography variant="body2">
      <Typography component="span" variant="body2" color="text.secondary">
        {label}:{" "}
      </Typography>
      {value}
    </Typography>
  );
}

/** The line a read-only language ends with: whose words these are. */
async function TextsReadOnly() {
  const t = await getTranslations("Admin");
  return (
    <Typography variant="body2" color="text.secondary">
      {t("editor.boxes.textsReadOnly")}
    </Typography>
  );
}

/**
 * The row's id and the version the language was rendered from, once per editable language, at the
 * very top of the save form. A save carrying a stale version fails the whole save, both languages
 * and the event row together (BR-REQ-051-01 criterion 5). The create form has no row and posts
 * neither. After a refusal it is the version that was posted, not the one the database now holds
 * (`RecallHidden`, §315): the recalled edits were made against that one.
 */
export function TranslationHiddenFields({ translation }: { translation: TranslationDraft }) {
  const name = named(translation);
  const row =
    translation.id !== undefined && translation.version !== undefined ? { id: translation.id, version: translation.version } : null;
  return (
    <>
      {row && <input type="hidden" name={name("translationId")} value={row.id} />}
      {row && <RecallHidden name={name("expectedVersion")} value={row.version} />}
    </>
  );
}

/**
 * Box 2, "Titlu și rezumat": the title, then the summary the card, the hero and every share carry
 * (§260) — required before publication, which its fold says on its face.
 */
export async function TitleSummaryFields({ translation, mayEdit }: PieceProps) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.fields.title")} value={translation.title || t("editor.boxes.summary.empty")} />
        <ReadOnlyLine label={t("editor.boxes.summaryLabel")} value={await documentState(translation.excerptJson ?? fromPlainText(translation.excerpt))} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <Stack spacing={2}>
      <RecallField name={name("title")} label={t("editor.fields.title")} defaultValue={translation.title} {...box("title")} />
      {/* In the same editor as everything else (§73): a sentence or two and, if the organizer
          wants one, a picture. */}
      <LazyRichTextEditor
        name={name("excerptBody")}
        label={t("editor.fields.excerpt")}
        summary={t("editor.fields.excerpt")}
        emptyHint={t("editor.excerptEmpty")}
        initialBody={translation.excerptJson ?? fromPlainText(translation.excerpt)}
        accessibleSuffix={translation.locale.toUpperCase()}
        labels={await editorLabels()}
      />
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
        {t("editor.excerptHelp")}
      </Typography>
    </Stack>
  );
}

/**
 * Box 3, "Descrierea evenimentului": the description proper, in the same editor a standing page
 * uses (§11.3, §71), folded so the heaviest editor mounts only when opened (§96). A film goes in
 * here too, with the editor's own YouTube button (§266).
 */
export async function DescriptionFields({ translation, mayEdit }: PieceProps) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.boxes.description.title")} value={await documentState(translation.bodyJson)} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <Stack spacing={1}>
      <LazyRichTextEditor
        name={name("body")}
        label={t("editor.fields.body")}
        summary={t("editor.fields.body")}
        emptyHint={t("editor.bodyEmpty")}
        initialBody={translation.bodyJson}
        accessibleSuffix={translation.locale.toUpperCase()}
        labels={await editorLabels()}
      />
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
        {t("editor.bodyHelp")}
      </Typography>
    </Stack>
  );
}

/**
 * Box 5, "Locul", its tabs: the place's name in this language (migration `0058`) — optional, and
 * blank means the meeting point typed once above them, which the help says.
 */
export async function PlaceNameField({ translation, mayEdit }: PieceProps) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.locationNameInLanguage")} value={translation.locationName || t("editor.boxes.summary.empty")} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <RecallField
      name={name("locationName")}
      label={t("editor.locationNameInLanguage")}
      helperText={t("editor.locationNameInLanguageHelp")}
      defaultValue={translation.locationName ?? ""}
      {...box("locationName")}
    />
  );
}

/**
 * Box 6, "Programul zilei și ce să aduci", its tabs: the notes under the timed rows (§96, §117) —
 * not on a group run (§111), hidden, never removed — and what to bring, on every type: one line
 * in the confirmation, the reminder and the calendar entry (§81).
 */
export async function ProgrammeTextFields({ translation, mayEdit, eventType }: PieceProps & { eventType: EventType }) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.fields.scheduleNotes")} value={await documentState(translation.scheduleJson)} />
        <ReadOnlyLine label={t("editor.fields.checklist")} value={translation.checklist || t("editor.boxes.summary.empty")} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <Stack spacing={2}>
      <OnlyForType type={EVENT_TYPES.filter(hasProgramme)} selectName="event.type" initialType={eventType}>
        <LazyRichTextEditor
          name={name("schedule")}
          label={t("editor.fields.scheduleNotes")}
          summary={t("editor.fields.scheduleNotes")}
          emptyHint={t("editor.bodyEmpty")}
          initialBody={translation.scheduleJson}
          accessibleSuffix={translation.locale.toUpperCase()}
          labels={await editorLabels()}
        />
      </OnlyForType>
      <RecallField
        name={name("checklist")}
        label={t("editor.fields.checklist")}
        helperText={t("editor.checklistHelp")}
        defaultValue={translation.checklist ?? ""}
        {...box("checklist")}
      />
    </Stack>
  );
}

/**
 * Box 7, "Regulamentul": what the declaration says they read on this page, linked from every
 * email (§96). Folded; the editor mounts on opening.
 */
export async function RulesFields({ translation, mayEdit }: PieceProps) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.fields.rules")} value={await documentState(translation.rulesJson)} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <Stack spacing={1}>
      <LazyRichTextEditor
        name={name("rules")}
        label={t("editor.fields.rules")}
        summary={t("editor.fields.rules")}
        emptyHint={t("editor.rulesEmpty")}
        initialBody={translation.rulesJson}
        accessibleSuffix={translation.locale.toUpperCase()}
        labels={await editorLabels()}
      />
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
        {t("editor.rulesHelp")}
      </Typography>
    </Stack>
  );
}

/**
 * Box 14, "Adresa paginii și motoarele de căutare": the address, locked once published (§11.5) —
 * a locked box is disabled and posts nothing, so a hidden input carries it — and the two fields a
 * search engine shows.
 */
export async function AddressFields({ translation, mayEdit, slugLocked }: PieceProps & { slugLocked: boolean }) {
  const t = await getTranslations("Admin");
  const name = named(translation);
  if (!mayEdit) {
    return (
      <Stack spacing={1}>
        <ReadOnlyLine label={t("editor.fields.slug")} value={translation.slug || t("editor.boxes.summary.empty")} />
        <TextsReadOnly />
      </Stack>
    );
  }
  return (
    <Stack spacing={2}>
      {slugLocked && <input type="hidden" name={name("slug")} value={translation.slug} />}
      {/* A locked address is disabled and posts nothing (the hidden field above carries it), so
          its constraints would only mark a box nobody can type into. */}
      <RecallField
        name={name("slug")}
        label={t("editor.fields.slug")}
        defaultValue={translation.slug}
        helperText={slugLocked ? t("editor.slugLocked") : t("editor.slugHelp")}
        disabled={slugLocked}
        {...(slugLocked ? {} : box("slug"))}
      />
      <RecallField name={name("seoTitle")} label={t("editor.fields.seoTitle")} defaultValue={translation.seoTitle ?? ""} {...box("seoTitle")} />
      <RecallField
        name={name("seoDescription")}
        label={t("editor.fields.seoDescription")}
        defaultValue={translation.seoDescription ?? ""}
        multiline
        minRows={2}
        {...box("seoDescription")}
      />
    </Stack>
  );
}
