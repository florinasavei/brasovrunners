"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type KeyboardEvent, useCallback, useRef, useState, useSyncExternalStore } from "react";
import RecallField, { NeverKeptField, useRecall } from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { nextRetireStep, reasonAcceptable, RETIRE_REASON_MAX, RETIRE_REASON_MIN, type RetireStep } from "../domain/retire-steps";

/**
 * «Șterge» on a version somebody relied on, as two steps inside the page's form (§NNN; the owner,
 * 2026-09-29: «cu dublă confirmare»): step one says what happens, with the real counts, and asks
 * the reason; step two asks the version's number typed by hand and carries «Șterg versiunea N».
 *
 * A client island only for the stepping. Every word is handed in as a string by the Server
 * Component (§370), and the boxes are the form's own — `RecallField` keeps the reason after a
 * refusal, `NeverKeptField` empties the number (§315). With JavaScript off both steps are drawn at
 * once and the form posts the two answers together; the server checks both either way
 * (`deleteReliedOnVersion`, BR-REQ-060-01). A hidden step stays in the DOM, so its box still posts.
 */
export default function LegalRetireSteps({
  version,
  words,
}: {
  version: number;
  words: {
    stepOne: string;
    /** The consequences, one sentence each, with the counts already in words. */
    consequences: readonly string[];
    reasonLabel: string;
    reasonHelp: string;
    continueLabel: string;
    stepTwo: string;
    numberLabel: string;
    numberHelp: string;
    action: string;
    back: string;
    incompleteHint: string;
  };
}) {
  const recall = useRecall();
  // False on the server and on the hydrating render, so the two agree; true once the island runs.
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const reasonBox = useRef<HTMLDivElement>(null);
  const [reasonShort, setReasonShort] = useState(false);

  // Every answer from the server lands on the step whose box it named (`nextRetireStep`); the
  // "storing information from previous renders" pattern, so the first paint is already right.
  const start: RetireStep = recall.has ? nextRetireStep("reason", { type: "refused", fields: recall.named("reason") ? ["reason"] : [] }) : "reason";
  const [tracked, setTracked] = useState<{ generation: number; step: RetireStep }>({ generation: recall.generation, step: start });
  if (tracked.generation !== recall.generation) setTracked({ generation: recall.generation, step: start });
  const step = tracked.step;

  const reasonValue = () => reasonBox.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="reason"]')?.value ?? "";
  const goOn = () => {
    const reason = reasonValue();
    const next = nextRetireStep(step, { type: "continue", reason });
    setReasonShort(!reasonAcceptable(reason));
    setTracked({ generation: recall.generation, step: next });
    if (next === "number") {
      // After the paint that shows step two: the box the thumb types into next.
      requestAnimationFrame(() => document.getElementById(recall.idOf("typedConfirmation"))?.focus());
    }
  };
  // Enter in the reason box is «Continuă», never a submit of a step not yet shown.
  const onReasonKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      goOn();
    }
  };

  const showReason = !hydrated || step === "reason";
  const showNumber = !hydrated || step === "number";

  return (
    <Stack spacing={3}>
      <Box ref={reasonBox} sx={{ display: showReason ? "block" : "none" }} data-testid="legal-retire-step-one">
        <Stack spacing={1.5}>
          <Typography variant="h3" sx={{ fontSize: "1.05rem" }}>
            {words.stepOne}
          </Typography>
          {words.consequences.map((sentence) => (
            <Typography key={sentence} variant="body2">
              {sentence}
            </Typography>
          ))}
          <RecallField
            name="reason"
            label={words.reasonLabel}
            helperText={words.reasonHelp}
            required
            multiline
            minRows={2}
            error={reasonShort}
            onKeyDown={onReasonKey}
            slotProps={{ htmlInput: { minLength: RETIRE_REASON_MIN, maxLength: RETIRE_REASON_MAX } }}
          />
          {hydrated && (
            <Box>
              <GlyphButton icon="confirm" variant="contained" onClick={goOn} sx={{ minHeight: 44 }} data-testid="legal-retire-continue">
                {words.continueLabel}
              </GlyphButton>
            </Box>
          )}
        </Stack>
      </Box>

      <Box sx={{ display: showNumber ? "block" : "none" }} data-testid="legal-retire-step-two">
        <Stack spacing={1.5}>
          <Typography variant="h3" sx={{ fontSize: "1.05rem" }}>
            {words.stepTwo}
          </Typography>
          {/* Posted as `typedConfirmation`, which a refusal never puts back (§315): it is the guard. */}
          <NeverKeptField
            name="typedConfirmation"
            label={words.numberLabel}
            helperText={words.numberHelp}
            required={showNumber}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 12 } }}
            data-testid={`legal-retire-number-${version}`}
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <GlyphSubmitButton icon="delete" label={words.action} pendingLabel={words.action} incompleteHintNamed={words.incompleteHint} color="error" size="medium" />
            {hydrated && (
              <GlyphButton
                icon="undo"
                variant="outlined"
                onClick={() => setTracked({ generation: recall.generation, step: nextRetireStep(step, { type: "back" }) })}
                sx={{ minHeight: 44 }}
              >
                {words.back}
              </GlyphButton>
            )}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
