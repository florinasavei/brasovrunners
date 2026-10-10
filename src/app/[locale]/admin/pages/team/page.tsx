import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
import GlyphChip from "@/modules/events/ui/GlyphChip";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import {
  TEAM_BIO_MAX,
  TEAM_NAME_MAX,
  TEAM_RESPONSIBILITIES_MAX_LINES,
  TEAM_RESPONSIBILITY_LINE_MAX,
  TEAM_ROLE_MAX,
  TEAM_SUBTITLE_MAX,
} from "@/modules/content/team/fields";
import { MAX_TEAM_LINKS, type TeamLinkKind } from "@/modules/content/team/links";
import { teamLinkKindWords } from "@/modules/content/team/ui/kind-words";
import { readTeamPageSettings, TEAM_INTRO_MAX, teamIntroDocs, type TeamPageSettings } from "@/modules/content/team/page-settings";
import { type AdminTeamMember, listTeamBoxesForAdmin, listTeamMembersForAdmin } from "@/modules/content/team/repository";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import TeamLinkRowsEditor, { type TeamLinkRowsLabels } from "@/modules/content/team/ui/TeamLinkRowsEditor";
import TeamPhotoField, { type TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import { noticeDescribesTeamPage } from "@/modules/legal-documents/repository";
import { canEditTeamPage, canReadContent, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallHidden } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import BoxesCard from "./BoxesCard";
import {
  createTeamMemberAction,
  deleteTeamMemberAction,
  moveTeamMemberAction,
  saveTeamMemberAction,
  saveTeamPageIntroAction,
  setTeamMemberVisibleAction,
  setTeamPagePublishedAction,
} from "./actions";

const AddPersonIcon = ACTION_ICONS.addPerson;
const IntroIcon = ACTION_ICONS.intro;
const EditIcon = ACTION_ICONS.edit;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Echipa» in the backoffice (§459): every card of the team page, one under the other in the
 * page's own order, each with what it says, whether it is on the site, and its verbs.
 *
 * Read by whoever reads the club's content (§208); every control is offered only to the role its
 * action asserts, and the action asserts it again (BR-REQ-060-01): writing a card is the
 * Redactor's and the Administrator's, showing one on the site the Administrator's alone (§201).
 *
 * The page itself comes first (§459): DRAFT until an Administrator publishes it — both languages at
 * once, asked first (§384) — and an optional introduction in both languages or neither (§352).
 * While the privacy notice in force does not describe the page (`{{teamPage}}`), a warning says so
 * beside the switch; `/admin/tasks` carries the same row.
 *
 * One page and no editor route: a card is a name, a role, the words about the person, their links
 * and a photo, so it is written in a fold on its own row — closed, with its words on the line,
 * until somebody opens it (§336) — rather than behind a second screen. The words are the rich-text
 * editor's, each language in a fold of its own that mounts the editor only when opened (§96,
 * §474), so a screen of twenty cards starts no editor at all. Each form carries a scope, so the ids
 * the refusal summary links to are never shared between two cards.
 */
export default async function AdminTeamPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const db = getDb();
  const [members, boxes, settings, noticeDescribed] = await Promise.all([
    listTeamMembersForAdmin(db),
    listTeamBoxesForAdmin(db),
    readTeamPageSettings(db),
    noticeDescribesTeamPage(db, new Date()),
  ]);
  // «Răspunde în fața» (§691): every card by name, so a form may name any other card as its parent.
  const cardNames = members.map((member) => ({ id: member.id, name: member.name }));
  const mayEdit = canEditTeamPage(actor.role);
  const mayShow = canShowTeamMember(actor.role);
  const storage = isStorageConfigured();
  const shown = members.filter((member) => member.visible).length;
  const publicHref = getPathname({ locale, href: "/team" });

  const editing: Editing = {
    rich: richTextEditorLabels(await getTranslations("Admin.richText")),
    links: {
      kind: t("team.linkRows.kind"),
      url: t("team.linkRows.url"),
      labelRo: t("team.linkRows.labelRo"),
      labelEn: t("team.linkRows.labelEn"),
      add: t("team.linkRows.add"),
      remove: t("team.linkRows.remove"),
      moveUp: t("team.linkRows.moveUp"),
      moveDown: t("team.linkRows.moveDown"),
      row: t("team.linkRows.row"),
    },
    // The card's own words for each kind — what the page shows when a link has no label (§474).
    kinds: await teamLinkKindWords(),
  };
  // Each link row's four boxes by the name the editor posts, so the summary says "Linkul 2: adresa".
  const linkBoxes = Object.fromEntries(
    Array.from({ length: MAX_TEAM_LINKS }, (_, index) =>
      (["kind", "url", "labelRo", "labelEn"] as const).map((box) => [`links[${index}].${box}`, `${editing.links.row} ${index + 1}: ${editing.links[box]}`]),
    ).flat(),
  );
  const messages = await refusalMessages({
    name: t("team.name"),
    roleRo: t("team.roleRo"),
    roleEn: t("team.roleEn"),
    bioRoBody: t("team.bioRo"),
    bioEnBody: t("team.bioEn"),
    links: t("team.links"),
    ...linkBoxes,
    photoAssetId: t("team.photo"),
    introRoBody: t("team.introRo"),
    introEnBody: t("team.introEn"),
    // The chart (§691): a card's sub-role, responsibilities, parent and placement, and a box's title and text.
    subtitleRo: t("team.subtitleRo"),
    subtitleEn: t("team.subtitleEn"),
    responsibilitiesRo: t("team.responsibilitiesRo"),
    responsibilitiesEn: t("team.responsibilitiesEn"),
    reportsToId: t("team.reportsTo"),
    placement: t("team.placement"),
    titleRo: t("team.boxes.titleRo"),
    titleEn: t("team.boxes.titleEn"),
    bodyRoBody: t("team.boxes.bodyRo"),
    bodyEnBody: t("team.boxes.bodyEn"),
  });
  const photoLabels: TeamPhotoLabels = {
    legend: t("team.photo"),
    choose: t("team.photoChoose"),
    replace: t("team.photoReplace"),
    remove: t("team.photoRemove"),
    uploading: t("team.photoUploading"),
    failed: t("team.photoFailed"),
    none: t("team.photoNone"),
    help: t("team.photoHelp"),
    // A picture the club already stored (§485), in the editor's own picker words.
    fromGallery: t("team.photoFromGallery"),
    gallery: {
      loading: t("richText.imageGalleryLoading"),
      empty: t("richText.imageGalleryEmpty"),
      close: t("richText.linkCancel"),
      filter: t("richText.imageGalleryFilter"),
      noMatch: t("richText.imageGalleryNoMatch"),
      sourceLegend: t("richText.imageGallerySourceLegend"),
      sources: {
        all: t("richText.imageGallerySourceAll"),
        event: t("richText.imageGallerySourceEvent"),
        album: t("richText.imageGallerySourceAlbum"),
        page: t("richText.imageGallerySourcePage"),
        team: t("richText.imageGallerySourceTeam"),
      },
    },
    // The gallery's words for the same choice (§414), one set for every upload — four levels (§437).
    quality: {
      legend: t("gallery.qualityLegend"),
      low: t("gallery.qualityLow"),
      normal: t("gallery.qualityNormal"),
      high: t("gallery.qualityHigh"),
      original: t("gallery.qualityOriginal"),
      help: t("gallery.qualityHelp", {
        lowMax: String(LOW_WEB_MAX),
        normalMax: String(WEB_MAX),
        highMax: String(HIGH_WEB_MAX),
        originalMax: String(ORIGINAL_WEB_MAX),
      }),
    },
    // The upload every other picture has (§541): the crop box, the chosen file and what it became —
    // the text editor's own words, the card's title and help beside them.
    crop: {
      title: t("team.photoCrop"),
      help: t("team.photoCropHelp"),
      reset: editing.rich.imageCropReset,
      position: editing.rich.imageCropPosition,
      ...editing.rich.imageShapes,
    },
    chosen: editing.rich.imageChosen,
    stored: editing.rich.imageStored,
    picked: editing.rich.imageFromGalleryPicked,
  };

  return (
    <Stack spacing={3}>
      <PagesSubNav locale={locale} active="team" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("team.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("team.intro")}
        </Typography>
        <Typography variant="body2">
          {shown > 0 ? t("team.shownCount", { count: shown, total: members.length }) : t("team.noneShown")}{" "}
          {shown > 0 && settings.status === "PUBLISHED" && (
            <MuiLink href={publicHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("team.viewPublic")}
            </MuiLink>
          )}
        </Typography>
        {!mayEdit && <Alert severity="info">{t("team.readOnly")}</Alert>}
        {mayEdit && !mayShow && <Alert severity="info">{t("team.showIsAdmin")}</Alert>}
        {mayEdit && !storage && <Alert severity="warning">{t("team.noStorage")}</Alert>}
      </Stack>

      <PageCard
        settings={settings}
        noticeDescribed={noticeDescribed}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        editing={editing}
        mayEdit={mayEdit}
        mayShow={mayShow}
      />

      {mayEdit && (
        <Box component="details" id="team-new" sx={BOXED_DISCLOSURE_SX}>
          <summary>
            <AddPersonIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("team.add")}
          </summary>
          <ActionForm action={createTeamMemberAction} messages={messages} scope="new" data-testid="team-create-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <MemberFields scope="new" member={null} cards={cardNames} words={t} photoLabels={photoLabels} editing={editing} storage={storage} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("team.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}

      {members.length === 0 ? (
        <Typography variant="body1">{t("team.empty")}</Typography>
      ) : (
        <Stack component="ol" spacing={2} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("team.listLabel")}>
          {members.map((member, index) => (
            <MemberCard
              key={member.id}
              member={member}
              cards={cardNames}
              first={index === 0}
              last={index === members.length - 1}
              locale={locale}
              words={t}
              cancel={words.cancel}
              messages={messages}
              photoLabels={photoLabels}
              editing={editing}
              mayEdit={mayEdit}
              mayShow={mayShow}
              storage={storage}
            />
          ))}
        </Stack>
      )}

      {/* «Casetele paginii» (§691): the club's titled texts under the chart, in the discount codes' shape (§552). */}
      <BoxesCard boxes={boxes} locale={locale} words={t} cancel={words.cancel} messages={messages} rich={editing.rich} mayEdit={mayEdit} mayShow={mayShow} />
    </Stack>
  );
}

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** A card as another card's possible parent: its id and the name the select shows (§691). */
type CardName = { id: string; name: string };

/** What the rich-text editors and the links' rows need, translated once on the server (§474). */
type Editing = {
  rich: ReturnType<typeof richTextEditorLabels>;
  links: TeamLinkRowsLabels;
  kinds: Record<TeamLinkKind, string>;
};

/**
 * The page as a whole: whether it is on the site, the switch that puts it there or takes it off
 * (the Administrator's, asked first), and the club's introduction in both languages or neither.
 */
function PageCard({
  settings,
  noticeDescribed,
  locale,
  words: t,
  cancel,
  messages,
  editing,
  mayEdit,
  mayShow,
}: {
  settings: TeamPageSettings;
  noticeDescribed: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  editing: Editing;
  mayEdit: boolean;
  mayShow: boolean;
}) {
  const published = settings.status === "PUBLISHED";
  const intro = teamIntroDocs(settings);
  const ro = getPathname({ locale: "ro", href: "/team" });
  const en = getPathname({ locale: "en", href: "/team" });
  return (
    <Paper variant="outlined" id="team-page" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("team.pageHeading")}
          </Typography>
          <GlyphChip glyph={published ? "visible" : "hidden"} color={published ? "success" : "default"} label={published ? t("team.pagePublished") : t("team.pageDraft")} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {published ? t("team.pagePublishedHelp", { ro, en }) : t("team.pageDraftHelp")}
        </Typography>
        {!noticeDescribed && <Alert severity="warning">{t("team.noticeMissing")}</Alert>}
        {mayShow && (
          <ActionForm
            action={setTeamPagePublishedAction}
            confirm={
              published
                ? { title: t("team.unpublishTitle"), body: t("team.unpublishBody"), confirmLabel: t("team.unpublish"), cancelLabel: cancel, destructive: true }
                : { title: t("team.publishTitle"), body: t("team.publishBody", { ro, en }), confirmLabel: t("team.publish"), cancelLabel: cancel }
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
              {published ? t("team.unpublish") : t("team.publish")}
            </GlyphButton>
          </ActionForm>
        )}
        {mayEdit && (
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <summary>
              <IntroIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {t("team.introFold")}
            </summary>
            <ActionForm action={saveTeamPageIntroAction} messages={messages} scope="intro" data-testid="team-intro-form">
              <input type="hidden" name="uiLocale" value={locale} />
              {/* The page's own column, so the whole toolbar: a picture, a film, a table (§474). */}
              <Stack spacing={1.5}>
                {/* «Copiază și tradu tot: RO → EN» (§464, §482): the introduction's English from its Romanian. */}
                <TranslateAllButton />
                <LazyRichTextEditor
                  name="introRoBody"
                  label={t("team.introRo")}
                  summary={t("team.introRo")}
                  emptyHint={t("team.textEmpty")}
                  initialBody={intro.ro}
                  accessibleSuffix="RO"
                  labels={editing.rich}
                />
                <LazyRichTextEditor
                  name="introEnBody"
                  label={t("team.introEn")}
                  summary={t("team.introEn")}
                  emptyHint={t("team.textEmpty")}
                  initialBody={intro.en}
                  accessibleSuffix="EN"
                  labels={editing.rich}
                />
                <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
                  {t("team.introHelp", { max: TEAM_INTRO_MAX })}
                </Typography>
              </Stack>
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </ActionForm>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

/** One card on the screen: its line, its verbs, and its words in a fold. */
function MemberCard({
  member,
  cards,
  first,
  last,
  locale,
  words: t,
  cancel,
  messages,
  photoLabels,
  editing,
  mayEdit,
  mayShow,
  storage,
}: {
  member: AdminTeamMember;
  cards: readonly CardName[];
  first: boolean;
  last: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  photoLabels: TeamPhotoLabels;
  editing: Editing;
  mayEdit: boolean;
  mayShow: boolean;
  storage: boolean;
}) {
  const role = locale === "ro" ? member.roleRo : member.roleEn;
  const scope = `m${member.id.slice(0, 8)}`;
  const mayDelete = mayEdit && (!member.visible || mayShow);
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="memberId" value={member.id} />
    </>
  );

  return (
    <Paper component="li" variant="outlined" id={`team-${member.id}`} sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        {member.photo ? (
          // The card's own drawing (§541): the crop the club drew, or the square it always was.
          <TeamPhotoImage src={member.photo.thumbUrl} photo={member.photo} width={64} radius={8} />
        ) : (
          <Box aria-hidden sx={{ width: 64, height: 64, borderRadius: 2, bgcolor: "action.hover", flexShrink: 0 }} />
        )}
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {member.name}
          </Typography>
          {role && (
            <Typography variant="body2" color="text.secondary">
              {role}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
            <GlyphChip glyph={member.visible ? "visible" : "hidden"} color={member.visible ? "success" : "default"} label={member.visible ? t("team.visible") : t("team.hidden")} />
            {!member.photo && <GlyphChip glyph="hidden" variant="outlined" label={t("team.noPhoto")} />}
            {member.links.length > 0 && <GlyphChip glyph="link" variant="outlined" label={t("team.linkCount", { count: member.links.length })} />}
            {oneSided(member) && <GlyphChip glyph="language" variant="outlined" color="warning" label={t("team.oneLanguage")} />}
          </Stack>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
        {mayEdit && !first && (
          <Box component="form" action={moveTeamMemberAction}>
            {hidden}
            <input type="hidden" name="direction" value="up" />
            <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("team.moveUpNamed", { name: member.name })} />
          </Box>
        )}
        {mayEdit && !last && (
          <Box component="form" action={moveTeamMemberAction}>
            {hidden}
            <input type="hidden" name="direction" value="down" />
            <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("team.moveDownNamed", { name: member.name })} />
          </Box>
        )}
        {mayShow && (
          // Putting a person on the site, or taking them off, asks first (§384).
          <ActionForm
            action={setTeamMemberVisibleAction}
            confirm={
              member.visible
                ? { title: t("team.hideTitle", { name: member.name }), body: t("team.hideBody"), confirmLabel: t("team.hide"), cancelLabel: cancel, destructive: true }
                : { title: t("team.showTitle", { name: member.name }), body: t("team.showBody"), confirmLabel: t("team.show"), cancelLabel: cancel }
            }
          >
            {hidden}
            <input type="hidden" name="expectedVersion" value={member.version} />
            <input type="hidden" name="visible" value={member.visible ? "false" : "true"} />
            <GlyphButton
              icon={member.visible ? "unpublish" : "publish"}
              type="submit"
              variant="outlined"
              color={member.visible ? "warning" : "primary"}
              sx={{ minHeight: 44 }}
            >
              {member.visible ? t("team.hide") : t("team.show")}
            </GlyphButton>
          </ActionForm>
        )}
        {mayDelete && (
          <ActionForm
            action={deleteTeamMemberAction}
            confirm={{ title: t("team.deleteTitle", { name: member.name }), body: t("team.deleteBody"), confirmLabel: t("team.delete"), cancelLabel: cancel, destructive: true }}
          >
            {hidden}
            <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
              {t("team.delete")}
            </GlyphButton>
          </ActionForm>
        )}
      </Stack>

      {mayEdit && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>
            <EditIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("team.edit")}
          </summary>
          <ActionForm action={saveTeamMemberAction} messages={messages} scope={scope} data-testid={`team-save-${member.id}`}>
            {hidden}
            <RecallHidden name="expectedVersion" value={member.version} />
            <MemberFields scope={scope} member={member} cards={cards} words={t} photoLabels={photoLabels} editing={editing} storage={storage} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Paper>
  );
}

/** A pair with one side written (only a hand-made or older row can hold one): the next save refuses it. */
function oneSided(member: AdminTeamMember): boolean {
  const written = (value: string | null) => (value ?? "").trim() !== "";
  return (
    written(member.roleRo) !== written(member.roleEn) ||
    written(member.subtitleRo) !== written(member.subtitleEn) ||
    written(member.responsibilitiesRo) !== written(member.responsibilitiesEn) ||
    (member.bioRo === null) !== (member.bioEn === null)
  );
}

/**
 * The boxes of a card, for adding one and for writing one: the name, then the role Română and
 * English side by side from `sm` — both or neither, the partner description's pattern (§352) —
 * then the words about the person in the rich-text editor, one fold per language (§474), the
 * person's links, and the photo.
 */
function MemberFields({
  scope,
  member,
  cards,
  words: t,
  photoLabels,
  editing,
  storage,
}: {
  scope: string;
  member: AdminTeamMember | null;
  /** Every card by name — the choices of «Răspunde în fața» (§691), less this card itself. */
  cards: readonly CardName[];
  words: Words;
  photoLabels: TeamPhotoLabels;
  editing: Editing;
  storage: boolean;
}) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  const parents = cards.filter((card) => card.id !== member?.id);
  // A parent that is gone or hidden still reads as stored; the select shows it only if it is still a card.
  const reportsTo = parents.some((card) => card.id === member?.reportsToId) ? (member?.reportsToId ?? "") : "";
  return (
    <Stack spacing={2}>
      {/* «Copiază și tradu tot: RO → EN» (§464, §482): this card's role, sub-role, responsibilities
          (§691, line for line), words and link labels in English from the Romanian, in this card's
          form alone — every card posts the same names (`translate/domain/fields.ts`). */}
      <TranslateAllButton />
      <RecallField
        name="name"
        label={t("team.name")}
        required
        fullWidth
        defaultValue={member?.name ?? ""}
        helperText={t("team.nameHelp")}
        slotProps={{ htmlInput: { maxLength: TEAM_NAME_MAX } }}
      />
      <Box sx={pairSx}>
        <RecallField
          name="roleRo"
          label={t("team.roleRo")}
          fullWidth
          defaultValue={member?.roleRo ?? ""}
          helperText={t("team.roleHelp")}
          slotProps={{ htmlInput: { maxLength: TEAM_ROLE_MAX, lang: "ro" } }}
        />
        <RecallField
          name="roleEn"
          label={t("team.roleEn")}
          fullWidth
          defaultValue={member?.roleEn ?? ""}
          helperText={t("team.bothOrNeither")}
          slotProps={{ htmlInput: { maxLength: TEAM_ROLE_MAX, lang: "en" } }}
        />
      </Box>
      {/*
        The organisational chart (§691): the one-line sub-role under the role, «Responsabilități» one
        per line, whom the card answers to (a native select of the other cards by name, «— nimeni, în
        vârf —» first) and where it sits against that card. Every pair both languages or neither (§352).
      */}
      <Box sx={pairSx}>
        <RecallField
          name="subtitleRo"
          label={t("team.subtitleRo")}
          fullWidth
          defaultValue={member?.subtitleRo ?? ""}
          helperText={t("team.subtitleHelp")}
          slotProps={{ htmlInput: { maxLength: TEAM_SUBTITLE_MAX, lang: "ro" } }}
        />
        <RecallField
          name="subtitleEn"
          label={t("team.subtitleEn")}
          fullWidth
          defaultValue={member?.subtitleEn ?? ""}
          helperText={t("team.bothOrNeither")}
          slotProps={{ htmlInput: { maxLength: TEAM_SUBTITLE_MAX, lang: "en" } }}
        />
      </Box>
      <Box sx={pairSx}>
        <RecallField
          name="responsibilitiesRo"
          label={t("team.responsibilitiesRo")}
          fullWidth
          multiline
          minRows={3}
          defaultValue={member?.responsibilitiesRo ?? ""}
          helperText={t("team.responsibilitiesHelp", { lines: TEAM_RESPONSIBILITIES_MAX_LINES, max: TEAM_RESPONSIBILITY_LINE_MAX })}
          slotProps={{ htmlInput: { lang: "ro" } }}
        />
        <RecallField
          name="responsibilitiesEn"
          label={t("team.responsibilitiesEn")}
          fullWidth
          multiline
          minRows={3}
          defaultValue={member?.responsibilitiesEn ?? ""}
          helperText={t("team.bothOrNeither")}
          slotProps={{ htmlInput: { lang: "en" } }}
        />
      </Box>
      <Box sx={pairSx}>
        <RecallField
          name="reportsToId"
          select
          fullWidth
          label={t("team.reportsTo")}
          defaultValue={reportsTo}
          helperText={t("team.reportsToHelp")}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="">{t("team.reportsToNone")}</option>
          {parents.map((card) => (
            <option key={card.id} value={card.id}>
              {card.name}
            </option>
          ))}
        </RecallField>
        <RecallField
          name="placement"
          select
          fullWidth
          label={t("team.placement")}
          defaultValue={member?.placement ?? "below"}
          helperText={t("team.placementHelp")}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="below">{t("team.placementBelow")}</option>
          <option value="beside">{t("team.placementBeside")}</option>
        </RecallField>
      </Box>
      {/*
        The words about the person in the editor every page uses (§474): paragraphs, a list, a link
        in the text, a picture. No table — a card two to a row on a phone has no room for one, and
        the save refuses it. Folded, so a screen of cards mounts no editor until one is opened (§96).
      */}
      <Stack spacing={1.5}>
        <LazyRichTextEditor
          name="bioRoBody"
          label={t("team.bioRo")}
          summary={t("team.bioRo")}
          emptyHint={t("team.textEmpty")}
          initialBody={member?.bioRo ?? null}
          accessibleSuffix="RO"
          features={{ media: true, tables: false }}
          labels={editing.rich}
        />
        <LazyRichTextEditor
          name="bioEnBody"
          label={t("team.bioEn")}
          summary={t("team.bioEn")}
          emptyHint={t("team.textEmpty")}
          initialBody={member?.bioEn ?? null}
          accessibleSuffix="EN"
          features={{ media: true, tables: false }}
          labels={editing.rich}
        />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {t("team.bioHelp", { max: TEAM_BIO_MAX })}
        </Typography>
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle2" component="p">
          {t("team.links")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("team.linksHelp", { max: MAX_TEAM_LINKS })}
        </Typography>
        <TeamLinkRowsEditor
          initial={(member?.links ?? []).map((link) => ({ kind: link.kind, url: link.url, labelRo: link.labelRo ?? "", labelEn: link.labelEn ?? "" }))}
          labels={editing.links}
          kindLabels={editing.kinds}
        />
      </Stack>
      {storage ? (
        <TeamPhotoField
          photo={
            member?.photoAssetId && member.photo
              ? { id: member.photoAssetId, src: member.photo.webUrl, preview: member.photo.thumbUrl, width: member.photo.width, height: member.photo.height }
              : null
          }
          crop={member?.photo?.crop ?? null}
          labels={photoLabels}
          inputId={`team-photo-${scope}`}
        />
      ) : (
        // No store on this deployment: the card keeps whatever photo it had, and gets none new.
        <input type="hidden" name="photoAssetId" value={member?.photoAssetId ?? ""} />
      )}
    </Stack>
  );
}
