import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listPagesForAdmin } from "@/modules/content/pages/repository";
import { isEditorial, type EditorialStatus } from "@/modules/staff-identity/domain/roles";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ButtonLink from "@/shared/ui/ButtonLink";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/** The club's standing pages (BR-REQ-050-03). */
export default async function AdminPagesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();

  const { saved, error } = await searchParams;
  const rows = await listPagesForAdmin(getDb(), locale);
  const t = await getTranslations("Admin");

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
        {t("pages.intro")}
      </Typography>

      {rows.length === 0 ? (
        <Typography variant="body1">{t("pages.empty")}</Typography>
      ) : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {rows.map((row) => (
            <Card key={row.id} component="li" variant="outlined">
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip
                    size="small"
                    label={EDITORIAL_STATUS_LABEL[row.editorialStatus as EditorialStatus]}
                  />
                  <Chip size="small" variant="outlined" label={t("pages.order", { order: row.navOrder })} />
                </Stack>
                <Typography variant="h3" sx={{ fontSize: "1rem" }}>
                  <Link href={{ pathname: "/admin/pages/[id]", params: { id: row.id } }}>
                    {row.title ?? t("pages.untitled")}
                  </Link>
                </Typography>
                {row.slug && (
                  <Typography variant="body2" color="text.secondary">
                    /{row.slug}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
