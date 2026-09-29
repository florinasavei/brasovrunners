"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import {
  CANCEL_REASON_FIELDS,
  CANCEL_REASON_MAX,
  type CancelReasonProblem,
} from "@/modules/registrations/domain/cancel-reason";

type Props = {
  /** «De ce anulezi?» — the select's label. */
  label: string;
  /** The empty first choice, «Alege motivul». */
  choose: string;
  /** The three answers in the form's order, each worded on the server in the page's language. */
  options: ReadonlyArray<{ value: string; label: string }>;
  textLabel: string;
  textHelp: string;
  /** The box a refused press named (`?reason=`), for this person's form only. */
  problem?: CancelReasonProblem;
  /** The refusal's sentence, worded on the server. */
  problemText?: string;
};

/**
 * Why the person cancels (§558; the owner, 2026-09-29: «when people cancel, they need to provide a
 * reason»): a native select of three answers and, for «Alt motiv», a short text of their own — the
 * boxes of the cancel form they sit in, at every self-cancellation door (the manage page,
 * «Înscrierile mele», the family wizard's «Renunț»).
 *
 * Works before hydration and without JavaScript: the select is native and `required`, the text box is
 * hidden by CSS alone unless «Alt motiv» is the selected option (`:has`, and shown to a browser that
 * lacks it), and the server refuses a missing answer or text naming the box, whatever the browser did.
 * With JavaScript the text box is also `required` while «Alt motiv» is chosen, so the browser names it
 * before the question opens (`AskFirstButton` asks the form to report first).
 *
 * **A courtesy, not the rule** (BR-REQ-060-01): `parseCancelReason` on the server is the rule.
 */
export default function CancelReasonFields({ label, choose, options, textLabel, textHelp, problem, problemText }: Props) {
  // «Alt motiv» is chosen again when the refusal was about its words.
  const initial = problem === "text" || problem === "long" ? "OTHER" : "";
  const [kind, setKind] = useState(initial);

  return (
    <Box
      id={problem ? "cancel-reason" : undefined}
      data-testid="cancel-reason"
      sx={{
        display: "grid",
        gap: 1.5,
        my: 1.5,
        maxWidth: 420,
        "@supports selector(:has(*))": {
          "&:not(:has(option[value='OTHER']:checked)) [data-cancel-reason-other]": { display: "none" },
        },
      }}
    >
      {problem && problemText && (
        <Alert severity="error" role="alert">
          {problemText}
        </Alert>
      )}
      <TextField
        select
        required
        name={CANCEL_REASON_FIELDS.kind}
        label={label}
        defaultValue={initial}
        onChange={(event) => setKind(event.target.value)}
        error={problem === "kind"}
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        <option value="">{choose}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </TextField>
      <Box data-cancel-reason-other>
        <TextField
          name={CANCEL_REASON_FIELDS.text}
          label={textLabel}
          helperText={textHelp}
          required={kind === "OTHER"}
          error={problem === "text" || problem === "long"}
          size="small"
          fullWidth
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: CANCEL_REASON_MAX } }}
        />
      </Box>
    </Box>
  );
}
