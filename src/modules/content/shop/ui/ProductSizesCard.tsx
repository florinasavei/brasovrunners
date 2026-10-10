import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import {
  measureAsTyped,
  SIZE_CHART_COLUMN_MAX,
  SIZE_CHART_COLUMNS_MAX,
  type SizeChart,
  sizesAsForm,
  STANDARD_SIZES,
  standardSizeOf,
  STOCK_MAX,
  VARIANT_LABEL_MAX,
  VARIANTS_MAX,
  variantKey,
} from "@/modules/content/shop/domain";
import { loadedStockJson } from "@/modules/content/shop/fields";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import RecallField, { RecallCheckbox } from "@/shared/forms/recall";
import { fieldId } from "@/shared/forms/outcome";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import Panel from "@/shared/ui/Panel";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

const TICK_ROW_SX = { display: "flex", alignItems: "center", gap: 1, minHeight: 44 } as const;
const TICK_SX = { width: 20, height: 20, flexShrink: 0 } as const;
const STOCK_BOX_SX = { width: 112 } as const;
/** The chart fold's glyph from the one registry (§694): the ruler. */
const ChartIcon = ACTION_ICONS.sizeChart;

/** The chart's cell for one size and column, as the editor shows it again. */
function cellOf(chart: SizeChart | null, label: string, index: number): string {
  if (!chart) return "";
  const key = variantKey(label);
  const row = Object.entries(chart.rows).find(([stored]) => variantKey(stored) === key)?.[1];
  return measureAsTyped(row?.[index] ?? null);
}

/**
 * «Mărimile și stocul» (§697; the owner: «I need to be able to define size — can't you see the
 * Excel?»): the nine standard sizes as ticks, XXS–4XL in the shop's order, each with its stock box
 * (empty: no limit; «0»: sold out); «Mărime unică» for a buff or a sticker, with the «Stoc» box; and
 * «Alte variante» for what is not a size — a colour, a child's cut — one per line as §683 had them.
 * Every tick is a variant row (`shop_product_variants`): the stock the form loaded travels with it,
 * so a save that did not touch a number leaves it as it stands now (§683), and a size unticked while
 * an order names it is refused, naming this card (`SHOP_SIZE_HAS_ORDERS`).
 *
 * Under it, «Tabelul de mărimi»: up to four measured columns named in both languages — chest width,
 * length — and a number per size; the zone draws it as a table under the product. Rows for sizes not
 * ticked are dropped at the save.
 */
export default function ProductSizesCard({ product, words: t, scope }: { product: AdminShopProduct | null; words: Words; scope?: string }) {
  const form = sizesAsForm(product?.variants ?? []);
  const ticked = new Set<string>(form.sizes);
  const extraLabels = (product?.variants ?? []).map((variant) => variant.label).filter((label): label is string => label !== null && standardSizeOf(label) === null);
  const chart = product?.sizeChart ?? null;
  const columns = Array.from({ length: SIZE_CHART_COLUMNS_MAX }, (_, index) => chart?.columns[index] ?? { ro: "", en: "" });
  const chartRows = [...STANDARD_SIZES, ...extraLabels];
  return (
    <Panel glyph="kit" title={t("members.shop.cards.sizes")} intro={t("members.shop.cards.sizesHelp")} id="product-sizes" data-testid="product-sizes-card">
      <Stack spacing={2}>
        <Box component="fieldset" id={fieldId("sizes", scope)} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
          <Typography component="legend" variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("members.shop.sizesLegend")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("members.shop.sizesStockHelp", { max: STOCK_MAX })}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 1 }}>
            {STANDARD_SIZES.map((size) => (
              <Box key={size} sx={TICK_ROW_SX} data-testid={`size-${size}`}>
                <Box component="label" sx={{ ...TICK_ROW_SX, minWidth: 88, cursor: "pointer" }}>
                  <RecallCheckbox name={`sizes[${size}]`} defaultChecked={ticked.has(size)} style={TICK_SX} />
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                    {size}
                  </Typography>
                </Box>
                <RecallField
                  name={`sizeStock[${size}]`}
                  size="small"
                  defaultValue={form.sizeStock[size] ?? ""}
                  placeholder={t("members.shop.stockNoLimit")}
                  slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6, "aria-label": t("members.shop.sizeStockLabel", { size }) } }}
                  sx={STOCK_BOX_SX}
                />
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ ...TICK_ROW_SX, flexWrap: "wrap" }} data-testid="size-one">
          <Box component="label" sx={{ ...TICK_ROW_SX, cursor: "pointer" }}>
            <RecallCheckbox name="oneSize" defaultChecked={form.oneSize} style={TICK_SX} />
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
              {t("members.shop.oneSize")}
            </Typography>
          </Box>
          <RecallField
            name="stock"
            size="small"
            defaultValue={form.stock}
            placeholder={t("members.shop.stockNoLimit")}
            helperText={t("members.shop.oneSizeHelp")}
            slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6, "aria-label": t("members.shop.stock") } }}
            sx={{ width: 220 }}
          />
        </Box>

        <RecallField
          name="extraVariants"
          label={t("members.shop.extraVariants")}
          fullWidth
          multiline
          minRows={2}
          defaultValue={form.extraVariants}
          helperText={t("members.shop.extraVariantsHelp", { max: VARIANTS_MAX, length: VARIANT_LABEL_MAX })}
          slotProps={{ htmlInput: { maxLength: VARIANTS_MAX * (VARIANT_LABEL_MAX + 10) } }}
        />
        {product && <input type="hidden" name="variantsLoaded" value={loadedStockJson(product.variants)} />}

        <Box component="details" open={chart ? true : undefined} sx={BOXED_DISCLOSURE_SX} data-testid="size-chart-fold">
          <summary>
            <ChartIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("members.shop.chart.title")}
          </summary>
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t("members.shop.chart.help", { max: SIZE_CHART_COLUMNS_MAX })}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              {columns.map((column, index) => (
                <Box key={index} sx={{ display: "grid", gap: 1, border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("members.shop.chart.column", { number: index + 1 })}
                  </Typography>
                  <RecallField
                    name={`chartColumns[${index}][ro]`}
                    label={t("members.shop.chart.columnRo")}
                    size="small"
                    defaultValue={column.ro}
                    placeholder={index === 0 ? t("members.shop.chart.exampleRo") : undefined}
                    slotProps={{ htmlInput: { maxLength: SIZE_CHART_COLUMN_MAX, lang: "ro" }, inputLabel: { shrink: true } }}
                  />
                  <RecallField
                    name={`chartColumns[${index}][en]`}
                    label={t("members.shop.chart.columnEn")}
                    size="small"
                    defaultValue={column.en}
                    placeholder={index === 0 ? t("members.shop.chart.exampleEn") : undefined}
                    slotProps={{ htmlInput: { maxLength: SIZE_CHART_COLUMN_MAX, lang: "en" }, inputLabel: { shrink: true } }}
                  />
                </Box>
              ))}
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Box component="table" sx={{ borderCollapse: "collapse", "& th, & td": { p: 0.5, textAlign: "left", verticalAlign: "middle" } }}>
                <thead>
                  <tr>
                    <th scope="col">
                      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                        {t("members.shop.chart.sizeColumn")}
                      </Typography>
                    </th>
                    {columns.map((_, index) => (
                      <th key={index} scope="col">
                        <Typography component="span" variant="body2" color="text.secondary">
                          {t("members.shop.chart.column", { number: index + 1 })}
                        </Typography>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartRows.map((label) => (
                    <tr key={label} data-testid={`chart-row-${label}`}>
                      <th scope="row">
                        <Typography component="span" variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          {label}
                        </Typography>
                      </th>
                      {columns.map((_, index) => (
                        <td key={index}>
                          <RecallField
                            name={`chartCells[${label}][${index}]`}
                            size="small"
                            defaultValue={cellOf(chart, label, index)}
                            slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 7, "aria-label": t("members.shop.chart.cellLabel", { size: label, number: index + 1 }) } }}
                            sx={{ width: 88 }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          </Stack>
        </Box>
      </Stack>
    </Panel>
  );
}
