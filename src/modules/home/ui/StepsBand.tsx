import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ComponentProps } from "react";
import type { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import { pickText } from "../domain/home-text";
import { STEP_GLYPHS, type StepsContent } from "../domain/steps";
import { HOME_GLYPHS } from "./home-glyphs";
import { GLYPH_SEAT_SX, HOME_BAND_SX, HOME_HEADING_SX } from "./home-surfaces";

export type StepsBandProps = {
  /** What the club typed (`domain/steps.ts`); an empty box draws the platform's sentence. */
  content: StepsContent;
  locale: Locale;
  /** Where «Cum funcționează» goes — the club page the setting names, resolved for this language — or null, and no button. */
  href: ComponentProps<typeof Link>["href"] | null;
};

/**
 * «Prima dată» (§NNN; `docs/REDESIGN.md` § What exists versus what is new): the home page's band for
 * someone who has never run with the club — a heading, one sentence, five numbered steps from the
 * calendar to the coffee, and «Cum funcționează», which opens a club page (decision 5).
 *
 * The steps are an ordered list (`<ol>`), each a glyph from the home registry (`home-glyphs.ts`, by
 * the name `STEP_GLYPHS` gives its place) in a round seat, its number, its title and the sentence under it: stacked on a
 * phone, five across from `md`. A Server Component with no island: the glyphs are drawn here, and
 * the one link is the house `ArrowButtonLink` (§708), 44 pixels with its trailing arrow (§521).
 */
export default async function StepsBand({ content, locale, href }: StepsBandProps) {
  const t = await getTranslations("HomeSections");
  const steps = STEP_GLYPHS.map((glyph, index) => ({
    glyph,
    number: index + 1,
    title: pickText(content.steps[index]?.title, locale) ?? t(`steps.items.${index + 1}.title`),
    text: pickText(content.steps[index]?.body, locale) ?? t(`steps.items.${index + 1}.body`),
  }));

  return (
    <Box component="section" aria-labelledby="home-steps-title" data-testid="home-steps" sx={{ ...HOME_BAND_SX, borderRadius: { xs: 0, sm: 4 }, px: { xs: 2, sm: 3, md: 5 }, py: { xs: 4, md: 6 } }}>
      <Typography variant="h2" id="home-steps-title" sx={HOME_HEADING_SX}>
        {pickText(content.title, locale) ?? t("steps.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: "60ch", mb: 3 }}>
        {pickText(content.lead, locale) ?? t("steps.lead")}
      </Typography>

      <Box
        component="ol"
        sx={{
          listStyle: "none",
          m: 0,
          p: 0,
          display: "grid",
          gap: { xs: 2, md: 3 },
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: `repeat(${STEP_GLYPHS.length}, minmax(0, 1fr))` },
        }}
      >
        {steps.map((step) => {
          const Glyph = HOME_GLYPHS[step.glyph];
          return (
            <Box component="li" key={step.glyph} data-step={step.number} sx={{ display: "flex", flexDirection: { xs: "row", md: "column" }, alignItems: { xs: "center", md: "flex-start" }, gap: 1.5, minWidth: 0 }}>
              <Box sx={GLYPH_SEAT_SX}>
                <Glyph aria-hidden="true" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {t("steps.number", { number: step.number })}
                </Typography>
                <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{step.title}</Typography>
                <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {step.text}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {href && (
        <Box sx={{ mt: 3 }}>
          <ArrowButtonLink href={href} label={pickText(content.linkLabel, locale) ?? t("steps.link")} variant="outlined" data-testid="home-steps-link" />
        </Box>
      )}
    </Box>
  );
}
