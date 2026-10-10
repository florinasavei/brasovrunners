import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { getTranslations } from "next-intl/server";
import type { ComponentType } from "react";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import DesignSection, { Block } from "./section";

/** Every glyph of a registry at 24 pixels with its name under it, in a grid that fills the width. */
function GlyphGrid({ entries, testId }: { entries: [string, ComponentType<SvgIconProps>][]; testId: string }) {
  return (
    <Box component="ul" data-testid={testId} sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
      {entries.map(([name, Icon]) => (
        <Box component="li" key={name} sx={{ textAlign: "center", minWidth: 0 }}>
          <Icon aria-hidden="true" sx={{ fontSize: 24, display: "block", mx: "auto" }} />
          <Typography variant="caption" component="div" sx={{ fontFamily: "ui-monospace, Consolas, monospace", overflowWrap: "anywhere", lineHeight: 1.3, mt: 0.5 }}>
            {name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * «Iconografie» (§NNN): every name of the public registry (`glyphs.ts`, §112) and of the backoffice's
 * verbs (`action-icons.ts`, §318), drawn from the registries themselves with the count in each
 * heading — add a glyph there and it is here. The backoffice may read the verbs' table; a public page
 * never does (`action-icons.test.ts` walks the imports).
 */
export default async function IconSection() {
  const t = await getTranslations("Admin");
  const glyphs = Object.entries(GLYPHS) as [string, ComponentType<SvgIconProps>][];
  const verbs = Object.entries(ACTION_ICONS) as [string, ComponentType<SvgIconProps>][];

  return (
    <DesignSection id="icons" title={t("design.sections.icons")} intro={t("design.icons.intro")}>
      <Block title={t("design.icons.public", { count: glyphs.length })} note={t("design.icons.publicNote")}>
        <GlyphGrid entries={glyphs} testId="design-glyphs" />
      </Block>
      <Block title={t("design.icons.backoffice", { count: verbs.length })} note={t("design.icons.backofficeNote")}>
        <GlyphGrid entries={verbs} testId="design-action-icons" />
      </Block>
    </DesignSection>
  );
}
