import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { youtubeVideoId } from "@/modules/events/domain/video";
import Panel from "@/shared/ui/Panel";
import { BoxNote, type BoxProps } from "./box-kit";

/**
 * "Filmul" (§69, §110, §406): the card for the page's film section — last year's film, behind one
 * press, under the rules (`EventVideo`). The editor had no card for it: the box was taken away on
 * the owner's word ("link video should not be present anymore since we have the rich text
 * editor"), and a film has been a figure in the description since, placed with the rich text's
 * YouTube button (§266). The page still draws the section for an older event that carries the
 * link, so the editor that mirrors the page (§406) says where it is.
 *
 * **Read-only, on purpose.** It posts nothing — `videoUrl` absent from a save means "not editing
 * the film", so the stored link survives every save (§266) — and offers no box, which would bring
 * back the second way in the owner removed. It says whether the page shows a film, gives the link
 * when there is one, and points at the description for a new one.
 */
export default async function VideoBox({ event, heading }: BoxProps) {
  const t = await getTranslations("Admin");
  const link = event?.videoUrl && youtubeVideoId(event.videoUrl) ? event.videoUrl : null;
  return (
    <Panel collapsible id="box-video" title={heading ?? t("editor.boxes.video.title")} aside={link ? t("editor.boxes.video.stored") : t("editor.boxes.video.none")}>
      <Stack spacing={1}>
        {link && (
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            <Link href={link} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }} data-testid="stored-video">
              {link}
            </Link>
          </Typography>
        )}
        <BoxNote>{link ? t("editor.boxes.video.storedHelp") : t("editor.boxes.video.noneHelp")}</BoxNote>
        <Typography variant="body2">
          <Link href="#box-description" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
            {t("editor.boxes.video.toDescription")}
          </Link>
        </Typography>
      </Stack>
    </Panel>
  );
}
