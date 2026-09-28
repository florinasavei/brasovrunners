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
 * What publication would refuse, read off the form (`missingForPublish`, the same check the
 * Publicare list and each card's closed line run).
 */
function publicationGaps(form: HTMLFormElement, locales: readonly string[]): PublishGap[] {
  const data = new FormData(form);
  return missingForPublish((name) => String(data.get(name) ?? ""), locales);
}

/**
 * "Creează și publică" (§315, §406): the create form's second submit, for a role that may
 * publish, posting `then=publish`. Always at full look: while a publication gap remains the press
 * posts nothing and opens the §47 summary instead (`askPublishGaps`). With no gaps left the
 * browser and then the server validate as usual; without JavaScript the server creates the draft
 * and the guard names what is missing. Must sit inside its form to drive the Server Action.
 */
export default function CreateAndPublishButton({ label, pendingLabel, locales, summaryId }: Props) {
  const status = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);

  // Only this button's own press: the plain create beside it shares the form's status.
  const pending = status.pending && status.data?.get(THEN_FIELD) === THEN_PUBLISH;
  // The publish glyph at rest (§318); the runner in its place while this press is in flight.
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
          // Runs before the browser validates: with a publication gap, post nothing (§406).
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
