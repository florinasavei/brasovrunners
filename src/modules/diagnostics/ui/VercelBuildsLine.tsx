import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";

type Props = {
  /** Deployments of this project that reached the build this month (`readVercelMonth`). */
  builds: number;
  /** The same builds by the branch that caused them, most first. */
  byBranch: { branch: string; count: number }[];
};

/**
 * «Build-uri luna aceasta» under the deployments line on `/devs` (§NNN): how many of the project's
 * deployments built and for which branch — a build is what Vercel meters, and the line says no more
 * than the count (what a build costs is on Vercel's usage card below). A Server Component over
 * MUI's Typography; no branch at all is the dash.
 */
export default async function VercelBuildsLine({ builds, byBranch }: Props) {
  const t = await getTranslations("Devs");
  return (
    <Typography variant="body2" sx={{ mb: 1 }} data-testid="vercel-builds">
      {t("vercel.builds", { builds, branches: byBranch.map((entry) => `${entry.branch} ${entry.count}`).join(", ") || "—" })}
    </Typography>
  );
}
