"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CampaignIcon from "@mui/icons-material/Campaign";
import CloseIcon from "@mui/icons-material/Close";
import ContrastIcon from "@mui/icons-material/Contrast";
import CropLandscapeIcon from "@mui/icons-material/CropLandscape";
import CropPortraitIcon from "@mui/icons-material/CropPortrait";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DateRangeIcon from "@mui/icons-material/DateRange";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import LightModeIcon from "@mui/icons-material/LightMode";
import ParkIcon from "@mui/icons-material/Park";
import StayCurrentPortraitIcon from "@mui/icons-material/StayCurrentPortrait";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import ViewWeekIcon from "@mui/icons-material/ViewWeek";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import DownloadIcon from "@mui/icons-material/Download";
import ShareIcon from "@mui/icons-material/Share";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import PressButton from "@/shared/ui/PressButton";
import { LOGO } from "@/theme/brand";
import type { CalendarImageData } from "../domain/calendar-image";
import { calendarImageFonts, loadCalendarImageFonts } from "./calendar-image-fonts";
import { CALENDAR_IMAGE_RATIOS, type CalendarImageRatio } from "./calendar-image-canvas";
import {
  CALENDAR_IMAGE_LAYOUT_CHOICES,
  CALENDAR_IMAGE_THEME_CHOICES,
  type CalendarImageLayout,
  type CalendarImageOptions,
  type CalendarImageTheme,
  drawCalendarImage,
} from "./calendar-image-draw";
import { initialWeek, weekLabel, weeksOf, weekSlug } from "./calendar-image-week";

export type CalendarImageDialogWords = {
  open: string;
  title: string;
  theme: string;
  themes: Record<CalendarImageTheme, string>;
  ratio: string;
  ratios: Record<CalendarImageRatio, string>;
  layout: string;
  layouts: Record<CalendarImageLayout, string>;
  /** «Perioada»: «Luna» or «Săptămâna», and the week select's label. */
  period: string;
  periods: { month: string; week: string };
  week: string;
  legend: string;
  download: string;
  share: string;
  close: string;
  preview: string;
  /** «Detalii» and its three ticks: the short place, the distance, the climb. */
  details: string;
  detailsPlace: string;
  detailsDistance: string;
  detailsElevation: string;
};

const RATIOS = Object.keys(CALENDAR_IMAGE_RATIOS) as CalendarImageRatio[];

/** Each choice wears its glyph before its word (§498): a poster's megaphone, the club's runner, the sun, the moon, a tree for the season, a half-filled circle for the monochrome, a warm sun; the shapes by their frame. */
const THEME_ICON = { poster: CampaignIcon, club: DirectionsRunIcon, light: LightModeIcon, dark: DarkModeIcon, season: ParkIcon, mono: ContrastIcon, warm: WhatshotIcon } as const;
const RATIO_ICON = { portrait: CropPortraitIcon, square: CropSquareIcon, story: StayCurrentPortraitIcon, landscape: CropLandscapeIcon } as const;
/** The layouts: the series in the weekday columns, chips in the cells, the key in a panel below. */
const LAYOUT_ICON = { heads: ViewWeekIcon, cells: GridViewIcon, formats: ViewAgendaIcon } as const;
/** «Perioada»: the month's grid, or a range of days. */
const PERIOD_ICON = { month: CalendarMonthIcon, week: DateRangeIcon } as const;
const CHOICE_SX = { minHeight: 44, gap: 0.5, textTransform: "none" } as const;
/** «Detalii»'s three ticks, in the order the words are drawn (`detailWords`), each named by its catalogue word. */
const DETAIL_CHOICES = ["place", "distance", "elevation"] as const;
const DETAIL_WORD = { place: "detailsPlace", distance: "detailsDistance", elevation: "detailsElevation" } as const;

/**
 * The picture's options and its preview (§855): the period — the month, or one of its weeks — the theme,
 * the shape, the layout and the legends; «Descarcă PNG», and «Distribuie» where the browser can hand a file
 * to an app (a phone, mostly). Every change redraws the one canvas at the picture's full size; the preview
 * is that canvas, scaled down by CSS.
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
  const [options, setOptions] = useState<CalendarImageOptions>({ theme: "poster", ratio: "portrait", layout: "heads", week: null, legend: true, details: { place: true, distance: true, elevation: true } });
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
  // The month's weeks, by their days in this month; the one chosen, or null for the month.
  const weeks = weeksOf(data.month);
  const week = options.week === null ? null : weeks[Math.min(options.week, weeks.length - 1)];
  // «brasov-runners-2026-10.png» — «brasov-runners-2026-10-05-11.png» for a week: the diacritics' marks
  // dropped before anything else is, or «ș» splits the word.
  const period = week ? weekSlug(data.month, week) : `${data.month.year}-${String(data.month.month).padStart(2, "0")}`;
  const fileName = `${data.clubName.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-")}-${period}.png`;
  const shareTitle = `${data.clubName} · ${week ? `${weekLabel(week, data.words.monthName)} ${data.month.year}` : data.words.monthTitle}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The web fonts first, or the first picture is drawn in a fallback face.
    const fonts = calendarImageFonts();
    void loadCalendarImageFonts().then(() => {
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
      await navigator.share({ files: [new File([file], fileName, { type: "image/png" })], title: shareTitle });
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
            {/* «Perioada»: the month, or one of its weeks — today's when today is in this month, else the first with a date. */}
            <div>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} id="calendar-image-period">
                {words.period}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={week ? "week" : "month"}
                onChange={(_, period: keyof typeof PERIOD_ICON | null) => period && setOptions((current) => ({ ...current, week: period === "week" ? initialWeek(data, new Date()) : null }))}
                aria-labelledby="calendar-image-period"
                sx={{ flexWrap: "wrap" }}
              >
                {(Object.keys(PERIOD_ICON) as (keyof typeof PERIOD_ICON)[]).map((period) => {
                  const PeriodIcon = PERIOD_ICON[period];
                  return (
                    <ToggleButton key={period} value={period} sx={CHOICE_SX}>
                      <PeriodIcon aria-hidden="true" sx={{ fontSize: 18 }} />
                      {words.periods[period]}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
            </div>
            {week && (
              <TextField
                select
                size="small"
                id="calendar-image-week"
                label={words.week}
                value={week.index}
                onChange={(event) => setOptions((current) => ({ ...current, week: Number(event.target.value) }))}
                slotProps={{
                  select: { native: true },
                  inputLabel: { shrink: true },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <DateRangeIcon aria-hidden="true" sx={{ fontSize: 20, color: "text.secondary" }} />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ maxWidth: 280 }}
              >
                {weeks.map((candidate) => (
                  <option key={candidate.index} value={candidate.index}>
                    {weekLabel(candidate, data.words.monthName)}
                  </option>
                ))}
              </TextField>
            )}
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
            {/* «Așezare» for every theme: the themes are the layouts' palettes. A week has one drawing and no legend, so neither applies to it. */}
            {!week && (
              <div>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} id="calendar-image-layout">
                  {words.layout}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={options.layout}
                  onChange={(_, layout: CalendarImageLayout | null) => layout && setOptions((current) => ({ ...current, layout }))}
                  aria-labelledby="calendar-image-layout"
                  sx={{ flexWrap: "wrap" }}
                >
                  {CALENDAR_IMAGE_LAYOUT_CHOICES.map((layout) => {
                    const LayoutIcon = LAYOUT_ICON[layout];
                    return (
                      <ToggleButton key={layout} value={layout} sx={CHOICE_SX}>
                        <LayoutIcon aria-hidden="true" sx={{ fontSize: 18 }} />
                        {words.layouts[layout]}
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
              </div>
            )}
            {!week && (
              <FormControlLabel
                control={<Checkbox checked={options.legend} onChange={(event) => setOptions((current) => ({ ...current, legend: event.target.checked }))} />}
                label={words.legend}
              />
            )}
            {/* «Detalii» (the owner, 2026-10-27): which of a date's details the layouts write after its hour — the
                short place («Locul, pe scurt», migration `0181`), the distance, the climb. All on to begin with. */}
            <div role="group" aria-labelledby="calendar-image-details">
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} id="calendar-image-details">
                {words.details}
              </Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1 }}>
                {DETAIL_CHOICES.map((detail) => (
                  <FormControlLabel
                    key={detail}
                    control={
                      <Checkbox
                        checked={options.details[detail]}
                        onChange={(event) => setOptions((current) => ({ ...current, details: { ...current.details, [detail]: event.target.checked } }))}
                        data-testid={`calendar-image-detail-${detail}`}
                      />
                    }
                    label={words[DETAIL_WORD[detail]]}
                  />
                ))}
              </Stack>
            </div>
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
