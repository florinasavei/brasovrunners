"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import RunnerLoader, { RunnerLoaderStyles } from "@/shared/ui/RunnerLoader";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { THEN_FIELD, THEN_PUBLISH } from "../form-names";
import { askPublishGaps } from "./PublishCheck";
import { missingForPublish, type PublishGap } from "./publish-check";

type Props = {
  label: string;
  pendingLabel: string;
  /** The languages the public page needs. */
  locales: readonly string[];
  /** The id of the summary a press opens while something publication needs is missing (`PublishGapsSummary`). */
  summaryId: string;
};

/**
 * What publication would refuse, read off the form as it stands (`missingForPublish`, the same
 * check the Publicare box's list and every card's closed line run, so none of them disagree).
 */
function publicationGaps(form: HTMLFormElement, locales: readonly string[]): PublishGap[] {
  const data = new FormData(form);
  return missingForPublish((name) => String(data.get(name) ?? ""), locales);
}

/**
 * "Creează și publică" (`DECISIONS.md` §315; the owner: "ar trebui sa pot crea si publica
 * dintr-un foc!") — the second submit button of the create form, shown only to a role that may
 * publish, posting the same form with `then=publish` so the action creates the event and walks
 * the two transitions in the create's own transaction.
 *
 * **Always its full self** (§NNN; the owner, 2026-09-25: "I am missing the create and publish for
 * some new events… this should be consistent!"). It used to dim to 38% while a box publication
 * needs was empty, and a dimmed button reads as no button. Now it looks the same on every kind of
 * event at every moment, and the press is what answers: while something is missing it posts
 * nothing and opens the §47 summary instead — focusable, each missing box and language a link —
 * and brings the first card that lacks one to the top (`askPublishGaps`). The card's own closed
 * line already said so (`CardRequiredLine`).
 *
 * Only the publication gaps are this button's to answer: once none is left the press goes to the
 * browser, which refuses a box it holds invalid with its own bubble (§315), and then to the
 * server, which refuses again whatever the browser let through — the guard, never this button.
 * Without JavaScript the press posts, the server creates the draft, the guard refuses the
 * publication, and the editor names what is missing (§315).
 * Inside its form and never beside it: a submit button outside its form drives no Server Action.
 */
export default function CreateAndPublishButton({ label, pendingLabel, locales, summaryId }: Props) {
  const status = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);

  // Only this button's own press: the plain create beside it shares the form's status.
  const pending = status.pending && status.data?.get(THEN_FIELD) === THEN_PUBLISH;
  // The publication verb's own glyph at rest, as on the editor's "Publică" (§318), and the
  // runner in its place while this press is in flight, at the size of the glyph it replaces.
  const PublishGlyph = ACTION_ICONS.publish;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Button
        ref={ref}
        type="submit"
        name={THEN_FIELD}
        value={THEN_PUBLISH}
        variant="outlined"
        size="medium"
        aria-disabled={status.pending}
        aria-busy={pending}
        // No ink under the finger, as `SubmitButton` (§371); the keyboard's focus ripple stays.
        disableTouchRipple
        startIcon={pending ? <RunnerLoader size={20} color="inherit" /> : <PublishGlyph fontSize="small" />}
        sx={TAP_TARGET}
        onClick={(event) => {
          if (status.pending) {
            event.preventDefault();
            return;
          }
          const form = ref.current?.form;
          if (!form) return;
          // The click runs before the browser validates the form it submits: while publication
          // would be refused, nothing is posted and the summary says why (§NNN).
          if (publicationGaps(form, locales).length > 0) {
            event.preventDefault();
            askPublishGaps(summaryId);
          }
        }}
        data-testid="create-and-publish"
      >
        {pending ? pendingLabel : label}
      </Button>
      {/* The runner's styles, drawn with the page, so the press adds none (§371). */}
      <RunnerLoaderStyles size={20} color="inherit" />
    </Box>
  );
}
