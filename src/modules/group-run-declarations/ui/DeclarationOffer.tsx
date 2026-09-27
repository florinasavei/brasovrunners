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
 * "Semnează declarația pe propria răspundere" on a group run's page (§393; the owner, 2026-09-25:
 * "for these group runs I should just have an optional 'semnează declarația pe propria răspundere'
 * button that just opens the signing flow").
 *
 * At `#declaratie`, the last part of the page's closed «Condiții de participare» fold, after the
 * rules and the photographs notice (§498; the owner, 2026-09-27, moving it from under the route's
 * pills): one line saying what happens — the copy by email, and how long the club keeps it — and
 * one small button to the signing page, «Semnează declarația» with a pen before it, under a
 * level-3 heading that names the section. Neither the heading nor the line calls it optional any
 * more — no «(opțional)», no «Dacă vrei»: the club recommends it, and for a trail run the
 * mountain rescue asks for it. Small — MUI's `size="small"`, the owner's «mai mic» — but a
 * thumb's 44 pixels tall (BR-REQ-041-01 criterion 6). Nothing at all unless the organizer offered it on a group run of asphalt or
 * trail, the club has an approved text of that kind in force, an approved privacy notice is in
 * force (the signature takes an address and an identity document, and the service refuses it
 * without one, as a registration is refused), and the run can still be signed for. The listing
 * card says nothing (§393).
 *
 * **The signer's own link (§NNN).** Opened from the signer's copy — `?declaratie=<secret>`, minted
 * when that copy was sent, its hash on the row — the section says what the link's declaration is:
 * «Ai semnat deja declarația pentru aceste alergări (v. N, semnată …)» and no button, while the
 * version signed is the one in force — on any date the signature covers, the run past or not; or,
 * once the club has approved a newer version, that the one signed was older, with the button again.
 * Read from the link alone, never from an address typed into anything: the page tells nobody else
 * whether somebody signed. Without the link, or with one that is not for this run, the section is
 * the one every visitor sees. A read, so opening the link changes nothing (§12.8).
 *
 * A Server Component with a plain link: no island, nothing for a visitor who does not press it.
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
  /** `?declaratie=` from the signer's own link (§NNN), as the address carried it. */
  viewToken?: string;
}) {
  const key = offeredGroupRunDeclarationKey(event);
  if (!key) return null;
  // The page reads a published event: the editorial state is the page's own guarantee.
  const open = signingOpen({ ...event, editorialStatus: "PUBLISHED" }, now);
  const token = typeof viewToken === "string" && isWellFormedTokenSecret(viewToken) ? viewToken : null;
  if (!open && token === null) return null;
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
  // The signer's own declaration, from their link alone (§NNN): not cached, it is one person's.
  const mine = token ? await readOrWhileAway(() => findSignatureByViewToken(getDb(), hashTokenSecret(token), event.id, key), undefined) : undefined;
  const signed = signedStateFor(mine, declaration.id);
  if (!open && signed?.kind !== "current") return null;
  // «For the whole series» only when both hold: the text names {{series}} AND the run has another
  // date; a one-off run's signature covers its one date whatever the text (§NNN).
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
        // Signed, the version in force (§NNN): what and when, and no button — there is nothing to sign.
        <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-signed">
          {t(mine?.series ? "groupRunDeclaration.signedSeries" : "groupRunDeclaration.signedOne", { version: signed.version, when })}
        </Typography>
      ) : signed?.kind === "renew" ? (
        // Signed an older version (§NNN): the club approved a new one, which is asked for again.
        <Typography variant="body2" sx={{ mb: 1 }} data-testid="group-run-declaration-renew">
          {t("groupRunDeclaration.signedOlder", { version: signed.version, when })}
        </Typography>
      ) : (
        // Once for the whole run (§NNN): a returning runner reads here that they need not sign again —
        // only while the text in force says so (`signatureCoversSeries`) and the run has another date;
        // otherwise a signature covers its own date, and the line says this run.
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
