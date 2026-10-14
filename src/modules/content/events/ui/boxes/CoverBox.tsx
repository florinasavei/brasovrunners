import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TeamPhotoField from "@/modules/content/team/ui/TeamPhotoField";
import { storedTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { isStorageConfigured } from "@/modules/media/storage";
import Panel from "@/shared/ui/Panel";
import { type CoverPicture, findCoverPicture } from "../../repository";
import { coverPhotoLabels } from "../cover-labels";
import { BoxNote, type BoxProps } from "./box-kit";

/** The cover's crop box starts at the card's own frame (§454): the largest 16∶9 of the picture. */
export const COVER_SHAPE = "16:9" as const;

/**
 * «Copertă» (the facelift's phase 2, §709; `docs/REDESIGN.md`): the event's cover picture, chosen
 * like every picture in the house — uploaded with the quality choice, or «Din galerie» (§485) — and
 * cropped in the crop box (§541), starting at the card's 16∶9. The field is «Echipa»'s, given its
 * own stem (`event.cover`) the way the shop's size guide took it (§705), so it posts
 * `event.coverAssetId` and `event.coverCrop` with the event's one save; nothing is kept until then,
 * and an unkept upload is swept after a week (§73).
 *
 * A named card inside card 2 «Titlu și rezumat» since §NNN (the owner, 2026-10-13: «practic vreau
 * mai puține carduri și mai mult nesting»): the cover travels with the title wherever the event is
 * shown as a card or shared. It was a card of its own among those not on the page (§406); no public
 * page shows it yet, so it promises nothing a visitor sees today. The same field, names and id
 * `#box-cover`. A settings card: a role that may not change the event row reads its heading and its
 * line, and the server asks again.
 */
export default async function CoverBox({ event, mayEditSettings, picture: given }: BoxProps & { picture?: CoverPicture | null }) {
  const t = await getTranslations("Admin");
  const storage = isStorageConfigured();
  const picture = given === undefined ? await coverPicture(event) : given;
  const card = {
    id: "box-cover",
    glyph: "pictures",
    level: 3,
    title: t("editor.boxes.cover.title"),
    aside: picture ? t("editor.cover.set") : t("editor.cover.missing"),
    "data-testid": "cover-box",
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;
  return (
    <Panel collapsible {...card}>
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
    </Panel>
  );
}

/**
 * The stored picture's facts — the master for the crop box, the small file for the preview, the
 * size — read only when a store is configured; an id that names nothing reads as no cover. Read once
 * by «Titlu și rezumat», whose closed line says whether there is one (§NNN), and handed to the card.
 */
export async function coverPicture(event: BoxProps["event"]): Promise<CoverPicture | null> {
  return isStorageConfigured() && event?.coverMediaAssetId ? findCoverPicture(getDb(), event.coverMediaAssetId) : null;
}
