"use client";

import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The only client island of the video facade (`DECISIONS.md` §NNN, found by re-review):
 * `VideoFacade` itself is a Server Component now — a `<details>`/`<summary>` with the poster and
 * the iframe already in its server-rendered HTML — so the play control works with no JavaScript
 * at all, a native disclosure the browser handles on its own. This bar is the one piece that
 * genuinely needs a script: talking to the iframe over `postMessage` and reading its answers
 * back. It finds its iframe by `frameId` (the `id` `VideoFacade` gave it — a plain string, never
 * an element or a ref crossing the server/client boundary) and its `<details>` ancestor to know
 * when the film is showing, and renders nothing until then.
 */

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
const CONTROL_SIZE = 44;
/**
 * The IFrame API's handshake (`DECISIONS.md` §NNN): an embedded player posts nothing to its
 * parent — no `onReady`, no `infoDelivery` — until the parent has sent it `listening`, which is
 * what YouTube's own `iframe_api` script does on the iframe's `load` and then every 250 ms until
 * the player answers. Without it every command below would wait in the queue for an answer that
 * never comes. Retried for ten seconds at most: a player that has not answered by then is not
 * going to, and the film still plays with its own controls.
 */
const LISTENING_RETRY_MS = 250;
const LISTENING_MAX_TRIES = 40;
const READY_EVENTS = new Set(["onReady", "initialDelivery", "infoDelivery"]);

type Command = { func: string; args?: number[] };

export default function VideoVolumeBar({
  frameId,
  labels,
}: {
  /** The `id` of the iframe this bar controls (`VideoFacade`'s own `useId()`). */
  frameId: string;
  labels: { mute: string; unmute: string; volume: string };
}) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** Whether the player has answered at all yet — until then, a command is queued, not sent. */
  const readyRef = useRef(false);
  const queueRef = useRef<Command[]>([]);
  /** The last command *this* bar sent, so the very next `infoDelivery` — which still describes
   *  the player from before that command took effect — never overwrites it with stale state
   *  (found by re-review: pressing mute the instant the film opened used to be undone a moment
   *  later by exactly that first, stale answer). */
  const pendingRef = useRef<{ muted?: boolean; volume?: number } | null>(null);

  const post = useCallback((func: string, args?: number[]) => {
    const frame = frameRef.current;
    if (!readyRef.current || !frame) {
      queueRef.current.push({ func, args });
      return;
    }
    frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YOUTUBE_ORIGIN);
  }, []);

  const flushQueue = useCallback(() => {
    const frame = frameRef.current;
    const queued = queueRef.current;
    queueRef.current = [];
    for (const { func, args } of queued) {
      frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YOUTUBE_ORIGIN);
    }
  }, []);

  /** `listening`, the handshake above. Harmless before the player has loaded: a message to a
   *  frame not yet on YouTube's origin is dropped by the browser, never delivered elsewhere. */
  const sendListening = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: frameId, channel: "widget" }),
      YOUTUBE_ORIGIN,
    );
  }, [frameId]);

  // Found by the film's `<details>` ancestor — the same element the summary's native disclosure
  // opens with no script running at all. Opening it here only starts talking to the iframe and
  // showing the bar; it never controls the disclosure itself.
  useEffect(() => {
    const frame = document.getElementById(frameId);
    if (!(frame instanceof HTMLIFrameElement)) return undefined;
    frameRef.current = frame;
    // The handshake on mount and on every load of the player — a closed-then-reopened
    // disclosure may load it afresh, and a fresh player has heard nothing yet.
    sendListening();
    const onLoad = () => sendListening();
    frame.addEventListener("load", onLoad);
    const details = frame.closest("details");
    // `open` already starts `false`, matching every real page load (the server never renders
    // the `open` attribute) — reading `details.open` here too would be the cascading
    // synchronous `setState` the lint rule refuses. The listener alone is enough to track the
    // one case that matters: the visitor's own click.
    const onToggle = () => setOpen(details?.open ?? false);
    details?.addEventListener("toggle", onToggle);
    return () => {
      frame.removeEventListener("load", onLoad);
      details?.removeEventListener("toggle", onToggle);
    };
  }, [frameId, sendListening]);

  // Reset per opening: a closed-then-reopened `<details>` gives the iframe a fresh load in every
  // browser that unloads hidden content, so the player is not yet ready again either.
  useEffect(() => {
    if (!open) {
      readyRef.current = false;
      queueRef.current = [];
      pendingRef.current = null;
      return;
    }
    frameRef.current?.focus();
    // The click that opened the disclosure is the same gesture that should start the film
    // (the owner's call: a click means sound); the player answers `onReady` before this does
    // anything, exactly like every other command here.
    post("playVideo");
    // The handshake again, until the player answers — as YouTube's own script does.
    sendListening();
    let tries = 1;
    const retry = window.setInterval(() => {
      if (readyRef.current || tries >= LISTENING_MAX_TRIES) {
        window.clearInterval(retry);
        return;
      }
      tries += 1;
      sendListening();
    }, LISTENING_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [open, post, sendListening]);

  // Always listening, open or not: a player that answers the handshake before the `toggle` event
  // has reached this bar must not have its first answer missed.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== YOUTUBE_ORIGIN) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      let data: unknown;
      try {
        data = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      const message = data as { event?: string; info?: { muted?: boolean; volume?: number } };
      if (message.event !== undefined && READY_EVENTS.has(message.event)) {
        if (!readyRef.current) {
          readyRef.current = true;
          flushQueue();
        }
      }
      if (message.event === "infoDelivery" && message.info) {
        const pending = pendingRef.current;
        if (typeof message.info.muted === "boolean" && pending?.muted === undefined) setMuted(message.info.muted);
        if (typeof message.info.volume === "number" && pending?.volume === undefined) setVolume(message.info.volume);
        // This answer is at least as new as the command it was queued behind — the next one
        // is free to describe the player again.
        pendingRef.current = null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [flushQueue]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    pendingRef.current = { ...pendingRef.current, muted: next };
    post(next ? "mute" : "unMute");
  }, [muted, post]);

  const changeVolume = useCallback(
    (_event: Event, value: number | number[]) => {
      const next = Array.isArray(value) ? (value[0] ?? 0) : value;
      setVolume(next);
      pendingRef.current = { ...pendingRef.current, volume: next };
      if (next === 0) {
        setMuted(true);
        pendingRef.current = { ...pendingRef.current, muted: true };
        post("mute");
      } else {
        setMuted(false);
        pendingRef.current = { ...pendingRef.current, muted: false };
        post("unMute");
        post("setVolume", [next]);
      }
    },
    [post],
  );

  return (
    <Box
      sx={{
        // Present in the markup from the first render — hydration-stable, and testable without
        // a click event — but shown only once the disclosure this bar controls is open.
        display: open ? "flex" : "none",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        bgcolor: "grey.900",
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
      }}
    >
      <IconButton
        type="button"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? labels.unmute : labels.mute}
        sx={{ color: "common.white", width: CONTROL_SIZE, height: CONTROL_SIZE, flexShrink: 0 }}
      >
        {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
      </IconButton>
      <Slider
        size="small"
        value={muted ? 0 : volume}
        onChange={changeVolume}
        min={0}
        max={100}
        aria-label={labels.volume}
        sx={{ color: "common.white", flex: 1, maxWidth: 180, mr: 1, display: { xs: "none", sm: "flex" } }}
      />
    </Box>
  );
}
