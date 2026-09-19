import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isRepoDocName, REPO_DOCS, renderRepoDoc } from "@/modules/diagnostics/repo-docs";
import { canSeeDiagnostics } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string; name: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

/**
 * One repository document, rendered (`DECISIONS.md` §88). `DEV` and above, like `/devs`;
 * the name is matched against the closed list and never touches a path.
 */
export default async function RepoDocPage({ params }: Props) {
  const { locale, name } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canSeeDiagnostics(actor.role)) notFound();
  if (!isRepoDocName(name)) notFound();

  const t = await getTranslations("Devs");
  const rendered = await renderRepoDoc(name);
  if (!rendered) notFound();

  return (
    <Stack spacing={3}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
          <Typography variant="body2">
            <Link href="/devs">{t("docs.back")}</Link>
          </Typography>
          {REPO_DOCS.map((doc) => (
            <Typography variant="body2" key={doc.name} sx={{ fontWeight: doc.name === name ? 700 : 400 }}>
              <Link href={{ pathname: "/devs/docs/[name]", params: { name: doc.name } }}>{doc.name}</Link>
            </Typography>
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t("docs.file", { file: REPO_DOCS.find((doc) => doc.name === name)?.file ?? name, kb: Math.round(rendered.bytes / 1024) })}
        </Typography>
        <Box
          // The repository's own Markdown, rendered: written by the people who deploy this and
          // read by the roles that can read `/devs` — not user input (`repo-docs.ts`).
          dangerouslySetInnerHTML={{ __html: rendered.html }}
          sx={{
            maxWidth: 900,
            "& h1": { fontSize: "1.75rem", mt: 4 },
            "& h2": { fontSize: "1.375rem", mt: 4, borderBottom: 1, borderColor: "divider", pb: 0.5 },
            "& h3": { fontSize: "1.125rem", mt: 3 },
            "& h4": { fontSize: "1rem", mt: 2 },
            "& p, & li": { lineHeight: 1.6 },
            "& pre": { overflowX: "auto", p: 2, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.8125rem" },
            "& code": { fontFamily: "monospace", fontSize: "0.875em" },
            "& table": { borderCollapse: "collapse", my: 2, display: "block", overflowX: "auto" },
            "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5, textAlign: "left", verticalAlign: "top" },
            "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 2, ml: 0, color: "text.secondary" },
            "& a": { color: "primary.main" },
          }}
        />
    </Stack>
  );
}
