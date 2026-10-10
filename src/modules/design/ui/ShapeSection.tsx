import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { theme } from "@/theme/theme";
import DesignSection, { Block, Code, ROW_SX } from "./section";

/** The shadows the house draws on cards: the first four steps of MUI's scale. */
const SHADOWS = [1, 2, 3, 4] as const;

/**
 * «Forme și umbre» (§692): the corner radius, the four shadows on cards, the breakpoints with
 * their pixels, the spacing unit, the phone density scale and the 44-pixel rule drawn as the square
 * it is — every value read from `theme.ts`, `density.ts` and `tap-target.ts`.
 */
export default async function ShapeSection() {
  const t = await getTranslations("Admin");
  const radius = theme.shape.borderRadius;
  const unit = theme.spacing(1);

  return (
    <DesignSection id="shape" title={t("design.sections.shape")} intro={t("design.shape.intro")}>
      <Block title={t("design.shape.radius")}>
        <Box sx={ROW_SX}>
          <Box aria-hidden="true" sx={{ width: 96, height: 56, border: 2, borderColor: "primary.main", borderRadius: `${radius}px` }} />
          <Typography variant="body2">
            <Code>theme.shape.borderRadius</Code> = {radius}px
          </Typography>
        </Box>
      </Block>

      <Block title={t("design.shape.shadows")} note={t("design.shape.shadowsNote")}>
        <Box sx={ROW_SX} data-testid="design-shadows">
          {SHADOWS.map((step) => (
            <Paper key={step} elevation={step} sx={{ width: 120, p: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t("design.shape.shadow", { n: step })}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ overflowWrap: "anywhere" }}>
                <Code>shadows[{step}]</Code>
              </Typography>
            </Paper>
          ))}
        </Box>
      </Block>

      <Block title={t("design.shape.breakpoints")}>
        <Table size="small" aria-label={t("design.shape.breakpoints")} sx={{ maxWidth: 360 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("design.shape.key")}</TableCell>
              <TableCell align="right">px</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(theme.breakpoints.values).map(([key, px]) => (
              <TableRow key={key}>
                <TableCell>
                  <Code>{key}</Code>
                </TableCell>
                <TableCell align="right">{px}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>

      <Block title={t("design.shape.spacing")}>
        <Typography variant="body2">
          <Code>theme.spacing(1)</Code> = {unit}
        </Typography>
      </Block>

      <Block title={t("design.shape.density")} note={t("design.shape.densityNote")}>
        <Table size="small" aria-label={t("design.shape.density")} sx={{ maxWidth: 480 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("design.shape.key")}</TableCell>
              <TableCell align="right">{t("design.shape.units")}</TableCell>
              <TableCell align="right">px</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(DENSITY).map(([key, value]) => (
              <TableRow key={key}>
                <TableCell>
                  <Code>DENSITY.{key}</Code>
                </TableCell>
                <TableCell align="right">{value}</TableCell>
                <TableCell align="right">{theme.spacing(value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>

      <Block title={t("design.shape.tapTarget")} note={t("design.shape.tapTargetNote")}>
        <Box sx={ROW_SX}>
          <Box
            aria-hidden="true"
            sx={{
              ...TAP_TARGET,
              width: TAP_TARGET.minHeight,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: 1,
              borderStyle: "dashed",
              borderColor: "primary.main",
              borderRadius: 1,
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            {TAP_TARGET.minHeight}
          </Box>
          <Typography variant="body2">
            <Code>TAP_TARGET</Code> = {TAP_TARGET.minHeight} × {TAP_TARGET.minHeight} px
          </Typography>
        </Box>
      </Block>
    </DesignSection>
  );
}
