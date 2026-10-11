import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { UNDER_LOOK } from "@/theme/look";

/**
 * The calendar's «Filtre» slot (§575, amending §413): the panel is always rendered, and a month with
 * nothing to narrow and nothing ticked keeps its box, unseen, rather than dropping it.
 *
 * §413 let the calendar leave its panel out when the period on view offers no box — the listing's
 * rule. But the calendar's month changes under the reader's thumb: a month of one event (nothing to
 * choose between) followed by one with a race and a run (something to choose) put a 44-pixel button
 * above the arrows the reader had just pressed, and every control under it moved — 44 px on a phone,
 * 60 on a desktop, measured on 2026-09-30 by `event-pages.spec.ts`, the day September's last event
 * was behind it. BR-REQ-041-01 criterion 12 says the calendar's controls do not move when the month
 * changes, so the slot's height may not depend on the month.
 *
 * Held, the panel is `visibility: hidden`: the same box to the pixel at every width, because it is
 * the same markup, and out of the accessibility tree, the tab order and the pointer — a button that
 * would open onto no boxes is not offered, as §413 wants. `children` is the panel itself, a Server
 * Component rendered here, on the server, like the rest of the page.
 *
 * **Under «Aspectul nou»** (the facelift's phase 4) the surface moves to the chips above the grid,
 * so the panel may have nothing left to offer there while it has today: `shownUnderLook` says
 * whether it does, and the look's rule holds or shows the same box by it. Unset, it is `shown`.
 */
export default function CalendarFilterSlot({ shown, shownUnderLook = shown, children }: { shown: boolean; shownUnderLook?: boolean; children?: ReactNode }) {
  // Under the look the chips row sits right above it, so a phone gives the slot's gap back to the first week (§569).
  const look = { [UNDER_LOOK]: { mb: { xs: 0, sm: 1 }, ...(shownUnderLook === shown ? {} : { visibility: shownUnderLook ? "visible" : "hidden" }) } };
  return (
    <Box
      data-testid="calendar-filter-slot"
      data-held={shown ? undefined : "true"}
      data-held-under-look={shownUnderLook ? undefined : "true"}
      sx={{ mb: 1, ...(shown ? {} : { visibility: "hidden" }), ...look }}
    >
      {children}
    </Box>
  );
}
