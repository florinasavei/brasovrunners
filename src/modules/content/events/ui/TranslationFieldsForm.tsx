import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { type TranslationFieldName, translationInputConstraints } from "../constraints";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { fromPlainText } from "@/modules/content/rich-text/domain/schema";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { EVENT_TYPES, type EventType, hasProgramme } from "@/modules/events/domain/event-type";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import type { EditableTranslation } from "../repository";
import OnlyForType from "./OnlyForType";

/**
 * What the panel needs of a translation: the stored row, or a blank one for the create form.
 *
 * The create page renders this same panel for an event that does not exist yet, so the row's
 * `id` and `version` are optional — without them the panel posts no `translationId` and no
 * `expectedVersion`, and `admin/actions.ts#translationInputFrom` reads the fields all the same.
 * `EditableTranslation` satisfies this as it is, so the editor passes its rows unchanged.
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

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§306). */
function box(field: TranslationFieldName) {
  return textFieldConstraints(translationInputConstraints(field));
}

/**
 * One language's text, as inputs inside the editor's single form — and inside the create
 * form, which renders this same panel so the two cannot drift.
 *
 * Every field name is namespaced `translations.<locale>.<field>`, which is what lets one form
 * carry the event row and both languages without any of them colliding —
 * `admin/actions.ts#translationInputFrom` reads exactly these names back, for the save and
 * for the create.
 *
 * Only what genuinely differs between the two languages is here: the title, the page address,
 * the two descriptions, the rules, the notes under the programme, the checklist, the two
 * search-engine fields — and, since migration `0058`, the *name* of the place in this
 * language. The meeting point itself, the street address, the difficulty and the cost are one
 * value for the whole event and live in the settings panels (`DECISIONS.md` §36) — they were
 * the same answer typed twice, not a translation — and so are the programme's timed rows
 * (§117): the time and the place are one fact, only the label is a translation, so the row
 * carries both and lives in "Când și unde". The place's name is the one piece of §36 the owner
 * took back ("ar trebui să pot pune și denumirea locației în română și în engleză"): "Parcul
 * Tractorul" is one place, but the English page may call it "Tractorul Park", and a blank here
 * means the event's own name, exactly as before.
 *
 * **The order is the order somebody writes in** (§260): the title, then the summary that the
 * card and the shares carry, then the full description, then the rules and the notes under the
 * programme, then what to bring. Every long text is a fold, and the address and the two search-engine fields
 * are folded away at the bottom because they are set once and never looked at again — except
 * while there is no address yet: on the create form the fold opens on its own, because a
 * required box inside a closed fold is a box the browser cannot focus when it refuses the
 * submit, and the organizer would see nothing happen.
 *
 * §170 put the description first — "it is what the writer came here to write" — and moved the
 * summary under it because an empty `Rezumat` is what refuses publication
 * (`REQUIRED_PUBLIC_TRANSLATION_FIELDS`) and it kept being empty. The owner asked for the other
 * order and gave the reason: "prima oară văd rezumat, apoi descriere full, asta e flow-ul
 * logic". It is the visitor's order — the card, the hero and every share carry the summary, and
 * the description is what somebody reads after deciding to look — and the emptiness §170 was
 * worried about is now answered by the fold itself, which says "obligatoriu" on its face
 * instead of hiding an empty box below the fold.
 *
 * A read-only language renders its reason and no inputs at all, so a save posts nothing for it
 * and the server has nothing to refuse. The rule itself is asserted in the service regardless
 * (BR-REQ-060-01): this is what the organizer sees, not what protects the text.
 *
 * Every box carries the constraints its schema rule implies — `required` on the title and the
 * address, the address's shape as a `pattern`, every `maxLength` — read off `fields.ts` through
 * `translationInputConstraints` (§306), and comes back filled after a refused submit.
 */
export default async function TranslationFieldsForm({
  translation,
  eventId,
  eventType,
  slugLocked,
  mayEdit,
}: {
  translation: TranslationDraft;
  /** The event, when it exists: the preview link needs it. Absent on the create form. */
  eventId?: string;
  /** What the event is: a group run has no programme to write (§111), so its editor is hidden. */
  eventType: EventType;
  /** AGENTS.md §11.5: the page address is stable once the event has been published. */
  slugLocked: boolean;
  mayEdit: boolean;
}) {
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Admin.richText");
  const name = (field: string) => `translations.${translation.locale}.${field}`;
  // A row that exists carries its id and version; a blank language on the create form does not.
  const row =
    translation.id !== undefined && translation.version !== undefined
      ? { id: translation.id, version: translation.version }
      : null;

  return (
    <Stack spacing={2}>
      {eventId && row && (
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
          {t("editor.version", { version: row.version })}
        </Typography>
      )}

      {!mayEdit ? (
        <Alert severity="info">{t("editor.translationReadOnly")}</Alert>
      ) : (
        <>
          {/* The version this panel was rendered from. A save carrying a stale one fails the
              whole save, both languages and the event row together (BR-REQ-051-01 criterion 5).
              The create form has no row yet and posts neither. */}
          {row && <input type="hidden" name={name("translationId")} value={row.id} />}
          {row && <input type="hidden" name={name("expectedVersion")} value={row.version} />}
          {/* A locked slug is not sent by the disabled field, so it is sent here. */}
          {slugLocked && <input type="hidden" name={name("slug")} value={translation.slug} />}

          <RecallField
            name={name("title")}
            label={t("editor.fields.title")}
            defaultValue={translation.title}
            {...box("title")}
          />

          {/* The place's name in this language (migration `0058`): optional, and blank means
              the name typed once in "Când și unde" — the help says so, because two boxes for
              one place need one sentence between them. */}
          <RecallField
            name={name("locationName")}
            label={t("editor.locationNameInLanguage")}
            helperText={t("editor.locationNameInLanguageHelp", { panel: t("editor.panels.when") })}
            defaultValue={translation.locationName ?? ""}
            {...box("locationName")}
          />

          {/* The summary first (§260): it is what a visitor meets — the card, the hero, every
              share — and it is what publication requires, so the fold says so. In the same
              editor as everything else (§73): a sentence or two and, if the organizer wants
              one, a picture. */}
          <LazyRichTextEditor
            name={name("excerptBody")}
            label={t("editor.fields.excerpt")}
            summary={t("editor.fields.excerpt")}
            emptyHint={t("editor.excerptEmpty")}
            initialBody={translation.excerptJson ?? fromPlainText(translation.excerpt)}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.excerptHelp")}
          </Typography>

          {/* The description proper, in the same editor a standing page uses (§11.3, §71), and
              folded like every other long text on this panel (§260) — which is also four fewer
              Tiptap instances mounted when the editor opens. A film goes in here too, with the
              editor's own YouTube button (§266), since the settings lost their link box. */}
          <LazyRichTextEditor
            name={name("body")}
            label={t("editor.fields.body")}
            summary={t("editor.fields.body")}
            emptyHint={t("editor.bodyEmpty")}
            initialBody={translation.bodyJson}
            accessibleSuffix={translation.locale.toUpperCase()}
            labels={richTextEditorLabels(rt)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {t("editor.bodyHelp")}
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
          {/* The notes under the programme (§96, §117): the programme itself is the timed rows
              in "Când și unde" — one list for both languages, one calendar entry each, repeated
              in the reminder — and this is the free text `EventProgramme` renders beneath them
              for what does not fit a row. The two carried the same word in two panels far apart
              and the owner read them as a duplicate ("programul evenimentului e duplicat!"), so
              the fold says "notes" and the hint says where the rows are. Folded like the rules;
              the column stays `schedule_json`. Not on a group run (§111): it follows the type
              select in the settings panels, and the service stores no programme for one
              whatever this posts. */}
          <OnlyForType type={EVENT_TYPES.filter(hasProgramme)} selectName="event.type" initialType={eventType}>
            <Stack spacing={2}>
              <LazyRichTextEditor
                name={name("schedule")}
                label={t("editor.fields.scheduleNotes")}
                summary={t("editor.fields.scheduleNotes")}
                emptyHint={t("editor.bodyEmpty")}
                initialBody={translation.scheduleJson}
                accessibleSuffix={translation.locale.toUpperCase()}
                labels={richTextEditorLabels(rt)}
              />
              <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
                {t("editor.scheduleHelp", { panel: t("editor.panels.when"), section: t("editor.programmeSection") })}
              </Typography>
            </Stack>
          </OnlyForType>

          {/* "What to bring": one line on the confirmation and the reminder (§81). */}
          <RecallField
            name={name("checklist")}
            label={t("editor.fields.checklist")}
            helperText={t("editor.checklistHelp")}
            defaultValue={translation.checklist ?? ""}
            {...box("checklist")}
          />

          {/* The page address and what a search engine shows, folded (§170): set once, then
              never looked at again. A published slug is locked anyway (§11.5), and the hidden
              input above is what carries it. Open while there is no address yet — the create
              form — so the required box is in view and the browser can point at it. */}
          <Box component="details" open={translation.slug.trim() === "" || undefined} sx={BOXED_DISCLOSURE_SX}>
            <Typography component="summary" variant="body2">
              {t("editor.seoSection")}
            </Typography>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              {/* A locked address is disabled and posts nothing (the hidden field above carries
                  it), so its constraints would only mark a box nobody can type into. */}
              <RecallField
                name={name("slug")}
                label={t("editor.fields.slug")}
                defaultValue={translation.slug}
                helperText={slugLocked ? t("editor.slugLocked") : t("editor.slugHelp")}
                disabled={slugLocked}
                {...(slugLocked ? {} : box("slug"))}
              />
              <RecallField
                name={name("seoTitle")}
                label={t("editor.fields.seoTitle")}
                defaultValue={translation.seoTitle ?? ""}
                {...box("seoTitle")}
              />
              <RecallField
                name={name("seoDescription")}
                label={t("editor.fields.seoDescription")}
                defaultValue={translation.seoDescription ?? ""}
                multiline
                minRows={2}
                {...box("seoDescription")}
              />
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}
