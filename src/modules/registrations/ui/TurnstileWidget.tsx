"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  BOT_CHECK_BLOCKED_AFTER_MS,
  BOT_CHECK_GAVE_UP_ATTRIBUTE,
  BOT_CHECK_SLOW_AFTER_MS,
  BOT_CHECK_STATE_ATTRIBUTE,
  botCheckAsksAttention,
  botCheckGaveUp,
  botCheckOffersRetry,
  type BotCheckState,
  reportBotCheckSignal,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TOKEN_EVENT,
} from "../domain/turnstile-widget";
import { isPressHeld } from "@/shared/ui/held-press";

/**
 * Cloudflare Turnstile, rendered explicitly and reset on every attempt (`DECISIONS.md` §185), with
 * every state it can be in said in words under it and a way out of each one a person can be stuck
 * in (§NNN).
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
 * **Every state, visible and recoverable (§NNN).** Cloudflare's own frame says «Success!» or shows
 * a box, and says nothing at all when its script is blocked, when it fails, when its token lapses
 * or when the box waited too long — and the send button (`SubmitButton`'s `awaitsBotCheck`) was
 * left to guess from an empty field. Now each of Cloudflare's documented callbacks names a state
 * (`BOT_CHECK_STATES`), the line under the widget says it in the reader's language, and:
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
 * - a widget that fails or never loads is counted once, level-only, for `/api/health`
 *   (`reportBotCheckSignal`).
 *
 * Cloudflare's own retries are kept: `retry` and `refresh-expired` / `refresh-timeout` stay at
 * their `auto` defaults, and the error callback returns `false`, which the documentation names as
 * "let Turnstile handle the retry" — «Reîncearcă verificarea» is a faster way out, not the only one.
 *
 * With JavaScript off none of it runs and nothing is said: the line is drawn only once the island
 * runs, so a page without scripts never promises a check that cannot start.
 */

type TurnstileOptions = {
  sitekey: string;
  language?: string;
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
  "unsupported-callback"?: () => void;
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileOptions) => string;
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
export type BotCheckWords = Record<BotCheckState, string> & { slow: string; retry: string; failed: string };

const SCRIPT_SELECTOR = "script[data-turnstile]";
const NOTHING_TO_WATCH = () => () => {};

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
  const [state, setState] = useState<BotCheckState>("loading");
  // Failures so far (§NNN): the first is Cloudflare's to retry, the second gives up. Kept across
  // «Reîncearcă verificarea» and new attempts; a pass starts the count again.
  const [failures, setFailures] = useState(0);
  // A press held on the form when the state changed: the button's own sentence is then the live
  // region, and this line changes without being read out on top of it (§NNN).
  const [quiet, setQuiet] = useState(false);
  // One count per widget for `/api/health` (§NNN), however many times it fails.
  const reported = useRef(false);
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

  useEffect(() => {
    let cancelled = false;
    const become = (next: BotCheckState) => {
      if (cancelled) return;
      const form = holder.current?.closest("form");
      setQuiet(form ? isPressHeld(form) : false);
      setState(next);
      if (next === "passed") setFailures(0);
      if (next === "error") setFailures((count) => count + 1);
      if ((next === "error" || next === "blocked") && !reported.current) {
        reported.current = true;
        reportBotCheckSignal("widget-failed");
      }
    };

    const draw = () => {
      if (cancelled || !holder.current || !window.turnstile) return;
      // Already drawn: the token has been spent, so ask for a fresh challenge rather than a
      // second widget — `render` into an occupied element is a Cloudflare error.
      if (widgetId.current !== null) {
        become("checking");
        window.turnstile.reset(widgetId.current);
        return;
      }
      /*
        Say so when the token arrives (§NNN). A send button held for the token also watches the
        hidden field's `value` attribute, but that holds only while Cloudflare draws the field as
        `type="hidden"`; the success callback is its documented answer. It bubbles to the form from
        here, and the button reads the field on the next task — so a held press is sent the moment
        the check says yes, whatever the field is and whichever order the script calls back and
        writes it in.

        Every other documented callback names a state (§NNN). The error callback returns `false`:
        Cloudflare's documentation says a falsy answer leaves the retry to Turnstile, and a truthy
        one takes it over — its automatic retry stays, and «Încearcă din nou» is the faster way.
      */
      const element = holder.current;
      become("checking");
      try {
        widgetId.current = window.turnstile.render(element, {
          sitekey: siteKey,
          language: locale,
          callback: () => {
            become("passed");
            element.dispatchEvent(new Event(TURNSTILE_TOKEN_EVENT, { bubbles: true }));
          },
          "error-callback": () => {
            become("error");
            return false;
          },
          "expired-callback": () => become("expired"),
          "timeout-callback": () => become("timeout"),
          "before-interactive-callback": () => become("interactive"),
          "after-interactive-callback": () => become("checking"),
          "unsupported-callback": () => become("unsupported"),
        });
      } catch {
        // A widget Cloudflare refused to draw (a malformed option, a script half-loaded) is a
        // failure like any other: said, retryable, and never a reason to hold a press.
        become("error");
      }
    };

    if (window.turnstile) {
      draw();
      return () => {
        cancelled = true;
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
      clearTimeout(late);
      script.removeEventListener("load", draw);
      script.removeEventListener("error", refused);
    };
  }, [siteKey, locale, attempt, reload]);

  /*
    A check that takes longer than it should says so and offers to start again (§NNN): the usual
    answer is under a second, and a spinner that never ends reads as a page that broke. The reset
    lives in the cleanup — it runs when the state moves on — rather than in the effect body, where
    a synchronous setState is a render scheduled from a render (`SubmitButton`'s own slow line).
  */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state !== "loading" && state !== "checking") return;
    const timer = setTimeout(() => setSlow(true), BOT_CHECK_SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [state, attempt, tries]);

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
    <Box>
      {/* `min-height` so the form does not jump when the challenge draws itself a moment later. */}
      <Box
        ref={holder}
        {...{ [BOT_CHECK_STATE_ATTRIBUTE]: state, ...(gaveUp ? { [BOT_CHECK_GAVE_UP_ATTRIBUTE]: "true" } : {}) }}
        sx={{ minHeight: 65 }}
      />
      {running && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5, mt: 0.5 }}>
          {/*
            A live region the state is read from as it changes: polite, it waits for the typing —
            and silent while a press is held, when the send button's own sentence says the same
            state (§NNN): one voice, not two sentences on top of each other.
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
    </Box>
  );
}
