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
import { TEAM_BIO_MAX, TEAM_LINK_MAX, TEAM_NAME_MAX, TEAM_ROLE_MAX } from "@/modules/content/team/fields";
import { readTeamPageSettings, TEAM_INTRO_MAX, type TeamPageSettings } from "@/modules/content/team/page-settings";
import { type AdminTeamMember, listTeamMembersForAdmin } from "@/modules/content/team/repository";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import TeamPhotoField, { type TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import { noticeDescribesTeamPage } from "@/modules/legal-documents/repository";
import { canEditTeamPage, canReadContent, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
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
  createTeamMemberAction,
  deleteTeamMemberAction,
  moveTeamMemberAction,
  saveTeamMemberAction,
  saveTeamPageIntroAction,
  setTeamMemberVisibleAction,
  setTeamPagePublishedAction,
} from "./actions";

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
 * One page and no editor route: a card is five boxes and a photo, so it is written in a fold on
 * its own row — closed, with its words on the line, until somebody opens it (§336) — rather than
 * behind a second screen. Each form carries a scope, so the ids the refusal summary links to are
 * never shared between two cards.
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
  const [members, settings, noticeDescribed] = await Promise.all([
    listTeamMembersForAdmin(db),
    readTeamPageSettings(db),
    noticeDescribesTeamPage(db, new Date()),
  ]);
  const mayEdit = canEditTeamPage(actor.role);
  const mayShow = canShowTeamMember(actor.role);
  const storage = isStorageConfigured();
  const shown = members.filter((member) => member.visible).length;
  const publicHref = getPathname({ locale, href: "/team" });

  const messages = await refusalMessages({
    name: t("team.name"),
    roleRo: t("team.roleRo"),
    roleEn: t("team.roleEn"),
    bioRo: t("team.bioRo"),
    bioEn: t("team.bioEn"),
    link: t("team.link"),
    photoAssetId: t("team.photo"),
    introRo: t("team.introRo"),
    introEn: t("team.introEn"),
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
        mayEdit={mayEdit}
        mayShow={mayShow}
      />

      {mayEdit && (
        <Box component="details" id="team-new" sx={BOXED_DISCLOSURE_SX}>
          <summary>{t("team.add")}</summary>
          <ActionForm action={createTeamMemberAction} messages={messages} scope="new" data-testid="team-create-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <MemberFields scope="new" member={null} words={t} photoLabels={photoLabels} storage={storage} />
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
              first={index === 0}
              last={index === members.length - 1}
              locale={locale}
              words={t}
              cancel={words.cancel}
              messages={messages}
              photoLabels={photoLabels}
              mayEdit={mayEdit}
              mayShow={mayShow}
              storage={storage}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

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
  mayEdit,
  mayShow,
}: {
  settings: TeamPageSettings;
  noticeDescribed: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayEdit: boolean;
  mayShow: boolean;
}) {
  const published = settings.status === "PUBLISHED";
  const ro = getPathname({ locale: "ro", href: "/team" });
  const en = getPathname({ locale: "en", href: "/team" });
  return (
    <Paper variant="outlined" id="team-page" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("team.pageHeading")}
          </Typography>
          <Chip size="small" color={published ? "success" : "default"} label={published ? t("team.pagePublished") : t("team.pageDraft")} />
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
            <summary>{t("team.introFold")}</summary>
            <ActionForm action={saveTeamPageIntroAction} messages={messages} scope="intro" data-testid="team-intro-form">
              <input type="hidden" name="uiLocale" value={locale} />
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                <RecallField
                  name="introRo"
                  label={t("team.introRo")}
                  fullWidth
                  multiline
                  minRows={3}
                  defaultValue={settings.introRo ?? ""}
                  helperText={t("team.introHelp", { max: TEAM_INTRO_MAX })}
                  slotProps={{ htmlInput: { maxLength: TEAM_INTRO_MAX, lang: "ro" } }}
                />
                <RecallField
                  name="introEn"
                  label={t("team.introEn")}
                  fullWidth
                  multiline
                  minRows={3}
                  defaultValue={settings.introEn ?? ""}
                  helperText={t("team.bothOrNeither")}
                  slotProps={{ htmlInput: { maxLength: TEAM_INTRO_MAX, lang: "en" } }}
                />
              </Box>
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
  first,
  last,
  locale,
  words: t,
  cancel,
  messages,
  photoLabels,
  mayEdit,
  mayShow,
  storage,
}: {
  member: AdminTeamMember;
  first: boolean;
  last: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  photoLabels: TeamPhotoLabels;
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
          // eslint-disable-next-line @next/next/no-img-element -- the club's own stored thumbnail
          <img
            src={member.photo.thumbUrl}
            alt=""
            width={64}
            height={64}
            style={{ width: 64, height: 64, objectFit: "cover", objectPosition: "50% 25%", borderRadius: 8, flexShrink: 0 }}
          />
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
            <Chip size="small" color={member.visible ? "success" : "default"} label={member.visible ? t("team.visible") : t("team.hidden")} />
            {!member.photo && <Chip size="small" variant="outlined" label={t("team.noPhoto")} />}
            {oneSided(member) && <Chip size="small" variant="outlined" color="warning" label={t("team.oneLanguage")} />}
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
          <summary>{t("team.edit")}</summary>
          <ActionForm action={saveTeamMemberAction} messages={messages} scope={scope} data-testid={`team-save-${member.id}`}>
            {hidden}
            <RecallHidden name="expectedVersion" value={member.version} />
            <MemberFields scope={scope} member={member} words={t} photoLabels={photoLabels} storage={storage} />
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
  return written(member.roleRo) !== written(member.roleEn) || written(member.bioRo) !== written(member.bioEn);
}

/**
 * The boxes of a card, for adding one and for writing one: the name, then each pair Română and
 * English side by side from `sm` — both or neither, the partner description's pattern (§352) —
 * then the photo.
 */
function MemberFields({
  scope,
  member,
  words: t,
  photoLabels,
  storage,
}: {
  scope: string;
  member: AdminTeamMember | null;
  words: Words;
  photoLabels: TeamPhotoLabels;
  storage: boolean;
}) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Stack spacing={2}>
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
      <Box sx={pairSx}>
        <RecallField
          name="bioRo"
          label={t("team.bioRo")}
          fullWidth
          multiline
          minRows={3}
          defaultValue={member?.bioRo ?? ""}
          helperText={t("team.bioHelp", { max: TEAM_BIO_MAX })}
          slotProps={{ htmlInput: { maxLength: TEAM_BIO_MAX, lang: "ro" } }}
        />
        <RecallField
          name="bioEn"
          label={t("team.bioEn")}
          fullWidth
          multiline
          minRows={3}
          defaultValue={member?.bioEn ?? ""}
          helperText={t("team.bothOrNeither")}
          slotProps={{ htmlInput: { maxLength: TEAM_BIO_MAX, lang: "en" } }}
        />
      </Box>
      <RecallField
        name="link"
        label={t("team.link")}
        type="url"
        fullWidth
        defaultValue={member?.link ?? ""}
        helperText={t("team.linkHelp")}
        slotProps={{ htmlInput: { maxLength: TEAM_LINK_MAX, inputMode: "url" } }}
      />
      {storage ? (
        <TeamPhotoField
          assetId={member?.photoAssetId ?? null}
          previewUrl={member?.photo?.thumbUrl ?? null}
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
