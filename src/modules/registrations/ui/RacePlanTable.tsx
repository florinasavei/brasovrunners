import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { PlanRow, RacePlanRows } from "../domain/race-plan";

/**
 * «Pe categorii» on «Planul locurilor» (§NNN): who holds the places, who is outside them, everybody who runs and who
 * waits, one line a number — the words `Admin.racePlan.rows.<key>`, the arithmetic `domain/race-plan.ts#racePlanRows`.
 * Four small tables under a line each, so a phone at 320 pixels reads every line without scrolling sideways; «din care …» indented under
 * the line it is part of, the sums bold. The test registrations, counted above like any other (§30), are said under the
 * tables only when there are any. A Server Component; nothing to press.
 */
export default async function RacePlanTable({ rows }: { rows: RacePlanRows }) {
  const t = await getTranslations("Admin");
  const group = (title: string, list: readonly PlanRow[], testId: string) => (
    <Box data-testid={testId}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
        {title}
      </Typography>
      <Table size="small" aria-label={title}>
        <TableBody>
          {list.map((row) => (
            <TableRow key={row.key} data-row={row.key}>
              <TableCell component="th" scope="row" sx={{ pl: row.part ? 4 : 2, color: row.part ? "text.secondary" : undefined, fontWeight: row.total ? 600 : undefined }}>
                {t(`racePlan.rows.${row.key}`)}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: row.total ? 600 : undefined, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {row.count === null ? t("racePlan.noLimit") : row.count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
  return (
    <Box data-testid="race-plan-table">
      {group(t("racePlan.categories.inside"), rows.inside, "race-plan-inside")}
      {group(t("racePlan.categories.outside"), rows.outside, "race-plan-outside")}
      {group(t("racePlan.categories.runners"), rows.runners, "race-plan-runners")}
      {/* A registration marked «Elită» is a place taken or a special guest: counted once, there (§NNN). */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="race-plan-runners-note">
        {t("racePlan.categories.runnersNote")}
      </Typography>
      {group(t("racePlan.categories.lists"), rows.lists, "race-plan-lists")}
      {rows.test > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-testid="race-plan-test">
          {t("racePlan.categories.test", { count: rows.test })}
        </Typography>
      )}
    </Box>
  );
}
