"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  NETWORK_PROBE_MARKER,
  NETWORK_PROBE_PATH,
  type NetworkProbe,
  networkReport,
  PROBE_TIMEOUT_MS,
  type ProbeState,
} from "../network-check";

export type NetworkProbeRow = {
  id: NetworkProbe;
  title: string;
  /** What this is, in a sentence a person without IT knowledge reads. */
  meaning: string;
  /** "Permite: <host> …" — the line for IT, with the host from configuration; null when nothing is to be allowed. */
  allow: string | null;
  /** Why it is not tried here (no picture stored, no bot-check keys); null when it is. */
  skip: string | null;
};

export type NetworkProbeWords = {
  checking: string;
  ok: string;
  blocked: string;
  skipped: string;
  again: string;
  reportTitle: string;
  reportIntro: string;
  copy: string;
  copied: string;
  copyFailed: string;
  reportHeading: string;
  siteLabel: string;
  browserLabel: string;
};

/** A promise that gives up: a proxy that swallows a request never answers at all. */
function withTimeout(work: Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** A Server Action call — the same request as every backoffice save. */
async function probeSaves(probe: () => Promise<"ok">): Promise<boolean> {
  try {
    return (await probe()) === "ok";
  } catch {
    return false;
  }
}

/**
 * A plain `multipart/form-data` post into a hidden frame — the request a blocked save is sent again
 * as — and the route's marker read back out of it. A proxy's own page carries no marker.
 */
function probePost(): Promise<boolean> {
  return new Promise((resolve) => {
    const name = `network-probe-${Date.now()}`;
    const frame = document.createElement("iframe");
    frame.name = name;
    frame.hidden = true;
    frame.title = name;
    const form = document.createElement("form");
    form.method = "post";
    form.enctype = "multipart/form-data";
    form.action = NETWORK_PROBE_PATH;
    form.target = name;
    form.hidden = true;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "probe";
    field.value = "1";
    form.append(field);
    const done = (value: boolean) => {
      frame.remove();
      form.remove();
      resolve(value);
    };
    frame.addEventListener("load", () => {
      let marked = false;
      try {
        // The empty frame's own first load is not the answer; the post's is.
        if (frame.contentWindow?.location.href === "about:blank") return;
        const answer = frame.contentDocument;
        marked = answer !== null && answer.getElementById(NETWORK_PROBE_MARKER) !== null;
      } catch {
        // A block page from another origin cannot be read — which is itself the answer.
      }
      done(marked);
    });
    document.body.append(frame, form);
    HTMLFormElement.prototype.submit.call(form);
  });
}

/** A stored picture, asked for afresh: only a real image loads, never a block page. */
function probePicture(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = `${url}${url.includes("?") ? "&" : "?"}probe=${Date.now()}`;
  });
}

/**
 * Cloudflare Turnstile's script, marked the way `TurnstileWidget` marks it so the two never load it
 * twice; it counts only when the script ran (`window.turnstile`), since a block page "loads" too.
 */
function probeScript(src: string): Promise<boolean> {
  if (window.turnstile) return Promise.resolve(true);
  return new Promise((resolve) => {
    document.querySelectorAll("script[data-network-probe]").forEach((element) => element.remove());
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.turnstile = "true";
    script.dataset.networkProbe = "true";
    script.addEventListener("load", () => resolve(Boolean(window.turnstile)));
    script.addEventListener("error", () => {
      script.remove();
      resolve(false);
    });
    document.head.append(script);
  });
}

const CHIP_COLOR: Record<ProbeState, "default" | "success" | "error"> = { checking: "default", skipped: "default", ok: "success", blocked: "error" };

/**
 * The four rows of `/admin/network` (§436), tried from this browser when the page opens and again on
 * "Verifică din nou", each green or red with the line for IT under it; and the report, copied to the
 * clipboard rather than sent. Copying is the lighter choice and the only one that works on the
 * network being diagnosed: sending it through the contact form would be a Server Action, the very
 * request that network refuses. The words are the server's, handed in as strings.
 */
export default function NetworkProbes({
  probe,
  rows,
  pictureUrl,
  turnstileScript,
  site,
  words,
}: {
  /** The page's own do-nothing Server Action (`probeSaveAction`). */
  probe: () => Promise<"ok">;
  rows: readonly NetworkProbeRow[];
  pictureUrl: string | null;
  turnstileScript: string | null;
  site: string;
  words: NetworkProbeWords;
}) {
  const initial = useCallback(
    (): Record<NetworkProbe, ProbeState> =>
      Object.fromEntries(rows.map((row) => [row.id, row.skip ? "skipped" : "checking"])) as Record<NetworkProbe, ProbeState>,
    [rows],
  );
  const [states, setStates] = useState<Record<NetworkProbe, ProbeState>>(initial);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Every probe at once; each row turns when its own answer comes.
  const start = useCallback(() => {
    const probes: Record<NetworkProbe, (() => Promise<boolean>) | null> = {
      saves: () => probeSaves(probe),
      post: probePost,
      pictures: pictureUrl ? () => probePicture(pictureUrl) : null,
      botCheck: turnstileScript ? () => probeScript(turnstileScript) : null,
    };
    for (const row of rows) {
      const attempt = probes[row.id];
      if (row.skip || !attempt) continue;
      void withTimeout(attempt()).then((passed) => setStates((current) => ({ ...current, [row.id]: passed ? "ok" : "blocked" })));
    }
  }, [pictureUrl, turnstileScript, rows, probe]);

  // When the page opens: the rows start as "checking" already.
  useEffect(() => {
    start();
  }, [start]);

  const again = () => {
    setStates(initial());
    setCopyNote(null);
    start();
  };

  const statusWord = (state: ProbeState) => ({ checking: words.checking, ok: words.ok, blocked: words.blocked, skipped: words.skipped })[state];

  const report = () =>
    networkReport({
      heading: words.reportHeading,
      when: new Date().toISOString(),
      siteLabel: words.siteLabel,
      site,
      browserLabel: words.browserLabel,
      browser: navigator.userAgent,
      lines: rows.map((row) => ({ title: row.title, status: statusWord(states[row.id]), allow: states[row.id] === "blocked" ? row.allow : null })),
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopyNote(words.copied);
    } catch {
      setCopyNote(words.copyFailed);
    }
  };

  return (
    <Stack spacing={2}>
      {rows.map((row) => (
        <Paper key={row.id} variant="outlined" sx={{ p: 2 }} data-testid={`network-row-${row.id}`} data-state={states[row.id]}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {row.title}
            </Typography>
            <Chip label={statusWord(states[row.id])} color={CHIP_COLOR[states[row.id]]} size="small" sx={{ alignSelf: "flex-start" }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {row.skip ?? row.meaning}
          </Typography>
          {row.allow && (
            <Typography variant="body2" sx={{ mt: 1, fontFamily: "monospace", wordBreak: "break-word", fontWeight: states[row.id] === "blocked" ? 600 : 400 }}>
              {row.allow}
            </Typography>
          )}
        </Paper>
      ))}
      <Box>
        <Button variant="outlined" onClick={again} sx={TAP_TARGET}>
          {words.again}
        </Button>
      </Box>
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {words.reportTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {words.reportIntro}
        </Typography>
        <Box>
          <Button variant="contained" onClick={() => void copy()} sx={TAP_TARGET} data-testid="network-copy">
            {words.copy}
          </Button>
        </Box>
        {copyNote && (
          <Typography variant="body2" role="status">
            {copyNote}
          </Typography>
        )}
        <TextField
          value={Object.values(states).includes("checking") ? "" : report()}
          multiline
          minRows={4}
          slotProps={{ htmlInput: { readOnly: true, "aria-label": words.reportTitle, "data-testid": "network-report" } }}
          fullWidth
        />
      </Stack>
    </Stack>
  );
}
