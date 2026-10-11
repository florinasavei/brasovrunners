import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TeamPhotoField from "@/modules/content/team/ui/TeamPhotoField";
import { storedTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { isStorageConfigured } from "@/modules/media/storage";
import Panel from "@/shared/ui/Panel";
import { findCoverPicture } from "../../repository";
import { coverPhotoLabels } from "../cover-labels";
import { BoxNote, type BoxProps, SettingsReadOnly } from "./box-kit";

/** The cover's crop box starts at the card's own frame (§454): the largest 16∶9 of the picture. */
export const COVER_SHAPE = "16:9" as const;

/**
 * «Copertă» (the facelift's phase 2, §NNN; `docs/REDESIGN.md`): the event's cover picture, chosen
 * like every picture in the house — uploaded with the quality choice, or «Din galerie» (§485) — and
 * cropped in the crop box (§541), starting at the card's 16∶9. The field is «Echipa»'s, given its
 * own stem (`event.cover`) the way the shop's size guide took it (§705), so it posts
 * `event.coverAssetId` and `event.coverCrop` with the event's one save; nothing is kept until then,
 * and an unkept upload is swept after a week (§73).
 *
 * Among the cards not on the page (the plan draws the cover from phase 3 on, under «Aspectul nou»):
 * no public page shows it yet, so it promises nothing a visitor sees today. A settings card: a role
 * that may not change the event row reads one line instead, and the server asks again.
 */
export default async function CoverBox({ event, mayEditSettings }: BoxProps) {
  const t = await getTranslations("Admin");
  const storage = isStorageConfigured();
  // The stored picture's facts — the master for the crop box, the small file for the preview, the
  // size — read only when a store is configured; an id that names nothing reads as no cover.
  const picture = storage && event?.coverMediaAssetId ? await findCoverPicture(getDb(), event.coverMediaAssetId) : null;
  const aside = picture ? t("editor.cover.set") : t("editor.cover.missing");
  return (
    <Panel glyph="pictures" collapsible id="box-cover" title={t("editor.boxes.cover.title")} aside={aside} data-testid="cover-box">
      {mayEditSettings ? (
        <Stack spacing={1.5}>
          <BoxNote>{t("editor.cover.intro")}</BoxNote>
          {storage ? (
            <TeamPhotoField
              photo={picture ? { id: picture.id, src: picture.webUrl, preview: picture.thumbUrl, width: picture.width, height: picture.height } : null}
              crop={picture ? storedTeamPhotoCrop(event?.coverCrop) : null}
              labels={coverPhotoLabels(t, richTextEditorLabels(await getTranslations("Admin.richText")))}
              inputId="event-cover"
              fieldPrefix="event.cover"
              shape={COVER_SHAPE}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("editor.cover.noStorage")}
            </Typography>
          )}
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
