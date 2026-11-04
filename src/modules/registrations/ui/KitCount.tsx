import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { KitCount as Kits } from "../admin-repository";
import { SHIRT_SIZES } from "../domain/kit";

/**
 * «Kituri de pregătit» under the registrations list's counts, for one event (the owner, 2026-10-29):
 * everyone holding a place now plus the open invitations, and — when the event gives a T-shirt
 * («Kit de participare») — how many of each size, the invited counted as a size not known yet.
 *
 * `volunteers` is the event's volunteers the organizers ticked «Are kit» on (§904), the cancelled left out:
 * one more line, «Plus voluntari cu kit: N», said only when there is any. It is never added to the title's
 * figure, which stays the registrations' and the invitations' (`countKits`, and every export, unchanged).
 *
 * `elites` is the event's separate elite list (§895): names, not registrations, so in no count — but each
 * runs and takes a kit (the owner, 2026-11-04: «aș vrea să mă asigur că număr și elitele»). One more line,
 * «Plus elite din lista separată: N»; a registered runner marked «Elită» is already in the title's figure.
 * Once either line is drawn, «Total de pregătit» adds the three, so the number to order is said once.
 */
export default async function KitCount({ kits, volunteers = 0, elites = 0, spaceAbove = 0 }: { kits: Kits; volunteers?: number; elites?: number; spaceAbove?: number }) {
  const t = await getTranslations("Admin");
  const shirts = [
    ...SHIRT_SIZES.filter((size) => kits.bySize[size]).map((size) => `${size}: ${kits.bySize[size]}`),
    kits.bySize.NONE ? t("registrations.kits.noShirt", { count: kits.bySize.NONE }) : null,
    kits.invitations ? t("registrations.kits.unknownSize", { count: kits.invitations }) : null,
  ].filter(Boolean);
  return (
    <Box data-testid="registrations-kits" sx={{ mt: spaceAbove }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t("registrations.kits.title", { count: kits.registrations + kits.invitations })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("registrations.kits.who", { registrations: kits.registrations, invitations: kits.invitations })}
      </Typography>
      {kits.kitShirt && shirts.length > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-kits-shirts">
          {t("registrations.kits.shirts", { sizes: shirts.join(" · ") })}
        </Typography>
      )}
      {elites > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-kits-elites">
          {t("registrations.kits.elites", { count: elites })}
        </Typography>
      )}
      {volunteers > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-kits-volunteers">
          {t("registrations.kits.volunteers", { count: volunteers })}
        </Typography>
      )}
      {(elites > 0 || volunteers > 0) && (
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="registrations-kits-total">
          {t("registrations.kits.total", { count: kits.registrations + kits.invitations + elites + volunteers })}
        </Typography>
      )}
    </Box>
  );
}
