"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  BOT_CHECK_ARMED_ATTRIBUTE,
  BOT_CHECK_ARMING_EVENTS as ARMING_EVENTS,
  BOT_CHECK_BLOCKED_AFTER_MS,
  BOT_CHECK_GAVE_UP_ATTRIBUTE,
  BOT_CHECK_SLOW_AFTER_MS,
  BOT_CHECK_STATE_ATTRIBUTE,
  botCheckAsksAttention,
  botCheckGaveUp,
  botCheckOffersRetry,
  type BotCheckRelay,
  BOT_CHECK_SIGNAL_FIELD,
  type BotCheckWidgetState,
  drawBotCheck,
  type TurnstileRenderOptions,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TOKEN_EVENT,
} from "../domain/turnstile-widget";
import { isPressHeld } from "@/shared/ui/held-press";

/**
 * Cloudflare Turnstile, rendered explicitly and reset on every attempt (`DECISIONS.md` §185), with
 * every state it can be in said in words under it and a way out of each one a person can be stuck
 * in (§518).
 *
 * The form used Cloudflare's implicit mode: `<div class="cf-turnstile">` in the server's markup
 * and `api.js` loaded beside it. That works exactly once. `api.js` scans the document when it
 * loads and never again, and the token it produces is **single use** — so the moment a
 * submission comes back with anything wrong on it, the server re-renders the form, React reuses
 * the same empty div, no script load happens, no widget is drawn, and the visitor is left with
 * "tick the box again" printed above nothing to tick. Every attempt after the first then fails
 * on a missing token, whatever else they fix. The owner, with a screenshot of exactly that:
 * "faza asta cu robotul man!!! implementeaza corect!!"
 *
 * So: explicit rendering. The script is injected once per document — `data-turnstile` marks it,
 * because two copies of `api.js` is a Cloudflare error, not a second widget — the widget is
 * drawn into this element when the script is ready, and `reset()` is called whenever `attempt`
 * changes. The server passes its own render time as `attempt`, which is a new value on every
 * response and therefore on every failed submission.
 *
 * **Every state, visible and recoverable (§518).** Cloudflare's own frame says «Success!» or shows
 * a box, and says nothing at all when its script is blocked, when it fails, when its token lapses
 * or when the box waited too long — and the send button (`SubmitButton`'s `awaitsBotCheck`) was
 * left to guess from an empty field. Now each of Cloudflare's documented callbacks names a state
 * (`BOT_CHECK_WIDGET_STATES`), the line under the widget says it in the reader's language, and:
 *
 * - a failure, a lapse, a script that never came and a check that takes too long offer
 *   «Reîncearcă verificarea» — `turnstile.reset()` on the widget, or the script injected again;
 * - the state is written on this element (`data-bot-check`), where the send button reads it from
 *   the form as it reads the token, and says it again in its own held sentence; a check that gave
 *   up (`botCheckGaveUp`: the second failure, a script that never came, a browser that cannot run
 *   it) is marked `data-bot-check-gave-up`, holds no press, lets a held one go at once, and says
 *   the owner's sentence — «Nu am putut verifica automat; trimitem oricum, iar clubul confirmă».
 *   The server takes the missing token for the check not running (§216), and people register at
 *   all costs (§205);
 * - a widget that fails or never loads says so in a hidden field of its form
 *   (`BOT_CHECK_SIGNAL_FIELD`), which the register action counts, level-only, for `/api/health`.
 *
 * **Callbacks that outlive the effect run that drew them (§518).** The widget is drawn once and
 * reset on every attempt, so the callbacks `render` was given are the ones Cloudflare keeps calling;
 * the effect below runs again on every attempt. The callbacks read the current run's `become` from
 * a ref (`relay`, `botCheckCallbacks`) at the moment they are called — before, they held the first
 * run's, cancelled by the first server re-render, and the widget went silent from then on.
 *
 * Cloudflare's own retries are kept: `retry` and `refresh-expired` / `refresh-timeout` stay at
 * their `auto` defaults, and the error callback returns `false`, which the documentation names as
 * "let Turnstile handle the retry" — «Reîncearcă verificarea» is a faster way out, not the only one.
 *
 * With JavaScript off none of it runs and nothing is said: the line is drawn only once the island
 * runs, so a page without scripts never promises a check that cannot start.
 */

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * The line under the widget, per state, the slow line, the retry button's label and the line of a
 * failure that gave up — translated on the server (`BotCheck`).
 */
export type BotCheckWords = Record<BotCheckWidgetState, string> & {
  slow: string;
  retry: string;
  failed: string;
  /** Who runs the check and what it sees (§323), said only once the widget is there (§593). */
  notice?: string;
};

const SCRIPT_SELECTOR = "script[data-turnstile]";
const NOTHING_TO_WATCH = () => () => {};
/**
 * Whether a person has started on a protected form in this document (§577) — a module's memory,
 * so it lasts as long as the page and no longer: a new visit is a new document and waits again.
 */
let startedInThisDocument = false;

export default function TurnstileWidget({
  siteKey,
  locale,
  attempt,
  words,
}: {
  siteKey: string;
  locale: string;
  /** Any value that changes on every server render; the widget is reset when it does. */
  attempt: string;
  words: BotCheckWords;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [state, setState] = useState<BotCheckWidgetState>("loading");
  // The current effect run's `become`, read by Cloudflare's callbacks when they are called (§518).
  const relay = useRef<BotCheckRelay["current"]>(null);
  // Failures so far (§518): the first is Cloudflare's to retry, the second gives up. Kept across
  // «Reîncearcă verificarea» and new attempts; a pass starts the count again.
  const [failures, setFailures] = useState(0);
  // A press held on the form when the state changed: the button's own sentence is then the live
  // region, and this line changes without being read out on top of it (§518).
  const [quiet, setQuiet] = useState(false);
  // The attempt in which the widget last failed or never loaded (§518): while it is this one, the
  // form says so to the register action, which counts it for `/api/health` — once per submission,
  // however many times it failed, and never again for a later attempt whose check worked.
  const [failedIn, setFailedIn] = useState<string | null>(null);
  // Bumped by «Încearcă din nou» when the script never came: the effect below injects it again.
  const [reload, setReload] = useState(0);
  // Bumped by every «Încearcă din nou», so the slow line's clock starts again even when the state
  // it restarts from is the one it was already in.
  const [tries, setTries] = useState(0);
  // Only a running island speaks: the server's render and a page without scripts say nothing.
  const running = useSyncExternalStore(
    NOTHING_TO_WATCH,
    () => true,
    () => false,
  );
  /*
    Nothing of Cloudflare's before the person starts on the form (§577): the script is injected and
    the widget drawn at the first focus, press, key or input anywhere in the enclosing form — never
    on page load. A page opened and left, or scrolled past, costs Cloudflare nothing and the reader
    no third-party request. The first field a person fills is seconds of typing ahead of the send
    button, which is what the check needs; a press on the send button itself arms it too (its focus
    comes first), and the button then holds the press for the token as it always did (§502).
  */
  // A person who started on a form in this document has started: a refused attempt re-renders the
  // form (a new mount after the redirect) and its check starts again at once, as it did before.
  const [armed, setArmed] = useState(() => startedInThisDocument);
  useEffect(() => {
    if (armed) return;
    const target: EventTarget | null = holder.current?.closest("form") ?? document;
    const arm = () => {
      startedInThisDocument = true;
      setArmed(true);
    };
    for (const type of ARMING_EVENTS) target.addEventListener(type, arm, { once: true, passive: true });
    return () => {
      for (const type of ARMING_EVENTS) target.removeEventListener(type, arm);
    };
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    const become = (next: BotCheckWidgetState) => {
      if (cancelled) return;
      const form = holder.current?.closest("form");
      setQuiet(form ? isPressHeld(form) : false);
      setState(next);
      if (next === "passed") setFailures(0);
      if (next === "error") setFailures((count) => count + 1);
      if (next === "error" || next === "blocked") setFailedIn(attempt);
    };
    // This run's `become` is the one every callback reaches from now on — the widget's callbacks
    // were handed to Cloudflare by whichever run drew it, and read this ref when they are called.
    relay.current = become;

    const draw = () => {
      if (cancelled || !holder.current || !window.turnstile) return;
      /*
        Drawn once, reset on every later attempt (`drawBotCheck`). Say so when the token arrives
        (§502): a send button held for the token also watches the hidden field's `value` attribute,
        but that holds only while Cloudflare draws the field as `type="hidden"`; the success
        callback is its documented answer. The event bubbles to the form from here, and the button
        reads the field on the next task — so a held press is sent the moment the check says yes,
        whatever the field is and whichever order the script calls back and writes it in. §502 left
        the failure callbacks out because an `error-callback` can change how the widget retries;
        the ones `drawBotCheck` hands Cloudflare (§518) answer `false`, which leaves Cloudflare's
        own retry as it was, and only name the state.
      */
      const element = holder.current;
      drawBotCheck(window.turnstile, element, widgetId, relay, {
        sitekey: siteKey,
        language: locale,
        onToken: () => element.dispatchEvent(new Event(TURNSTILE_TOKEN_EVENT, { bubbles: true })),
      });
    };

    if (window.turnstile) {
      draw();
      return () => {
        cancelled = true;
        if (relay.current === become) relay.current = null;
      };
    }

    // A tag that already failed — a client navigation back to a form whose script was blocked —
    // will never fire `load` or `error` again: it goes, and a fresh one is injected at once rather
    // than waited for ten seconds.
    const found = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    if (found?.dataset.turnstileFailed) found.remove();
    const existing = found?.dataset.turnstileFailed ? null : found;
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      document.head.append(script);
    }
    // The script refused (a blocker, a proxy, offline) or simply not there yet after ten seconds:
    // said, and «Încearcă din nou» injects it again. A script that arrives later still draws.
    const refused = () => {
      script.dataset.turnstileFailed = "true";
      become("blocked");
    };
    const late = setTimeout(() => {
      if (!window.turnstile) become("blocked");
    }, BOT_CHECK_BLOCKED_AFTER_MS);
    script.addEventListener("load", draw);
    script.addEventListener("error", refused);
    return () => {
      cancelled = true;
      if (relay.current === become) relay.current = null;
      clearTimeout(late);
      script.removeEventListener("load", draw);
      script.removeEventListener("error", refused);
    };
  }, [armed, siteKey, locale, attempt, reload]);

  /*
    A check that takes longer than it should says so and offers to start again (§518): the usual
    answer is under a second, and a spinner that never ends reads as a page that broke. The reset
    lives in the cleanup — it runs when the state moves on — rather than in the effect body, where
    a synchronous setState is a render scheduled from a render (`SubmitButton`'s own slow line).
  */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    // Not armed yet (§577): nothing is loading, so nothing can be slow.
    if (!armed) return;
    if (state !== "loading" && state !== "checking") return;
    const timer = setTimeout(() => setSlow(true), BOT_CHECK_SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [armed, state, attempt, tries]);

  /*
    «Reîncearcă verificarea»: a fresh challenge on the widget that is there, or — when there is none
    because the script never came — the script again. A tag that failed to load stays in the
    document and never fires `load` again, so it goes before the new one is added; a tag still on
    its way stays, and is waited for again — removing it would not stop it running, and two copies
    of `api.js` is a Cloudflare error.
  */
  const retry = () => {
    const api = window.turnstile;
    setTries((count) => count + 1);
    setQuiet(false);
    if (api && widgetId.current !== null) {
      setState("checking");
      try {
        api.reset(widgetId.current);
      } catch {
        setState("error");
        setFailures((count) => count + 1);
        setFailedIn(attempt);
      }
      return;
    }
    if (!api) document.querySelector(`${SCRIPT_SELECTOR}[data-turnstile-failed]`)?.remove();
    setState("loading");
    setReload((count) => count + 1);
  };

  /*
    Hand the widget back when this island goes away (§284).

    Cloudflare keeps its own registry keyed by the id `render` returned, and it does not notice
    the element leaving the document — so a form unmounted by a client navigation left an orphan
    behind, which is the console's "Cannot find Widget cf-chl-widget-…, consider using
    turnstile.remove() to clean up a widget". The next mount then drew a *second* widget beside
    the ghost, and the token a submission carried was whichever of them the API answered for.

    Its own effect with no dependencies, so it runs on unmount and never between attempts: the
    effect above deliberately keeps one widget alive and `reset()`s it, because a fresh challenge
    is the point and a fresh widget is not.
  */
  useEffect(
    () => () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (!id || !window.turnstile) return;
      try {
        window.turnstile.remove(id);
      } catch {
        // A widget Cloudflare has already forgotten is not a failure worth a console line of
        // ours on top of theirs.
      }
    },
    [],
  );

  const gaveUp = botCheckGaveUp(state, failures);
  const offersRetry = botCheckOffersRetry(state, slow);
  const attention = botCheckAsksAttention(state, slow);
  const line =
    slow && (state === "loading" || state === "checking") ? words.slow : state === "error" && gaveUp ? words.failed : words[state];

  return (
    <Box {...(running && armed ? { [BOT_CHECK_ARMED_ATTRIBUTE]: "true" } : {})}>
      {/*
        `min-height` so the form does not jump when the challenge draws itself a moment later — only
        once armed (§593): before the first touch nothing is coming, and a blank box above
        Cloudflare's sentence read as a broken form.
      */}
      <Box
        ref={holder}
        {...{ [BOT_CHECK_STATE_ATTRIBUTE]: state, ...(gaveUp ? { [BOT_CHECK_GAVE_UP_ATTRIBUTE]: "true" } : {}) }}
        sx={armed ? { minHeight: 65 } : undefined}
      />
      {/*
        A widget that failed in this attempt says so with the form (§518) — a word, nothing about
        who — and the register action counts it for `/api/health`. Beside Cloudflare's element,
        never inside it: that one is the script's to draw into.
      */}
      {failedIn === attempt && <input type="hidden" name={BOT_CHECK_SIGNAL_FIELD} value="widget-failed" />}
      {/* Said once the check has started (§577): before the first touch of the form there is nothing to say. */}
      {running && armed && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5, mt: 0.5 }}>
          {/*
            A live region the state is read from as it changes: polite, it waits for the typing —
            and silent while a press is held, when the send button's own sentence says the same
            state (§518): one voice, not two sentences on top of each other.
          */}
          <Typography
            variant="body2"
            role="status"
            aria-live={quiet ? "off" : "polite"}
            data-testid="bot-check-status"
            color={attention ? "text.primary" : "text.secondary"}
            sx={{ fontWeight: attention ? 600 : undefined, flex: "1 1 16rem" }}
          >
            {line}
          </Typography>
          {offersRetry && (
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={retry}
              // A thumb's target (BR-REQ-041-01 criterion 6): it is the way out of a stuck check.
              sx={TAP_TARGET}
            >
              {words.retry}
            </Button>
          )}
        </Box>
      )}
      {/* Who runs the check and what it sees (§323) — with the widget, never before it (§593). */}
      {running && armed && words.notice && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="bot-check-notice">
          {words.notice}
        </Typography>
      )}
    </Box>
  );
}
