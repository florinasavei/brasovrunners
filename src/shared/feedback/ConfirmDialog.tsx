"use client";

import AltRouteIcon from "@mui/icons-material/AltRoute";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import SendIcon from "@mui/icons-material/Send";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { useId, useState } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { emailRoadCookieLine } from "./email-road";
import { type ConfirmSpec, confirmOnKey } from "./notice";

/**
 * The one confirmation dialog of the backoffice (`DECISIONS.md` §384): "are you sure", worded
 * on the server with the consequence and its values, drawn on the client.
 *
 * Driven by `ActionForm`'s `confirm` prop for every single-verb form, by `ConfirmSubmitButton`
 * where one form carries several verbs, and by nothing else — the row menus and the message
 * composer used to draw dialogs of their own, and every one of them now submits a form that asks.
 *
 * **A courtesy, not a permission** (BR-REQ-060-01): what it finally does is `requestSubmit()` on
 * the form, and the Server Action behind it asserts the role, the version and every rule exactly
 * as it did before the dialog existed. With JavaScript off there is no dialog and the form posts.
 *
 * The safe button — cancel — takes the focus on open, so a stray Space cancels. Enter anywhere in
 * the dialog confirms one that is not destructive (`confirmOnKey`): the reader who pressed Enter
 * in a box to send the form meant to send it, and the question is a pause, not a trap. In a
 * destructive dialog Enter never confirms — it reaches the focused cancel button and cancels — so
 * only the red button itself does. A held key's repeats are swallowed: the Enter that submitted
 * the form, still down when the dialog opens, neither confirms nor cancels it. Escape and the
 * backdrop cancel either. An email the action will queue is a line of its own, in bold, so it is
 * never missed.
 *
 * **A second answer**, rarely (`alternative`): a question with two ways forward and a way back —
 * «Copiază și tradu tot» asks whether to replace the English already written or fill only the
 * empty boxes (§482). It sits between cancel and confirm, outlined, and Enter never picks it.
 * A resend's two answers (§540, `spec.choice`): «Trimite acum…» is the confirm button with the send
 * glyph, «Pune la coadă…» the outlined one with the scheduled-send glyph.
 *
 * **The email's road** (§841, `spec.road`): under the email line, which road the message takes —
 * «Pleacă prin Mailgun.» — and, where the club's Gmail is configured too, two radios to choose the
 * road for this press alone, the recommended one marked and a sentence saying why. Either answer
 * writes the road into a twenty-second cookie just before the form is sent (`email-road.ts`), and
 * the action's `enqueueEmail` stamps the row with it. Nothing is decided here: a road the server
 * cannot take (Gmail gone) is the group's road again, and the group's setting never moves.
 */
export default function ConfirmDialog({
  spec,
  open,
  onCancel,
  onConfirm,
  alternative,
}: {
  spec: ConfirmSpec | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  alternative?: { label: string; onClick: () => void } | null;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const roadId = useId();
  // The road for this press, starting from the group's setting — again for each new question: a dialog kept
  // mounted between two questions (`InviteForm`) must not carry the last press's pick into the next.
  const [picked, setPicked] = useState<{ spec: ConfirmSpec | null; road: "mailgun" | "gmail" }>({ spec, road: spec?.road?.current ?? "mailgun" });
  const road = picked.spec === spec ? picked.road : (spec?.road?.current ?? "mailgun");
  if (picked.spec !== spec) setPicked({ spec, road });
  const setRoad = (next: "mailgun" | "gmail") => setPicked({ spec, road: next });
  if (!spec) return null;

  // Either way forward carries the road to the action, as a cookie the request that follows reads once.
  const withRoad = (answer: () => void) => () => {
    if (spec.road) {
      try {
        document.cookie = emailRoadCookieLine({ road, group: spec.road.group }, Date.now());
      } catch {
        // A browser that refuses the write: the message takes its group's road, and the toast names none.
      }
    }
    answer();
  };
  const confirm = withRoad(onConfirm);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        // A held Enter's repeats: the press that opened the dialog is not an answer to it.
        if (event.repeat) {
          if (event.key === "Enter") event.preventDefault();
          return;
        }
        if (confirmOnKey(event.key, spec.destructive) !== "confirm") return;
        // Before the focused cancel button turns the Enter into its own click.
        event.preventDefault();
        confirm();
      }}
      data-testid="confirm-dialog"
    >
      <DialogTitle id={titleId}>{spec.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>{spec.body}</DialogContentText>
        {spec.email && (
          <DialogContentText sx={{ mt: 1.5, fontWeight: 600, color: "text.primary" }} data-testid="confirm-email">
            {spec.email}
          </DialogContentText>
        )}
        {spec.email && spec.road && !spec.road.switchable && (
          // One road here: said, so the reader knows, with nothing to choose.
          <DialogContentText variant="body2" sx={{ mt: 1 }} data-testid="confirm-road">
            {spec.road.leaves.replace("{road}", spec.road.names[spec.road.current])}
          </DialogContentText>
        )}
        {spec.email && spec.road && spec.road.switchable && (
          <FormControl component="fieldset" sx={{ mt: 1.5 }} data-testid="confirm-road">
            <FormLabel id={roadId} sx={{ fontSize: "0.875rem" }}>
              {spec.road.legend}
            </FormLabel>
            <RadioGroup aria-labelledby={roadId} name="emailRoad" value={road} onChange={(_event, value) => setRoad(value === "gmail" ? "gmail" : "mailgun")}>
              {(["mailgun", "gmail"] as const).map((name) => (
                <FormControlLabel
                  key={name}
                  value={name}
                  control={<Radio size="small" />}
                  label={name === spec.road?.recommended ? `${spec.road.names[name]} · ${spec.road.recommendedMark}` : spec.road?.names[name]}
                  sx={{ minHeight: 44 }}
                  data-testid={`confirm-road-${name}`}
                />
              ))}
            </RadioGroup>
            <FormHelperText sx={{ mx: 0 }} data-testid="confirm-road-why">
              {spec.road.why}
            </FormHelperText>
          </FormControl>
        )}
      </DialogContent>
      {/*
        Two verbs that may be long ("Renunță" and "Anulează înscrierea") in a paper 256 px wide at
        320 px: the row wraps, each button a full line of its own, rather than overflowing the
        paper — where the second button's middle lands outside it and a tap hits the backdrop.
      */}
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(:first-of-type)": { ml: 0 } }}>
        <Button onClick={onCancel} autoFocus startIcon={<CloseIcon fontSize="small" />} sx={{ ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } }} data-testid="confirm-dialog-cancel">
          {spec.cancelLabel}
        </Button>
        {alternative && (
          <Button
            variant="outlined"
            // «Pune la coadă pentru trecerea programată» (§540) wears the scheduled-send glyph.
            startIcon={spec.choice ? <ScheduleSendIcon fontSize="small" /> : <AltRouteIcon fontSize="small" />}
            onClick={withRoad(alternative.onClick)}
            sx={{ ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } }}
            data-testid="confirm-dialog-alternative"
          >
            {alternative.label}
          </Button>
        )}
        <Button
          variant="contained"
          color={spec.destructive ? "error" : "primary"}
          // «Trimite acum, fără să aștepte trecerea programată» (§540) wears the send glyph.
          startIcon={spec.choice ? <SendIcon fontSize="small" /> : <CheckIcon fontSize="small" />}
          onClick={confirm}
          sx={{ ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } }}
          data-testid="confirm-dialog-confirm"
        >
          {spec.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
