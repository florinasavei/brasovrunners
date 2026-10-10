import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { type DecisionStatus, type PhaseStatus, REDESIGN_DECISIONS, REDESIGN_DOC_PATH, REDESIGN_PHASES } from "../redesign-plan";
import DesignSection, { Block, Code } from "./section";

/** A status as a chip: the club's answer and a released phase green, a reopened question amber, work in progress the club's blue. */
const STATUS_COLOR: Record<DecisionStatus | PhaseStatus, "default" | "success" | "warning" | "primary"> = {
  default: "default",
  decided: "success",
  open: "warning",
  planned: "default",
  building: "primary",
  released: "success",
};

/**
 * «Planul redesign-ului» (§NNN): two sentences — where the full text is, and that the side-by-side
 * of today's look and the new one comes with phase 1 — then the twelve decisions and the seven
 * phases from `redesign-plan.ts`, each with its status; the words of every row from the catalogue,
 * in both languages.
 */
export default async function PlanSection() {
  const t = await getTranslations("Admin");

  return (
    <DesignSection id="plan" title={t("design.sections.plan")}>
      <Box>
        <Typography sx={{ mb: 1 }}>
          {t("design.plan.intro1")} <Code>{REDESIGN_DOC_PATH}</Code>.
        </Typography>
        <Typography color="text.secondary">{t("design.plan.intro2")}</Typography>
      </Box>

      <Block title={t("design.plan.decisionsTitle")} note={t("design.plan.decisionsNote")}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label={t("design.plan.decisionsTitle")} data-testid="design-decisions">
            <TableHead>
              <TableRow>
                <TableCell>{t("design.plan.number")}</TableCell>
                <TableCell>{t("design.plan.decision")}</TableCell>
                <TableCell>{t("design.plan.default")}</TableCell>
                <TableCell>{t("design.plan.status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {REDESIGN_DECISIONS.map((decision) => (
                <TableRow key={decision.id} data-decision={decision.id}>
                  <TableCell sx={{ verticalAlign: "top" }}>{decision.id}</TableCell>
                  <TableCell sx={{ verticalAlign: "top", fontWeight: 600 }}>{t(`design.plan.decisions.${decision.id}.title`)}</TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>{t(`design.plan.decisions.${decision.id}.default`)}</TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    <Chip size="small" color={STATUS_COLOR[decision.status]} label={t(`design.plan.statuses.${decision.status}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Block>

      <Block title={t("design.plan.phasesTitle")} note={t("design.plan.phasesNote")}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-label={t("design.plan.phasesTitle")} data-testid="design-phases">
            <TableHead>
              <TableRow>
                <TableCell>{t("design.plan.number")}</TableCell>
                <TableCell>{t("design.plan.phase")}</TableCell>
                <TableCell>{t("design.plan.gate")}</TableCell>
                <TableCell>{t("design.plan.status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {REDESIGN_PHASES.map((phase) => (
                <TableRow key={phase.id} data-phase={phase.id}>
                  <TableCell sx={{ verticalAlign: "top" }}>{phase.id}</TableCell>
                  <TableCell sx={{ verticalAlign: "top", fontWeight: 600 }}>{t(`design.plan.phases.${phase.id}.title`)}</TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>{t(`design.plan.phases.${phase.id}.gate`)}</TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    <Chip size="small" color={STATUS_COLOR[phase.status]} label={t(`design.plan.statuses.${phase.status}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Block>
    </DesignSection>
  );
}
