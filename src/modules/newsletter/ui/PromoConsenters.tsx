import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PROMO_TABLE_LIMIT, type PromoConsenterList, type PromoConsenterRow } from "../promo-consenters";

type Props = {
  locale: Locale;
  list: PromoConsenterList;
};

/** The fold's own anchor, beside «Abonați»'s. */
export const PROMO_ANCHOR = "newsletter-promo";

/** The subscribers table's two layouts (§550), by CSS alone: a table from `md`, a block per row below. */
const TABLE = { display: { xs: "block", md: "table" } } as const;
const HEAD = { display: { xs: "none", md: "table-header-group" } } as const;
const BODY = { display: { xs: "flex", md: "table-row-group" }, flexDirection: "column", gap: 1.5 } as const;
const ROW = (last: boolean) =>
  ({
    display: { xs: "block", md: "table-row" },
    border: { xs: 1, md: 0 },
    borderColor: "divider",
    borderRadius: { xs: 1, md: 0 },
    p: { xs: 2, md: 0 },
    "& > td": {
      display: { xs: "flex", md: "table-cell" },
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 1,
      textAlign: { xs: "right", md: "left" },
      px: { xs: 0, md: 2 },
      py: { xs: 0.25, md: 1.25 },
      verticalAlign: "top",
      borderBottom: { xs: 0, md: last ? 0 : 1 },
      borderColor: "divider",
      "&::before": {
        content: { xs: "attr(data-label)", md: "none" },
        color: "text.secondary",
        fontSize: "0.875rem",
        flexShrink: 0,
      },
    },
    "& > td[data-cell='name']": { display: { xs: "block", md: "table-cell" }, fontWeight: { xs: 700, md: 400 }, fontSize: { xs: "1rem", md: "inherit" }, mb: { xs: 1, md: 0 } },
    "& > td[data-cell='name']::before": { content: "none" },
  }) as const;
const HEAD_RULE = { borderBottom: 2, borderColor: "text.secondary", fontWeight: 700, whiteSpace: "nowrap" } as const;

/**
 * «Participanți care au bifat oferte și beneficii» / "Participants who ticked offers and
 * benefits" (§NNN, amending §550): the newsletter page's second fold, under «Abonați». Every
 * registration whose person said yes — the name, the address, the event and the moment — newest
 * first, with its own «Descarcă CSV». Closed by default (§336); its closed line says how many.
 *
 * A Server Component with no form of its own: the page reads the list (`listPromoConsenters`, which
 * asserts the role) and hands it here. The words say the two consents apart: this is not the
 * newsletter, and the partners never receive the list.
 */
export default async function PromoConsenters({ locale, list }: Props) {
  const t = await getTranslations("Admin");
  const csvHref = `/api/admin/newsletter/promo?${new URLSearchParams({ lang: locale }).toString()}`;
  const dayTime = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const counts = t(`newsletter.promo.count.${countForm(list.total, locale)}`, { count: list.total });

  const columns: { key: string; label: string; render: (row: PromoConsenterRow) => ReactNode }[] = [
    { key: "name", label: t("newsletter.promo.columns.name"), render: (row) => row.name },
    {
      key: "email",
      label: t("newsletter.promo.columns.email"),
      render: (row) => (
        <Box component="span" sx={{ wordBreak: "break-all" }} data-testid="newsletter-promo-email">
          {row.email}
        </Box>
      ),
    },
    { key: "event", label: t("newsletter.promo.columns.event"), render: (row) => row.eventTitle ?? "—" },
    { key: "since", label: t("newsletter.promo.columns.since"), render: (row) => (row.consentedAt ? dayTime(row.consentedAt) : "—") },
  ];

  return (
    <Panel
      glyph="partners"
      collapsible
      title={t("newsletter.promo.title")}
      intro={t("newsletter.promo.intro")}
      aside={counts}
      id={PROMO_ANCHOR}
      data-testid="newsletter-promo"
    >
      <Stack spacing={2}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="newsletter-promo-counts">
            {counts}
          </Typography>
          <GlyphButton icon="download" href={csvHref} variant="outlined" sx={TAP_TARGET} data-testid="newsletter-promo-csv">
            {t("newsletter.promo.csv")}
          </GlyphButton>
        </Stack>
        {list.truncated && (
          <Typography variant="body2" color="text.secondary">
            {t("newsletter.promo.truncated", { count: String(PROMO_TABLE_LIMIT) })}
          </Typography>
        )}
        {list.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="newsletter-promo-empty">
            {t("newsletter.promo.empty")}
          </Typography>
        ) : (
          <Box sx={{ border: { md: 1 }, borderColor: "divider", borderRadius: { md: 1 }, overflow: { md: "hidden" } }}>
            <Table size="small" aria-label={t("newsletter.promo.title")} sx={TABLE} data-testid="newsletter-promo-table">
              <TableHead sx={HEAD}>
                <TableRow sx={{ bgcolor: "action.hover" }}>
                  {columns.map((column) => (
                    <TableCell key={column.key} sx={HEAD_RULE}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody sx={BODY}>
                {list.rows.map((row, index) => {
                  const last = index === list.rows.length - 1;
                  return (
                    <TableRow key={row.registrationId} hover data-testid="newsletter-promo-row" data-row-separator={last ? "none" : "line"} sx={ROW(last)}>
                      {columns.map((column) => (
                        <TableCell key={column.key} data-cell={column.key} data-label={column.label}>
                          {column.render(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
    </Panel>
  );
}
