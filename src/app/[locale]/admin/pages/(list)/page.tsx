import CardMembershipIcon from "@mui/icons-material/CardMembership";
import GroupsIcon from "@mui/icons-material/Groups";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readFaqPageSettings } from "@/modules/content/faq/page-settings";
import { listFaqItemsForAdmin } from "@/modules/content/faq/repository";
import { readMembersPageSettings } from "@/modules/content/members/page-settings";
import { listPagesForAdmin, type PageListRow } from "@/modules/content/pages/repository";
import { readTeamPageSettings } from "@/modules/content/team/page-settings";
import { listTeamMembersForAdmin } from "@/modules/content/team/repository";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import { PAGES_ROW_ROUTE } from "@/modules/content/pages/pages-row";
import { cachedContactFormReaches, cachedShownContactAddresses } from "@/modules/public-cache/reads";
import { canEditTexts, canManageClubSettings, canReadContent, type EditorialStatus } from "@/modules/staff-identity/domain/roles";
import { readMenuOrder } from "@/modules/content/menu/menu-order";
import { pageMenuKey, resolveMenuOrder, sortByMenuOrder } from "@/modules/content/menu/order";
import MenuOrderPanel from "@/modules/content/menu/ui/MenuOrderPanel";
import { pageListVerbs } from "@/modules/content/pages/page-list-verbs";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { countMembers } from "@/modules/staff-identity/repository";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import RowMenu, { type RowMenuItem } from "@/shared/ui/RowMenu";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import { CLUB_NAME } from "@/theme/brand";
import { deletePageAction, transitionPageAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * The club's standing pages (BR-REQ-050-03).
 *
 * ## The order is edited here, in one list for the whole menu (§NNN)
 *
 * `nav_order` was a number on the page editor, which asks the wrong question; then two arrows on
 * each custom page's row, which ordered the club's pages among themselves and left «Evenimente»,
 * «Calendar», «Contact» and the standard pages where the code put them. The owner, 2026-09-29:
 * «vreau să pot seta ordinea la orice pagină, inclusiv cea de evenimente, calendar, contact». So
 * «Ordinea meniului» orders every entry the menu can carry in one list, and the table below shows
 * each custom page's place in it («Locul în meniu») rather than a number of its own. The old
 * number only places a page the order does not name yet (a page written after the last save).
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
  // Reading the club's pages, not writing them (§208).
  if (!canReadContent(actor.role)) notFound();
  // «Ordinea meniului» is a club setting (§450): the Administrator's, which the action asserts again.
  const mayOrderMenu = canManageClubSettings(actor.role);

  const current = await searchParams;
  const { saved, error } = current;
  const db = getDb();
  const [pageRows, menuState, teamSettings, teamMembers, faqSettings, faqItems, membersSettings, members, contactFormReaches, contactAddresses] = await Promise.all([
    listPagesForAdmin(db, locale),
    readMenuOrder(db),
    readTeamPageSettings(db),
    listTeamMembersForAdmin(db),
    readFaqPageSettings(db),
    listFaqItemsForAdmin(db),
    readMembersPageSettings(db),
    countMembers(db),
    cachedContactFormReaches(),
    cachedShownContactAddresses(),
  ]);
  // The menu's one order (§NNN): every entry, the custom pages among them; the table follows it.
  const menuOrder = resolveMenuOrder(menuState.stored, pageRows.map((row) => row.id));
  const rows = sortByMenuOrder(pageRows, (row) => pageMenuKey(row.id), menuOrder);
  const placeInMenu = (id: string) => menuOrder.indexOf(pageMenuKey(id)) + 1;
  const t = await getTranslations("Admin");
  /*
    The standard pages (§525): the platform's own, whose address and title the club does not
    choose and whose contents it keeps on their own screens — «Contact» (§442, §461), «Echipa»
    (§459), «Întrebări frecvente» and «Membri» (§524). Each wears its glyph and says whether it is on the site and
    what of it is, so the list answers "what is live" for every page the club has, standard and
    custom alike. «Contact» is always on the site; its row says what the page offers, and opens
    its own page, `/admin/pages/contact`, like the others — never a «Setări» tab, which switched the
    main bar away from «Pagini» (the owner, 2026-09-28).
  */
  const contactLine = [
    contactFormReaches ? t("pages.contactForm") : t("pages.contactNoForm"),
    contactAddresses.length > 0 ? t("pages.contactAddress", { address: contactAddresses.join(", ") }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const standard = [
    {
      key: "contact",
      icon: <MailOutlineIcon aria-hidden fontSize="small" color="action" />,
      href: PAGES_ROW_ROUTE.contact,
      title: t("pages.tabContact"),
      published: true,
      line: contactLine,
    },
    {
      key: "team",
      icon: <GroupsIcon aria-hidden fontSize="small" color="action" />,
      href: PAGES_ROW_ROUTE.team,
      title: t("pages.tabTeam"),
      published: teamSettings.status === "PUBLISHED",
      line: t("pages.standardShown", {
        shown: String(teamMembers.filter((member) => member.visible).length),
        total: String(teamMembers.length),
      }),
    },
    {
      key: "faq",
      icon: <HelpOutlineIcon aria-hidden fontSize="small" color="action" />,
      href: PAGES_ROW_ROUTE.faq,
      title: t("pages.tabFaq"),
      published: faqSettings.status === "PUBLISHED",
      line: t("pages.standardShown", {
        shown: String(faqItems.filter((item) => item.visible).length),
        total: String(faqItems.length),
      }),
    },
    {
      key: "members",
      icon: <CardMembershipIcon aria-hidden fontSize="small" color="action" />,
      href: PAGES_ROW_ROUTE.members,
      title: t("pages.tabMembers"),
      published: membersSettings.status === "PUBLISHED",
      line: t("members.count", { count: members }),
    },
  ];
  const words = await confirmWords();

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
      // Its place in «Ordinea meniului» (§NNN), counting every entry of the menu, not only the pages.
      render: (row) => placeInMenu(row.id),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* The club's own pages, and the platform's standard ones: «Contact», «Echipa» (§459), «Întrebări frecvente» (§525), «Membri» (§524). */}
      <PagesSubNav locale={locale} active="pages" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack component="section" spacing={1.5} aria-labelledby="pages-standard" data-testid="pages-standard">
        <Typography variant="h2" id="pages-standard" sx={{ fontSize: "1.25rem" }}>
          {t("pages.standardTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("pages.standardIntro")}
        </Typography>
        <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {standard.map((page) => (
            <Paper component="li" key={page.key} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }} data-testid={`pages-standard-${page.key}`}>
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, minWidth: 0 }}>
                  {page.icon}
                  <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
                    {page.title}
                  </Typography>
                  <Chip
                    size="small"
                    color={page.published ? "success" : "default"}
                    label={EDITORIAL_STATUS_LABEL[page.published ? "PUBLISHED" : "DRAFT"]}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {page.line}
                  </Typography>
                </Stack>
                {page.href && (
                  <GlyphButtonLink href={page.href} icon="edit" variant="outlined" sx={{ minHeight: 44 }}>
                    {t("pages.standardOpen")}
                  </GlyphButtonLink>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Stack>

      {/* «Ordinea meniului» (§NNN): every entry of the site menu, the standard and the custom pages together. */}
      <MenuOrderPanel
        locale={locale}
        order={menuOrder}
        pages={pageRows.map((row) => ({ id: row.id, title: row.title, editorialStatus: row.editorialStatus }))}
        mayEdit={mayOrderMenu}
        openWhen={{ saved: saved === "menuOrder" }}
      />

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("pages.customTitle")}
        </Typography>
        {/* A reader opens this list; writing a page is the Redactor's and the Administrator's
            (§207, §208). The action refuses either way — this keeps the button off a screen
            where pressing it could only fail. */}
        {canEditTexts(actor.role) && (
        <GlyphButtonLink href="/admin/pages/new" icon="add" variant="contained" sx={{ minHeight: 44 }}>
          {t("pages.create")}
        </GlyphButtonLink>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t("pages.intro", { club: CLUB_NAME })} {t("pages.moveHelp")}
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
          return (
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", gap: 0.5 }}>
              {/* The ↑ / ↓ that stood here went with §NNN: a page moves in «Ordinea meniului», above. */}
              {/*
                The verbs, in the same ⋮ every other list uses (§256). The two forms beside it
                are the Server Actions the menu submits — hidden, because the menu is the
                control and a form in a table cell is not.
              */}
              {(() => {
                // Each verb asks the gate its own service asserts (`pageListVerbs`): a Redactor reads
                // this list and edits a page, but is never shown «Șterge» or «Publică» / «Retrage».
                const verbs = pageListVerbs(actor.role, row.editorialStatus as EditorialStatus);
                if (!verbs.edit && !verbs.toggleTo && !verbs.remove) return null;
                const items: RowMenuItem[] = [];
                if (verbs.edit) items.push({ kind: "link", label: t("pages.edit"), icon: "edit", href: `${basePath}/${row.id}` });
                if (verbs.toggleTo) {
                  items.push({
                    kind: "submit",
                    label: verbs.toggleTo === "DRAFT" ? t("pages.unpublish") : t("pages.publish"),
                    icon: verbs.toggleTo === "DRAFT" ? "unpublish" : "publish",
                    formId: `publish-${row.id}`,
                    color: verbs.toggleTo === "DRAFT" ? "warning" : "primary",
                  });
                }
                if (verbs.remove) items.push({ kind: "submit", label: t("pages.delete"), icon: "delete", formId: `delete-${row.id}`, color: "error" });
                return (
                  <>
                    {/* Each verb's form asks its own question (§384); the menu only submits it. */}
                    {verbs.toggleTo && (
                      <ActionForm
                        id={`publish-${row.id}`}
                        action={transitionPageAction}
                        hidden
                        confirm={
                          verbs.toggleTo === "DRAFT"
                            ? { title: t("pages.unpublishTitle"), body: t("pages.unpublishBody"), confirmLabel: t("pages.unpublish"), cancelLabel: words.cancel, destructive: true }
                            : { title: t("pages.publishTitle"), body: t("pages.publishBody"), confirmLabel: t("pages.publish"), cancelLabel: words.cancel }
                        }
                      >
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="pageId" value={row.id} />
                        <input type="hidden" name="expectedVersion" value={row.version} />
                        <input type="hidden" name="to" value={verbs.toggleTo} />
                      </ActionForm>
                    )}
                    {verbs.remove && (
                      <ActionForm
                        id={`delete-${row.id}`}
                        action={deletePageAction}
                        hidden
                        confirm={{ title: t("pages.deleteTitle", { title: row.title ?? t("pages.untitled") }), body: t("pages.deleteBody"), confirmLabel: t("pages.delete"), cancelLabel: words.cancel, destructive: true }}
                      >
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="pageId" value={row.id} />
                      </ActionForm>
                    )}
                    <RowMenu ariaLabel={t("pages.rowActions", { title: row.title ?? t("pages.untitled") })} items={items} />
                  </>
                );
              })()}
            </Stack>
          );
        }}
      />
    </Stack>
  );
}
