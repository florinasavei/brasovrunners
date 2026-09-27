import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/modules/content/faq/fields";
import { readFaqPageSettings } from "@/modules/content/faq/page-settings";
import { type AdminFaqItem, listFaqItemsForAdmin } from "@/modules/content/faq/repository";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import { canEditFaqPage, canReadContent, canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import {
  createFaqItemAction,
  deleteFaqItemAction,
  moveFaqItemAction,
  saveFaqItemAction,
  setFaqItemVisibleAction,
  setFaqPagePublishedAction,
} from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Întrebări frecvente» in the backoffice (§NNN): «Echipa»'s screen (§459) for questions — the page
 * first, DRAFT until an Administrator publishes it (both languages at once, asked first, §384),
 * then every question in the page's own order, each with whether it is on the site and its verbs.
 *
 * Read by whoever reads the club's content (§208); every control is offered only to the role its
 * action asserts, and the action asserts it again (BR-REQ-060-01): writing a question is the
 * Redactor's and the Administrator's, showing one the Administrator's alone (§201).
 *
 * A question is written in a fold on its own row — closed, with the question on the line, until
 * somebody opens it (§336) — its answer in the rich-text editor, one fold per language that mounts
 * the editor only when opened (§96), words only: no picture, film or table (the save refuses them).
 * Each form carries a scope, so the ids the refusal summary links to are never shared.
 */
export default async function AdminFaqPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const db = getDb();
  const [items, settings] = await Promise.all([listFaqItemsForAdmin(db), readFaqPageSettings(db)]);
  const mayEdit = canEditFaqPage(actor.role);
  const mayShow = canShowFaqItem(actor.role);
  const shown = items.filter((item) => item.visible).length;
  const published = settings.status === "PUBLISHED";
  const ro = getPathname({ locale: "ro", href: "/faq" });
  const en = getPathname({ locale: "en", href: "/faq" });

  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const messages = await refusalMessages({
    questionRo: t("faq.questionRo"),
    questionEn: t("faq.questionEn"),
    answerRoBody: t("faq.answerRo"),
    answerEnBody: t("faq.answerEn"),
  });

  return (
    <Stack spacing={3}>
      <PagesSubNav locale={locale} active="faq" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("faq.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("faq.intro")}
        </Typography>
        <Typography variant="body2">
          {shown > 0 ? t("faq.shownCount", { count: String(shown), total: String(items.length) }) : t("faq.noneShown")}{" "}
          {shown > 0 && published && (
            <MuiLink href={getPathname({ locale, href: "/faq" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("faq.viewPublic")}
            </MuiLink>
          )}
        </Typography>
        {!mayEdit && <Alert severity="info">{t("faq.readOnly")}</Alert>}
        {mayEdit && !mayShow && <Alert severity="info">{t("faq.showIsAdmin")}</Alert>}
      </Stack>

      {/* The page as a whole: whether it is on the site, and the switch that puts it there. */}
      <Paper variant="outlined" id="faq-page" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t("faq.pageHeading")}
            </Typography>
            <Chip size="small" color={published ? "success" : "default"} label={published ? t("faq.pagePublished") : t("faq.pageDraft")} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {published ? t("faq.pagePublishedHelp", { ro, en }) : t("faq.pageDraftHelp")}
          </Typography>
          {mayShow && (
            <ActionForm
              action={setFaqPagePublishedAction}
              confirm={
                published
                  ? { title: t("faq.unpublishTitle"), body: t("faq.unpublishBody"), confirmLabel: t("faq.unpublish"), cancelLabel: words.cancel, destructive: true }
                  : { title: t("faq.publishTitle"), body: t("faq.publishBody", { ro, en }), confirmLabel: t("faq.publish"), cancelLabel: words.cancel }
              }
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="published" value={published ? "false" : "true"} />
              <GlyphButton
                icon={published ? "unpublish" : "publish"}
                type="submit"
                variant={published ? "outlined" : "contained"}
                color={published ? "warning" : "primary"}
                sx={{ minHeight: 44 }}
              >
                {published ? t("faq.unpublish") : t("faq.publish")}
              </GlyphButton>
            </ActionForm>
          )}
        </Stack>
      </Paper>

      {mayEdit && (
        <Box component="details" id="faq-new" sx={BOXED_DISCLOSURE_SX}>
          <summary>{t("faq.add")}</summary>
          <ActionForm action={createFaqItemAction} messages={messages} scope="new" data-testid="faq-create-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <ItemFields item={null} words={t} rich={rich} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("faq.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}

      {items.length === 0 ? (
        <Typography variant="body1">{t("faq.empty")}</Typography>
      ) : (
        <Stack component="ol" spacing={2} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("faq.listLabel")}>
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              first={index === 0}
              last={index === items.length - 1}
              locale={locale}
              words={t}
              cancel={words.cancel}
              messages={messages}
              rich={rich}
              mayEdit={mayEdit}
              mayShow={mayShow}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;
type RichLabels = ReturnType<typeof richTextEditorLabels>;

/** One question on the screen: its line, its verbs, and its words in a fold. */
function ItemCard({
  item,
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
  item: AdminFaqItem;
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
  const question = locale === "en" ? item.questionEn : item.questionRo;
  const scope = `q${item.id.slice(0, 8)}`;
  const mayDelete = mayEdit && (!item.visible || mayShow);
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="itemId" value={item.id} />
    </>
  );

  return (
    <Paper component="li" variant="outlined" id={`faq-${item.id}`} sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
        {question}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
        <Chip size="small" color={item.visible ? "success" : "default"} label={item.visible ? t("faq.visible") : t("faq.hidden")} />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
        {mayEdit && !first && (
          <Box component="form" action={moveFaqItemAction}>
            {hidden}
            <input type="hidden" name="direction" value="up" />
            <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("faq.moveUpNamed", { question })} />
          </Box>
        )}
        {mayEdit && !last && (
          <Box component="form" action={moveFaqItemAction}>
            {hidden}
            <input type="hidden" name="direction" value="down" />
            <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("faq.moveDownNamed", { question })} />
          </Box>
        )}
        {mayShow && (
          // Putting a question on the site, or taking it off, asks first (§384).
          <ActionForm
            action={setFaqItemVisibleAction}
            confirm={
              item.visible
                ? { title: t("faq.hideTitle", { question }), body: t("faq.hideBody"), confirmLabel: t("faq.hide"), cancelLabel: cancel, destructive: true }
                : { title: t("faq.showTitle", { question }), body: t("faq.showBody"), confirmLabel: t("faq.show"), cancelLabel: cancel }
            }
          >
            {hidden}
            <input type="hidden" name="expectedVersion" value={item.version} />
            <input type="hidden" name="visible" value={item.visible ? "false" : "true"} />
            <GlyphButton
              icon={item.visible ? "unpublish" : "publish"}
              type="submit"
              variant="outlined"
              color={item.visible ? "warning" : "primary"}
              sx={{ minHeight: 44 }}
            >
              {item.visible ? t("faq.hide") : t("faq.show")}
            </GlyphButton>
          </ActionForm>
        )}
        {mayDelete && (
          <ActionForm
            action={deleteFaqItemAction}
            confirm={{ title: t("faq.deleteTitle", { question }), body: t("faq.deleteBody"), confirmLabel: t("faq.delete"), cancelLabel: cancel, destructive: true }}
          >
            {hidden}
            <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
              {t("faq.delete")}
            </GlyphButton>
          </ActionForm>
        )}
      </Stack>

      {mayEdit && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>{t("faq.edit")}</summary>
          <ActionForm action={saveFaqItemAction} messages={messages} scope={scope} data-testid={`faq-save-${item.id}`}>
            {hidden}
            <RecallHidden name="expectedVersion" value={item.version} />
            <ItemFields item={item} words={t} rich={rich} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Paper>
  );
}

/**
 * The boxes of a question, for adding one and for writing one: the question Română and English
 * side by side from `sm` — both required — then the answer in the rich-text editor, one fold per
 * language (§96), words only.
 */
function ItemFields({ item, words: t, rich }: { item: AdminFaqItem | null; words: Words; rich: RichLabels }) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Stack spacing={2}>
      {/* «Copiază și tradu tot: RO → EN» (§464, §482): this question's English from its Romanian,
          in this form alone — every question's form posts the same names. */}
      <TranslateAllButton />
      <Box sx={pairSx}>
        <RecallField
          name="questionRo"
          label={t("faq.questionRo")}
          required
          fullWidth
          defaultValue={item?.questionRo ?? ""}
          helperText={t("faq.questionHelp")}
          slotProps={{ htmlInput: { maxLength: FAQ_QUESTION_MAX, lang: "ro" } }}
        />
        <RecallField
          name="questionEn"
          label={t("faq.questionEn")}
          required
          fullWidth
          defaultValue={item?.questionEn ?? ""}
          helperText={t("faq.bothRequired")}
          slotProps={{ htmlInput: { maxLength: FAQ_QUESTION_MAX, lang: "en" } }}
        />
      </Box>
      <Stack spacing={1.5}>
        <LazyRichTextEditor
          name="answerRoBody"
          label={t("faq.answerRo")}
          summary={t("faq.answerRo")}
          emptyHint={t("faq.textEmpty")}
          initialBody={item?.answerRo ?? null}
          accessibleSuffix="RO"
          features={{ media: false, tables: false }}
          labels={rich}
        />
        <LazyRichTextEditor
          name="answerEnBody"
          label={t("faq.answerEn")}
          summary={t("faq.answerEn")}
          emptyHint={t("faq.textEmpty")}
          initialBody={item?.answerEn ?? null}
          accessibleSuffix="EN"
          features={{ media: false, tables: false }}
          labels={rich}
        />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {t("faq.answerHelp", { max: String(FAQ_ANSWER_MAX) })}
        </Typography>
      </Stack>
    </Stack>
  );
}
