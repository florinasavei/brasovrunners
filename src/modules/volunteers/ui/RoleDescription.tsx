import Box from "@mui/material/Box";
import RichText from "@/modules/content/rich-text/ui/RichText";

/**
 * A role's «Descrierea rolului» on the public form (§765; the owner, 2026-10-14: «I need the rich text editor here for
 * responsibilities»): the editor's document drawn by `RichText` — the one renderer every page uses, the allowlist it was
 * validated by.
 *
 * Since §780 (amended; the owner, 2026-10-16: «colapsată descrierea și cu o cuinița de semnul întrebării») the description is
 * never drawn open on its own: the role's chip (`VolunteerRoleChip`) holds it behind a «?» — a native `<details>` — so this
 * draws the words only, flush under the name, never folded a second time inside (the old «Detalii» fold of §765 is gone with
 * the tile). A Server Component; a link in the document works, the chip drawing it outside the checkbox's label.
 *
 * Nothing is drawn for a role with no description in this language — never the other language's text (§28, §352).
 */
export default function RoleDescription({
  doc,
  words,
  bodyId,
  testId = "volunteer-role-description",
}: {
  /** The stored document for the page's language, or null. */
  doc: unknown;
  /** Its plain words: a blank one is no description. */
  words: string | null;
  /** The id of the words' box, so the role's tick can name it in `aria-describedby` (it is read with the box, open or not). */
  bodyId?: string;
  testId?: string;
}) {
  if (doc === null || doc === undefined || words === null || words.trim() === "") return null;
  return (
    <Box
      sx={{
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
}
