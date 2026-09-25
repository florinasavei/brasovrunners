import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { RETENTION } from "@/modules/jobs/retention";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { signingOpen } from "../domain";

/**
 * "Semnează declarația pe propria răspundere" on a group run's page (§NNN; the owner, 2026-09-25:
 * "for these group runs I should just have an optional 'semnează declarația pe propria răspundere'
 * button that just opens the signing flow").
 *
 * Under the route's pills, at `#declaratie`: one 44-pixel button to the signing page and one line
 * saying what happens — the copy by email, and how long the club keeps it. Nothing at all unless
 * the organizer offered it on a group run of asphalt or trail, the club has an approved text of
 * that kind in force, and the run can still be signed for. The listing card says nothing (§NNN).
 *
 * A Server Component with a plain link: no island, nothing for a visitor who does not press it.
 */
export default async function DeclarationOffer({
  event,
  locale,
  slug,
  now,
}: {
  event: { type: string; surface: string | null; offersGroupRunDeclaration: boolean; eventStatus: string; startsAt: Date };
  locale: Locale;
  slug: string;
  now: Date;
}) {
  const key = offeredGroupRunDeclarationKey(event);
  // The page reads a published event: the editorial state is the page's own guarantee.
  if (!key || !signingOpen({ ...event, editorialStatus: "PUBLISHED" }, now)) return null;
  if (!(await cachedCurrentApprovedDocument(key, locale, now))) return null;
  const t = await getTranslations("Event");
  const href = getPathname({ locale, href: { pathname: "/events/[slug]/declaration", params: { slug } } });
  return (
    <Box component="section" id="declaratie" data-testid="group-run-declaration-offer" sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}>
      <Button component="a" href={href} variant="outlined" sx={TAP_TARGET}>
        {t("groupRunDeclaration.button")}
      </Button>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("groupRunDeclaration.line", { days: durationPhrase(locale, RETENTION.groupRunDeclarationsDaysAfterEvent, "days") })}
      </Typography>
    </Box>
  );
}
