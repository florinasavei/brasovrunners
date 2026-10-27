// `yarn calendar:preview`'s page: the dialog's own fonts and drawing, every theme asked in every layout and
// every format, as data URLs.
import { CALENDAR_IMAGE_RATIOS } from "@/modules/events/ui/calendar-image-canvas";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, drawCalendarImage, type CalendarImageTheme } from "@/modules/events/ui/calendar-image-draw";
import { calendarImageFonts, loadCalendarImageFonts } from "@/modules/events/ui/calendar-image-fonts";
import type { CalendarImageData } from "@/modules/events/domain/calendar-image";
import { LOGO } from "@/theme/brand";

declare global {
  interface Window {
    renderPreview: (data: CalendarImageData, themes: string) => Promise<Record<string, string>>;
  }
}

window.renderPreview = async (data, themes) => {
  const fonts = calendarImageFonts();
  await loadCalendarImageFonts(fonts);
  const logo = new Image();
  logo.src = LOGO.lockup.onDark;
  await logo.decode();
  const chosen = themes === "all" ? CALENDAR_IMAGE_THEME_CHOICES : (themes.split(",") as CalendarImageTheme[]);
  const images: Record<string, string> = {};
  for (const theme of chosen) {
    // Each theme in each layout, «poster-heads-portrait».
    for (const layout of CALENDAR_IMAGE_LAYOUT_CHOICES) {
      for (const ratio of Object.keys(CALENDAR_IMAGE_RATIOS) as (keyof typeof CALENDAR_IMAGE_RATIOS)[]) {
        const { width, height } = CALENDAR_IMAGE_RATIOS[ratio];
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        drawCalendarImage(ctx, data, { theme, ratio, layout, legend: true }, fonts, { logo });
        images[`${theme}-${layout}-${ratio}`] = canvas.toDataURL("image/png");
      }
    }
  }
  return images;
};
