"use client";

import AltRouteIcon from "@mui/icons-material/AltRoute";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import SendIcon from "@mui/icons-material/Send";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
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
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { emailRoadCookieLine } from "./email-road";
import { type ConfirmSpec, confirmOnKey, withEmailOff } from "./notice";

/** What the reader answered besides yes: whether «Trimite emailul» was unticked (`ConfirmSpec.emailOptOut`). */
export type ConfirmAnswer = { emailOff: boolean };

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
 * never missed — the person named and the email by its name in «Emailuri», or «Nu pleacă niciun email
 * către …» (`confirmWords().mail`, `noMail`) — and what else the press sends follows the road, quieter
 * (`spec.also`): the club's mailboxes as a count, the freed place's offer to the next in line.
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
 *
 * **«Trimite emailul»** (`spec.emailOptOut`; the design «telling the owner about every email a staff press sends», slice
 * 4): a box after the quieter lines, ticked whenever a question opens. Unticked, the bold line says that no email
 * leaves to the person, the road is not offered and the lines that belong to that email — its club copies — go
 * (`withEmailOff`); what the press sends anybody else stays said. Either answer hands the box's state to the caller
 * (`ConfirmAnswer`), which writes it into the form (`emailOptOutAnswer`) before it is sent.
 */
export default function ConfirmDialog({
  spec: asked,
  open,
  onCancel,
  onConfirm,
  alternative,
}: {
  spec: ConfirmSpec | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: (answer: ConfirmAnswer) => void;
  alternative?: { label: string; onClick: (answer: ConfirmAnswer) => void } | null;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const roadId = useId();
  // The road for this press, starting from the group's setting — again for each new question: a dialog kept
  // mounted between two questions (`InviteForm`) must not carry the last press's pick into the next.
  const [picked, setPicked] = useState<{ spec: ConfirmSpec | null; road: "mailgun" | "gmail" }>({ spec: asked, road: asked?.road?.current ?? "mailgun" });
  const road = picked.spec === asked ? picked.road : (asked?.road?.current ?? "mailgun");
  if (picked.spec !== asked) setPicked({ spec: asked, road });
  const setRoad = (next: "mailgun" | "gmail") => setPicked({ spec: asked, road: next });
  // The dialog's own box (§888), unticked again for each new question, as the road is picked again.
  const [tick, setTick] = useState<{ spec: ConfirmSpec | null; on: boolean }>({ spec: asked, on: false });
  const ticked = tick.spec === asked && tick.on;
  // «Trimite emailul», ticked again for each new question: a press never inherits the last one's untick.
  const [mailOff, setMailOff] = useState<{ spec: ConfirmSpec | null; off: boolean }>({ spec: asked, off: false });
  const emailOff = mailOff.spec === asked && mailOff.off;
  if (!asked) return null;
  // The question as it reads now: unticked, no email line to the person, no road, none of its copies.
  const spec = withEmailOff(asked, emailOff);
  // A dialog that asks for a tick answers only once it is ticked — Enter included.
  const mayConfirm = !spec.tick || ticked;

  // Either way forward carries the road to the action, as a cookie the request that follows reads once — and the box's state.
  const withRoad = (answer: (given: ConfirmAnswer) => void) => () => {
    // An email left unsent takes no road (`withEmailOff` dropped it): nothing is written for the action to read.
    if (spec.road) {
      try {
        document.cookie = emailRoadCookieLine({ road, group: spec.road.group }, Date.now());
      } catch {
        // A browser that refuses the write: the message takes its group's road, and the toast names none.
      }
    }
    answer({ emailOff });
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
        if (mayConfirm) confirm();
      }}
      data-testid="confirm-dialog"
    >
      <DialogTitle id={titleId}>{spec.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>{spec.body}</DialogContentText>
        {spec.lines && spec.lines.length > 0 && (
          // One fact a line (§914): each place setting the save changes, then what it does.
          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }} data-testid="confirm-lines">
            {spec.lines.map((line, index) => (
              <Typography component="li" variant="body2" key={index} sx={{ mb: 0.5 }}>
                {line}
              </Typography>
            ))}
          </Box>
        )}
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
        {/* What else the press sends, quieter (the design «telling the owner about every email a staff press sends», slice 3):
            the club's mailboxes as a count, the freed place's offer, Zitadel's own email — each line as the builder worded it. */}
        {spec.also?.map((line, index) => (
          <DialogContentText key={`${index}:${line.text}`} variant="body2" sx={{ mt: 1 }} data-testid="confirm-also">
            {line.text}
          </DialogContentText>
        ))}
        {asked.emailOptOut && (
          // «Trimite emailul» (slice 4): ticked as the question opens; unticked, the person's email is not queued.
          <FormControlLabel
            control={<Checkbox checked={!emailOff} onChange={(_event, on) => setMailOff({ spec: asked, off: !on })} sx={CHECKBOX_TAP_TARGET} />}
            label={<Typography variant="body2">{asked.emailOptOut.label}</Typography>}
            sx={{ mt: 1.5, mx: 0, alignItems: "flex-start", "& .MuiFormControlLabel-label": { pt: 1.25 } }}
            data-testid="confirm-send-email"
          />
        )}
        {spec.tick && (
          // A rule the press must not assume (§33): the reader ticks it here, and the confirm button waits for it.
          <FormControlLabel
            control={<Checkbox checked={ticked} onChange={(_event, on) => setTick({ spec: asked, on })} sx={CHECKBOX_TAP_TARGET} />}
            label={<Typography variant="body2">{spec.tick.label}</Typography>}
            sx={{ mt: 1.5, mx: 0, alignItems: "flex-start", "& .MuiFormControlLabel-label": { pt: 1.25 } }}
            data-testid="confirm-tick"
          />
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
          disabled={!mayConfirm}
          sx={{ ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } }}
          data-testid="confirm-dialog-confirm"
        >
          {spec.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
