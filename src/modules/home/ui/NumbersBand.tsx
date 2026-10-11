import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { CLUB_NAME } from "@/theme/brand";
import type { HomeFigure } from "../domain/numbers";
import { HOME_BAND_SX, VISUALLY_HIDDEN_SX } from "./home-surfaces";

export type NumbersBandProps = {
  /** The figures `homeFigures` read (`domain/numbers.ts`), in the band's order. None, and nothing is drawn. */
  figures: readonly HomeFigure[];
  locale: Locale;
};

/**
 * The numbers band (§NNN; `docs/REDESIGN.md`, decision 8): up to four figures — the club's years and
 * its active runners, as the club typed them; the weekly runs a week and «100%» free, read off the
 * events — each a large number in the primary over a short line. Two to the row on a phone, four
 * from `md`. A figure without its fact is left out by the domain, and a band with none is not drawn:
 * the platform never invents a number (BUSINESS.md §7).
 *
 * The heading names the club (`CLUB_NAME`, §369) and is read by a screen reader only: the band's
 * figures speak for themselves to the eye. Each figure is its number and its words in one list item,
 * so «12 ani de alergări împreună» is read as one sentence. A Server Component with no island.
 */
export default async function NumbersBand({ figures, locale }: NumbersBandProps) {
  if (figures.length === 0) return null;
  const t = await getTranslations("HomeSections");
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");

  const words = (figure: HomeFigure): { value: string; label: string } => {
    const count = number.format(figure.count);
    const form = countForm(figure.count, locale);
    switch (figure.id) {
      case "years":
        return { value: count, label: t(`numbers.years.${form}`) };
      case "runners":
        return { value: count, label: t(`numbers.runners.${form}`) };
      case "perWeek":
        return { value: t("numbers.perWeek.figure", { count }), label: t(`numbers.perWeek.${form}`) };
      case "free":
        return { value: t("numbers.free.figure", { count }), label: t("numbers.free.label") };
    }
  };

  return (
    <Box component="section" aria-labelledby="home-numbers-title" data-testid="home-numbers" sx={{ ...HOME_BAND_SX, borderRadius: { xs: 0, sm: 4 }, px: { xs: 2, sm: 3, md: 5 }, py: { xs: 3, md: 5 } }}>
      <Typography variant="h2" id="home-numbers-title" sx={VISUALLY_HIDDEN_SX}>
        {t("numbers.title", { club: CLUB_NAME })}
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: { xs: 2.5, md: 3 }, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: `repeat(${Math.max(figures.length, 1)}, minmax(0, 1fr))` } }}
      >
        {figures.map((figure) => {
          const { value, label } = words(figure);
          return (
            <Box component="li" key={figure.id} data-figure={figure.id} sx={{ minWidth: 0, textAlign: { xs: "left", md: "center" } }}>
              <Typography variant="h3" component="p" sx={{ fontSize: { xs: "2.25rem", md: "3rem" }, lineHeight: 1.1, color: "primary.main" }}>
                {value}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                {label}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
