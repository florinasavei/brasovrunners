"use client";

import CloseIcon from "@mui/icons-material/Close";
import CropLandscapeIcon from "@mui/icons-material/CropLandscape";
import CropPortraitIcon from "@mui/icons-material/CropPortrait";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import LightModeIcon from "@mui/icons-material/LightMode";
import ParkIcon from "@mui/icons-material/Park";
import StayCurrentPortraitIcon from "@mui/icons-material/StayCurrentPortrait";
import DownloadIcon from "@mui/icons-material/Download";
import ShareIcon from "@mui/icons-material/Share";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import PressButton from "@/shared/ui/PressButton";
import type { CalendarImageData } from "../domain/calendar-image";
import {
  CALENDAR_IMAGE_RATIOS,
  CALENDAR_IMAGE_THEME_CHOICES,
  type CalendarImageOptions,
  type CalendarImageRatio,
  type CalendarImageTheme,
  drawCalendarImage,
} from "./calendar-image-draw";

export type CalendarImageDialogWords = {
  open: string;
  title: string;
  theme: string;
  themes: Record<CalendarImageTheme, string>;
  ratio: string;
  ratios: Record<CalendarImageRatio, string>;
  legend: string;
  download: string;
  share: string;
  close: string;
  preview: string;
};

const RATIOS = Object.keys(CALENDAR_IMAGE_RATIOS) as CalendarImageRatio[];

/** Each choice wears its glyph before its word (§498): the club's runner, the sun, the moon, a tree for the season; the shapes by their frame. */
const THEME_ICON = { club: DirectionsRunIcon, light: LightModeIcon, dark: DarkModeIcon, season: ParkIcon } as const;
const RATIO_ICON = { portrait: CropPortraitIcon, square: CropSquareIcon, story: StayCurrentPortraitIcon, landscape: CropLandscapeIcon } as const;
const CHOICE_SX = { minHeight: 44, gap: 0.5, textTransform: "none" } as const;

/** The faces the page loaded, as the canvas names them: the body's, and the club kit's for the name. */
function pageFonts() {
  const style = getComputedStyle(document.body);
  const body = style.fontFamily || "sans-serif";
  const display = style.getPropertyValue("--font-facon").trim() || body;
  return { body, display };
}

/**
 * The picture's options and its preview (§NNN): the theme, the shape and the legends; «Descarcă PNG», and
 * «Distribuie» where the browser can hand a file to an app (a phone, mostly). Every change redraws the one
 * canvas at the picture's full size; the preview is that canvas, scaled down by CSS.
 */
export default function CalendarImageDialog({
  open,
  onClose,
  data,
  words,
}: {
  open: boolean;
  onClose: () => void;
  data: CalendarImageData;
  words: CalendarImageDialogWords;
}) {
  const [options, setOptions] = useState<CalendarImageOptions>({ theme: "club", ratio: "portrait", legend: true });
  // Whether the browser can hand a PNG to an app (a phone, mostly). The dialog mounts only after the press, in the browser.
  const [canShare] = useState(() => {
    const probe = new File([new Blob()], "probe.png", { type: "image/png" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const fileName = `${data.clubName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}-${data.month.year}-${String(data.month.month).padStart(2, "0")}.png`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The web fonts first, or the first picture is drawn in a fallback face.
    void document.fonts.ready.then(() => {
      const element = canvas.current;
      const ctx = element?.getContext("2d");
      if (cancelled || !element || !ctx) return;
      drawCalendarImage(ctx, data, options, pageFonts());
    });
    return () => {
      cancelled = true;
    };
  }, [open, data, options, width, height]);

  const blob = () => new Promise<Blob | null>((resolve) => canvas.current?.toBlob(resolve, "image/png") ?? resolve(null));

  async function download() {
    const file = await blob();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function share() {
    const file = await blob();
    if (!file) return;
    try {
      await navigator.share({ files: [new File([file], fileName, { type: "image/png" })], title: `${data.clubName} · ${data.words.monthTitle}` });
    } catch {
      // Closed by the visitor, or refused by the browser: nothing to say.
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" data-testid="calendar-image-dialog">
      <DialogTitle>{words.title}</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "flex-start" } }}>
          <canvas
            ref={canvas}
            width={width}
            height={height}
            role="img"
            aria-label={words.preview}
            data-testid="calendar-image-canvas"
            style={{ width: "100%", maxWidth: options.ratio === "landscape" ? 560 : 360, maxHeight: "60vh", objectFit: "contain", alignSelf: "center", borderRadius: 8 }}
          />
          <Stack spacing={2} sx={{ minWidth: 0, flex: 1 }}>
            <div>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} id="calendar-image-theme">
                {words.theme}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={options.theme}
                onChange={(_, theme: CalendarImageTheme | null) => theme && setOptions((current) => ({ ...current, theme }))}
                aria-labelledby="calendar-image-theme"
                sx={{ flexWrap: "wrap" }}
              >
                {CALENDAR_IMAGE_THEME_CHOICES.map((theme) => {
                  const ThemeIcon = THEME_ICON[theme];
                  return (
                    <ToggleButton key={theme} value={theme} sx={CHOICE_SX}>
                      <ThemeIcon aria-hidden="true" sx={{ fontSize: 18 }} />
                      {words.themes[theme]}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
            </div>
            <div>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} id="calendar-image-ratio">
                {words.ratio}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={options.ratio}
                onChange={(_, ratio: CalendarImageRatio | null) => ratio && setOptions((current) => ({ ...current, ratio }))}
                aria-labelledby="calendar-image-ratio"
                sx={{ flexWrap: "wrap" }}
              >
                {RATIOS.map((ratio) => {
                  const RatioIcon = RATIO_ICON[ratio];
                  return (
                    <ToggleButton key={ratio} value={ratio} sx={CHOICE_SX}>
                      <RatioIcon aria-hidden="true" sx={{ fontSize: 18 }} />
                      {words.ratios[ratio]}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
            </div>
            <FormControlLabel
              control={<Checkbox checked={options.legend} onChange={(event) => setOptions((current) => ({ ...current, legend: event.target.checked }))} />}
              label={words.legend}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <PressButton icon={CloseIcon} onClick={onClose}>
          {words.close}
        </PressButton>
        {canShare && (
          <PressButton icon={ShareIcon} variant="outlined" onClick={() => void share()} data-testid="calendar-image-share">
            {words.share}
          </PressButton>
        )}
        <PressButton icon={DownloadIcon} variant="contained" onClick={() => void download()} data-testid="calendar-image-download">
          {words.download}
        </PressButton>
      </DialogActions>
    </Dialog>
  );
}
