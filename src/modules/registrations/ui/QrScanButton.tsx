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

// A client island already, so the element is made here; the glyph is still the registry's (§318).
const ScanGlyph = ACTION_ICONS.scan;
const DismissIcon = ACTION_ICONS.dismiss;
// «Altă cameră»: the registry's «replace» glyph, one thing swapped for another.
const SwitchGlyph = ACTION_ICONS.replace;

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };

/** The focus controls Chrome on Android exposes on a camera track; absent elsewhere, and typed by nobody yet. */
type FocusCapabilities = { focusMode?: string[]; focusDistance?: { min: number; max: number } };
type FocusConstraints = { focusMode?: string; focusDistance?: number };

/**
 * Ask the camera to keep focusing (the owner, 2026-10-25, a phone held at a watch: «It works but the camera does not focus»). The
 * default stream on some Android phones comes from a lens that holds one distance, so a QR code held close stays a blur and is never
 * read. Where the track says it can, continuous autofocus is asked for; where it cannot, nothing changes and the camera app stays
 * the way, as the page already says. A refusal is swallowed: focus is a courtesy, the frame is read either way.
 */
async function keepFocusing(stream: MediaStream): Promise<void> {
  const [track] = stream.getVideoTracks();
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") return;
  const capabilities = track.getCapabilities() as FocusCapabilities;
  const wanted: FocusConstraints = {};
  if (capabilities.focusMode?.includes("continuous")) wanted.focusMode = "continuous";
  if (Object.keys(wanted).length === 0) return;
  try {
    await track.applyConstraints({ advanced: [wanted as MediaTrackConstraintSet] });
  } catch {
    // The camera keeps its own focus: the stream is still shown and read.
  }
}
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
/** Where the phone remembers which of its cameras the desk chose (§850): a per-viewer convenience, never read by the server. */
const CAMERA_KEY = "desk.camera";

function rememberedCamera(): string | null {
  try {
    return window.localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

function rememberCamera(deviceId: string | null): void {
  try {
    if (deviceId === null) window.localStorage.removeItem(CAMERA_KEY);
    else window.localStorage.setItem(CAMERA_KEY, deviceId);
  } catch {
    // A private window or blocked storage: the choice lasts the dialog, which is enough for one scan.
  }
}

export default function QrScanButton({
  hrefTemplate,
  label,
  closeLabel,
  hint,
  unreadableHint,
  switchLabel,
  cameraLabel,
}: {
  hrefTemplate: string;
  label: string;
  closeLabel: string;
  hint: string;
  unreadableHint: string;
  /** «Altă cameră»: the button that moves to the phone's next camera, shown only when it has more than one. */
  switchLabel: string;
  /** «Camera {n} din {total}»: which one is on, beside the button. */
  cameraLabel: string;
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
  // The phone's cameras, known once the first stream is open (labels and ids come only with the permission), and the one in use —
  // the owner, 2026-10-25: «I wanna be able to use the better camera»: a phone with three back lenses gives the browser the wide one,
  // which cannot focus on a code held close; the right one is a press away and remembered on that phone.
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  // The camera asked for by a press in this dialog; null means the one the phone remembers, else any back camera.
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Bumped when a remembered camera is gone, so the stream is asked for again without it.
  const [attempt, setAttempt] = useState(0);
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
        // A sharper stream than the default, which on some phones is a low-resolution feed that never reads a code on a screen;
        // the chosen camera by its id when the phone remembers one, else any back camera.
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
        const wanted = cameraId ?? rememberedCamera();
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: wanted ? { deviceId: { exact: wanted }, ...size } : { facingMode: "environment", ...size } });
        } catch (error) {
          // A remembered camera that is gone (another phone's id, a changed browser): the memory dropped, the back camera asked for again.
          if (!wanted) throw error;
          rememberCamera(null);
          setCameraId(null);
          setAttempt((count) => count + 1);
          return;
        }
        await keepFocusing(stream);
        const [track] = stream.getVideoTracks();
        setCurrentId(track?.getSettings?.().deviceId ?? wanted);
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setCameras(devices.filter((device) => device.kind === "videoinput"));
        } catch {
          // No list: the one camera the browser gave is used, as before.
        }
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
  }, [open, hrefTemplate, unreadableHint, cameraId, attempt]);

  if (!supported) return null;

  const currentIndex = Math.max(0, cameras.findIndex((device) => device.deviceId === currentId));
  const nextCamera = () => {
    if (cameras.length < 2) return;
    const next = cameras[(currentIndex + 1) % cameras.length];
    rememberCamera(next.deviceId);
    setProblem(null);
    setCameraId(next.deviceId);
  };

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
          {cameras.length > 1 && (
            <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Button variant="outlined" size="small" onClick={nextCamera} startIcon={<SwitchGlyph fontSize="small" />} sx={{ minHeight: 44 }} data-testid="scan-switch-camera">
                {switchLabel}
              </Button>
              <Box component="span" sx={{ fontSize: "0.875rem", color: "text.secondary" }}>
                {cameraLabel.replace("{n}", String(currentIndex + 1)).replace("{total}", String(cameras.length))}
              </Box>
            </Box>
          )}
          {problem && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {problem}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} startIcon={<DismissIcon fontSize="small" />}>
            {closeLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
