import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import type { PictureColumn } from "@/modules/media/ladder";
import { DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { TEAM_CANVAS } from "@/theme/brand";
import { riseIn } from "@/theme/motion";
import type { TeamLinkKind } from "../links";
import type { PublicTeamMember } from "../repository";
import TeamMemberLinks, { teamPhotoWidths } from "./TeamMemberLinks";
import TeamPhotoImage from "./TeamPhotoImage";

/**
 * One card of «Echipa»'s canvas (§NNN, amending §691; the president's drawing): a white card on the
 * blue, in one of three shapes the card's level decides —
 *
 * - `wide`, row 1's single `.0`: the photo on the left, the words on the right, the president's
 *   card — only while she is alone at the lead; two leads on row 1 are drawn tall, like a row under;
 * - `tall`, a `.0` on the rows under: the photo on top, the words under it, three to a row;
 * - `small`, any `.5`: compact, the photo on the left, beside the leads of its row — the
 *   counsellor at the president's side. No label of its own: the role title the club typed says
 *   what the person is.
 *
 * Closed, a card is the photo in the crop the club drew (§541), the name, the role title in the
 * club's blue, the sub-role and the first three responsibilities. «Mai multe» — the owner: «we can
 * click into each person to see more details» — is a `details` fold on the card itself, server
 * rendered and closed, no script and no route of its own: open, it continues the responsibilities
 * to the last one, then the words about the person and their links (§474). Nothing hidden is kept
 * out of the HTML; the fold only folds. The summary is a 44-pixel target that draws its own arrow
 * (`DISCLOSURE_SX`, §325) and, after it, the person glyph by its registry name (`GLYPHS.person`,
 * §521, §694): the arrow says "this opens", the glyph says what is inside — never a second
 * chevron that would not turn. The person's name is in its accessible name, so twenty «Mai multe»
 * on one page are twenty different buttons to a screen reader.
 *
 * The photo's `sizes` is the column the shape is drawn in (§414): a tall card is one, two, three to
 * a row like an album's cover (`cover`), a wide card's photo is the 240/280-pixel column beside the
 * words (`aside`), a small card's the 88/104-pixel thumbnail (`thumb`).
 *
 * Every colour is `TEAM_CANVAS`'s (`theme/brand.ts`): the card keeps the brand's light colours
 * after dark, where the palette's ink and link colours would not read on white. A Server Component:
 * every prop is data (§370).
 */

export type TeamCanvasVariant = "wide" | "tall" | "small";

/** The catalogue's words a card needs, once per page. */
export type TeamCanvasWords = {
  more: string;
  moreAbout: (name: string) => string;
  responsibilities: string;
  linksLabel: (name: string) => string;
  kinds: Record<TeamLinkKind, string>;
};

/** How many responsibilities a closed card shows; the rest are behind «Mai multe». */
export const CANVAS_SHOWN_RESPONSIBILITIES = 3;

const PersonIcon = GLYPHS.person;

const SMALL_TEXT = { xs: "0.8125rem", sm: "0.875rem" } as const;

/** The name's size, by shape: the president's largest, a small card's the body's. */
const NAME_SIZE: Record<TeamCanvasVariant, string | Record<string, string>> = {
  wide: { xs: "1.25rem", sm: "1.5rem" },
  tall: { xs: "1.0625rem", sm: "1.125rem" },
  small: "1rem",
};

/** The photo's box, by shape: a band across a tall card, a column beside the words otherwise. */
const PHOTO_WIDTH: Record<TeamCanvasVariant, string | number | Record<string, string | number>> = {
  wide: { xs: "100%", sm: 240, md: 280 },
  tall: "100%",
  small: { xs: 88, sm: 104 },
};

/** The ladder column each shape's photo is drawn in (`media/ladder.ts`, §414), so `sizes` says its true width. */
const PHOTO_COLUMN: Record<TeamCanvasVariant, PictureColumn> = { wide: "aside", tall: "cover", small: "thumb" };

/** The words about a person (§474) at the card's size, in the card's own colours. */
const BIO_SX = {
  color: TEAM_CANVAS.inkMuted,
  overflowWrap: "anywhere",
  mt: 1,
  "& p, & li": { fontSize: SMALL_TEXT, lineHeight: 1.45 },
  "& p": { mb: 1 },
  "& p:last-child": { mb: 0 },
  "& h2, & h3": { fontSize: { xs: "0.875rem", sm: "0.9375rem" }, mt: 1.5, mb: 0.5, color: TEAM_CANVAS.ink },
  "& ul, & ol": { pl: 2.5, mb: 1 },
  "& a": { color: TEAM_CANVAS.title },
  "& figure": { width: "100%", my: 1, float: "none", marginLeft: "auto", marginRight: "auto" },
  "& figcaption": { textAlign: "center", color: TEAM_CANVAS.inkMuted },
} as const;

const LIST_SX = { m: 0, pl: 2.5, color: TEAM_CANVAS.inkMuted, "& li": { fontSize: SMALL_TEXT, lineHeight: 1.45, overflowWrap: "anywhere" } } as const;

export default function TeamCanvasCard({
  member,
  variant,
  index,
  words,
}: {
  member: PublicTeamMember;
  variant: TeamCanvasVariant;
  /** The card's place on the canvas, for the rise-in's stagger and the first photos' eager load. */
  index: number;
  words: TeamCanvasWords;
}) {
  const shown = member.responsibilities.slice(0, CANVAS_SHOWN_RESPONSIBILITIES);
  const rest = member.responsibilities.slice(CANVAS_SHOWN_RESPONSIBILITIES);
  const hasMore = rest.length > 0 || member.bio !== null || member.links.length > 0;
  const sideways = variant !== "tall";
  return (
    <Card
      component="li"
      variant="outlined"
      data-testid="team-canvas-card"
      data-variant={variant}
      sx={{
        ...riseIn(index),
        bgcolor: TEAM_CANVAS.card,
        color: TEAM_CANVAS.ink,
        borderColor: TEAM_CANVAS.line,
        display: "flex",
        // The wide card stacks on a phone, where 320 pixels hold no photo beside four lines of words.
        flexDirection: variant === "wide" ? { xs: "column", sm: "row" } : sideways ? "row" : "column",
        alignItems: "stretch",
        minWidth: 0,
        height: "100%",
      }}
    >
      {member.photo && (
        <Box sx={{ width: PHOTO_WIDTH[variant], flexShrink: 0, alignSelf: sideways ? "flex-start" : "auto" }}>
          {/* Our own WebP ladder (§414) in the crop the club drew (§541); the name is beside it, so `alt` is empty. */}
          <TeamPhotoImage
            src={member.photo.thumbUrl}
            {...teamPhotoWidths(member.photo, PHOTO_COLUMN[variant])}
            photo={member.photo}
            loading={index < 4 ? "eager" : "lazy"}
            testId="team-photo"
          />
        </Box>
      )}
      <Box sx={{ p: variant === "small" ? 1.5 : 2, minWidth: 0, flex: 1 }}>
        <Typography variant="h2" sx={{ fontSize: NAME_SIZE[variant], mb: 0.25, overflowWrap: "anywhere" }}>
          {member.name}
        </Typography>
        {member.role && (
          <Typography variant="body2" sx={{ color: TEAM_CANVAS.title, fontWeight: 700, fontSize: SMALL_TEXT, mb: 0.5 }}>
            {member.role}
          </Typography>
        )}
        {member.subtitle && (
          <Typography variant="body2" data-testid="team-subtitle" sx={{ color: TEAM_CANVAS.inkMuted, fontSize: SMALL_TEXT, mb: 1, overflowWrap: "anywhere" }}>
            {member.subtitle}
          </Typography>
        )}
        {shown.length > 0 && (
          <Box data-testid="team-responsibilities">
            <Typography component="h3" variant="subtitle2" sx={{ fontSize: SMALL_TEXT, fontWeight: 700, mt: 0.5, color: TEAM_CANVAS.ink }}>
              {words.responsibilities}
            </Typography>
            <Box component="ul" sx={LIST_SX}>
              {shown.map((line, lineIndex) => (
                <li key={lineIndex}>{line}</li>
              ))}
            </Box>
          </Box>
        )}
        {hasMore && (
          <Box component="details" data-testid="team-more" sx={{ ...DISCLOSURE_SX, mt: 0.5 }}>
            <Typography component="summary" variant="body2" aria-label={words.moreAbout(member.name)} sx={{ fontWeight: 600, color: TEAM_CANVAS.title }}>
              <PersonIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              {words.more}
            </Typography>
            {rest.length > 0 && (
              // The responsibilities from the fourth on, continuing the list above; one list to the eye.
              <Box component="ul" data-testid="team-responsibilities-rest" sx={LIST_SX}>
                {rest.map((line, lineIndex) => (
                  <li key={lineIndex}>{line}</li>
                ))}
              </Box>
            )}
            {member.bio && (
              // Through the renderer's allowlist, never markup the club did not type (§11.3).
              <Box sx={BIO_SX} data-testid="team-bio">
                <RichText body={member.bio} pictures="tile" />
              </Box>
            )}
            {member.links.length > 0 && (
              <TeamMemberLinks
                links={member.links}
                label={words.linksLabel(member.name)}
                kindWords={words.kinds}
                fontSize={SMALL_TEXT}
                linkColor={TEAM_CANVAS.title}
                glyphColor={TEAM_CANVAS.inkMuted}
              />
            )}
          </Box>
        )}
      </Box>
    </Card>
  );
}
