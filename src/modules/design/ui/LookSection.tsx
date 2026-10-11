import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { LOOK_PRIMARY, LOOK_PRIMARY_TOKENS, lookPaletteCss, PRIMARY_VARIABLES } from "@/modules/appearance/domain/site-look";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import HeaderCta from "@/shared/ui/HeaderCta";
import MountainMark from "@/shared/ui/MountainMark";
import { LOOK_PREVIEW_ATTRIBUTE, LOOK_VALUE } from "@/theme/look";
import DesignSection, { Block, Code } from "./section";

/**
 * One look's sample, drawn by the components the site renders: a heading as the theme draws an `h2`,
 * a sentence, a link in the primary, the pink pill and the ink one with their arrows, the header's
 * «Vino cu noi», and the mountain mark. The same markup twice; only the box around the second one
 * carries `data-look-preview`, so every difference between the two is a rule of the new look.
 */
async function Sample({ preview }: { preview: boolean }) {
  const t = await getTranslations("Admin");
  const site = await getTranslations("Site");
  return (
    <Box
      {...(preview ? { [LOOK_PREVIEW_ATTRIBUTE]: LOOK_VALUE } : {})}
      data-testid={preview ? "design-look-new" : "design-look-today"}
      sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, bgcolor: "background.default", minWidth: 0, display: "grid", gap: 1.5, alignContent: "start" }}
    >
      <Typography variant="overline" color="text.secondary" component="p">
        {preview ? t("design.look.new") : t("design.look.today")}
      </Typography>
      <Typography variant="h2" component="p">
        {t("design.look.heading")}
      </Typography>
      <Typography>
        {t("design.look.body")}{" "}
        <Link href="#look" underline="always">
          {t("design.look.link")}
        </Link>
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
        <ArrowButtonLink href="/events" label={t("design.look.primary")} />
        <ArrowButtonLink href="/events" label={t("design.look.secondary")} variant="outlined" />
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {t("design.look.cta")}
        </Typography>
        {/* The header's own component: drawn only under the look's scope, so the left column shows the gap it leaves. */}
        <HeaderCta href="/events" label={site("cta.join")} />
      </Box>
      <Box sx={{ color: "primary.light" }}>
        <MountainMark width={96} />
      </Box>
    </Box>
  );
}

/**
 * «Aspectul nou» on the design page (§NNN; phase 1 of `docs/REDESIGN.md`): today's look and the new
 * one side by side, drawn by the site's own components and the theme's own rules — the right-hand box
 * carries the preview scope (`theme/look.ts`), and the page draws the new look's palette variables
 * for it with the very stylesheet the public layout draws (`lookPaletteCss`). Then the mapping of
 * MUI's primary onto the pink tokens, light and dark, and the mountain mark at its sizes. The new
 * tokens themselves are swatches under «Culori», their pairs in its table.
 */
export default async function LookSection() {
  const t = await getTranslations("Admin");
  const rows = (Object.keys(PRIMARY_VARIABLES) as (keyof typeof PRIMARY_VARIABLES)[]).map((key) => ({
    key,
    variable: PRIMARY_VARIABLES[key],
    light: `COLOR.${LOOK_PRIMARY_TOKENS.light[key]} · ${LOOK_PRIMARY.light[key]}`,
    dark: `COLOR_DARK.${LOOK_PRIMARY_TOKENS.dark[key]} · ${LOOK_PRIMARY.dark[key]}`,
  }));

  return (
    <DesignSection id="look" title={t("design.sections.look")} intro={t("design.look.intro")}>
      {/* The new look's primary for the preview box — `brand.ts`'s tokens, the public layout's own rule. */}
      <style data-design-look="">{lookPaletteCss()}</style>

      <Block title={t("design.look.sideBySide")} note={t("design.look.sideBySideNote")}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }} data-testid="design-look">
          <Sample preview={false} />
          <Sample preview />
        </Box>
      </Block>

      <Block title={t("design.look.primaryTitle")} note={t("design.look.primaryNote")}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label={t("design.look.primaryTitle")} data-testid="design-look-primary">
            <TableHead>
              <TableRow>
                <TableCell>{t("design.look.variable")}</TableCell>
                <TableCell>{t("design.look.lightScheme")}</TableCell>
                <TableCell>{t("design.look.darkScheme")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Code>{row.variable}</Code>
                  </TableCell>
                  <TableCell>
                    <Code>{row.light}</Code>
                  </TableCell>
                  <TableCell>
                    <Code>{row.dark}</Code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Block>

      <Block title={t("design.look.markTitle")} note={t("design.look.markNote")}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "flex-end", color: "text.primary" }} data-testid="design-mountain-mark">
          {[48, 96, 160].map((width) => (
            <Box key={width} sx={{ display: "grid", gap: 0.5, justifyItems: "start" }}>
              <MountainMark width={width} />
              <Typography variant="caption" color="text.secondary">
                {width} px
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          <Code>MountainMark</Code> · <Code>LookWatermark</Code> · <Code>ArrowButtonLink</Code> · <Code>HeaderCta</Code> · <Code>HeaderSocials</Code>
        </Typography>
      </Block>
    </DesignSection>
  );
}
