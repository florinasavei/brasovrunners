import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { type ListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { SponsorListSummary } from "@/modules/registrations/sponsor-list";
import SponsorListButton from "@/modules/registrations/ui/SponsorListButton";
import { PROMO_TABLE_LIMIT, type PromoConsenterList, type PromoConsenterRow } from "../promo-consenters";

type Props = {
  locale: Locale;
  list: PromoConsenterList;
  /** The table's page and its size (§NNN), from the address — the same as «Abonați»'s, the page's one list query. */
  listQuery: ListQuery;
  /** The address names a page or a size: the fold opens on what was asked for. */
  paged: boolean;
  /** The list for sponsors across every event (§570), or null for a role that may not take it. */
  sponsors?: SponsorListSummary | null;
};

/** The fold's own anchor, beside «Abonați»'s. */
export const PROMO_ANCHOR = "newsletter-promo";

/**
 * «Participanți care au bifat oferte și beneficii» / "Participants who ticked offers and
 * benefits" (§562, amending §550): the newsletter page's second fold, under «Abonați». Every
 * registration whose person said yes — the name, the address, the event and the moment — newest
 * first, with its own «Descarcă CSV». Closed by default (§336); its closed line says how many.
 *
 * A Server Component with no form of its own: the page reads the list (`listPromoConsenters`, which
 * asserts the role) and hands it here. The words say the two consents apart: this is not the
 * newsletter, and the partners receive only the list for sponsors (§570) — the button under the
 * club's own, for every event, the same query and the same file as an event's registrations page.
 * The rows are the backoffice's table since §NNN (`AdminTable`), paged through the address.
 */
export default async function PromoConsenters({ locale, list, listQuery, paged, sponsors = null }: Props) {
  const t = await getTranslations("Admin");
  const csvHref = `/api/admin/newsletter/promo?${new URLSearchParams({ lang: locale }).toString()}`;
  const dayTime = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const counts = t(`newsletter.promo.count.${countForm(list.total, locale)}`, { count: list.total });

  const columns: readonly AdminColumn<PromoConsenterRow>[] = [
    { key: "name", label: t("newsletter.promo.columns.name"), primary: true, render: (row) => row.name },
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
      openWhen={{ inUse: paged }}
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
        {sponsors && <SponsorListButton locale={locale} eventId={null} list={sponsors} />}
        {list.truncated && (
          <Typography variant="body2" color="text.secondary">
            {t("newsletter.promo.truncated", { count: String(PROMO_TABLE_LIMIT) })}
          </Typography>
        )}
        <Box data-testid="newsletter-promo-table">
          <AdminTable
            caption={t("newsletter.promo.title")}
            tableId="newsletter-promo"
            columns={columns}
            rows={list.rows.slice(listQuery.offset, listQuery.offset + listQuery.limit)}
            rowKey={(row) => row.registrationId}
            basePath={getPathname({ locale, href: "/admin/newsletter" })}
            currentParams={{}}
            query={listQuery}
            total={list.rows.length}
            labels={{
              results: t("list.results", { count: list.rows.length }),
              page: t("list.page", { page: listQuery.page, pages: pageCount(list.rows.length, listQuery.perPage) }),
              previous: t("list.previous"),
              next: t("list.next"),
              perPage: t("list.perPage"),
              actions: t("list.actions"),
              sortBy: (column) => t("list.sortBy", { column }),
            }}
            empty={
              <Typography variant="body2" color="text.secondary" data-testid="newsletter-promo-empty">
                {t("newsletter.promo.empty")}
              </Typography>
            }
          />
        </Box>
      </Stack>
    </Panel>
  );
}
