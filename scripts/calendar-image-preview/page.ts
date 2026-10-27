// `yarn calendar:preview`'s page: the dialog's own fonts and drawing, every theme asked in every layout and
// every format, as data URLs — and, when asked, the month's weeks («Perioada» → «Săptămâna») in every format.
import { CALENDAR_IMAGE_RATIOS } from "@/modules/events/ui/calendar-image-canvas";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, drawCalendarImage, type CalendarImageOptions, type CalendarImageTheme } from "@/modules/events/ui/calendar-image-draw";
import { calendarImageFonts, loadCalendarImageFonts } from "@/modules/events/ui/calendar-image-fonts";
import { weeksOf } from "@/modules/events/ui/calendar-image-week";
import type { CalendarImageData } from "@/modules/events/domain/calendar-image";
import { LOGO } from "@/theme/brand";

declare global {
  interface Window {
    renderPreview: (data: CalendarImageData, themes: string, weeks: string) => Promise<Record<string, string>>;
  }
}

window.renderPreview = async (data, themes, weeks) => {
  const fonts = calendarImageFonts();
  await loadCalendarImageFonts();
  const logo = new Image();
  logo.src = LOGO.lockup.onDark;
  await logo.decode();
  const chosen = themes === "all" ? CALENDAR_IMAGE_THEME_CHOICES : (themes.split(",") as CalendarImageTheme[]);
  // `--week none|all|<n>`: no week, every week of the month, or the n-th (1 first) — none from a month with fewer.
  const count = weeksOf(data.month).length;
  const weekIndexes = weeks === "all" ? weeksOf(data.month).map((week) => week.index) : weeks === "none" ? [] : [Number(weeks) - 1].filter((index) => index < count);
  const images: Record<string, string> = {};
  const draw = (name: string, options: CalendarImageOptions) => {
    const { width, height } = CALENDAR_IMAGE_RATIOS[options.ratio];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCalendarImage(ctx, data, options, fonts, { logo });
    images[name] = canvas.toDataURL("image/png");
  };
  for (const theme of chosen) {
    for (const ratio of Object.keys(CALENDAR_IMAGE_RATIOS) as (keyof typeof CALENDAR_IMAGE_RATIOS)[]) {
      // Each theme in each layout, «poster-heads-portrait»; then each week asked, «poster-week1-portrait». Every
      // detail on, so a drawing that writes them is seen with the most it has to fit.
      for (const layout of CALENDAR_IMAGE_LAYOUT_CHOICES) draw(`${theme}-${layout}-${ratio}`, { theme, ratio, layout, week: null, legend: true, details: { place: true, distance: true, elevation: true } });
      for (const week of weekIndexes) draw(`${theme}-week${week + 1}-${ratio}`, { theme, ratio, layout: "heads", week, legend: true, details: { place: true, distance: true, elevation: true } });
    }
  }
  return images;
};
