"use client";

import CampaignIcon from "@mui/icons-material/Campaign";
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
import { LOGO } from "@/theme/brand";
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

/** Each choice wears its glyph before its word (§498): a poster's megaphone, the club's runner, the sun, the moon, a tree for the season; the shapes by their frame. */
const THEME_ICON = { poster: CampaignIcon, club: DirectionsRunIcon, light: LightModeIcon, dark: DarkModeIcon, season: ParkIcon } as const;
const RATIO_ICON = { portrait: CropPortraitIcon, square: CropSquareIcon, story: StayCurrentPortraitIcon, landscape: CropLandscapeIcon } as const;
const CHOICE_SX = { minHeight: 44, gap: 0.5, textTransform: "none" } as const;

/**
 * Poppins (SIL OFL 1.1, `public/fonts/calendar/`), the geometric sans «Afiș» is set in: the dialog's own,
 * fetched when it first opens, so no other page pays for it. Each weight is two files, as fontsource splits
 * them: the Latin letters, and the extended ones Romanian's «ș ț ă» live in.
 */
const POSTER_FAMILY = "Poppins";
const POSTER_FACES = [
  { weight: "500", style: "normal", file: "500" },
  { weight: "700", style: "normal", file: "700" },
  { weight: "800", style: "normal", file: "800" },
  { weight: "500", style: "italic", file: "500italic" },
  { weight: "900", style: "italic", file: "900italic" },
] as const;
const POSTER_SUBSETS = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  latinext:
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
} as const;
let posterFaces: Promise<unknown> | null = null;

/** The poster's faces added to the document once; a failed load is tried again the next time the dialog opens. */
function loadPosterFaces(): Promise<unknown> {
  posterFaces ??= Promise.all(
    POSTER_FACES.flatMap(({ weight, style, file }) =>
      Object.entries(POSTER_SUBSETS).map(([subset, unicodeRange]) => {
        const face = new FontFace(POSTER_FAMILY, `url(/fonts/calendar/${POSTER_FAMILY}-${file}-${subset}.woff2) format("woff2")`, { weight, style, unicodeRange });
        document.fonts.add(face);
        return face.load();
      }),
    ),
  ).catch((error: unknown) => {
    posterFaces = null;
    throw error;
  });
  return posterFaces;
}

/** The faces the canvas names: the page's body, the club kit's and the hand-written one; and the poster's, the page's body after it. */
function pageFonts() {
  const style = getComputedStyle(document.body);
  const body = style.fontFamily || "sans-serif";
  const display = style.getPropertyValue("--font-facon").trim() || body;
  const script = style.getPropertyValue("--font-signature").trim() || body;
  return { body, display, script, poster: `'${POSTER_FAMILY}', ${body}` };
}

/**
 * The picture's options and its preview (§855): the theme, the shape and the legends; «Descarcă PNG», and
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
  const [options, setOptions] = useState<CalendarImageOptions>({ theme: "poster", ratio: "portrait", legend: true });
  // Whether the browser can hand a PNG to an app (a phone, mostly). The dialog mounts only after the press, in the browser.
  const [canShare] = useState(() => {
    const probe = new File([new Blob()], "probe.png", { type: "image/png" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // The club's real logo, the white lockup the site serves itself (so the canvas stays exportable); null
  // until it has loaded, and the picture is drawn again when it has.
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const { width, height } = CALENDAR_IMAGE_RATIOS[options.ratio];
  // «brasov-runners-2026-10.png»: the diacritics' marks dropped before anything else is, or «ș» splits the word.
  const fileName = `${data.clubName.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-")}-${data.month.year}-${String(data.month.month).padStart(2, "0")}.png`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The web fonts first, or the first picture is drawn in a fallback face.
    // The hand-written face is not preloaded by the page (it is used nowhere else on it), and the poster's
    // is the dialog's own: both asked for here.
    const fonts = pageFonts();
    void Promise.all([loadPosterFaces(), document.fonts.load(`400 64px ${fonts.script}`), document.fonts.load(`italic 900 52px ${fonts.display}`)]).catch(() => undefined).then(() => document.fonts.ready).then(() => {
      const element = canvas.current;
      const ctx = element?.getContext("2d");
      if (cancelled || !element || !ctx) return;
      drawCalendarImage(ctx, data, options, fonts, { logo });
    });
    return () => {
      cancelled = true;
    };
  }, [open, data, options, width, height, logo]);

  useEffect(() => {
    if (!open || logo) return;
    let cancelled = false;
    const image = new Image();
    image.src = LOGO.lockup.onDark;
    // A logo that cannot load leaves the drawn mountains in its place: nothing to say.
    void image
      .decode()
      .then(() => {
        if (!cancelled) setLogo(image);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, logo]);

  // `toBlob` answers through its callback and returns nothing: a `??` after it resolved null at once,
  // so «Descarcă PNG» and «Distribuie» did nothing (the owner, 2026-10-27).
  const blob = () =>
    new Promise<Blob | null>((resolve) => {
      const element = canvas.current;
      if (!element) {
        resolve(null);
        return;
      }
      element.toBlob(resolve, "image/png");
    });

  async function download() {
    const file = await blob();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    // In the document while it is pressed: an anchor outside it is not followed by every browser.
    document.body.append(link);
    link.click();
    link.remove();
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
