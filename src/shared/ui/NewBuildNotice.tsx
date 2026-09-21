"use client";

import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fadeIn } from "@/theme/motion";
import {
  ANSWER_TIMEOUT_MS,
  BUILD_ENDPOINT,
  BUILD_STORAGE_KEYS,
  POLL_INTERVAL_MS,
  readReloadStamp,
  readServedBuild,
  shouldRaiseNotice,
} from "./new-build";
import { TAP_TARGET } from "./tap-target";

/**
 * "A newer version is deployed" — offered, never taken.
 *
 * The whole feature is in three parts and this is the one that touches a browser: the rules are
 * in `new-build.ts`, the deployed build's identity is at `/api/build-id`, and this asks, compares
 * and puts one sentence on the screen with a button beside it. It **never reloads on its own**,
 * by any path — the single `location.reload()` below is inside an `onClick`.
 *
 * ## Why it is a client island at all, and what keeps it small
 *
 * Nothing else on this site needs to know that the world changed while a page was open, so
 * there is no cheaper mechanism to reuse: this is a timer, a fetch and a flag. What it costs is
 * bounded on purpose — no dependency, no context, no state library, and the only MUI it pulls
 * in (`Paper`, `Button`, `IconButton`, `Typography`) is already in every page's bundle.
 *
 * With JavaScript off, nothing here runs and nothing breaks: the notice simply never appears,
 * and the site is exactly the site it was.
 *
 * ## Where the running build's identity comes from
 *
 * A **string prop from a Server Component** (`SiteHeader`), which is the only source that
 * answers the right question. The client bundle cannot answer it: a value inlined into a chunk
 * is the identity of *the chunk the browser happens to have*, which is the very thing suspected
 * of being stale, and baking a per-deployment value into a chunk changes that chunk's hash on
 * every build — the entire client bundle re-downloaded so a notice can exist. A prop comes out
 * of the HTML the deployment just served, so it is by construction the identity of the code
 * this tab is running. (A `<meta>` tag would do the same job; a prop is the same fact with one
 * fewer element in every document, and this project already inlines `BUILD_*` through
 * `next.config.ts` for a Server Component to read.)
 *
 * It is a plain string and not an element, per the rule `CheckboxField.tsx` documents at
 * length: a React element passed as a prop across the server/client boundary is serialised, and
 * past a certain tree depth it arrives as a lazy reference with no `props` and the page answers
 * 500.
 */

/**
 * The store: one module-level value, observed with `useSyncExternalStore`.
 *
 * It holds the identity of a deployed build that differs from this tab's, and it moves **one
 * way** — from "nothing to say" to an identity, and afterwards only to a newer identity. It
 * never returns to `null`, because a deployment cannot un-happen. Dismissing is therefore not
 * the store's business (that is the component's state, below): if dismissal cleared the store,
 * a second deployment after a dismissal would have nothing to change.
 *
 * A store rather than component state because the component must not fetch during render, and
 * because the check has to keep working across a re-render it did not cause. Several islands
 * here already use this hook for the same reason in its smallest form — `NativeShareButton`
 * and `ThemeModeToggle` use it as the hydration test — and this is the same shape with a real
 * value behind it.
 */
let deployed: string | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): string | null {
  return deployed;
}

/**
 * The server renders nothing, and so does the first client render: `deployed` is `null` until a
 * poll has answered, which cannot happen during render. The HTML and the first hydration agree.
 */
function getServerSnapshot(): null {
  return null;
}

/**
 * What the last check concluded — and it moves **both** ways (§210, found in review).
 *
 * It only moved forward at first, on the reasoning that a deployment cannot un-happen. The
 * reasoning is true and the conclusion was not: what this tab compares itself against is not "a
 * deployment happened" but "the address I am on serves something else now", and that **can** go
 * back. A rollback does it — the club presses Vercel's promote on yesterday's build — and so does
 * an alias moved by hand, which is how this project switched domains. Once raised, the notice
 * stayed up for ever, telling somebody to reload onto a build they were already running.
 *
 * So `settle` is the only writer: it raises when the served build differs and clears when a
 * later answer agrees with the running one.
 */
function settle(build: string | null): void {
  if (deployed === build) return;
  deployed = build;
  for (const onChange of listeners) onChange();
}

/**
 * Every `sessionStorage` touch is wrapped, in both directions.
 *
 * A private window, a browser with site data blocked, a storage quota that is full: the
 * accessor itself throws, not the value. A throw here would take the header — and therefore
 * every page — down with it, to remember a dismissal.
 */
function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Nothing remembered. The notice may ask again after a reload, which is the mild failure. */
  }
}

export default function NewBuildNotice({ build }: { build: string }) {
  const t = useTranslations("Site");
  const deployedBuild = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /** The identity this reader waved away in this render tree; the stored copy survives a remount. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    // No identity, no question. A build with no git checkout and no host deployment id cannot
    // compare itself to anything, and the check would poll forever to learn that.
    if (!build) return;

    let stopped = false;
    let timer: number | undefined;

    const ask = async () => {
      /**
       * `no-store` so the answer is never the browser's own copy of it, and an
       * `AbortController` on a three-second fuse so a request that hangs — a captive portal, a
       * network that accepted the connection and then went away — cannot leave this function
       * unfinished and the tab permanently quiet.
       */
      const controller = new AbortController();
      const fuse = window.setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
      try {
        const response = await fetch(BUILD_ENDPOINT, {
          cache: "no-store",
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const served = readServedBuild(response.status, response.ok ? await response.text() : null);
        if (stopped || served === null) return;
        const raiseIt = shouldRaiseNotice({
          running: build,
          served,
          dismissed: readStored(BUILD_STORAGE_KEYS.dismissed),
          reloadedAt: readReloadStamp(readStored(BUILD_STORAGE_KEYS.reloadedAt)),
          now: Date.now(),
        });
        /*
          Both directions (§210): raise on a difference, and clear when the answer agrees with
          what this tab is running — a rollback is the case that made the one-way store lie.
          `shouldRaiseNotice` still owns every reason NOT to raise (a dismissal, the cooldown,
          garbage), so clearing is only ever done on the one fact it cannot express.
        */
        if (raiseIt) settle(served);
        else if (served === build) settle(null);
      } catch {
        /**
         * Offline, aborted, DNS gone, a proxy that closed the socket. Silence is the answer:
         * a failed check is not evidence of a deployment, and a notice raised on a tunnel
         * would be a notice nobody can ever trust again.
         */
      } finally {
        window.clearTimeout(fuse);
      }
    };

    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        // Belt as well as braces: an interval can fire once more as a tab is being hidden.
        if (document.visibilityState === "visible") void ask();
      }, POLL_INTERVAL_MS);
    };

    /**
     * A hidden tab is stopped **entirely** — the interval is cleared, not skipped.
     *
     * That is the cheap decision and also the correct one. A background tab has nobody reading
     * it, so an answer it receives is of no use until somebody comes back; and a browser
     * throttles background timers to roughly once a minute anyway, so skipping inside the
     * callback would keep waking the tab to decide to do nothing. The moment it becomes
     * visible again it asks at once, which is the cheapest useful moment there is: exactly one
     * request, at the instant a person is there to be told.
     *
     * There is deliberately **no check on mount**. The document in front of the reader was
     * just served by the deployment it names, so the first poll would compare a value against
     * itself — one request per page view for an answer that is known.
     */
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void ask();
        schedule();
      } else {
        window.clearInterval(timer);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") schedule();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [build]);

  const show = deployedBuild !== null && deployedBuild !== dismissed;

  return (
    /**
     * Anchored to the bottom edge of the sticky header, which is what makes the placement
     * work rather than fight.
     *
     * `position: absolute` inside the header's own sticky box means the notice **tracks the
     * header** instead of guessing where it is. It therefore cannot cover the header, the
     * language switcher or the navigation (they are the row above it), and it cannot cover the
     * orange "this is not the real site" banner either — that banner sits above the header in
     * the flow and scrolls away, and a fixed notice with a hard-coded top offset would have
     * landed on top of it at scroll zero on qa. Absolute rather than in the flow costs no
     * layout: nothing moves when the notice appears, which matters more here than anywhere,
     * because the reader may be typing.
     *
     * It is at the top of the page, so it is never over a submit button — those are at the
     * bottom of a form — and never over the build badge in the opposite corner.
     *
     * `role="status"` is on the wrapper, which is always rendered, so the region exists before
     * the sentence arrives in it; a live region created at the same moment as its content is
     * announced unreliably. `pointerEvents: none` on the wrapper keeps the empty strip inert,
     * and the card turns them back on for itself.
     */
    <Box
      role="status"
      sx={{
        /*
          In the flow, below the sticky header (§210, found in review).

          It was `position: absolute; top: 100%` inside the header's sticky box, on the
          reasoning that it would then track the header rather than guess where it is. It does —
          and a positioned descendant of a sticky element travels with it, so the notice occupied
          a fixed band of the *viewport* at every scroll position, covering whatever the reader
          had scrolled to. `pointerEvents: none` on this wrapper let clicks through, but the card
          itself took them back, and a card cannot be read through at all.

          In the flow it costs one layout shift when it appears and then covers nothing. The
          shift is momentary; the occlusion was permanent.
        */
        display: "flex",
        justifyContent: "center",
        px: 1,
      }}
    >
      {show && (
        <Paper
          elevation={6}
          sx={{
            // Readable at 320px: the bar takes what the viewport has, minus the gutters.
            width: "100%",
            maxWidth: 560,
            // Slim, because it is in the flow now and every pixel of it is a pixel the page
            // moved down when it appeared (§210).
            px: 1,
            py: 0.5,
            mt: 1,
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
            border: 1,
            borderColor: "divider",
            // Guarded by `MOTION_OK` inside: a reader who asked for less motion gets it still.
            ...fadeIn,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/*
              One sentence, and it has to say what the button costs. That is the entire reason
              this is a confirmation and not a refresh: the person reading it may have twenty
              fields filled in and a signature drawn, and "a new version is available" tells
              them nothing about what they are agreeing to lose.
            */}
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t("newBuild.body")}
            </Typography>
            <Button
              variant="contained"
              size="small"
              // A thumb's 44 pixels (BR-REQ-041-01 criterion 6): this is pressed on a phone.
              sx={TAP_TARGET}
              onClick={() => {
                /**
                 * The only reload in the feature, and a person pressed it. The stamp is written
                 * first so the cooldown holds even if the new document is the same old one —
                 * see `RELOAD_COOLDOWN_MS`.
                 */
                writeStored(BUILD_STORAGE_KEYS.reloadedAt, String(Date.now()));
                window.location.reload();
              }}
            >
              {t("newBuild.reload")}
            </Button>
          </Box>
          <IconButton
            size="small"
            aria-label={t("newBuild.dismiss")}
            sx={{ ...TAP_TARGET, minWidth: 44 }}
            onClick={() => {
              /**
               * Keyed by the identity, in both places: the state hides it now, the stored value
               * keeps it hidden if this island remounts. A newer deployment has a different
               * identity and is free to ask again — which is the point of storing the build
               * rather than a flag.
               */
              if (deployedBuild) writeStored(BUILD_STORAGE_KEYS.dismissed, deployedBuild);
              setDismissed(deployedBuild);
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Paper>
      )}
    </Box>
  );
}
