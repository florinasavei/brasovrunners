import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { Locale } from "@/i18n/routing";
import NumbersBand from "@/modules/home/ui/NumbersBand";
import PhotoStrip from "@/modules/home/ui/PhotoStrip";
import StepsBand from "@/modules/home/ui/StepsBand";
import WhyList from "@/modules/home/ui/WhyList";
import { LOOK_PREVIEW_ATTRIBUTE, LOOK_VALUE } from "@/theme/look";
import { SAMPLE_HOME_STEPS, SAMPLE_HOME_STRIP_SLOTS, SAMPLE_HOME_WHY, sampleHomeFigures } from "../fixtures";

/**
 * The home page's four sections on «Mostre» (§NNN; `docs/REDESIGN.md` § The visual system: «each
 * drawn with a fixture on /admin/design → Mostre»): `StepsBand`, `WhyList`, `PhotoStrip` and
 * `NumbersBand`, the very components the home page renders, from the sample content in
 * `fixtures.ts`. Inside the new look's preview box (`theme/look.ts`), because the home page is the
 * facelift's: the pink, the pill and the Inter headings are the rules themselves, not a copy. The
 * strip draws its empty places, which a page never does.
 */
export default function HomeSamples({ locale }: { locale: Locale }) {
  return (
    <Box
      {...{ [LOOK_PREVIEW_ATTRIBUTE]: LOOK_VALUE }}
      data-testid="design-home"
      sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1, sm: 2 }, bgcolor: "background.default", minWidth: 0 }}
    >
      <Stack spacing={2}>
        <StepsBand content={SAMPLE_HOME_STEPS} locale={locale} href="/faq" />
        <WhyList content={SAMPLE_HOME_WHY} locale={locale} />
        <PhotoStrip content={{ title: null }} pictures={[]} instagram={null} locale={locale} emptySlots={SAMPLE_HOME_STRIP_SLOTS} />
        <NumbersBand figures={sampleHomeFigures(locale)} locale={locale} />
      </Stack>
    </Box>
  );
}
