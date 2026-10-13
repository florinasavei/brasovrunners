import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { type Checkpoint, checkpointRows, type CheckpointRow } from "@/modules/event-checkpoints/domain/checkpoint";
import { DENSITY } from "@/theme/density";
import GlyphChip from "./GlyphChip";

/** Text a screen reader reads and the eye never sees (`GlyphChip`'s technique, `'1px'` strings and not numbers). */
const SR_ONLY = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * «Puncte de control» / "Checkpoints" under `#checkpoints` (§NNN; the owner, 2026-10-13: «I need to put
 * checkpoints and limit times»): a table under the route's maps — the kilometre, the point, what
 * there is (a chip with a glyph **and** its word, never the glyph alone) and the cut-off in words,
 * «Ora limită 11:30». **The finish is the last row when the event has a time limit** — the event's
 * end on its own clock, at the route's length — so the last cut-off a runner reads is the one that
 * ends the race.
 *
 * Nothing at all with no checkpoints, so the anchor exists only when it leads somewhere. One
 * component for the public page and the staff's previews, so the two cannot differ.
 *
 * **At 320 pixels the table is a stack**: each row is a bordered block, its cells under one
 * another with their column's word in front (`data-label`, drawn by `::before`), the header row
 * visually hidden but still read by a screen reader. From the small breakpoint up it is a table.
 */
export default async function EventCheckpoints({
  checkpoints,
  finish,
  locale,
}: {
  checkpoints: readonly Checkpoint[];
  /** The route's length and the event's time limit as `HH:MM` on the event's clock; both null for none. */
  finish: { km: number | null; limit: string | null };
  locale: "ro" | "en";
}) {
  const rows = checkpointRows(checkpoints, finish);
  if (rows.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "Event" });
  const km = (value: number) => t("checkpoints.km", { km: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) });

  const cell = (row: CheckpointRow) => {
    if (row.kind === "finish") {
      return {
        key: "finish",
        km: row.km === null ? "—" : km(row.km),
        name: t("checkpoints.finish"),
        note: null,
        kinds: [] as const,
        cutoff: row.cutoff,
        finish: true,
      };
    }
    return {
      key: row.id,
      km: km(row.km),
      name: locale === "ro" ? row.nameRo : row.nameEn,
      note: locale === "ro" ? row.noteRo : row.noteEn,
      kinds: row.kinds,
      cutoff: row.cutoff,
      finish: false,
    };
  };

  return (
    <Box component="section" id="checkpoints" data-testid="event-checkpoints" aria-labelledby="checkpoints-title" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Typography id="checkpoints-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {t("checkpoints.heading")}
      </Typography>
      <Box
        component="table"
        sx={{
          width: "100%",
          borderCollapse: "collapse",
          // Phone: every row a block, every cell under the one before with its column's word in front.
          display: { xs: "block", sm: "table" },
          "& thead": { display: { xs: "block", sm: "table-header-group" } },
          // Hidden from the eye on a phone, read by a screen reader: the cells carry their own words there.
          "& thead tr": {
            position: { xs: "absolute", sm: "static" },
            width: { xs: "1px", sm: "auto" },
            height: { xs: "1px", sm: "auto" },
            overflow: { xs: "hidden", sm: "visible" },
            clipPath: { xs: "inset(50%)", sm: "none" },
          },
          "& tbody": { display: { xs: "block", sm: "table-row-group" } },
          "& tbody tr": {
            display: { xs: "block", sm: "table-row" },
            border: { xs: 1, sm: 0 },
            borderColor: "divider",
            borderRadius: { xs: 1, sm: 0 },
            borderBottom: { sm: 1 },
            mb: { xs: 1, sm: 0 },
            p: { xs: 1, sm: 0 },
          },
          "& th": { textAlign: "left", fontSize: "0.8125rem", fontWeight: 600, color: "text.secondary", py: 0.75, pr: 2, borderBottom: 1, borderColor: "divider" },
          "& td": {
            display: { xs: "flex", sm: "table-cell" },
            gap: { xs: 1, sm: 0 },
            alignItems: { xs: "baseline", sm: "initial" },
            py: { xs: 0.5, sm: 1 },
            pr: { sm: 2 },
            verticalAlign: "top",
            fontSize: "0.9375rem",
          },
          "& td::before": {
            content: "attr(data-label)",
            display: { xs: "inline-block", sm: "none" },
            minWidth: { xs: "6.5rem", sm: 0 },
            flexShrink: 0,
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "text.secondary",
          },
        }}
      >
        <thead>
          <tr>
            <th scope="col">{t("checkpoints.columns.km")}</th>
            <th scope="col">{t("checkpoints.columns.name")}</th>
            <th scope="col">{t("checkpoints.columns.kinds")}</th>
            <th scope="col">{t("checkpoints.columns.cutoff")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const view = cell(row);
            return (
              <tr key={view.key} data-testid={view.finish ? "checkpoint-finish" : "checkpoint-row"}>
                <Box component="td" data-label={t("checkpoints.columns.km")} sx={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                  <span>{view.km}</span>
                </Box>
                <td data-label={t("checkpoints.columns.name")}>
                  <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
                    <Box component="span" sx={{ fontWeight: view.finish ? 700 : 500, overflowWrap: "anywhere" }}>
                      {view.name}
                    </Box>
                    {view.note && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {view.note}
                      </Typography>
                    )}
                  </Box>
                </td>
                <td data-label={t("checkpoints.columns.kinds")}>
                  {view.kinds.length > 0 ? (
                    <Box component="span" sx={{ display: "inline-flex", flexWrap: "wrap", gap: 0.5 }}>
                      {view.kinds.map((kind) => (
                        <GlyphChip key={kind} glyph={`checkpoint:${kind}`} label={t(`checkpoints.kinds.${kind}`)} variant="outlined" />
                      ))}
                    </Box>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td data-label={t("checkpoints.columns.cutoff")}>
                  {view.cutoff ? (
                    <span data-testid="checkpoint-cutoff">{t("checkpoints.cutoff", { time: view.cutoff })}</span>
                  ) : (
                    <>
                      <span aria-hidden="true">—</span>
                      <Box component="span" sx={SR_ONLY}>
                        {t("checkpoints.noCutoff")}
                      </Box>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}
