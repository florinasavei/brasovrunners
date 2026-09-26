import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatCalendarDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { albumKind, listAlbumsForAdmin, type AlbumKind, type AlbumListRow } from "@/modules/content/gallery/repository";
import GallerySubNav from "@/modules/content/gallery/ui/GallerySubNav";
import { isStorageConfigured } from "@/modules/media/storage";
import { isEditorial } from "@/modules/staff-identity/domain/roles";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import RowMenu, { type RowMenuItem } from "@/shared/ui/RowMenu";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import { deleteAlbumAction, transitionAlbumAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/** The list's two groups, in the order they are shown (§NNN). */
const ALBUM_KINDS: readonly AlbumKind[] = ["event", "free"];

/**
 * The albums, newest first (BR-REQ-054-01). Editorial roles; the section gate is in the
 * layout beside this file's loading boundary (`DECISIONS.md` §54), and asserted again here.
 */
export default async function AdminGalleryPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();

  const current = await searchParams;
  const { saved, error } = current;
  const rows = await listAlbumsForAdmin(getDb(), locale);
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const query = parseListQuery(current, { sortable: [], defaultSort: "takenOn", defaultPerPage: 100 });

  const columns: readonly AdminColumn<AlbumListRow>[] = [
    {
      key: "title",
      label: t("gallery.columnTitle"),
      primary: true,
      render: (row) => (
        <Link href={{ pathname: "/admin/gallery/[id]", params: { id: row.id } }}>{row.title}</Link>
      ),
    },
    {
      key: "takenOn",
      // A calendar day stored at noon UTC (the album form): read as the day it names (§349).
      label: t("gallery.columnTakenOn"),
      render: (row) => formatCalendarDay(row.takenOn, { locale, style: "short" }),
    },
    {
      key: "status",
      label: t("gallery.columnStatus"),
      render: (row) => (
        <Chip
          size="small"
          color={row.editorialStatus === "PUBLISHED" ? "success" : "default"}
          label={EDITORIAL_STATUS_LABEL[row.editorialStatus]}
        />
      ),
    },
    {
      key: "photos",
      label: t("gallery.columnPhotos"),
      align: "right",
      hideBelow: "sm",
      render: (row) => row.photoCount,
    },
  ];

  // The event an album is from, in its own group only; an event with no title in this language
  // still reads as linked (§NNN).
  const eventColumn: AdminColumn<AlbumListRow> = {
    key: "event",
    label: t("gallery.columnEvent"),
    hideBelow: "sm",
    render: (row) => row.eventTitle ?? "—",
  };

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("gallery.title")}
        </Typography>
        <GlyphButtonLink href="/admin/gallery/new" icon="add" variant="contained" sx={{ minHeight: 44 }}>
          {t("gallery.create")}
        </GlyphButtonLink>
      </Stack>

      {/* The other half of this tab: every stored picture, and where each one is used. */}
      <GallerySubNav locale={locale} active="albums" />

      <Typography variant="body2" color="text.secondary">
        {t("gallery.intro")}
      </Typography>

      {/* Read from the environment, never remembered: the five R2 variables are there or not. */}
      {!isStorageConfigured() && <Alert severity="warning">{t("gallery.storageUnconfigured")}</Alert>}

      {/* Two groups, by kind (§NNN): the albums of an event, then the free ones — group photos
          that belong to no event. Each group is newest first; an empty group says so. */}
      {rows.length === 0 && <Typography variant="body1">{t("gallery.empty")}</Typography>}
      {rows.length > 0 && ALBUM_KINDS.map((kind) => {
        const group = rows.filter((row) => albumKind(row) === kind);
        return (
          <Stack key={kind} component="section" spacing={1} aria-labelledby={`albums-${kind}`}>
            <Typography id={`albums-${kind}`} variant="h3" sx={{ fontSize: "1.0625rem", fontWeight: 600 }}>
              {t(`gallery.group.${kind}`)} ({group.length})
            </Typography>
            <AdminTable
              caption={t(`gallery.group.${kind}`)}
              columns={kind === "event" ? [...columns.slice(0, 1), eventColumn, ...columns.slice(1)] : columns}
              rows={group}
              rowKey={(row) => row.id}
              basePath={getPathname({ locale, href: "/admin/gallery" })}
              currentParams={{}}
              query={query}
              total={group.length}
              labels={{
                results: t("list.results", { count: group.length }),
                page: t("list.page", { page: query.page, pages: pageCount(group.length, query.perPage) }),
                previous: t("list.previous"),
                next: t("list.next"),
                perPage: t("list.perPage"),
                actions: t("list.actions"),
                sortBy: (column) => t("list.sortBy", { column }),
              }}
              empty={<Typography variant="body2" color="text.secondary">{t(`gallery.groupEmpty.${kind}`)}</Typography>}
              rowActions={(row) => (
                // The verbs in the same menu every other list uses (§256); the two forms beside it
                // are the Server Actions it submits, and the server checks the role and the version.
                <>
                  {/* Each verb's form asks its own question (§384); the menu only submits it. */}
                  <ActionForm
                    id={`album-publish-${row.id}`}
                    action={transitionAlbumAction}
                    hidden
                    confirm={
                      row.editorialStatus === "PUBLISHED"
                        ? { title: t("gallery.unpublishTitle"), body: t("gallery.unpublishBody"), confirmLabel: t("gallery.unpublish"), cancelLabel: words.cancel, destructive: true }
                        : { title: t("gallery.publishTitle"), body: t("gallery.publishBody"), confirmLabel: t("gallery.publish"), cancelLabel: words.cancel }
                    }
                  >
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="albumId" value={row.id} />
                    <input type="hidden" name="expectedVersion" value={row.version} />
                    <input type="hidden" name="to" value={row.editorialStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED"} />
                  </ActionForm>
                  <ActionForm
                    id={`album-delete-${row.id}`}
                    action={deleteAlbumAction}
                    hidden
                    confirm={{ title: t("gallery.deleteAlbumTitle"), body: t("gallery.deleteAlbumBody", { title: row.title }), confirmLabel: t("gallery.deleteAlbum"), cancelLabel: words.cancel, destructive: true }}
                  >
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="albumId" value={row.id} />
                  </ActionForm>
                  <RowMenu
                    ariaLabel={t("gallery.rowActions", { title: row.title })}
                    items={[
                      {
                        kind: "link",
                        label: t("gallery.edit"),
                        icon: "edit",
                        href: `${getPathname({ locale, href: "/admin/gallery" })}/${row.id}`,
                      },
                      {
                        kind: "submit",
                        label: row.editorialStatus === "PUBLISHED" ? t("gallery.unpublish") : t("gallery.publish"),
                        icon: row.editorialStatus === "PUBLISHED" ? "unpublish" : "publish",
                        formId: `album-publish-${row.id}`,
                        color: row.editorialStatus === "PUBLISHED" ? "warning" : "primary",
                      },
                      {
                        kind: "submit",
                        label: t("gallery.deleteAlbum"),
                        icon: "delete",
                        formId: `album-delete-${row.id}`,
                        color: "error",
                      },
                    ] satisfies RowMenuItem[]}
                  />
                </>
              )}
            />
          </Stack>
        );
      })}
    </Stack>
  );
}
