import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import type { KitCount as Kits } from "../admin-repository";
import { SHIRT_SIZES } from "../domain/kit";

/** The counted phrases of the kits, each in one, few and other (`count-form.ts`): «1 alergător», «2 alergători», «20 de alergători». */
type Counted = "runners" | "volunteers" | "holding" | "invitations" | "elites";

/**
 * «Kituri de pregătit» under the registrations list's counts, for one event (the owner, 2026-10-29), said as the runners plus
 * the volunteers (the owner, 2026-11-04, of «Kituri de pregătit: 178»: «Cu tot cu Ingrid și cu Silviu Stoica? Aș vrea să mă
 * asigur că număr și elitele»):
 *
 * - the title says the total and its split — «Kituri de pregătit: 188 = 179 de alergători + 9 voluntari» — or, with no
 *   volunteer ticked «Are kit», the runners alone: «Kituri de pregătit: 179 de alergători»;
 * - the line under it says what the runners are: everyone holding a place now (the special guests among them), the open
 *   invitations and, when there is any, the event's separate elite list (§895: names, not registrations — no place, but at
 *   the start with a kit), a link to the editor's elite card. A registered runner marked «Elită» is a registration already
 *   and is never counted twice; the waiting list is not in it;
 * - when the event gives a T-shirt («Kit de participare»), how many of each size, the invited counted as a size not known yet.
 *
 * `volunteers` is the event's volunteers ticked «Are kit», the cancelled left out (§904's figure); `elites` how many lines the
 * elite list holds (`elite-list.ts#listEliteEntries`, which the page reads for its «Elite» fold too). `countKits` and every
 * export stay as they were: the sum is said here alone.
 */
export default async function KitCount({
  kits,
  locale,
  volunteers = 0,
  elites = 0,
  eliteHref,
  spaceAbove = 0,
}: {
  kits: Kits;
  /** The page's language, for the counted words. */
  locale: string;
  volunteers?: number;
  elites?: number;
  /** The editor's elite card (`/admin/events/[id]#bib-elite`, which opens the fold): the elites' words link there. */
  eliteHref?: string;
  spaceAbove?: number;
}) {
  const t = await getTranslations("Admin");
  const counted = (key: Counted, count: number) => t(`registrations.kits.${key}.${countForm(count, locale)}`, { count });
  const runners = kits.registrations + kits.invitations + elites;
  const who = { holding: counted("holding", kits.registrations), invitations: counted("invitations", kits.invitations) };
  // A plain anchor from the server, so the editor's fold opens from `#bib-elite` (`OpenFoldFromHash`).
  const eliteLink = (chunks: ReactNode) =>
    eliteHref ? (
      <Box component="a" href={eliteHref} sx={{ color: "primary.main" }} data-testid="registrations-kits-elites">
        {chunks}
      </Box>
    ) : (
      chunks
    );
  const shirts = [
    ...SHIRT_SIZES.filter((size) => kits.bySize[size]).map((size) => `${size}: ${kits.bySize[size]}`),
    kits.bySize.NONE ? t("registrations.kits.noShirt", { count: kits.bySize.NONE }) : null,
    kits.invitations ? t("registrations.kits.unknownSize", { count: kits.invitations }) : null,
  ].filter(Boolean);
  return (
    <Box data-testid="registrations-kits" sx={{ mt: spaceAbove }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }} data-testid="registrations-kits-title">
        {volunteers > 0
          ? t("registrations.kits.titleWithVolunteers", { count: runners + volunteers, runners: counted("runners", runners), volunteers: counted("volunteers", volunteers) })
          : t("registrations.kits.title", { runners: counted("runners", runners) })}
      </Typography>
      <Typography variant="body2" color="text.secondary" data-testid="registrations-kits-runners">
        {elites > 0 ? t.rich("registrations.kits.whoWithElites", { ...who, elites: counted("elites", elites), link: eliteLink }) : t("registrations.kits.who", who)}
      </Typography>
      {kits.kitShirt && shirts.length > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-kits-shirts">
          {t("registrations.kits.shirts", { sizes: shirts.join(" · ") })}
        </Typography>
      )}
    </Box>
  );
}
