import DrawIcon from "@mui/icons-material/Draw";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { GROUP_RUN_DECLARATION_RETENTION_DAYS, signingOpen } from "../domain";

/**
 * "Semnează declarația pe propria răspundere" on a group run's page (§393; the owner, 2026-09-25:
 * "for these group runs I should just have an optional 'semnează declarația pe propria răspundere'
 * button that just opens the signing flow").
 *
 * At `#declaratie`, inside the page's closed «Condiții de participare» fold after the rules (§NNN;
 * the owner, 2026-09-27, moving it from under the route's pills): one line saying what happens —
 * the copy by email, and how long the club keeps it — and one small button to the signing page,
 * «Semnează declarația» with a pen before it, under a level-3 heading that names the section.
 * The heading no longer says «(opțional)»: the line under it already says «Dacă vrei», and the
 * fold is the page's quiet corner. Small, but a thumb's 44 pixels tall (BR-REQ-041-01 criterion
 * 6). Nothing at all unless the organizer offered it on a group run of asphalt or
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
  /*
    An optional part of the page (§447): while the database cannot say which texts are in force — away,
    or a red month's miss with no copy (§493) — the offer is left out rather than taking the event
    page down with it. Signing needs the database anyway.
  */
  const [declaration, privacyNotice] = await readOrWhileAway(
    () => Promise.all([cachedCurrentApprovedDocument(key, locale, now), cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now)]),
    [undefined, undefined],
  );
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
      <Typography component="h3" variant="h3" id="declaratie-heading" sx={{ fontSize: "1.0625rem", mb: 0.5 }}>
        {t("groupRunDeclaration.heading")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("groupRunDeclaration.line", { days: durationPhrase(locale, GROUP_RUN_DECLARATION_RETENTION_DAYS, "days") })}
      </Typography>
      <Button component="a" href={href} variant="outlined" size="small" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
        <DrawIcon aria-hidden="true" data-testid="declaration-offer-glyph" sx={glyphSx("small")} />
        {t("groupRunDeclaration.button")}
      </Button>
    </Box>
  );
}
