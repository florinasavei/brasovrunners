import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Box from "@mui/material/Box";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import { descriptionNeedsFold } from "../domain/volunteer";

/**
 * A role's «Descrierea rolului» under its tick on the public form (§NNN; the owner, 2026-10-14: «I need the rich text
 * editor here for responsibilities»): the editor's document drawn by `RichText` — the one renderer every page uses, the
 * allowlist it was validated by — indented under the box it belongs to. A description that runs past about three
 * lines (`descriptionNeedsFold`, read off its plain words) sits behind a native `<details>` «Detalii», so a long list
 * of tasks does not push the form away; a short one is simply there. A Server Component and a native fold: it works
 * with scripts off, and the summary is the 44 pixels every fold on a public page is.
 *
 * Nothing is drawn for a role with no description in this language — never the other language's text (§28, §352).
 */
export default function RoleDescription({
  doc,
  words,
  detailsLabel,
  bodyId,
  testId = "volunteer-role-description",
}: {
  /** The stored document for the page's language, or null. */
  doc: unknown;
  /** Its plain words: what decides whether it folds. */
  words: string | null;
  /** «Detalii» / "Details". */
  detailsLabel: string;
  /** The id of the words' box, so the role's tick can name it in `aria-describedby` (it is read with the box, folded or not). */
  bodyId?: string;
  testId?: string;
}) {
  if (doc === null || doc === undefined || words === null || words.trim() === "") return null;
  const body = (
    <Box
      sx={{
        // Under the box's label, not under the box: the tick is 44 pixels wide and the words start after it.
        pl: { xs: 4.5, sm: 5 },
        pr: 1,
        color: "text.secondary",
        typography: "body2",
        overflowWrap: "anywhere",
        "& p": { my: 0.5 },
        "& ul, & ol": { my: 0.5, pl: 2.5 },
      }}
      id={bodyId}
      data-testid={`${testId}-body`}
    >
      <RichText body={doc} />
    </Box>
  );
  if (!descriptionNeedsFold(words)) {
    return <Box data-testid={testId}>{body}</Box>;
  }
  return (
    <Box
      component="details"
      data-testid={testId}
      data-folded="true"
      sx={{ pl: { xs: 4.5, sm: 5 }, "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 0.5 }, ...DISCLOSURE_OPEN_ARROW, "& > div": { pl: 0 } }}
    >
      <Box component="summary">
        <InfoOutlinedIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
        {detailsLabel}
      </Box>
      {body}
    </Box>
  );
}
