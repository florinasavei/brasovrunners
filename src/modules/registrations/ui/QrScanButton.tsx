"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isCheckinCode, normalizeCheckinCode } from "@/modules/registrations/checkin-code";
import { ACTION_ICONS } from "@/shared/ui/action-icons";

// A client island already, so the element is made here; the glyph is still the registry's (§NNN).
const ScanGlyph = ACTION_ICONS.scan;

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/**
 * Scan a runner's QR from inside the desk page (BR-REQ-037-08), with the browser's own
 * `BarcodeDetector` — no library, no bundle. It exists on Android Chrome, which is what a
 * volunteer's phone usually is; where it does not (iOS Safari, most desktops) the button is
 * not rendered and the page says to use the camera app, which opens the same link, because
 * the QR *is* a link. Either way the code ends up at `/admin/checkin/<code>`.
 *
 * `hrefTemplate` is the localized path with `__CODE__` where the code goes; the server built
 * it with `getPathname`, so this island never assembles a route.
 */
export default function QrScanButton({
  hrefTemplate,
  label,
  closeLabel,
  hint,
  unreadableHint,
}: {
  hrefTemplate: string;
  label: string;
  closeLabel: string;
  hint: string;
  unreadableHint: string;
}) {
  // False on the server and during hydration, true afterwards where the API exists — read as
  // an external store so the server and the first client render agree.
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => "BarcodeDetector" in window && "mediaDevices" in navigator,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let done = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (done || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            for (const found of codes) {
              const code = normalizeCheckinCode(found.rawValue);
              if (isCheckinCode(code)) {
                done = true;
                window.location.assign(hrefTemplate.replace("__CODE__", code));
                return;
              }
              setProblem(unreadableHint);
            }
          } catch {
            // A frame that could not be read is not an error; the next one is tried.
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      done = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, hrefTemplate, unreadableHint]);

  if (!supported) return null;

  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)} startIcon={<ScanGlyph fontSize="small" />} sx={{ minHeight: 44 }}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          <Box
            component="video"
            ref={videoRef}
            muted
            playsInline
            sx={{ width: "100%", borderRadius: 1, bgcolor: "black", aspectRatio: "1 / 1", objectFit: "cover" }}
          />
          <Box sx={{ mt: 1, fontSize: "0.875rem", color: "text.secondary" }}>{hint}</Box>
          {problem && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {problem}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{closeLabel}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
