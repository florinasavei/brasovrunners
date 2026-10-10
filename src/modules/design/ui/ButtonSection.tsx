import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { TYPE_GLYPH } from "@/modules/events/ui/glyphs";
import { BUTTON_GLYPH_PX, glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import DesignSection, { Block, ROW_SX } from "./section";

/** The public button's sample glyph, from the public registry by name (§694). */
const RunIcon = TYPE_GLYPH.GROUP_RUN;

const VARIANTS = ["contained", "outlined", "text"] as const;
const SIZES = ["small", "medium", "large"] as const;

/**
 * «Butoane» (§692). The public button is `ButtonLink` with its glyph as its first child — one icon
 * file, imported here as a public page would (§498, §521), never `startIcon`, which from a Server
 * Component is an element handed to a client component (§370). The backoffice's are `GlyphButton`,
 * `GlyphSubmitButton` and `GlyphButtonLink`, which take the verb's glyph by name from
 * `action-icons.ts` (§318) — this page is a backoffice page, so it may draw them; a public page never
 * imports that table, and `action-icons.test.ts` walks the imports to make sure.
 */
export default async function ButtonSection() {
  const t = await getTranslations("Admin");
  const label = t("design.buttons.sample");

  return (
    <DesignSection id="buttons" title={t("design.sections.buttons")} intro={t("design.buttons.intro")}>
      <Block title={t("design.buttons.public")} note={t("design.buttons.publicNote")}>
        <Box sx={ROW_SX} data-testid="design-public-buttons">
          {VARIANTS.map((variant) => (
            <ButtonLink key={variant} href="/events" variant={variant} sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
              <RunIcon aria-hidden="true" sx={glyphSx("medium")} />
              {label}
            </ButtonLink>
          ))}
          <ButtonLink href="/events" variant="contained" disabled sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
            <RunIcon aria-hidden="true" sx={glyphSx("medium")} />
            {t("design.buttons.disabled")}
          </ButtonLink>
        </Box>
      </Block>

      <Block title={t("design.buttons.sizes")} note={t("design.buttons.sizesNote", { small: BUTTON_GLYPH_PX.small, medium: BUTTON_GLYPH_PX.medium, large: BUTTON_GLYPH_PX.large })}>
        <Box sx={ROW_SX}>
          {SIZES.map((size) => (
            <ButtonLink key={size} href="/events" variant="outlined" size={size} sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
              <RunIcon aria-hidden="true" sx={glyphSx(size)} />
              {label} · {size}
            </ButtonLink>
          ))}
        </Box>
      </Block>

      <Block title={t("design.buttons.backoffice")} note={t("design.buttons.backofficeNote")}>
        <Box sx={ROW_SX} data-testid="design-backoffice-buttons">
          {VARIANTS.map((variant) => (
            <GlyphButton key={variant} icon="save" variant={variant}>
              {t("design.buttons.save")}
            </GlyphButton>
          ))}
          <GlyphButton icon="save" variant="contained" disabled>
            {t("design.buttons.save")}
          </GlyphButton>
          <GlyphSubmitButton icon="save" label={t("design.buttons.save")} pendingLabel={t("design.buttons.saving")} variant="contained" />
          <GlyphButtonLink icon="preview" href="/admin/design" variant="outlined">
            {t("design.buttons.open")}
          </GlyphButtonLink>
        </Box>
      </Block>
    </DesignSection>
  );
}
