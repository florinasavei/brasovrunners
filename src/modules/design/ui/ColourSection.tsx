import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { COLOR, COLOR_DARK, GRADIENT, SITE_TINT, SURFACE_GRADIENT } from "@/theme/brand";
import { ACCENT_PAIRS, type BrandPair, HERO_PAIRS, TEXT_PAIRS, TEXT_PAIRS_DARK } from "@/theme/brand-pairs";
import DesignSection, { Block, CELL_GRID_SX, Code, SWATCH_PX } from "./section";

/** WCAG 2.1's threshold for large text (18 pt, or 14 pt bold): what a heading may fall to. */
const LARGE_TEXT_CONTRAST = 3;

/** A colour as the code names it: the square, the key and the hex it reads from `brand.ts`. */
function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
      <Box aria-hidden="true" sx={{ width: SWATCH_PX, height: SWATCH_PX, bgcolor: hex, border: 1, borderColor: "divider", borderRadius: 1, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {name}
        </Typography>
        <Code>{hex}</Code>
      </Box>
    </Box>
  );
}

/** A gradient drawn as a bar, with its name and the CSS it is. */
function GradientBar({ name, css }: { name: string; css: string }) {
  return (
    <Box>
      <Box aria-hidden="true" sx={{ height: 28, borderRadius: 1, border: 1, borderColor: "divider", backgroundImage: css }} />
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
        {name}
      </Typography>
      <Code>{css}</Code>
    </Box>
  );
}

/**
 * «Culori» (§692): every key of `COLOR` and `COLOR_DARK` as a swatch, the site tints with the
 * names the «Aspect» tab gives them, the gradients as bars, then the pairs `brand.test.ts` holds at
 * AA with each one's ratio — from the one contrast helper (`tint-contrast.ts`), never a second
 * formula. Read, never copied: a token added to `brand.ts` is on this page at the next render.
 */
export default async function ColourSection() {
  const t = await getTranslations("Admin");
  const pairGroups: { title: string; pairs: readonly BrandPair[] }[] = [
    { title: t("design.colours.pairsLight"), pairs: TEXT_PAIRS },
    { title: t("design.colours.pairsDark"), pairs: TEXT_PAIRS_DARK },
    { title: t("design.colours.pairsHero"), pairs: HERO_PAIRS },
    { title: t("design.colours.pairsAccent"), pairs: ACCENT_PAIRS },
  ];
  const level = (ratio: number) =>
    ratio >= MIN_TEXT_CONTRAST ? t("design.colours.aa") : ratio >= LARGE_TEXT_CONTRAST ? t("design.colours.aaLarge") : t("design.colours.below");

  return (
    <DesignSection id="colours" title={t("design.sections.colours")} intro={t("design.colours.intro")}>
      <Block title={t("design.colours.light")}>
        <Box sx={CELL_GRID_SX} data-testid="design-colours-light">
          {Object.entries(COLOR).map(([key, hex]) => (
            <Swatch key={key} name={key} hex={hex} />
          ))}
        </Box>
      </Block>

      <Block title={t("design.colours.dark")}>
        <Box sx={CELL_GRID_SX} data-testid="design-colours-dark">
          {Object.entries(COLOR_DARK).map(([key, hex]) => (
            <Swatch key={key} name={key} hex={hex} />
          ))}
        </Box>
      </Block>

      <Block title={t("design.colours.tints")} note={t("design.colours.tintsNote")}>
        <Box sx={CELL_GRID_SX} data-testid="design-tints">
          {Object.entries(SITE_TINT).map(([key, hex]) => (
            <Swatch key={key} name={`${t(`appearance.tints.${key}.name`)} · ${key}`} hex={hex} />
          ))}
        </Box>
      </Block>

      <Block title={t("design.colours.gradients")} note={t("design.colours.gradientsNote")}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
          <GradientBar name="GRADIENT.vertical" css={GRADIENT.vertical} />
          {Object.entries(SURFACE_GRADIENT).map(([key, css]) => (
            <GradientBar key={key} name={`SURFACE_GRADIENT.${key}`} css={css} />
          ))}
        </Box>
      </Block>

      <Block title={t("design.colours.pairs")} note={t("design.colours.pairsNote")}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label={t("design.colours.pairs")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("design.colours.sample")}</TableCell>
                <TableCell>{t("design.colours.foreground")}</TableCell>
                <TableCell>{t("design.colours.background")}</TableCell>
                <TableCell align="right">{t("design.colours.ratio")}</TableCell>
                <TableCell>{t("design.colours.level")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pairGroups.map((group) => [
                <TableRow key={group.title}>
                  <TableCell colSpan={5} sx={{ fontWeight: 600, bgcolor: "action.hover" }}>
                    {group.title}
                  </TableCell>
                </TableRow>,
                ...group.pairs.map((pair) => {
                  const ratio = contrastRatio(pair.foreground.hex, pair.background.hex);
                  return (
                    <TableRow key={`${pair.foreground.name}/${pair.background.name}`}>
                      <TableCell>
                        <Box
                          aria-hidden="true"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: SWATCH_PX,
                            height: SWATCH_PX,
                            borderRadius: 1,
                            border: 1,
                            borderColor: "divider",
                            bgcolor: pair.background.hex,
                            color: pair.foreground.hex,
                            fontWeight: 600,
                          }}
                        >
                          Aa
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Code>{pair.foreground.name}</Code>
                      </TableCell>
                      <TableCell>
                        <Code>{pair.background.name}</Code>
                      </TableCell>
                      <TableCell align="right">{ratio.toFixed(2)} : 1</TableCell>
                      <TableCell>{level(ratio)}</TableCell>
                    </TableRow>
                  );
                }),
              ])}
            </TableBody>
          </Table>
        </Box>
      </Block>
    </DesignSection>
  );
}
