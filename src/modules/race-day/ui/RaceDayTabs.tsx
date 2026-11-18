import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { getPathname } from "@/i18n/navigation";
import { canEnterResults, canWorkTheDesk, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import { PANEL_GLYPHS, type PanelGlyphName } from "@/shared/ui/panel-glyphs";
import SubNav, { type SubNavItem } from "@/shared/ui/SubNav";

/** The three parts of «Ziua cursei». */
export type RaceDayTab = "desk" | "results" | "items";

/**
 * Each tab's picture, by its name in the subjects' table (§521): the desk's own cup, the results' board, a checklist.
 * Looked up here, on the server; only the drawn `<svg>` reaches the browser.
 */
const TAB_GLYPH = {
  desk: { glyph: "raceDay" },
  results: { glyph: "results" },
  items: { glyph: "todo" },
} as const satisfies Record<RaceDayTab, { glyph: PanelGlyphName }>;

/**
 * «Ziua cursei»'s three tabs (§979; the owner, 2026-11-18: «Pentru "Ziua Cursei" vreau un tab pentru "Clasament", ce am acum
 * pe aceasta pagina e de fapt "Prezenta"», and «un alt tab pentru ziua cursei unde sa bifam "lucruri de adus"»): «Prezența» —
 * the desk as it was —, «Clasament» — the chosen event's results (§808) — and «Lucruri de adus», the event's checklist.
 *
 * The house's row of sub-tabs (`SubNav`, §360), `fits` — three short words a phone holds, «Lucruri» alone below `sm` — so no
 * script: plain links drawn on the server, the current one marked (`aria-current`), never on paper. Each carries the event
 * chosen on the page (the desk's select; on a results page, the page's own event); with none chosen the desk and the list
 * pick their default as the desk does, and «Clasament», which has no page without an event, is not drawn. A tab whose page
 * the viewer's role cannot open is not drawn either — «Clasament» is `canEnterResults`' — and every page still asserts its
 * own gate on the server (BR-REQ-060-01).
 *
 * A function the page awaits, not an async component: the element it returns is drawn in the page's own tree, which every
 * screen test renders synchronously.
 */
export async function raceDayTabs({ locale, active, eventId, actor }: { locale: string; active: RaceDayTab; eventId?: string; actor: StaffSubject }): Promise<ReactElement> {
  const t = await getTranslations("Admin");
  const withEvent = (path: string) => (eventId ? `${path}?eventId=${encodeURIComponent(eventId)}` : path);
  const glyph = (tab: RaceDayTab) => {
    const Glyph = PANEL_GLYPHS[TAB_GLYPH[tab].glyph];
    return <Glyph />;
  };
  const items: SubNavItem[] = [];
  if (canWorkTheDesk(actor)) {
    items.push({ href: withEvent(getPathname({ locale, href: "/admin/checkin" })), label: t("raceDay.tabs.desk"), active: active === "desk", glyph: glyph("desk") });
  }
  if (eventId && canEnterResults(actor)) {
    items.push({
      href: getPathname({ locale, href: { pathname: "/admin/events/[id]/results", params: { id: eventId } } }),
      label: t("raceDay.tabs.results"),
      active: active === "results",
      glyph: glyph("results"),
    });
  }
  if (canWorkTheDesk(actor)) {
    items.push({
      href: withEvent(getPathname({ locale, href: "/admin/checkin/lucruri" })),
      label: t("raceDay.tabs.items"),
      short: t("raceDay.tabs.itemsShort"),
      active: active === "items",
      glyph: glyph("items"),
    });
  }
  return (
    <Box sx={{ "@media print": { display: "none" } }} data-testid="race-day-tabs">
      <SubNav fits label={t("raceDay.tabs.label")} items={items} />
    </Box>
  );
}
