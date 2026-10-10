import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import ButtonSection from "./ButtonSection";
import ColourSection from "./ColourSection";
import IconSection from "./IconSection";
import PillSection from "./PillSection";
import PlanSection from "./PlanSection";
import RuleSection from "./RuleSection";
import SampleSection from "./SampleSection";
import { DESIGN_SECTION_IDS } from "./section";
import ShapeSection from "./ShapeSection";
import TypeSection from "./TypeSection";

/**
 * «Sistemul de design» (§NNN; the owner, 2026-10-10: «that Claude design artifact should go
 * somewhere in the app so we can all access it, and we need a design system page, similar to
 * Flyward»): one backoffice page that draws the site's tokens, type, shapes, buttons, pills,
 * samples and glyphs **from the code** — imports, never a copy that drifts — and carries the
 * redesign plan's decisions and phases with a status each. The content, apart from the page's
 * gate: `page.tsx` asserts who may read it and renders this, so a test can render this alone.
 *
 * The side-by-side of today's look and the new one is not here yet; it comes with the facelift's
 * phase 1 (`docs/REDESIGN.md`), and the plan's section says so.
 */
export default async function DesignSystem({ locale }: { locale: Locale }) {
  const t = await getTranslations("Admin");

  return (
    <Stack spacing={4} data-testid="design-system">
      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("design.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("design.intro")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("design.sideBySide")}
        </Typography>
        {/* The contents: one anchor per section, each a 44-pixel target in a row that wraps. */}
        <Box component="nav" aria-label={t("design.contents")} sx={{ mt: 1.5 }}>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexWrap: "wrap", columnGap: 2 }}>
            {DESIGN_SECTION_IDS.map((id) => (
              <li key={id}>
                <Link href={`#${id}`} underline="hover" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 500 }}>
                  {t(`design.sections.${id}`)}
                </Link>
              </li>
            ))}
          </Box>
        </Box>
      </Box>

      <ColourSection />
      <TypeSection />
      <ShapeSection />
      <ButtonSection />
      <PillSection locale={locale} />
      <SampleSection locale={locale} />
      <IconSection />
      <RuleSection />
      <PlanSection />
    </Stack>
  );
}
