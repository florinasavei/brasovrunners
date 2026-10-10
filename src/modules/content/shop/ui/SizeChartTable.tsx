import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatMeasure } from "@/modules/content/shop/domain";
import type { MembersSizeChart } from "@/modules/content/shop/repository";

/**
 * «Tabelul de mărimi» in the members' zone (§NNN): one row per size in the shop's order, one column
 * per measure the club named — chest width, length — the numbers in the reader's locale («66,5» /
 * «66.5»). A table rather than free text because numbers in a grid read on a phone and free text
 * does not; it scrolls sideways when four columns do not fit. The caller folds it.
 */
export default function SizeChartTable({ chart, sizeColumn, locale }: { chart: MembersSizeChart; /** The first column's heading, «Mărimea». */ sizeColumn: string; locale: string }) {
  return (
    <Box sx={{ overflowX: "auto" }} data-testid="size-chart">
      <Box
        component="table"
        sx={{
          borderCollapse: "collapse",
          minWidth: "100%",
          "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.75, textAlign: "left", whiteSpace: "nowrap" },
          "& th": { bgcolor: "action.hover" },
        }}
      >
        <thead>
          <tr>
            <th scope="col">
              <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                {sizeColumn}
              </Typography>
            </th>
            {chart.columns.map((column, index) => (
              <th key={index} scope="col">
                <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                  {column}
                </Typography>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">
                <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                  {row.label}
                </Typography>
              </th>
              {row.cells.map((cell, index) => (
                <td key={index}>
                  <Typography component="span" variant="body2">
                    {cell === null ? "—" : formatMeasure(cell, locale)}
                  </Typography>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
