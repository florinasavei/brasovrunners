import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  addStripPictureAction,
  moveStripPictureAction,
  removeStripPictureAction,
  updateHomePageAction,
} from "@/app/[locale]/admin/settings/appearance/actions";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { HOME_BUTTON_MAX, HOME_HEADLINE_MAX, HOME_SECTION_KEYS, HOME_SUBLINE_MAX } from "@/modules/appearance/domain/home-page";
import {
  ACTIVE_RUNNERS_FIELD,
  FOUNDED_ON_FIELD,
  HOME_SECTION_BOXES,
  type HomeTextBox,
  STEPS_BOXES,
  STEPS_PAGE_FIELD,
  STRIP_BOXES,
  WHY_BOXES,
} from "@/modules/appearance/domain/home-sections-form";
import type { HomePageState } from "@/modules/appearance/home-page";
import { coverPhotoLabels } from "@/modules/content/events/ui/cover-labels";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TeamPhotoField from "@/modules/content/team/ui/TeamPhotoField";
import { MAX_STRIP_PICTURES } from "@/modules/home/domain/photo-strip";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox, RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** A club page «Cum funcționează» may open: its id, its Romanian title and whether it is on the site. */
export type HomePageChoice = { id: string; title: string; published: boolean };

type Props = {
  locale: Locale;
  state: HomePageState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** The club's own pages («Pagini personalizate»), for the two «Cum funcționează» buttons. */
  pages: readonly HomePageChoice[];
  /** The page's `?saved=`, so the fold whose own save just landed opens on arrival (§336). */
  saved?: string;
  /** Why the fold opens on arrival (§336). */
  openWhen?: FoldOpenWhen;
};

/** The two choices, in the order the form shows them: off first, the default. */
const CHOICES = ["off", "on"] as const;

/** The hero's crop box starts at the largest 16∶9 of the picture, the hero's own frame. */
const HERO_SHAPE = "16:9" as const;

const LANGUAGES = ["ro", "en"] as const;
const suffix = (language: (typeof LANGUAGES)[number]) => (language === "ro" ? "Ro" : "En");

/** The hero's two pairs of boxes, each in both languages or neither (§352). */
const LINES = [
  { stem: "headline", max: HOME_HEADLINE_MAX },
  { stem: "subline", max: HOME_SUBLINE_MAX },
] as const;

/** The first two buttons' label pairs, each in both languages or neither (§352). */
const BUTTONS = [
  { stem: "buttonJoin", key: "join" },
  { stem: "buttonCalendar", key: "calendar" },
] as const;

/** The sentences a box stands in for when it is empty: the platform's own, from `HomeSections` (none for the quote). */
function platformKey(stem: string): string | null {
  const step = /^step(\d)$/.exec(stem);
  if (step) return `steps.items.${step[1]}`;
  const why = /^why(\d)(Title|Body)$/.exec(stem);
  if (why) return `why.items.${why[1]}.${why[2].toLowerCase()}`;
  const fixed: Record<string, string> = { stepsTitle: "steps.title", stepsLead: "steps.lead", stepsLink: "steps.link", whyTitle: "why.title", stripTitle: "strip.title" };
  return fixed[stem] ?? null;
}

/**
 * «Pagina principală» (§NNN; `docs/REDESIGN.md`, decision 3): a real home page at `/ro` and `/en`,
 * reached from the logo and never from a menu entry — one switch, off until the club says yes, and
 * then the one-press way back to the listing at the root.
 *
 * The shape of «Aspectul nou» beside it (§708): a Server Component, one form, a radio per choice,
 * Save behind the §384 confirmation. Under the choice, **one fold per part of the page**, closed on
 * arrival with a line that says what is in it (§336, the owner's «folds closed by default with a
 * summary line»): the hero (its photograph — `TeamPhotoField` under its own stem, `hero`: the upload
 * with its quality, «Din galerie», the crop box at 16∶9 — its two lines and its three buttons), which
 * sections the page draws, «Prima dată», «De ce» and the quote, the strip's heading and the numbers.
 * Every box is a pair, both languages or neither; an empty one shows, as its placeholder, the
 * platform's sentence the page draws instead. One «Copiază și tradu tot» over the form (§464, §482).
 *
 * The strip's pictures are chosen in a fold of their own after the form, one small form each — add,
 * ↑ / ↓, take out — as a product's pictures are (§697): a form cannot sit inside another, and a slow
 * upload never holds the page's boxes hostage. A role that may not change it reads the choice in force.
 */
export default async function HomePagePanel({ locale, state, mayEdit, pages, saved, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const platform = { ro: await getTranslations({ locale: "ro", namespace: "HomeSections" }), en: await getTranslations({ locale: "en", namespace: "HomeSections" }) };
  const words = await confirmWords();
  const { setting } = state;
  const choice = setting.on ? "on" : "off";
  const hero = setting.hero;
  const storage = isStorageConfigured();
  const store = storage ? getStorage() : null;
  const base = coverPhotoLabels(t, richTextEditorLabels(await getTranslations("Admin.richText")));
  const labels = {
    ...base,
    legend: t("homePage.heroLegend"),
    help: t("homePage.heroHelp"),
    crop: { ...base.crop, title: t("homePage.heroCropTitle"), help: t("homePage.heroCropHelp") },
  };
  const stripLabels = { ...base, legend: t("homePage.strip.addLegend"), help: t("homePage.strip.addHelp") };

  /** A box's label in one language: «Prima dată: pasul 3 (engleză)». */
  const boxLabel = (stem: string, language: (typeof LANGUAGES)[number]) => {
    const step = /^step(\d)$/.exec(stem);
    const why = /^why(\d)(Title|Body)$/.exec(stem);
    const box = step
      ? t("homePage.boxes.step", { number: step[1] })
      : why
        ? t(`homePage.boxes.reason${why[2]}`, { number: why[1] })
        : t(`homePage.boxes.${stem}`);
    return t(`homePage.inLanguage.${language}`, { box });
  };

  /** The value a box holds now: the club's words in that language, or empty for the platform's. */
  const valueAt = (box: HomeTextBox, language: (typeof LANGUAGES)[number]) => {
    const section = box.stem.startsWith("step") ? setting.steps : box.stem.startsWith("strip") ? setting.strip : setting.why;
    let node: unknown = section;
    for (const segment of box.path) node = (node as Record<string | number, unknown> | null | undefined)?.[segment];
    return (node as Record<string, string> | null | undefined)?.[language] ?? "";
  };

  /** The pairs of one fold, a row each: Romanian beside English from `sm`, stacked on a phone. */
  const pairs = (boxes: readonly HomeTextBox[]) =>
    boxes.map((box) => {
      const key = platformKey(box.stem);
      return (
        <Stack key={box.stem} direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          {LANGUAGES.map((language) => (
            <RecallField
              key={language}
              name={`${box.stem}${suffix(language)}`}
              label={boxLabel(box.stem, language)}
              fullWidth
              multiline={box.max > 120}
              defaultValue={valueAt(box, language)}
              placeholder={key ? platform[language](key) : undefined}
              slotProps={{ htmlInput: { maxLength: box.max, lang: language }, inputLabel: { shrink: true } }}
            />
          ))}
        </Stack>
      );
    });

  /** «Textele clubului» when the club wrote any box of the fold, else «Textele implicite». */
  const wordsAside = (boxes: readonly HomeTextBox[]) =>
    t(boxes.some((box) => valueAt(box, "ro") !== "") ? "homePage.folds.wordsClub" : "homePage.folds.wordsPlatform");

  /** A select of the club's pages, for a «Cum funcționează» button: none first, a draft marked as such. */
  const pageSelect = (name: string, value: string | null, help: string) => (
    <RecallField
      name={name}
      select
      fullWidth
      label={t("homePage.pageLabel")}
      defaultValue={value ?? ""}
      helperText={help}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
    >
      <option value="">{t("homePage.pageNone")}</option>
      {pages.map((page) => (
        <option key={page.id} value={page.id}>
          {page.published ? page.title : t("homePage.pageDraft", { title: page.title })}
        </option>
      ))}
    </RecallField>
  );

  const shownCount = HOME_SECTION_KEYS.filter((key) => setting.sections[key]).length;
  const pictures = setting.strip.pictures;
  const filledNumbers = [setting.numbers.foundedOn, setting.numbers.activeRunners].filter((value) => value !== null).length;
  const pictureCount = t(`homePage.strip.count.${countForm(pictures.length, locale)}`, { count: pictures.length });

  return (
    <Panel glyph="home" title={t("homePage.title")} intro={t("homePage.intro")} introMore={t("homePage.introMore")} id="home-page" data-testid="home-page" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="home-page-current">
        {t("homePage.current", { state: t(`homePage.choices.${choice}.name`) })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("homePage.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("homePage.readOnly")}
        </Typography>
      ) : (
        <Stack spacing={2} sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateHomePageAction}
            messages={await refusalMessages({
              page: t("homePage.legend"),
              heroAssetId: t("homePage.heroLegend"),
              headlineRo: t("homePage.headlineRo"),
              headlineEn: t("homePage.headlineEn"),
              sublineRo: t("homePage.sublineRo"),
              sublineEn: t("homePage.sublineEn"),
              buttonJoinRo: t("homePage.buttonJoinRo"),
              buttonJoinEn: t("homePage.buttonJoinEn"),
              buttonCalendarRo: t("homePage.buttonCalendarRo"),
              buttonCalendarEn: t("homePage.buttonCalendarEn"),
              buttonHowRo: t("homePage.buttonHowRo"),
              buttonHowEn: t("homePage.buttonHowEn"),
              buttonHowPageId: t("homePage.buttonHowPage"),
              [STEPS_PAGE_FIELD]: t("homePage.stepsPage"),
              [FOUNDED_ON_FIELD]: t("homePage.numbers.foundedOn"),
              [ACTIVE_RUNNERS_FIELD]: t("homePage.numbers.activeRunners"),
              ...Object.fromEntries(
                HOME_SECTION_BOXES.flatMap((box) => LANGUAGES.map((language) => [`${box.stem}${suffix(language)}`, boxLabel(box.stem, language)])),
              ),
            })}
            confirm={{
              title: t("confirm.homePageTitle"),
              body: t("confirm.homePageBody"),
              confirmLabel: t("homePage.save"),
              cancelLabel: words.cancel,
            }}
            scope="homePage"
            data-testid="home-page-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            {/* Each fold says the form carried it, so a save keeps whatever an older form did not show. */}
            <input type="hidden" name="sectionsPosted" value="1" />
            <input type="hidden" name="stepsPosted" value="1" />
            <input type="hidden" name="whyPosted" value="1" />
            <input type="hidden" name="stripPosted" value="1" />
            <input type="hidden" name="numbersPosted" value="1" />
            <Stack spacing={2} sx={{ maxWidth: 720 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("homePage.legend")}
                </Typography>
                {CHOICES.map((value) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={value}
                    component="label"
                    sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                    data-testid={`home-page-option-${value}`}
                  >
                    <RecallRadio name="page" value={value} defaultChecked={choice === value} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                        {t(`homePage.choices.${value}.name`)}
                        {value === "off" ? ` · ${t("homePage.default")}` : ""}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t(`homePage.choices.${value}.help`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>

              <TranslateAllButton />

              <Panel
                glyph="menuOrder"
                collapsible
                level={3}
                title={t("homePage.folds.sections")}
                aside={t("homePage.folds.sectionsAside", { shown: shownCount, total: HOME_SECTION_KEYS.length })}
                id="home-page-sections"
                data-testid="home-page-sections"
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("homePage.sectionsHelp")}
                </Typography>
                {HOME_SECTION_KEYS.map((key) => (
                  <Box key={key} component="label" sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, cursor: "pointer" }} data-testid={`home-page-section-${key}`}>
                    <RecallCheckbox name={`section_${key}`} defaultChecked={setting.sections[key]} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <Typography component="span" variant="body2">
                      {t(`homePage.sections.${key}`)}
                    </Typography>
                  </Box>
                ))}
              </Panel>

              <Panel
                glyph="title"
                collapsible
                level={3}
                title={t("homePage.folds.hero")}
                aside={t(hero ? "homePage.folds.heroWithPhoto" : "homePage.folds.heroEmpty")}
                id="home-page-hero"
                data-testid="home-page-hero"
              >
                <Stack spacing={2}>
                  {store ? (
                    <TeamPhotoField
                      photo={
                        hero
                          ? {
                              id: hero.assetId,
                              src: store.publicUrl(objectKey(hero.keyPrefix, "web")),
                              preview: store.publicUrl(objectKey(hero.keyPrefix, "thumb")),
                              width: hero.width,
                              height: hero.height,
                            }
                          : null
                      }
                      crop={hero?.crop ?? null}
                      labels={labels}
                      inputId="home-hero"
                      fieldPrefix="hero"
                      shape={HERO_SHAPE}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("homePage.noStorage")}
                    </Typography>
                  )}

                  {LINES.map(({ stem, max }) => (
                    <Box key={stem} component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                      <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                        {t(`homePage.${stem}Legend`)}
                      </Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        {LANGUAGES.map((language) => {
                          const name = `${stem}${suffix(language)}`;
                          return (
                            <RecallField
                              key={name}
                              name={name}
                              label={t(`homePage.${name}`)}
                              fullWidth
                              multiline={stem === "subline"}
                              defaultValue={setting[stem]?.[language] ?? ""}
                              helperText={t(`homePage.${stem}Help`)}
                              slotProps={{ htmlInput: { maxLength: max, lang: language } }}
                            />
                          );
                        })}
                      </Stack>
                    </Box>
                  ))}

                  <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                    <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {t("homePage.buttonsLegend")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                      {t("homePage.buttonsHelp")}
                    </Typography>
                    <Stack spacing={1.5}>
                      {BUTTONS.map(({ stem, key }) => (
                        <Stack key={stem} direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                          {LANGUAGES.map((language) => {
                            const name = `${stem}${suffix(language)}`;
                            return (
                              <RecallField
                                key={name}
                                name={name}
                                label={t(`homePage.${name}`)}
                                fullWidth
                                defaultValue={setting.buttons[key]?.[language] ?? ""}
                                slotProps={{ htmlInput: { maxLength: HOME_BUTTON_MAX, lang: language } }}
                              />
                            );
                          })}
                        </Stack>
                      ))}
                      {pageSelect("buttonHowPageId", setting.buttons.how?.pageId ?? null, t("homePage.buttonHowHelp"))}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        {LANGUAGES.map((language) => {
                          const name = `buttonHow${suffix(language)}`;
                          return (
                            <RecallField
                              key={name}
                              name={name}
                              label={t(`homePage.${name}`)}
                              fullWidth
                              defaultValue={setting.buttons.how?.label?.[language] ?? ""}
                              slotProps={{ htmlInput: { maxLength: HOME_BUTTON_MAX, lang: language } }}
                            />
                          );
                        })}
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Panel>

              <Panel glyph="help" collapsible level={3} title={t("homePage.folds.steps")} aside={wordsAside(STEPS_BOXES)} intro={t("homePage.folds.stepsIntro")} id="home-page-steps" data-testid="home-page-steps">
                <Stack spacing={1.5}>
                  {pairs(STEPS_BOXES)}
                  {pageSelect(STEPS_PAGE_FIELD, setting.steps.targetPageId, t("homePage.stepsPageHelp"))}
                </Stack>
              </Panel>

              <Panel glyph="description" collapsible level={3} title={t("homePage.folds.why")} aside={wordsAside(WHY_BOXES)} intro={t("homePage.folds.whyIntro")} id="home-page-why" data-testid="home-page-why">
                <Stack spacing={1.5}>{pairs(WHY_BOXES)}</Stack>
              </Panel>

              <Panel glyph="pictures" collapsible level={3} title={t("homePage.folds.strip")} aside={pictureCount} intro={t("homePage.folds.stripIntro")} id="home-page-strip" data-testid="home-page-strip">
                <Stack spacing={1.5}>{pairs(STRIP_BOXES)}</Stack>
              </Panel>

              <Panel
                glyph="summary"
                collapsible
                level={3}
                title={t("homePage.folds.numbers")}
                aside={t("homePage.folds.numbersAside", { filled: filledNumbers })}
                intro={t("homePage.folds.numbersIntro")}
                id="home-page-numbers"
                data-testid="home-page-numbers"
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <RecallField
                    name={FOUNDED_ON_FIELD}
                    type="date"
                    fullWidth
                    label={t("homePage.numbers.foundedOn")}
                    defaultValue={setting.numbers.foundedOn ?? ""}
                    helperText={t("homePage.numbers.foundedOnHelp")}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <RecallField
                    name={ACTIVE_RUNNERS_FIELD}
                    type="number"
                    fullWidth
                    label={t("homePage.numbers.activeRunners")}
                    defaultValue={setting.numbers.activeRunners ?? ""}
                    helperText={t("homePage.numbers.activeRunnersHelp")}
                    slotProps={{ htmlInput: { min: 1, max: 100000, step: 1, inputMode: "numeric" }, inputLabel: { shrink: true } }}
                  />
                </Stack>
              </Panel>

              <Box>
                <GlyphSubmitButton label={t("homePage.save")} pendingLabel={t("homePage.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>

          <Panel
            glyph="pictures"
            collapsible
            level={3}
            title={t("homePage.strip.title")}
            aside={pictureCount}
            intro={t("homePage.strip.intro", { max: MAX_STRIP_PICTURES })}
            id="home-strip-pictures"
            data-testid="home-strip-pictures"
            openWhen={{ saved: saved === "homeStrip" }}
          >
            <Stack spacing={2} sx={{ maxWidth: 720 }}>
              {pictures.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid="home-strip-none">
                  {t("homePage.strip.none")}
                </Typography>
              ) : (
                <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("homePage.strip.title")}>
                  {pictures.map((picture, index) => {
                    const number = index + 1;
                    const hidden = (
                      <>
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="stripAssetId" value={picture.assetId} />
                      </>
                    );
                    return (
                      <Box component="li" key={picture.assetId} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 } }} data-testid="home-strip-picture">
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                          {store && (
                            // eslint-disable-next-line @next/next/no-img-element -- the club's own stored thumbnail, square as its tile
                            <img
                              src={store.publicUrl(objectKey(picture.keyPrefix, "thumb"))}
                              alt=""
                              width={72}
                              height={72}
                              style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block" }}
                            />
                          )}
                          <Typography variant="body2" color="text.secondary">
                            {t("homePage.strip.position", { number })}
                          </Typography>
                          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                            {index > 0 && (
                              <Box component="form" action={moveStripPictureAction}>
                                {hidden}
                                <input type="hidden" name="direction" value="up" />
                                <GlyphSubmitButton icon="moveUp" label={t("homePage.strip.up")} pendingLabel={t("homePage.strip.up")} variant="outlined" ariaLabel={t("homePage.strip.moveUp", { number })} />
                              </Box>
                            )}
                            {index < pictures.length - 1 && (
                              <Box component="form" action={moveStripPictureAction}>
                                {hidden}
                                <input type="hidden" name="direction" value="down" />
                                <GlyphSubmitButton icon="moveDown" label={t("homePage.strip.down")} pendingLabel={t("homePage.strip.down")} variant="outlined" ariaLabel={t("homePage.strip.moveDown", { number })} />
                              </Box>
                            )}
                            <ActionForm
                              action={removeStripPictureAction}
                              confirm={{
                                title: t("homePage.strip.removeTitle"),
                                body: t("homePage.strip.removeBody"),
                                confirmLabel: t("homePage.strip.remove"),
                                cancelLabel: words.cancel,
                                destructive: true,
                              }}
                            >
                              {hidden}
                              <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }} aria-label={t("homePage.strip.removeNamed", { number })}>
                                {t("homePage.strip.remove")}
                              </GlyphButton>
                            </ActionForm>
                          </Stack>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              )}

              {!store ? (
                <Typography variant="body2" color="text.secondary">
                  {t("homePage.noStorage")}
                </Typography>
              ) : pictures.length >= MAX_STRIP_PICTURES ? (
                <Typography variant="body2" color="text.secondary" data-testid="home-strip-full">
                  {t("homePage.strip.full", { max: MAX_STRIP_PICTURES })}
                </Typography>
              ) : (
                <ActionForm
                  action={addStripPictureAction}
                  messages={await refusalMessages({ stripAssetId: t("homePage.strip.addLegend") })}
                  scope="homeStripAdd"
                  data-testid="home-strip-add"
                >
                  <input type="hidden" name="uiLocale" value={locale} />
                  <Stack spacing={1.5}>
                    <TeamPhotoField photo={null} crop={null} labels={stripLabels} inputId="home-strip-new" fieldPrefix="strip" noCrop />
                    <Box>
                      <GlyphSubmitButton label={t("homePage.strip.add")} pendingLabel={t("homePage.saving")} icon="add" />
                    </Box>
                  </Stack>
                </ActionForm>
              )}
            </Stack>
          </Panel>
        </Stack>
      )}

      {setting.on && (
        <Box sx={{ mt: 1.5 }}>
          <GlyphButtonLink icon="preview" href="/" variant="outlined" size="small" sx={TAP_TARGET} data-testid="home-page-open">
            {t("homePage.open")}
          </GlyphButtonLink>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("homePage.scope")}
      </Typography>
    </Panel>
  );
}
