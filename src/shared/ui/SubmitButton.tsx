"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useId, useRef, useState } from "react";
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
  /**
   * The same sentence, naming the first thing missing (`DECISIONS.md` §306; the owner: "in
   * general formularele trebuie sa fie mai smart"): `{field}` is replaced with the label of the
   * first control the browser would refuse, read from its own `<label>`. Where a control has
   * no label to read, `incompleteHint` is what is said. Either alone dims the button.
   */
  incompleteHintNamed?: string;
  /** Under the button once a submit has been in flight for SLOW_AFTER_MS (§304): patience, not a second press. */
  slowHint?: string;
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
  incompleteHintNamed,
  awaitsBotCheck,
  botCheckHint,
  slowHint,
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
  // The label of the first control the browser would refuse, for the named sentence (§306).
  const [firstMissing, setFirstMissing] = useState<string | null>(null);
  const watches = Boolean(incompleteHint || incompleteHintNamed);

  useEffect(() => {
    if (!watches) return;
    const form = ref.current?.form;
    if (!form) return;

    const measure = () => {
      const controls = Array.from(form.elements) as Array<Element & { validity?: ValidityState; labels?: NodeListOf<HTMLLabelElement> | null }>;
      const invalid = controls.find((control) => control.validity && !control.validity.valid);
      setComplete(invalid === undefined);
      // A tick's label is a sentence, not the name of a box — "Fill in first: I understand that…"
      // reads badly — so a tick is named only where the button has no sentence of its own for it
      // (the live-edit acknowledgement's `incompleteHint`).
      const tick = invalid instanceof HTMLInputElement && invalid.type === "checkbox";
      if (tick && incompleteHint) {
        setFirstMissing(null);
        return;
      }
      // MUI marks a required label with " *"; the sentence names the box, not the asterisk. A box
      // inside a language tab says which language, or "Titlu" would not say which of two titles.
      const text = invalid?.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, "").trim() || invalid?.getAttribute("aria-label");
      const language = invalid?.closest("[data-language]")?.getAttribute("data-language");
      setFirstMissing(text ? (language ? `${language}: ${text}` : text) : null);
    };
    measure();
    form.addEventListener("input", measure);
    form.addEventListener("change", measure);
    return () => {
      form.removeEventListener("input", measure);
      form.removeEventListener("change", measure);
    };
  }, [watches, incompleteHint]);

  // The named sentence when there is a box to name; the button's own sentence otherwise; and
  // never the named one with its `{field}` unfilled.
  const incompleteSentence =
    incompleteHintNamed && firstMissing ? incompleteHintNamed.replace("{field}", firstMissing) : incompleteHint;

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

  /*
    **A held press is sent, not dropped (§304).**

    §285 swallowed a press made before Cloudflare's token existed and showed a sentence; the
    sentence went away when the token landed, and that was all — the person had to press again,
    and nothing told them so. With autofill the whole form is filled in a second and the press
    comes in the same second, so the swallowed press was the *normal* press. Amalia, from her
    laptop, 2026-09-23: "nu am eroare … ramane blocat … ca si cum m-am inscris … dar nu apare pe
    lista" — QA's database has no row and no outbox entry for that minute: the submit never left
    her browser.

    So the press is kept and replayed: the moment `waiting` turns false — the token arrived, or
    the valve above opened after eight seconds — the form is submitted with this button as the
    submitter, exactly as if the finger had landed now. `requestSubmit` runs the browser's own
    validation first, so an invalid form still gets its bubble rather than a request. Once, and
    only while nothing is in flight; a page that navigates afterwards resets all of this anyway.
  */
  // A ref, not state: "already replayed" is bookkeeping for the effect, never something the
  // screen shows, and a render for it would be a render for nothing.
  const replayed = useRef(false);
  useEffect(() => {
    if (!pressedEarly || waiting || pending || replayed.current) return;
    const button = ref.current;
    const form = button?.form;
    if (!form) return;
    replayed.current = true;
    form.requestSubmit(button);
  }, [pressedEarly, waiting, pending]);

  /*
    A submit that takes too long says so (§304). `pending` comes from the form's own status and
    lasts as long as the request does; a request a proxy has swallowed lasts for ever, and the
    runner beside the label was the only sign — which reads as "it went through". After
    SLOW_AFTER_MS a sentence appears under the button; the request itself cannot be cancelled
    from here, so the sentence asks for patience and forbids the second press, which would only
    queue a second request behind the first.
  */
  const SLOW_AFTER_MS = 15_000;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    // The reset lives in the cleanup — it runs when `pending` turns false — rather than in the
    // effect body, where a synchronous setState is a render scheduled from a render.
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);

  const dimmed = (watches && !complete && !pending) || (waiting && pressedEarly);
  const hint = waiting && pressedEarly ? (botCheckHint ?? incompleteSentence) : incompleteSentence;
  // One id per button: a page with two forms has two buttons that may both be waiting (§306).
  const hintId = useId();

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
        aria-describedby={dimmed && hint ? hintId : undefined}
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
            // a refusal the person did nothing to earn. The effect above sends it the moment the
            // check answers or the valve opens (§304) — the person does not press twice.
            event.preventDefault();
            setPressedEarly(true);
          }
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {dimmed && hint && (
        <Typography id={hintId} variant="body2" color="text.secondary" role="status">
          {hint}
        </Typography>
      )}
      {pending && slow && slowHint && (
        <Typography variant="body2" color="text.secondary" role="status">
          {slowHint}
        </Typography>
      )}
    </Box>
  );
}
