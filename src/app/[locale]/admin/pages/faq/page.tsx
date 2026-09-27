import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import { routing } from "@/i18n/routing";
import { FAQ_ANSWER_MAX, FAQ_CATEGORY_MAX, FAQ_INTRO_MAX, FAQ_QUESTION_MAX, faqBoxName } from "@/modules/content/faq/fields";
import { faqIntroDocs, readFaqPageSettings } from "@/modules/content/faq/page-settings";
import { type AdminFaqItem, listFaqItemsForAdmin } from "@/modules/content/faq/repository";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import { canEditFaqPage, canReadContent, canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox, RecallHidden } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import { CLUB_NAME } from "@/theme/brand";
import { saveFaqPageAction, setFaqPagePublishedAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;
type RichLabels = ReturnType<typeof richTextEditorLabels>;

/** A card's two languages, as the tabs draw them. */
const LANGUAGES = [
  { locale: "ro", suffix: "Ro", label: "langRo" },
  { locale: "en", suffix: "En", label: "langEn" },
] as const;

/**
 * «Întrebări frecvente» in the backoffice (§NNN): the page first — DRAFT until an Administrator
 * publishes it, both languages at once, asked first (§384) — then the page's **one form** (§28):
 * «Copiază și tradu tot: RO → EN» at the top (§482), the introduction, and every question as a
 * card in the page's own order, the last card a spare for a new question, and one save.
 *
 * Each card is a fold (§336) holding a Română | English strip with «Tradu cardul» in its tab row
 * (§514): the question, its optional «Categorie» and the answer in the rich-text editor — words,
 * links and pictures (§72, §414), no table. Under the strip the card's arrows (the save's own
 * buttons, so a move keeps every word typed), «Pe site» for the Administrator, and «Șterge la
 * salvare». A save that puts a question on the site, takes one off or deletes one asks first,
 * naming the question (§384); a save that changes nothing outward asks nothing.
 *
 * Read by whoever reads the club's content (§208); the form is offered only to the roles the
 * service lets write (BR-REQ-060-01), which asserts every role again.
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
  const questionOf = (item: AdminFaqItem) => (locale === "en" ? item.questionEn : item.questionRo);

  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const publicWords = await getTranslations("Faq");
  // The refusal summary's words, by each card's own boxes, so a link names the question's number.
  const labels: Record<string, string> = { introRoBody: t("faq.introRo"), introEnBody: t("faq.introEn") };
  for (let index = 0; index <= items.length; index += 1) {
    const n = ` · ${index + 1}`;
    for (const box of ["questionRo", "questionEn", "categoryRo", "categoryEn"] as const) labels[faqBoxName(index, box)] = `${t(`faq.${box}`)}${n}`;
    labels[faqBoxName(index, "answerRoBody")] = `${t("faq.answerRo")}${n}`;
    labels[faqBoxName(index, "answerEnBody")] = `${t("faq.answerEn")}${n}`;
  }
  const messages = await refusalMessages(labels);

  // Ask first for what reaches the site (§384): a deletion, a question taken off, one put on.
  const confirm: ConfirmSpec[] = [];
  items.forEach((item, index) => {
    const question = questionOf(item);
    if (!item.visible || mayShow) {
      confirm.push({
        title: t("faq.deleteTitle", { question }),
        body: t("faq.deleteBody"),
        confirmLabel: t("faq.deleteConfirm"),
        cancelLabel: words.cancel,
        destructive: true,
        when: [{ field: faqBoxName(index, "remove"), equals: "on" }],
      });
    }
  });
  if (mayShow) {
    items.forEach((item, index) => {
      const question = questionOf(item);
      confirm.push(
        item.visible
          ? {
              title: t("faq.hideTitle", { question }),
              body: t("faq.hideBody"),
              confirmLabel: t("faq.hideConfirm"),
              cancelLabel: words.cancel,
              destructive: true,
              when: [
                { field: faqBoxName(index, "visible"), notEquals: "on" },
                { field: faqBoxName(index, "remove"), notEquals: "on" },
              ],
            }
          : {
              title: t("faq.showTitle", { question }),
              body: t("faq.showBody"),
              confirmLabel: t("faq.showConfirm"),
              cancelLabel: words.cancel,
              when: [
                { field: faqBoxName(index, "visible"), equals: "on" },
                { field: faqBoxName(index, "remove"), notEquals: "on" },
              ],
            },
      );
    });
    // The spare card asks only when a question is typed on it: an empty spare card saves nothing.
    confirm.push({
      title: t("faq.showTitle", { question: t("faq.newHeading") }),
      body: t("faq.showBody"),
      confirmLabel: t("faq.showConfirm"),
      cancelLabel: words.cancel,
      when: [
        { field: faqBoxName(items.length, "visible"), equals: "on" },
        { field: faqBoxName(items.length, "questionRo"), notEquals: "" },
      ],
    });
  }

  const intro = faqIntroDocs(settings);

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

      {mayEdit ? (
        <ActionForm action={saveFaqPageAction} messages={messages} confirm={confirm} data-testid="faq-page-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <RecallHidden name="expectedVersion" value={settings.version} />
          {/*
            The form's default button, first in tree order: Enter in a box presses the first submit
            button, and without this one that was card 1's ↓ — a move nobody asked for. This one is
            the plain save, out of sight, out of the tab order and nameless, so neither a reader nor a
            finger meets it; «Salvează pagina» below is the one seen and named.
          */}
          <Box
            component="button"
            type="submit"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="faq-default-save"
            sx={{ position: "absolute", width: 1, height: 1, p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", border: 0, pointerEvents: "none" }}
          />
          <Stack spacing={2}>
            {/* «Copiază și tradu tot: RO → EN» (§464, §482): once, at the top — every English box of the page. */}
            <TranslateAllButton />

            <Panel collapsible level={3} title={t("faq.introHeading")} id="faq-intro" data-testid="faq-intro-card">
              <LocaleTabPanels
                idPrefix="faq-intro"
                translateCard
                panels={LANGUAGES.map((language) => ({
                  locale: language.locale,
                  label: t(`faq.${language.label}`),
                  content: (
                    <Box sx={{ pt: 2 }}>
                      <LazyRichTextEditor
                        name={`intro${language.suffix}Body`}
                        label={t(`faq.intro${language.suffix}`)}
                        summary={t(`faq.intro${language.suffix}`)}
                        emptyHint={t("faq.textEmpty")}
                        initialBody={language.locale === "ro" ? intro.ro : intro.en}
                        accessibleSuffix={language.suffix.toUpperCase()}
                        features={{ media: true, tables: true }}
                        labels={rich}
                      />
                    </Box>
                  ),
                }))}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {t("faq.introHelp", { max: String(FAQ_INTRO_MAX) })}
              </Typography>
              {/* The sentence the page opens with while the club has written no introduction. */}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontStyle: "italic" }}>
                {t("faq.introDefault", { lead: publicWords("lead", { club: CLUB_NAME }) })}
              </Typography>
            </Panel>

            <Stack spacing={1} id="faq-questions" sx={{ scrollMarginTop: 16 }}>
              <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {t("faq.questionsHeading")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("faq.questionsHelp")}
              </Typography>
            </Stack>

            <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("faq.listLabel")}>
              {items.map((item, index) => (
                <Box component="li" key={item.id}>
                  <QuestionCard
                    item={item}
                    index={index}
                    count={items.length}
                    title={`${index + 1}. ${questionOf(item)}`}
                    words={t}
                    rich={rich}
                    mayShow={mayShow}
                  />
                </Box>
              ))}
              <Box component="li">
                <QuestionCard item={null} index={items.length} count={items.length} title={t("faq.newHeading")} words={t} rich={rich} mayShow={mayShow} />
              </Box>
            </Stack>

            <Box>
              <GlyphSubmitButton label={t("faq.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </Stack>
        </ActionForm>
      ) : items.length === 0 ? (
        <Typography variant="body1">{t("faq.empty")}</Typography>
      ) : (
        <Stack component="ol" spacing={1} sx={{ m: 0, pl: 3 }} aria-label={t("faq.listLabel")}>
          {items.map((item) => (
            <Typography component="li" key={item.id} variant="body1">
              {questionOf(item)}{" "}
              <Chip size="small" color={item.visible ? "success" : "default"} label={item.visible ? t("faq.visible") : t("faq.hidden")} />
            </Typography>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * One question's card — or, with no `item`, the spare card a new question is written on: a fold
 * with the question's number and words on its line and whether it is on the site, a Română |
 * English strip with «Tradu cardul», and the card's own controls under it.
 */
function QuestionCard({
  item,
  index,
  count,
  title,
  words: t,
  rich,
  mayShow,
}: {
  item: AdminFaqItem | null;
  index: number;
  count: number;
  title: string;
  words: Words;
  rich: RichLabels;
  mayShow: boolean;
}) {
  const name = (box: Parameters<typeof faqBoxName>[1]) => faqBoxName(index, box);
  const mayRemove = item !== null && (!item.visible || mayShow);
  const aside = item ? (item.visible ? t("faq.visible") : t("faq.hidden")) : t("faq.newHelp");

  return (
    <Panel collapsible level={3} title={title} aside={aside} id={item ? `faq-${item.id}` : "faq-new"} data-testid={item ? "faq-card" : "faq-new-card"}>
      {item && <input type="hidden" name={name("id")} value={item.id} />}
      <LocaleTabPanels
        idPrefix={`faq-q${index}`}
        // «Tradu cardul: RO → EN» in the tab row (§514): this question's English from its Romanian.
        translateCard
        panels={LANGUAGES.map((language) => {
          const field = <B extends "question" | "category">(box: B) => `${box}${language.suffix}` as `${B}${"Ro" | "En"}`;
          return {
            locale: language.locale,
            label: t(`faq.${language.label}`),
            content: (
              <Stack spacing={2} sx={{ pt: 2 }}>
                <RecallField
                  name={name(field("question"))}
                  label={t(`faq.${field("question")}`)}
                  fullWidth
                  defaultValue={item ? (language.locale === "ro" ? item.questionRo : item.questionEn) : ""}
                  helperText={t("faq.questionHelp")}
                  slotProps={{ htmlInput: { maxLength: FAQ_QUESTION_MAX, lang: language.locale } }}
                />
                <RecallField
                  name={name(field("category"))}
                  label={t(`faq.${field("category")}`)}
                  fullWidth
                  defaultValue={item ? ((language.locale === "ro" ? item.categoryRo : item.categoryEn) ?? "") : ""}
                  helperText={t("faq.categoryHelp")}
                  slotProps={{ htmlInput: { maxLength: FAQ_CATEGORY_MAX, lang: language.locale } }}
                />
                <LazyRichTextEditor
                  name={name(language.locale === "ro" ? "answerRoBody" : "answerEnBody")}
                  label={t(`faq.answer${language.suffix}`)}
                  summary={t(`faq.answer${language.suffix}`)}
                  emptyHint={t("faq.textEmpty")}
                  initialBody={item ? (language.locale === "ro" ? item.answerRo : item.answerEn) : null}
                  accessibleSuffix={`${language.suffix.toUpperCase()} ${index + 1}`}
                  features={{ media: true, tables: false }}
                  labels={rich}
                />
                <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
                  {t("faq.answerHelp", { max: String(FAQ_ANSWER_MAX) })}
                </Typography>
              </Stack>
            ),
          };
        })}
      />

      <Stack direction="row" sx={{ mt: 1.5, flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        {/* The arrows are the save itself, with the move (`parseFaqMove`): nothing typed is lost. */}
        {item && index > 0 && (
          <Button type="submit" name="move" value={`${index}:up`} variant="outlined" sx={{ minHeight: 44, minWidth: 44 }} aria-label={t("faq.moveUpNamed", { question: title })}>
            ↑
          </Button>
        )}
        {item && index < count - 1 && (
          <Button type="submit" name="move" value={`${index}:down`} variant="outlined" sx={{ minHeight: 44, minWidth: 44 }} aria-label={t("faq.moveDownNamed", { question: title })}>
            ↓
          </Button>
        )}
        {mayShow && (
          <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, cursor: "pointer" }}>
            <RecallCheckbox name={name("visible")} defaultChecked={item?.visible ?? false} data-testid="faq-visible" />
            {t("faq.onSite")}
          </Box>
        )}
        {mayRemove && (
          <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, cursor: "pointer", color: "error.main" }}>
            <RecallCheckbox name={name("remove")} data-testid="faq-remove" />
            {t("faq.remove")}
          </Box>
        )}
      </Stack>
    </Panel>
  );
}

