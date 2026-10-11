import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { TEAM_CANVAS } from "@/theme/brand";
import { riseIn } from "@/theme/motion";
import type { PublicTeamBox } from "../repository";

/**
 * One of the page's boxes (§691) at the bottom of the canvas (§701; the president's drawing: three
 * light boxes under the cards): its heading and the club's text through the renderer every page
 * uses, on the hero's tint — the card colour walked towards the club's blue, a step lighter than
 * the canvas and a step darker than a card, so the boxes read as the canvas's own footer rather
 * than as three more people. The same colours after dark, as the canvas (`TEAM_CANVAS`).
 */
export default function TeamCanvasBox({ box, index }: { box: PublicTeamBox; index: number }) {
  return (
    <Card
      component="article"
      variant="outlined"
      data-testid="team-box"
      sx={{ ...riseIn(index), bgcolor: TEAM_CANVAS.box, color: TEAM_CANVAS.ink, borderColor: TEAM_CANVAS.line, minWidth: 0 }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.0625rem", sm: "1.125rem" }, mb: 1, overflowWrap: "anywhere" }}>
          {box.title}
        </Typography>
        <Box
          sx={{
            overflowWrap: "anywhere",
            "& > :last-child": { mb: 0 },
            "& p, & li": { fontSize: { xs: "0.875rem", sm: "0.9375rem" } },
            "& a": { color: TEAM_CANVAS.title },
            "& figcaption": { color: TEAM_CANVAS.inkMuted },
          }}
        >
          <RichText body={box.body} />
        </Box>
      </CardContent>
    </Card>
  );
}
