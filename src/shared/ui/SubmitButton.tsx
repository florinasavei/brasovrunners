"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import RunnerLoader from "./RunnerLoader";
import { TAP_TARGET } from "./tap-target";
import { accentOnHover } from "@/theme/surfaces";

type Props = {
  label: string;
  /** What the button says while the server is working. It is the whole reason this exists. */
  pendingLabel: string;
  /**
   * When given, the button watches its form and, while any required field is still empty or
   * invalid, dims itself and shows this sentence beneath. It stays pressable: a press then runs
   * the browser's own validation, which focuses the first missing field and names it — the
   * answer a merely-disabled button could never give. See the notes below.
   */
  incompleteHint?: string;
  color?: "primary" | "error" | "warning" | "inherit";
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
  /**
   * A button in a dense backoffice table: no 44-pixel floor, and the label never wraps.
   *
   * `tap-target.ts` already draws this line and gives the reason — "a `MuiButton` default would
   * silently enlarge every control in the backoffice too, where density is worth more than
   * reach". The registrations list is where that bites: one button per row, in a narrow column,
   * with a label long enough to wrap, makes every row seventy pixels tall (the owner, looking at
   * the list: "these buttons are HUGE!"). The rule it steps around is BR-REQ-041-01 criterion 6,
   * which is about the participant journeys on a phone; this is an Administrator's table.
   *
   * Not for the race-day desk, which is a phone in somebody's hand and keeps the floor.
   */
  compact?: boolean;
  /**
   * Wait for Cloudflare's token before letting the press through (§285).
   *
   * Pressing send before Turnstile has answered buys a refusal for no reason — the owner:
   * "butonul de trimitere nu ar trebui sa fie vizibil daca Cloudflare Turnstile nu a terminat".
   * While the token is missing the button is dimmed and says why; after `RELEASE_AFTER_MS`, or
   * if the widget never draws at all, it is released, because §205 is not negotiable: people
   * register at all costs, and a check that never answers must not be the thing that stops them.
   */
  awaitsBotCheck?: boolean;
  /** What the button says while it waits for that token. */
  botCheckHint?: string;
  /**
   * The accessible name, when the visible label cannot be one — an arrow in a row of pages is
   * "↓" to everybody who can see which row it is in, and nothing at all to anybody who cannot.
   */
  ariaLabel?: string;
};

/**
 * The submit button for a form driven by a Server Action: it shows the server is working, says
 * so in words, and — where asked — says that the form is not yet complete.
 *
 * ## Why this earned a client island (§1.5, §14.1)
 *
 * Every write in the backoffice is a Server Action behind a full page round-trip, and until the
 * server answered there was no feedback at all: the button looked idle, so an organizer pressed
 * it again. That is not a cosmetic problem here — the editor carries an optimistic version on
 * both the event row and each translation, so the second press arrives with the version the
 * first one has already superseded and comes back a CONFLICT, which the organizer then has to
 * read, understand and recover from. The island exists to stop a double press, and there is no
 * way to know a submission is in flight without being on the client.
 *
 * It costs one `useFormStatus` call and no props that carry data — the labels are passed in
 * already translated, so the catalogue stays on the server and no participant row crosses the
 * boundary to render a button (§14.5).
 *
 * ## Why `aria-disabled` and not `disabled`, twice over
 *
 * A disabled control cannot say why it is disabled. `disabled` would also drop keyboard focus
 * the instant the press registers, so somebody using a screen reader would be moved off the
 * control and never told the save had begun. `aria-disabled` keeps it focused and announced;
 * the label changing is the explanation, and the click handler is what stops the second press.
 *
 * The same argument governs `incompleteHint` (the owner, 2026-09-17: "the submit button is
 * enabled even if I did not fill in the mandatory stuff"). The button *looks* unavailable while
 * the form is incomplete and says so in words beneath it — but it is not disabled, because a
 * press is what produces the specific answer: the browser refuses, focuses the first unfilled
 * field and names what it wants, in the reader's language, and a disabled button would have
 * prevented exactly that. Validity is read from each control's own `validity`, never with
 * `checkValidity()`, which fires `invalid` events and would light every field up at once.
 *
 * With JavaScript off none of this runs and the button is an ordinary submit — which is the
 * honest fallback, because every guard that matters is on the server.
 */
export default function SubmitButton({
  label,
  pendingLabel,
  incompleteHint,
  awaitsBotCheck,
  botCheckHint,
  color = "primary",
  variant = "contained",
  size = "small",
  fullWidth,
  ariaLabel,
  compact,
}: Props) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  // Complete until measured: the first paint and a no-JavaScript render must not dim a button
  // that nothing has yet found fault with.
  const [complete, setComplete] = useState(true);

  useEffect(() => {
    if (!incompleteHint) return;
    const form = ref.current?.form;
    if (!form) return;

    const measure = () => {
      const controls = Array.from(form.elements) as Array<Element & { validity?: ValidityState }>;
      setComplete(controls.every((control) => !control.validity || control.validity.valid));
    };
    measure();
    form.addEventListener("input", measure);
    form.addEventListener("change", measure);
    return () => {
      form.removeEventListener("input", measure);
      form.removeEventListener("change", measure);
    };
  }, [incompleteHint]);

  /*
    Cloudflare writes its token into a hidden input inside the widget's own element, so the form
    is where it shows up and the DOM is what this watches — the same shape `PhoneField` uses to
    watch the other telephone (§231), rather than lifting a third party's element into React.
  */
  const RELEASE_AFTER_MS = 8000;
  const [tokenMissing, setTokenMissing] = useState(false);

  useEffect(() => {
    if (!awaitsBotCheck) return;
    const form = ref.current?.form;
    if (!form) return;

    const token = () => {
      const input = form.querySelector('[name="cf-turnstile-response"]');
      return input instanceof HTMLInputElement ? input.value : "";
    };
    // Nothing drawn yet is also "waiting": the widget appears a moment after the page does.
    const measure = () => setTokenMissing(token() === "");
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ["value"] });
    form.addEventListener("input", measure);
    // The valve. A blocked script, an offline moment, a bad minute at Cloudflare — none of them
    // may end with somebody unable to press send (§205).
    const release = setTimeout(() => {
      observer.disconnect();
      setTokenMissing(false);
    }, RELEASE_AFTER_MS);

    return () => {
      observer.disconnect();
      form.removeEventListener("input", measure);
      clearTimeout(release);
    };
  }, [awaitsBotCheck]);

  /*
    Nothing is said until somebody presses (§285, amended; the owner: "nici macar nu am facut
    submit inca si apare asta").

    The first version dimmed the button and explained itself the moment the page loaded, which
    is a warning about a problem nobody has yet had — and for the half-second Turnstile usually
    takes, it is a flicker of "you cannot do this yet" in front of somebody who was doing
    nothing. So the press is what asks the question: if the token is not there yet, that press
    is swallowed, the sentence appears, and it goes away by itself when the token arrives.
  */
  const [pressedEarly, setPressedEarly] = useState(false);
  const waiting = Boolean(awaitsBotCheck) && tokenMissing && !pending;
  // No effect resets `pressedEarly` when the token lands: it is only ever read alongside
  // `waiting`, which is false from that moment, so a stale `true` says nothing and setting state
  // from an effect would be a render scheduled for no visible reason.

  const dimmed = (Boolean(incompleteHint) && !complete && !pending) || (waiting && pressedEarly);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        width: fullWidth ? "100%" : "auto",
      }}
    >
      <Button
        ref={ref}
        type="submit"
        color={color}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        aria-label={ariaLabel}
        // Only a submission in flight is announced as unavailable. The incomplete state is
        // deliberately NOT aria-disabled: assistive technology (and Playwright) treat that as
        // "do not press", and pressing is the one action that produces the specific answer.
        // The dimming and the sentence beneath are the signal; the browser's own validation,
        // on press, is the explanation.
        aria-disabled={pending}
        aria-busy={pending}
        aria-describedby={dimmed ? "submit-incomplete" : undefined}
        sx={{
          ...(compact ? { whiteSpace: "nowrap", py: 0.25, px: 1 } : TAP_TARGET),
          ...(variant === "contained" && color === "primary" ? accentOnHover : {}),
          /*
            What "not now" looks like (§285; the owner: "butoanele disabled ar trebui sa fie mai
            transparente, si cu cursor interzis"). 0.55 read as a colour choice rather than as a
            state; at 0.38 — MUI's own disabled opacity — with the forbidden cursor, nobody
            mistakes it for a button that is merely quiet. It stays pressable, and the reason is
            the same as ever: a press is what produces the specific answer.
          */
          ...(dimmed ? { opacity: 0.38, cursor: "not-allowed" } : {}),
        }}
        // The club's runner rather than MUI's ring (§166; the owner: "I need a runner showing
        // as a loader"). `color="inherit"` so it takes the button's own foreground on a
        // contained button and the brand blue on a text one, and it carries no accessible
        // name of its own: the label beside it has already changed to `pendingLabel` and
        // `aria-busy` is set, so the figure is the third way of saying it rather than the
        // only one. Under `prefers-reduced-motion` it stands still and the words carry it.
        startIcon={pending ? <RunnerLoader size={18} color="inherit" /> : undefined}
        onClick={(event) => {
          // The press that is already in flight owns this form. Swallowing the second one here
          // rather than disabling the control is what keeps it focusable and readable.
          if (pending) event.preventDefault();
          if (waiting) {
            // The check is still running: hold this press and say so, rather than spending it on
            // a refusal the person did nothing to earn.
            event.preventDefault();
            setPressedEarly(true);
          }
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {dimmed && (
        <Typography id="submit-incomplete" variant="body2" color="text.secondary" role="status">
          {waiting && pressedEarly ? (botCheckHint ?? incompleteHint) : incompleteHint}
        </Typography>
      )}
    </Box>
  );
}
