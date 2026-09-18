import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listMediaAssetsForAdmin, type MediaAssetRow, type MediaReference } from "@/modules/media/references";
import { isStorageConfigured } from "@/modules/media/storage";
import { canEditEventFields, isEditorial } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { parseListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { deletePictureAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * Every stored picture and where it is used (`DECISIONS.md` §73). The owner's ask: "I don't
 * see these uploaded pictures in the gallery so I can review and delete them — I need to know
 * what picture and where it's used." So: the thumbnail, the file, when and by whom, and one
 * line per page, event or album it appears in, each a link to the editor of that thing.
 * Delete is offered only for a picture used nowhere; the sweep takes those anyway after a
 * week, and this is for the organizer who wants it gone now.
 */
export default async function AdminPicturesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();

  const current = await searchParams;
  const { saved, error } = current;
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const rows = isStorageConfigured() ? await listMediaAssetsForAdmin(getDb(), locale) : [];
  const query = parseListQuery(current, { sortable: [], defaultSort: "createdAt", defaultPerPage: 50 });
  const page = rows.slice((query.page - 1) * query.perPage, query.page * query.perPage);
  const mayDelete = canEditEventFields(actor.role);

  const referenceLink = (reference: MediaReference) => {
    const title = reference.title ?? t("pictures.untitled");
    switch (reference.kind) {
      case "album":
        return (
          <Link href={{ pathname: "/admin/gallery/[id]", params: { id: reference.id } }}>
            {t("pictures.usedInAlbum", { title })}
          </Link>
        );
      case "page":
        return (
          <Link href={{ pathname: "/admin/pages/[id]", params: { id: reference.id } }}>
            {t("pictures.usedInPage", { title })}
          </Link>
        );
      case "event":
        return (
          <Link href={{ pathname: "/admin/events/[id]", params: { id: reference.id } }}>
            {t("pictures.usedInEvent", { title })}
          </Link>
        );
    }
  };

  const columns: readonly AdminColumn<MediaAssetRow>[] = [
    {
      key: "picture",
      label: t("pictures.columnPicture"),
      render: (row) => (
        <Box
          component="a"
          href={row.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: "inline-block", lineHeight: 0 }}
        >
          <Box
            component="img"
            src={row.thumbUrl}
            alt={row.originalFilename}
            width={72}
            height={72}
            loading="lazy"
            sx={{ width: 72, height: 72, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider" }}
          />
        </Box>
      ),
    },
    {
      key: "name",
      label: t("pictures.columnName"),
      primary: true,
      render: (row) => (
        <>
          <Typography component="span" sx={{ display: "block", wordBreak: "break-all" }}>
            {row.originalFilename}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            {t("pictures.size", { width: row.width, height: row.height, kb: Math.round(row.byteSize / 1024) })}
          </Typography>
        </>
      ),
    },
    {
      key: "uploaded",
      label: t("pictures.columnUploaded"),
      hideBelow: "md",
      render: (row) => (
        <>
          {format.dateTime(row.createdAt, { dateStyle: "medium" })}
          {row.uploadedByName ? ` · ${row.uploadedByName}` : ""}
        </>
      ),
    },
    {
      key: "usedIn",
      label: t("pictures.columnUsedIn"),
      render: (row) =>
        row.references.length === 0 ? (
          <Typography component="span" variant="body2" color="text.secondary">
            {t("pictures.unused")}
          </Typography>
        ) : (
          <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {row.references.map((reference) => (
              <li key={`${reference.kind}:${reference.id}`}>{referenceLink(reference)}</li>
            ))}
          </Stack>
        ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("pictures.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("pictures.intro")}
      </Typography>
      <Typography variant="body2">
        <Link href="/admin/gallery">← {t("gallery.title")}</Link>
      </Typography>

      {!isStorageConfigured() && <Alert severity="warning">{t("gallery.storageUnconfigured")}</Alert>}

      <AdminTable
        caption={t("pictures.tableCaption")}
        columns={columns}
        rows={page}
        rowKey={(row) => row.id}
        basePath={getPathname({ locale, href: "/admin/gallery/pictures" })}
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
        empty={<Typography variant="body1">{t("pictures.empty")}</Typography>}
        rowActions={
          mayDelete
            ? (row) =>
                row.references.length === 0 ? (
                  <form action={deletePictureAction}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="assetId" value={row.id} />
                    <ConfirmSubmitButton
                      label={t("pictures.delete")}
                      title={t("pictures.deleteConfirm")}
                      body={row.originalFilename}
                      confirmLabel={t("pictures.delete")}
                      cancelLabel={t("confirm.cancel")}
                      color="error"
                    />
                  </form>
                ) : null
            : undefined
        }
      />
    </Stack>
  );
}
