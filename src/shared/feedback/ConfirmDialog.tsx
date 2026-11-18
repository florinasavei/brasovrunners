"use client";

import AltRouteIcon from "@mui/icons-material/AltRoute";
import CancelScheduleSendIcon from "@mui/icons-material/CancelScheduleSend";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
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
import { type ConfirmSpec, confirmOnKey, emailAnswers, withOption } from "./notice";

/**
 * What the reader answered besides yes: whether they chose «… fără email» (`ConfirmSpec.emailOptOut`, §976), and whether
 * the question's optional box was ticked (`ConfirmSpec.option`).
 */
export type ConfirmAnswer = { emailOff: boolean; optionOn: boolean };

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
 * only the red button itself does; nor in one that may send the person their email (§976, below). A held
 * key's repeats are swallowed: the Enter that submitted the form, still down when the dialog opens,
 * neither confirms nor cancels it. Escape and the
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
 * **The email, a choice made at every press** (`spec.emailOptOut`; §976, amending slice 4 of the design «telling the owner
 * about every email a staff press sends», whose box ticked in advance it replaces; the owner, 2026-11-18: «vreau mereu sa
 * confirm daca trimit un mail»): the one confirm becomes two answers that each say whether the email leaves — the
 * contained «{action} și trimite emailul», in the press's colour with its glyph, and the outlined «{action} fără email»
 * (`emailAnswers`, each `{action}` the question's `confirmLabel`). The bold email line, its club copies and its road
 * describe the first; the road is written only for it. Enter answers neither (`confirmOnKey`): it reaches the focused
 * «Renunță», so the reader presses the answer they mean. Either answer hands the choice to the caller (`ConfirmAnswer`),
 * which writes it into the form (`emailOptOutAnswer`) before it is sent. A required tick holds both; a second answer
 * (`alternative`) stays beside them and sends.
 *
 * **A wider press, offered in the question** (`spec.option`, §956: «Trimite din nou tuturor» under «Trimite fiecăruia
 * punctul lui»): a box after the quieter lines, unticked whenever a question opens, that the confirm button never waits
 * for. Ticked, the question reads as the wider press words it — its body, its bold email line (`withOption`) — and the
 * answer carries the tick to the caller, which writes it into the form's hidden field (`optionAnswer`).
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
  // The question's optional box (§956), unticked again for each new question: a press never inherits the last one's tick.
  const [option, setOption] = useState<{ spec: ConfirmSpec | null; on: boolean }>({ spec: asked, on: false });
  const optionOn = option.spec === asked && option.on;
  if (!asked) return null;
  // The question as it reads now: with its optional box ticked, the wider press's words.
  const spec = withOption(asked, optionOn);
  // A question with the email's two answers (§976) is answered by neither on Enter.
  const emailChoice = spec.emailOptOut !== undefined;
  // A dialog that asks for a tick answers only once it is ticked — Enter included, and both of the email's answers.
  const mayConfirm = !spec.tick || ticked;

  // Each way forward says whether the person's email leaves; one that sends carries the road to the action, as a cookie
  // the request that follows reads once.
  const withRoad = (answer: (given: ConfirmAnswer) => void, emailOff = false) => () => {
    // An email left unsent takes no road: nothing is written for the action to read.
    if (spec.road && !emailOff) {
      try {
        document.cookie = emailRoadCookieLine({ road, group: spec.road.group }, Date.now());
      } catch {
        // A browser that refuses the write: the message takes its group's road, and the toast names none.
      }
    }
    answer({ emailOff, optionOn });
  };
  const confirm = withRoad(onConfirm);
  // «… fără email» (§976): the same press, the person's email kept back.
  const confirmWithoutEmail = withRoad(onConfirm, true);

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
        if (confirmOnKey(event.key, spec.destructive, emailChoice) !== "confirm") return;
        // Before the focused cancel button turns the Enter into its own click.
        event.preventDefault();
        if (mayConfirm) confirm();
      }}
      data-testid="confirm-dialog"
    >
      <DialogTitle id={titleId}>{spec.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>{spec.body}</DialogContentText>
        {spec.warning && (
          <Alert severity="warning" sx={{ mt: 1.5 }} data-testid="confirm-warning">
            {spec.warning}
          </Alert>
        )}
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
        {asked.option && (
          // A wider press the reader may choose here (§956): unticked as the question opens, and the confirm never waits for it.
          <FormControlLabel
            control={<Checkbox checked={optionOn} onChange={(_event, on) => setOption({ spec: asked, on })} sx={CHECKBOX_TAP_TARGET} />}
            label={<Typography variant="body2">{asked.option.label}</Typography>}
            sx={{ mt: 1.5, mx: 0, alignItems: "flex-start", "& .MuiFormControlLabel-label": { pt: 1.25 } }}
            data-testid="confirm-option"
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
      <ConfirmDialogActions
        spec={spec}
        mayConfirm={mayConfirm}
        onCancel={onCancel}
        confirm={confirm}
        confirmWithoutEmail={confirmWithoutEmail}
        alternative={alternative ? { label: alternative.label, onClick: withRoad(alternative.onClick) } : null}
      />
    </Dialog>
  );
}

/** Every button of the dialog's row: full width on a phone (the wrap rule above), side by side from `sm`. */
const ANSWER_SX = { ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } } as const;

/**
 * The dialog's row of answers, apart so that a Node render can draw it (the `Dialog` around it is a portal, which renders
 * nothing on the server): «Renunță», focused on open; the quiet second answer when there is one; and the confirm — or,
 * on a question that may send the person their email (§976), the two answers in its place: the outlined «{action} fără
 * email» and the contained «{action} și trimite emailul», both held by a required tick. The handlers come wrapped by the
 * dialog, the road and the answer already in them.
 */
export function ConfirmDialogActions({
  spec,
  mayConfirm,
  onCancel,
  confirm,
  confirmWithoutEmail,
  alternative,
}: {
  spec: ConfirmSpec;
  mayConfirm: boolean;
  onCancel: () => void;
  /** The sending answer — or the one confirm —, the road already written in it. */
  confirm: () => void;
  /** «… fără email», drawn only on a question with the email's choice. */
  confirmWithoutEmail: () => void;
  alternative?: { label: string; onClick: () => void } | null;
}) {
  // The email's two answers (§976), or none: a question without the choice keeps its one confirm.
  const answers = emailAnswers(spec);
  return (
    <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(:first-of-type)": { ml: 0 } }}>
      <Button onClick={onCancel} autoFocus startIcon={<CloseIcon fontSize="small" />} sx={ANSWER_SX} data-testid="confirm-dialog-cancel">
        {spec.cancelLabel}
      </Button>
      {alternative && (
        <Button
          variant="outlined"
          // «Pune la coadă pentru trecerea programată» (§540) wears the scheduled-send glyph.
          startIcon={spec.choice ? <ScheduleSendIcon fontSize="small" /> : <AltRouteIcon fontSize="small" />}
          onClick={alternative.onClick}
          sx={ANSWER_SX}
          data-testid="confirm-dialog-alternative"
        >
          {alternative.label}
        </Button>
      )}
      {answers && (
        // «{action} fără email» (§976): outlined, beside the sending answer — the same press, nothing to the person.
        <Button
          variant="outlined"
          color={spec.destructive ? "error" : "primary"}
          startIcon={<CancelScheduleSendIcon fontSize="small" />}
          onClick={confirmWithoutEmail}
          disabled={!mayConfirm}
          sx={ANSWER_SX}
          data-testid="confirm-dialog-skip-email"
        >
          {answers.skip}
        </Button>
      )}
      <Button
        variant="contained"
        color={spec.destructive ? "error" : "primary"}
        // «Trimite acum, fără să aștepte trecerea programată» (§540) wears the send glyph.
        startIcon={spec.choice ? <SendIcon fontSize="small" /> : <CheckIcon fontSize="small" />}
        onClick={confirm}
        disabled={!mayConfirm}
        sx={ANSWER_SX}
        data-testid="confirm-dialog-confirm"
      >
        {/* With the email's choice, «{action} și trimite emailul» (§976); else the verb alone. */}
        {answers ? answers.send : spec.confirmLabel}
      </Button>
    </DialogActions>
  );
}
