import type { StaffRole } from "./roles";

/**
 * The guide's own section, as the catalogue holds it (`Admin.guide.sections`) — just enough of
 * its shape for the ordering below, so this module needs no import from the page or the
 * catalogue's own (larger) type.
 */
export type GuideSectionLike = { roles: StaffRole[] };

/**
 * The reader's own sections first, then the rest — the owner's "a how-to page depending on each
 * role" (`src/app/[locale]/admin/guide/page.tsx`). A stable partition, not a sort: within each
 * half, sections keep the catalogue's own order.
 *
 * Pure and framework-free so the partition itself — not just its rendering — has a test, for
 * every `StaffRole` including `ADMIN` (BR-REQ-060-01 criterion 34).
 */
export function orderGuideSections<T extends GuideSectionLike>(sections: readonly T[], role: StaffRole): T[] {
  const mine = sections.filter((section) => section.roles.includes(role));
  const others = sections.filter((section) => !section.roles.includes(role));
  return [...mine, ...others];
}
