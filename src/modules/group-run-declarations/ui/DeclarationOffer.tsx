import DrawIcon from "@mui/icons-material/Draw";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { signedStateFor, signingOpen } from "../domain";
import { findRunSeries, findSignatureByViewToken } from "../repository";
import { signatureCoversSeries } from "../series";

/**
 * The «Semnează declarația» section at `#declaratie` in the «Condiții de participare» fold (§393,
 * §498): a small button, 44 px tall (BR-REQ-041-01 criterion 6). Rendered only when offered, an
 * approved text of that kind and an approved privacy notice are in force, and signing is open.
 *
 * With the signer's own `?declaratie=` link (§523) it says what they signed and hides the button
 * while that version is in force. Read from the link alone, so it reveals nothing about anyone
 * else; a GET that changes nothing (AGENTS.md §12.8).
 */
export default async function DeclarationOffer({
  event,
  locale,
  slug,
  now,
  viewToken,
}: {
  event: {
    id: string;
    title: string;
    type: string;
    surface: string | null;
    offersGroupRunDeclaration: boolean;
    eventStatus: string;
    startsAt: Date;
    timezone: string;
  };
  locale: Locale;
  slug: string;
  now: Date;
  /** `?declaratie=` from the signer's own link (§523). */
  viewToken?: string;
}) {
  const key = offeredGroupRunDeclarationKey(event);
  if (!key) return null;
  // The page reads a published event: the editorial state is the page's own guarantee.
  const open = signingOpen({ ...event, editorialStatus: "PUBLISHED" }, now);
  const token = typeof viewToken === "string" && isWellFormedTokenSecret(viewToken) ? viewToken : null;
  if (!open && token === null) return null;
  // Optional (§447, §493): without the database the offer is left out rather than failing the page.
  const [declaration, privacyNotice] = await readOrWhileAway(
    () => Promise.all([cachedCurrentApprovedDocument(key, locale, now), cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now)]),
    [undefined, undefined],
  );
  if (!declaration || !privacyNotice) return null;
  // Not cached: it is one person's (§523).
  const mine = token ? await readOrWhileAway(() => findSignatureByViewToken(getDb(), hashTokenSecret(token), event.id, key), undefined) : undefined;
  const signed = signedStateFor(mine, declaration.id);
  if (!open && signed?.kind !== "current") return null;
  // The text names {{series}} AND the run has another date (§523).
  const coversSeries =
    signed === null &&
    signatureCoversSeries(declaration.body) &&
    (await readOrWhileAway(async () => (await findRunSeries(getDb(), event.id)).key !== null, false));
  const t = await getTranslations("Event");
  const href = getPathname({ locale, href: { pathname: "/events/[slug]/declaration", params: { slug } } });
  const when = signed ? formatDay(signed.acceptedAt, { locale, timeZone: event.timezone, style: "long", position: "inline" }) : "";
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
      {signed?.kind === "current" ? (
        <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-signed">
          {t(mine?.series ? "groupRunDeclaration.signedSeries" : "groupRunDeclaration.signedOne", { version: signed.version, when })}
        </Typography>
      ) : signed?.kind === "renew" ? (
        <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-renew">
          {t("groupRunDeclaration.signedOlder", { version: signed.version, when })}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} data-testid="group-run-declaration-line">
          {t(coversSeries ? "groupRunDeclaration.line" : "groupRunDeclaration.lineOneDate", { event: event.title })}
        </Typography>
      )}
      {signed?.kind !== "current" && (
        <Button component="a" href={href} variant="outlined" size="small" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
          <DrawIcon aria-hidden="true" data-testid="declaration-offer-glyph" sx={glyphSx("small")} />
          {t("groupRunDeclaration.button")}
        </Button>
      )}
    </Box>
  );
}
