import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { GROUP_RUN_DECLARATION_RETENTION_DAYS, signingOpen } from "../domain";

/**
 * "Semnează declarația pe propria răspundere" on a group run's page (§393; the owner, 2026-09-25:
 * "for these group runs I should just have an optional 'semnează declarația pe propria răspundere'
 * button that just opens the signing flow").
 *
 * Under the route's pills, at `#declaratie`: one 44-pixel button to the signing page and one line
 * saying what happens — the copy by email, and how long the club keeps it — under a heading that
 * names the section. Nothing at all unless the organizer offered it on a group run of asphalt or
 * trail, the club has an approved text of that kind in force, an approved privacy notice is in
 * force (the signature takes an address and an identity document, and the service refuses it
 * without one, as a registration is refused), and the run can still be signed for. The listing
 * card says nothing (§393).
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
  const [declaration, privacyNotice] = await Promise.all([
    cachedCurrentApprovedDocument(key, locale, now),
    cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now),
  ]);
  if (!declaration || !privacyNotice) return null;
  const t = await getTranslations("Event");
  const href = getPathname({ locale, href: { pathname: "/events/[slug]/declaration", params: { slug } } });
  return (
    <Box
      component="section"
      id="declaratie"
      aria-labelledby="declaratie-heading"
      data-testid="group-run-declaration-offer"
      sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}
    >
      <Typography variant="h2" id="declaratie-heading" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {t("groupRunDeclaration.heading")}
      </Typography>
      <Button component="a" href={href} variant="outlined" sx={TAP_TARGET}>
        {t("groupRunDeclaration.button")}
      </Button>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("groupRunDeclaration.line", { days: durationPhrase(locale, GROUP_RUN_DECLARATION_RETENTION_DAYS, "days") })}
      </Typography>
    </Box>
  );
}
