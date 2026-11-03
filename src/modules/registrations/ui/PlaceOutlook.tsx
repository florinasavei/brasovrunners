import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ComponentProps } from "react";
import { countForm } from "@/i18n/count-form";
import { HELD_KINDS, type PlaceOutlook as Outlook } from "../domain/place-outlook";
import PublicNowLine from "./PublicNowLine";

/**
 * «Locuri» under the registrations list's counts, for one event with a capacity (the owner, 2026-11-03:
 * «nu să mă uit eu de fiecare dată»). The answer first — the places free now — then why: who takes the
 * places (confirmed, or holding one until they sign, by what holds it: a declaration to sign, an offer, an
 * invitation, a family's reservation — §NNN), who waits, where the free places go, what letting everybody in
 * would take, and the people at the start. The owner, the same day, of the first wording: «nu înțeleg exact
 * câte locuri mai pot să dau». `domain/place-outlook.ts` does the arithmetic; this only says it.
 *
 * Last, «Pe site acum» (§NNN, `PublicNowLine`): what the public meets this minute, from the public card's own
 * predicate, and the tick «Înscrieri publice deschise» beside it. Absent when the page read no door.
 */
export default async function PlaceOutlook({
  outlook,
  locale,
  spaceAbove = 0,
  door,
}: {
  outlook: Outlook;
  /** The page's language, for the counted words («1 ofertă», «2 oferte», «20 de oferte»). */
  locale: string;
  spaceAbove?: number;
  door?: ComponentProps<typeof PublicNowLine>;
}) {
  const t = await getTranslations("Admin");
  const waitingSomewhere = outlook.waiting + outlook.internal > 0;
  // «9 declarații, 2 oferte, 2 invitații»: each kind that holds a place, counted; a kind at 0 is not said.
  const heldKinds = HELD_KINDS.filter((kind) => outlook[kind] > 0)
    .map((kind) => t(`registrations.places.heldKinds.${kind}.${countForm(outlook[kind], locale)}`, { count: outlook[kind] }))
    .join(", ");
  return (
    <Box data-testid="registrations-places" sx={{ mt: spaceAbove }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t("registrations.places.title", { free: outlook.free, capacity: outlook.capacity })}
      </Typography>
      <Typography variant="body2" color="text.secondary" data-testid="registrations-places-taken">
        {outlook.held > 0
          ? t("registrations.places.taken", {
              occupied: outlook.occupied,
              confirmed: outlook.confirmed,
              held: t(`registrations.places.held.${countForm(outlook.held, locale)}`, { count: outlook.held }),
              kinds: heldKinds,
            })
          : t("registrations.places.takenConfirmed", { occupied: outlook.occupied })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {waitingSomewhere
          ? t("registrations.places.waiting", { count: outlook.waiting + outlook.internal, waiting: outlook.waiting, internal: outlook.internal })
          : t("registrations.places.nobodyWaits")}
      </Typography>
      {outlook.free > 0 && waitingSomewhere && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-places-let-in">
          {t("registrations.places.letIn")}
        </Typography>
      )}
      {outlook.raises > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-places-raises">
          {t("registrations.places.raises", {
            count: outlook.raises,
            // A capacity lowered under the places taken is raised from the places taken.
            capacity: Math.max(outlook.capacity, outlook.occupied) + outlook.raises,
          })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" data-testid="registrations-places-total">
        {t("registrations.places.total", { outside: outlook.outside, count: outlook.totalIfAll })}
      </Typography>
      {door && <PublicNowLine {...door} spaceAbove={1} />}
    </Box>
  );
}
