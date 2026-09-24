"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { VALIDITY_PROXY_ATTRIBUTE } from "@/shared/forms/ValidityProxy";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import RunnerLoader, { RunnerLoaderStyles } from "@/shared/ui/RunnerLoader";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { THEN_FIELD, THEN_PUBLISH } from "../form-names";
import { missingForPublish, type PublishGap, publishGapLabel, type PublishGapLabels } from "./publish-check";

type Props = {
  label: string;
  pendingLabel: string;
  /** "Cannot publish yet — missing: {field}", with the placeholder. */
  notReadyHint: string;
  /** The languages the public page needs. */
  locales: readonly string[];
  /** The words a gap is named by — the box, the language, the field (§350). */
  labels: PublishGapLabels;
};

/**
 * What publication would refuse, read off the form as it stands (`missingForPublish`, the same
 * check the Publicare box's list runs, so the button and the list never disagree).
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
 * **It says why it waits.** While a publication requirement is visibly unmet the button dims
 * and names the first one, re-read on every keystroke. It stays pressable, like `SubmitButton`:
 * the press is what produces the specific answer.
 *
 * **And the press is refused in the browser** where the browser can know. The title, the
 * address and the meeting point carry `required` already, so the browser stops the press on
 * them itself. The summary does not — a draft may be saved without one; it is publication that
 * needs it (§170, §260) — so on this button's press, and only this one, the summary's proxy
 * (`ValidityProxy`, beside the editor's hidden field) is made required for the one validation
 * pass the press starts, and the browser refuses with its own bubble at the fold, bringing the
 * language forward and opening it. The plain "Creează" beside it never meets that rule.
 *
 * Never the only guard: without JavaScript the press posts, and the server creates the draft,
 * walks the transitions, is refused by the same guard, and the editor names what is missing.
 * Inside its form and never beside it: a submit button outside its form drives no Server Action.
 */
export default function CreateAndPublishButton({ label, pendingLabel, notReadyHint, locales, labels }: Props) {
  const status = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;

    const measure = () => {
      const first = publicationGaps(form, locales)[0];
      setMissing(first ? publishGapLabel(first, labels) : null);
    };
    // The editor writes its document into a hidden field after the keystroke it answers, so the
    // measure waits; the observer catches the write itself, whichever comes first. It waits for
    // the frame, too, and runs once for a burst (§NNN): a whole-form read on every mutation —
    // every keystroke in a rich text, every node of the commit that paints "Se salvează…" — was
    // work queued ahead of the very paint the reader was waiting for.
    const scheduler = paintedScheduler(measure);
    measure();
    form.addEventListener("input", scheduler.schedule);
    form.addEventListener("change", scheduler.schedule);
    const observer = new MutationObserver(scheduler.schedule);
    observer.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ["value"] });
    return () => {
      form.removeEventListener("input", scheduler.schedule);
      form.removeEventListener("change", scheduler.schedule);
      observer.disconnect();
      scheduler.cancel();
    };
  }, [locales, labels]);

  // Only this button's own press: the plain create beside it shares the form's status.
  const pending = status.pending && status.data?.get(THEN_FIELD) === THEN_PUBLISH;
  const dimmed = missing !== null && !status.pending;
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
        // No ink under the finger, as `SubmitButton` (§NNN); the keyboard's focus ripple stays.
        disableTouchRipple
        aria-describedby={dimmed ? "publish-not-ready" : undefined}
        startIcon={pending ? <RunnerLoader size={20} color="inherit" /> : <PublishGlyph fontSize="small" />}
        sx={{ ...TAP_TARGET, ...(dimmed ? { opacity: 0.38, cursor: "not-allowed" } : {}) }}
        onClick={(event) => {
          if (status.pending) {
            event.preventDefault();
            return;
          }
          const form = ref.current?.form;
          if (!form) return;
          // The click runs before the browser validates the form it submits: a summary that is
          // empty is made required for exactly this pass, and let go of straight after it.
          for (const gap of publicationGaps(form, locales)) {
            if (!gap.name.endsWith(".excerptBody")) continue;
            const proxy = form.querySelector<HTMLInputElement>(`[${VALIDITY_PROXY_ATTRIBUTE}="${gap.name}"]`);
            if (!proxy) continue;
            proxy.required = true;
            setTimeout(() => {
              proxy.required = false;
            }, 0);
          }
        }}
        data-testid="create-and-publish"
      >
        {pending ? pendingLabel : label}
      </Button>
      {/* The runner's styles, drawn with the page, so the press adds none (§NNN). */}
      <RunnerLoaderStyles size={20} color="inherit" />
      {dimmed && (
        <Typography id="publish-not-ready" variant="body2" color="text.secondary" role="status">
          {notReadyHint.replace("{field}", missing)}
        </Typography>
      )}
    </Box>
  );
}
