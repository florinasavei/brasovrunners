/**
 * The house rules «Reguli» draws (§692), as data: each rule's id names its sentence in the
 * catalogues (`Admin.design.rules.items.<id>`, both languages) and `where` lists the files or the
 * tests that hold it — paths, which are code and so live here rather than in the catalogue, whose
 * words a screen shows in the club's language and which never name a repository path (§511).
 * The page prints each path as `code`, never as a link: nothing here points off the site.
 */
export type DesignRule = { readonly id: string; readonly where: readonly string[] };

export const DESIGN_RULES: readonly DesignRule[] = [
  { id: "hex", where: ["src/theme/brand.ts"] },
  { id: "pairs", where: ["src/theme/brand-pairs.ts", "tests/unit/theme/brand.test.ts"] },
  { id: "elementProps", where: ["tests/unit/shared/server-element-props.test.ts", "src/shared/ui/action-icons.ts"] },
  { id: "actionIcons", where: ["tests/unit/shared/action-icons.test.ts"] },
  { id: "oneFilePerGlyph", where: ["src/modules/events/ui/glyphs.ts", "src/shared/ui/action-icons.ts"] },
  { id: "tapTarget", where: ["src/shared/ui/tap-target.ts", "tests/e2e"] },
  { id: "bothLanguages", where: ["messages/ro.json", "messages/en.json", "tests/unit/i18n/messages.test.ts"] },
  { id: "gradients", where: ["src/theme/surfaces.ts"] },
  { id: "motion", where: ["src/theme/motion.ts"] },
  { id: "density", where: ["src/theme/density.ts", "tests/unit/theme/density.test.ts"] },
  { id: "fonts", where: ["src/theme/fonts/", "src/app/[locale]/layout.tsx"] },
  { id: "panels", where: ["src/shared/ui/Panel.tsx", "src/shared/ui/panel-glyphs.ts"] },
  { id: "staticPages", where: ["tests/unit/public-cache/static-public-routes.test.ts", "src/modules/public-cache/reads.ts"] },
  { id: "lightDefault", where: ["src/theme/AppTheme.tsx", "src/shared/ui/ThemeModeToggle.tsx"] },
  { id: "pageTint", where: ["src/modules/appearance/domain/site-tint.ts", "tests/unit/appearance/site-tint.test.ts"] },
  { id: "fontSize", where: ["src/modules/appearance/domain/site-font-size.ts", "tests/unit/appearance/site-font-size.test.ts"] },
  { id: "colourLiterals", where: ["tests/unit/design/colour-literals.test.ts", "tests/unit/design/guards-allowlist.ts"] },
  { id: "iconImports", where: ["tests/unit/design/icon-imports.test.ts", "tests/unit/design/guards-allowlist.ts"] },
  { id: "primitives", where: ["tests/unit/design/primitives.test.ts", "tests/unit/design/guards-allowlist.ts"] },
];
