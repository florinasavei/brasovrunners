import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { PlaceOutlook as Outlook } from "../domain/place-outlook";

/**
 * «Locuri» under the registrations list's counts, for one event with a capacity (the owner, 2026-11-03:
 * «nu să mă uit eu de fiecare dată»): the places taken and free, the two lists, how many can be let in
 * with no place added and with how many added, and the total if everybody came. `domain/place-outlook.ts`
 * does the arithmetic; this only says it.
 */
export default async function PlaceOutlook({ outlook, spaceAbove = 0 }: { outlook: Outlook; spaceAbove?: number }) {
  const t = await getTranslations("Admin");
  const waitingSomewhere = outlook.waiting + outlook.internal > 0;
  return (
    <Box data-testid="registrations-places" sx={{ mt: spaceAbove }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t("registrations.places.title", { occupied: outlook.occupied, capacity: outlook.capacity, free: outlook.free })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("registrations.places.lists", { waiting: outlook.waiting, internal: outlook.internal, outside: outlook.outside })}
      </Typography>
      {outlook.free > 0 && waitingSomewhere && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-places-let-in">
          {t("registrations.places.letIn", {
            count: outlook.fromWaiting + outlook.fromInternal,
            fromWaiting: outlook.fromWaiting,
            fromInternal: outlook.fromInternal,
          })}
        </Typography>
      )}
      {outlook.free > 0 && !waitingSomewhere && (
        <Typography variant="body2" color="text.secondary">
          {t("registrations.places.nobodyWaits")}
        </Typography>
      )}
      {outlook.raises > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-places-raises">
          {t(outlook.free > 0 ? "registrations.places.raisesRest" : "registrations.places.raisesAll", {
            count: outlook.raises,
            // A capacity lowered under the places taken is raised from the places taken.
            capacity: Math.max(outlook.capacity, outlook.occupied) + outlook.raises,
          })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" data-testid="registrations-places-total">
        {t("registrations.places.total", { count: outlook.totalIfAll })}
      </Typography>
    </Box>
  );
}
