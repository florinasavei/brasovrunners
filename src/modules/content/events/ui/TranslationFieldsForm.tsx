import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
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
          <TextField
            name={name("excerpt")}
            label={t("editor.fields.excerpt")}
            helperText={t("editor.excerptHelp")}
            defaultValue={translation.excerpt ?? ""}
            multiline
            minRows={2}
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
        </>
      )}
    </Stack>
  );
}
