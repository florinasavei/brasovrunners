import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listPagesForAdmin, type PageListRow } from "@/modules/content/pages/repository";
import { isEditorial, type EditorialStatus } from "@/modules/staff-identity/domain/roles";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ButtonLink from "@/shared/ui/ButtonLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { movePageAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * The club's standing pages (BR-REQ-050-03).
 *
 * ## The order is edited here, not in a number field
 *
 * `nav_order` was a number on the page editor, which asks the wrong question. Nobody wants page
 * four to have `nav_order = 40`; they want it above page three — and answering that through a
 * number means opening two editors, reading both numbers, inventing a third, and hoping no other
 * page shares it. Two arrows on the row ask the question the club is actually asking, and
 * `movePageInNav` renumbers the whole list behind them so duplicates and zeroes heal themselves.
 *
 * The number field on the editor stays: it is how a page is placed when it is first written,
 * before there is a list to move it within.
 *
 * The list is not paginated in practice — a club with more standing pages than fit on a screen
 * has a navigation problem rather than a paging one — but it goes through the same `AdminTable`
 * as every other list, so the pager appears by itself if that ever stops being true.
 */
export default async function AdminPagesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();

  const current = await searchParams;
  const { saved, error } = current;
  const rows = await listPagesForAdmin(getDb(), locale);
  const t = await getTranslations("Admin");

  const query = parseListQuery(current, {
    // The navigation's own order is the only order this list has: it is what the menu shows,
    // so a column that re-sorted it would be showing something the site does not do.
    sortable: [],
    defaultSort: "order",
    defaultPerPage: 100,
  });

  const basePath = getPathname({ locale, href: "/admin/pages" });

  const columns: readonly AdminColumn<PageListRow>[] = [
    {
      key: "title",
      label: t("pages.columnTitle"),
      primary: true,
      render: (row) => (
        <Link href={{ pathname: "/admin/pages/[id]", params: { id: row.id } }}>
          {row.title ?? t("pages.untitled")}
        </Link>
      ),
    },
    {
      key: "status",
      label: t("pages.columnStatus"),
      render: (row) => (
        <Chip
          size="small"
          color={row.editorialStatus === "PUBLISHED" ? "success" : "default"}
          label={EDITORIAL_STATUS_LABEL[row.editorialStatus as EditorialStatus]}
        />
      ),
    },
    {
      key: "address",
      label: t("pages.columnAddress"),
      hideBelow: "lg",
      render: (row) => (row.slug ? `/${row.slug}` : "—"),
    },
    {
      key: "order",
      label: t("pages.columnOrder"),
      align: "right",
      hideBelow: "sm",
      render: (row) => row.navOrder,
    },
  ];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("pages.title")}
        </Typography>
        <ButtonLink href="/admin/pages/new" variant="contained" sx={{ minHeight: 44 }}>
          {t("pages.create")}
        </ButtonLink>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t("pages.intro")} {t("pages.moveHelp")}
      </Typography>

      <AdminTable
        caption={t("pages.tableCaption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        basePath={basePath}
        currentParams={{}}
        query={query}
        total={rows.length}
        labels={{
          results: t("list.results", { count: rows.length }),
          page: t("list.page", { page: query.page, pages: pageCount(rows.length, query.perPage) }),
          previous: t("list.previous"),
          next: t("list.next"),
          perPage: t("list.perPage"),
          actions: t("list.actions"),
          sortBy: (column) => t("list.sortBy", { column }),
        }}
        empty={<Typography variant="body1">{t("pages.empty")}</Typography>}
        rowActions={(row) => {
          const index = rows.findIndex((candidate) => candidate.id === row.id);

          return (
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", gap: 0.5 }}>
              {/* The ends have no button rather than a disabled one: there is nothing to
                  explain about an arrow that would move the first page above itself, and a
                  control that never does anything is worse than one that is not there. */}
              {index > 0 && (
                <Box component="form" action={movePageAction}>
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="pageId" value={row.id} />
                  <input type="hidden" name="direction" value="up" />
                  <SubmitButton
                    label="↑"
                    pendingLabel="↑"
                    variant="outlined"
                    ariaLabel={t("pages.moveUpNamed", { title: row.title ?? t("pages.untitled") })}
                  />
                </Box>
              )}
              {index < rows.length - 1 && (
                <Box component="form" action={movePageAction}>
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="pageId" value={row.id} />
                  <input type="hidden" name="direction" value="down" />
                  <SubmitButton
                    label="↓"
                    pendingLabel="↓"
                    variant="outlined"
                    ariaLabel={t("pages.moveDownNamed", { title: row.title ?? t("pages.untitled") })}
                  />
                </Box>
              )}
            </Stack>
          );
        }}
      />
    </Stack>
  );
}
