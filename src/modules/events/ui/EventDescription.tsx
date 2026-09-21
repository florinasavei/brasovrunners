import Box from "@mui/material/Box";
import { planEventDescription } from "../domain/description";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventExcerpt from "./EventExcerpt";

/**
 * The event's description, in one place, for the page and its preview (`DECISIONS.md` §187).
 *
 * ## The rule, in a sentence
 *
 * The page shows the long description when it has words; otherwise the summary — and then
 * whatever a wordless long description holds, a picture or a film. One slot, directly under the
 * title, whichever field filled it.
 *
 * ## Why this exists
 *
 * The owner, having just used the editor: "pagina de edit event și main e diferită… rezumatul
 * apare înainte descrierii full! Fi consistent man!" Three separate things were true at once,
 * and a survey of every surface that renders either field found all of them:
 *
 * 1. **The order contradicted the editor.** §170 put Conținut first and Rezumat under it, on the
 *    grounds that asking for a summary of something not yet written is what left summaries
 *    empty. The page kept the summary's slot under the title and rendered the long description
 *    eighty lines and six blocks lower — after the facts, the registration call to action, the
 *    five-step panel, the share row and the street address.
 * 2. **The one description moved half a page depending on which field was filled.** A
 *    summary-only event read its prose under the title; an event with a long description read it
 *    below the address. Same editorial role, two positions, and the more somebody wrote the
 *    further down it went.
 * 3. **A long description that was only a picture or only a film was silently dropped.** The
 *    page guarded both slots with `isRichTextEmpty`, which is defined over the plain text, while
 *    `EventExcerpt` has always guarded itself with `hasRichTextContent`, which counts a picture.
 *    So an organizer who wrote a picture-only Conținut saw the Rezumat in its place and his
 *    picture nowhere — "the summary is there and my full description is not", exactly.
 *
 * ## The two predicates, deliberately both
 *
 * `planEventDescription` is where that lives, and it is pure: `hasRichTextContent` decides
 * whether the long description renders at all, `isRichTextEmpty` decides whether it contributed
 * any **words**, and the summary stands in when it did not. That is what keeps a picture-only
 * Conținut from taking the page's prose down with it — the reader gets the sentence and then the
 * picture. Reading the question with one predicate is what caused defect 3 above, so the pair is
 * stated in a function with a test rather than spread across two JSX guards.
 *
 * ## Why a component and not two copies
 *
 * The preview is the only way to read a draft before publication, and it rendered the body five
 * blocks higher than the live page did — so an organizer checked one layout and shipped another.
 * Two call sites, one component: they cannot drift again.
 */
export default function EventDescription({
  bodyJson,
  excerptJson,
  excerpt,
}: {
  bodyJson: unknown;
  excerptJson: unknown;
  excerpt: string | null;
}) {
  const { showsSummary, showsBody } = planEventDescription(bodyJson);

  return (
    <>
      {showsSummary && <EventExcerpt excerptJson={excerptJson} excerpt={excerpt} />}
      {showsBody && (
        <Box sx={{ mb: 2 }}>
          <RichText body={bodyJson} />
        </Box>
      )}
    </>
  );
}
