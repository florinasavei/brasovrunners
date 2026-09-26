"use client";

import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { type ComponentType, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { isRefused, labelOf, type MissingControl, missingControls, sameEntries, type WatchedControl } from "./missing-controls";
import RunnerLoader, { RunnerLoaderStyles } from "./RunnerLoader";
import { TAP_TARGET } from "./tap-target";
import { accentOnHover } from "@/theme/surfaces";

/**
 * The glyph's size in CSS pixels, per button size: what MUI's own start-icon slot gives an icon
 * (18 / 20 / 22), so the running figure that replaces the verb's glyph while the request is in
 * flight is exactly as big as the glyph it replaced and the label does not move.
 */
const GLYPH_PX = { small: 18, medium: 20, large: 22 } as const;

/**
 * Bring a listed control into view and focus it — opening any fold around it first, since a
 * control inside a closed `<details>` can be neither seen nor focused. The link's own `#id` is
 * the fallback with JavaScript off, and for a control this cannot find.
 */
function reach(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const control = document.getElementById(id);
  if (!(control instanceof HTMLElement)) return;
  event.preventDefault();
  for (let fold = control.closest("details"); fold; fold = fold.parentElement?.closest("details") ?? null) fold.open = true;
  control.scrollIntoView({ block: "center" });
  control.focus({ preventScroll: true });
}

export type SubmitButtonProps = {
  label: string;
  /** What the button says while the server is working. It is the whole reason this exists. */
  pendingLabel: string;
  /**
   * The public send buttons — the registration and the contact form: the club's runner before
   * the label, standing at rest, the figure `RunnerLoader` animates while the same button is
   * pending (§318; the owner: "butoanele de trimitere înscriere și contact trebuie să aibă și
   * iconița cu un alergător").
   *
   * A flag and not a name, because this button is on the public pages and the verbs' registry
   * (`action-icons.ts`) is the backoffice's: a lookup by a runtime key cannot be tree-shaken, so
   * importing it here would put every backoffice glyph on the register page, the contact page
   * and the event page. `DirectionsRunIcon` is the one glyph this file imports, and
   * `RunnerLoader` already carries it.
   */
  runner?: boolean;
  /**
   * A glyph already resolved on the client, for `GlyphSubmitButton` — the backoffice's wrapper,
   * which looks a verb's name up in the registry and hands the component here. A Server
   * Component cannot pass this (a function does not cross the boundary); it passes the name to
   * `GlyphSubmitButton` instead. While the request is in flight the glyph gives way to the
   * running figure, which is the one thing this button already did.
   */
  glyph?: ComponentType<SvgIconProps>;
  /**
   * When given, the button watches its form and, while any required field is still empty or
   * invalid, dims itself and shows this sentence beneath. It stays pressable: a press then runs
   * the browser's own validation, which focuses the first missing field and names it — the
   * answer a merely-disabled button could never give. See the notes below.
   */
  incompleteHint?: string;
  /**
   * The same sentence, naming the first thing missing (`DECISIONS.md` §315; the owner: "in
   * general formularele trebuie sa fie mai smart"): `{field}` is replaced with the label of the
   * first control the browser would refuse, read from its own `<label>`. Where a control has
   * no label to read, `incompleteHint` is what is said. Either alone dims the button.
   */
  incompleteHintNamed?: string;
  /**
   * The heading of a live list, **above** the button, of every control the browser would refuse
   * — not only the first (§422; the owner, of the registration form: a dimmed button and "fill in
   * the fields marked *" while the one thing missing was a box nobody could see). Given, the list
   * takes the place of the sentence beneath: each entry is a link that brings its field into view
   * and focuses it, and the list shrinks as the form is filled. The same scan as the dimming — one
   * pass over the form's own `validity`, never a second watcher.
   */
  missingTitle?: string;
  /**
   * Short names by control `name` for that list: a tick's label is a sentence ("Am citit și
   * accept…"), and a list of sentences is a wall. A control not named here is listed by its own
   * `<label>`, then its `aria-label`.
   */
  missingNames?: Readonly<Record<string, string>>;
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
  runner,
  glyph,
  incompleteHint,
  incompleteHintNamed,
  missingTitle,
  missingNames,
  awaitsBotCheck,
  botCheckHint,
  slowHint,
  color = "primary",
  variant = "contained",
  size = "small",
  fullWidth,
  ariaLabel,
  compact,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  // Complete until measured: the first paint and a no-JavaScript render must not dim a button
  // that nothing has yet found fault with.
  const [complete, setComplete] = useState(true);
  // The label of the first control the browser would refuse, for the named sentence (§315).
  const [firstMissing, setFirstMissing] = useState<string | null>(null);
  // Every control the browser would refuse, in the form's order, for the list above (§422).
  const [missing, setMissing] = useState<readonly MissingControl[]>([]);
  const lists = Boolean(missingTitle);
  const watches = Boolean(incompleteHint || incompleteHintNamed || lists);
  // By value: a Server Component hands a new object on every render, and the watcher below must
  // not be torn down and rebuilt for the same names.
  const namesKey = missingNames ? JSON.stringify(missingNames) : "";

  useEffect(() => {
    if (!watches) return;
    const form = ref.current?.form;
    if (!form) return;
    const names: Readonly<Record<string, string>> = namesKey ? JSON.parse(namesKey) : {};

    const measure = () => {
      const controls = Array.from(form.elements) as WatchedControl[];
      // `isRefused` skips a control that will not validate: one in a disabled fieldset
      // (`HiddenForMinor`) is not the browser's to refuse, and must not be listed as missing.
      // The whole scan only where a list is drawn; elsewhere the first refusal is all that is said,
      // and the event editor's few hundred boxes stop at it (§371).
      const invalid = lists ? controls.filter(isRefused) : [];
      const first = lists ? invalid[0] : controls.find(isRefused);
      setComplete(first === undefined);
      if (lists) {
        const entries = missingControls(invalid, names);
        // Only a different list is a render: the scan runs once a frame while somebody types.
        setMissing((previous) => (sameEntries(previous, entries) ? previous : entries));
      }
      // A tick's label is a sentence, not the name of a box — "Fill in first: I understand that…"
      // reads badly — so a tick is named only where the button has no sentence of its own for it
      // (the live-edit acknowledgement's `incompleteHint`).
      const tick = first instanceof HTMLInputElement && first.type === "checkbox";
      if (tick && incompleteHint) {
        setFirstMissing(null);
        return;
      }
      setFirstMissing(first ? labelOf(first) : null);
    };
    measure();
    // Behind the frame the keystroke leads to, once per frame (§371): the scan reads every box of
    // the form, and the event editor has a few hundred — inside the keystroke it was paid before
    // the letter appeared, and a `change` on leaving a box put it inside the press of this button.
    const scheduler = paintedScheduler(measure);
    form.addEventListener("input", scheduler.schedule);
    form.addEventListener("change", scheduler.schedule);
    return () => {
      form.removeEventListener("input", scheduler.schedule);
      form.removeEventListener("change", scheduler.schedule);
      scheduler.cancel();
    };
  }, [watches, incompleteHint, lists, namesKey]);

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
  // The list, where one is asked for, says what the sentence beneath would have said — only better.
  const showList = lists && !complete && !pending && missing.length > 0;
  const hint = waiting && pressedEarly ? (botCheckHint ?? incompleteSentence) : showList ? undefined : incompleteSentence;
  // One id per button: a page with two forms has two buttons that may both be waiting (§315).
  const hintId = useId();
  const listId = useId();
  const describedBy = [showList ? listId : null, dimmed && hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const Glyph = glyph ?? (runner ? DirectionsRunIcon : null);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        width: fullWidth ? "100%" : "auto",
      }}
    >
      {/*
        What is still missing, above the button (§422): where somebody about to press is already
        looking, every entry a thumb's target (BR-REQ-041-01 criterion 6) that goes to its field.
        Not a live region — a list re-read at every keystroke would talk over the typing; it is
        the button's description instead, read with it.
      */}
      {showList && (
        <Box
          id={listId}
          data-testid="form-missing"
          sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {missingTitle}
          </Typography>
          <Box
            component="ul"
            sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0, display: "flex", flexWrap: "wrap", columnGap: 1.5 }}
          >
            {missing.map(({ key, label, id }) => (
              <li key={key}>
                {id ? (
                  <Link
                    href={`#${id}`}
                    onClick={(event) => reach(event, id)}
                    variant="body2"
                    sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
                  >
                    {label}
                  </Link>
                ) : (
                  <Typography variant="body2" component="span" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                    {label}
                  </Typography>
                )}
              </li>
            ))}
          </Box>
        </Box>
      )}
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
        aria-describedby={describedBy}
        /*
          No ink under the finger (§371): the press answers with "Se salvează…" and the runner in
          the same frame, which is the feedback, and the ripple was the costliest thing in it — MUI
          mounts it on the first press, measures the button (a forced layout), and on a page whose
          first press this is, writes its styles into the layered sheet: a whole-page
          recalculation inside the press. The keyboard's focus ripple stays.
        */
        disableTouchRipple
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
        // At rest the verb's own glyph, if it has one (§318) — on the public send buttons that
        // is the same runner, standing, so a press is the figure setting off.
        startIcon={
          pending ? (
            <RunnerLoader size={GLYPH_PX[size]} color="inherit" />
          ) : Glyph ? (
            <Glyph fontSize="small" />
          ) : undefined
        }
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
      {/*
        The runner's styles, drawn with the page, so the press adds none (§371). The guarantee
        assumes the button already has a start icon at rest — a verb's glyph or the runner. A
        button with neither (the pages list's ↑ ↓, the registrations list's compact "Retrimite",
        the desk's `ConfirmOnArrival`, which presses itself) mounts MUI's start-icon slot for the
        first time on the press, and its styles may be written then if nothing else on the page
        drew that slot at that size. Accepted: those are one-line forms, not the heavy ones this
        was measured on, and each one's missing glyph is deliberate where it is written.
      */}
      <RunnerLoaderStyles size={GLYPH_PX[size]} color="inherit" />
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
