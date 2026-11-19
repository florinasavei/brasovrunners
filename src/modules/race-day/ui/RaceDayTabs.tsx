import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { canEnterResults, canRecordFinishes, canWorkTheDesk, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import { canTakeRaffleList } from "@/modules/volunteers/raffle-list";
import { raffleTabShown } from "@/modules/volunteers/raffle-roster";
import { PANEL_GLYPHS, type PanelGlyphName } from "@/shared/ui/panel-glyphs";
import SubNav, { type SubNavItem } from "@/shared/ui/SubNav";

/** The five parts of «Ziua cursei». */
export type RaceDayTab = "desk" | "results" | "timing" | "raffle" | "items";

/**
 * Each tab's picture, by its name in the subjects' table (§521): the desk's own cup, the results' board, the stopwatch, a
 * wrapped prize, a checklist. Looked up here, on the server; only the drawn `<svg>` reaches the browser.
 */
const TAB_GLYPH = {
  desk: { glyph: "raceDay" },
  results: { glyph: "results" },
  timing: { glyph: "timing" },
  raffle: { glyph: "raffle" },
  items: { glyph: "todo" },
} as const satisfies Record<RaceDayTab, { glyph: PanelGlyphName }>;

/**
 * «Ziua cursei»'s five tabs (§979; the owner, 2026-11-18: «Pentru "Ziua Cursei" vreau un tab pentru "Clasament", ce am acum
 * pe aceasta pagina e de fapt "Prezenta"», and «un alt tab pentru ziua cursei unde sa bifam "lucruri de adus"»; and, the same
 * day, §NNN: «pentru ziua cursei am nevoie de o pagina noua pentru cronometrare», and §NNN: «un tab de tombolă unde să văd toți
 * participanții la tombolă»): «Prezența» — the desk as it was —, «Clasament» — the chosen event's results (§808) —,
 * «Cronometrare» — the finish line, a number or an elite pressed as the runner crosses —, «Tombolă» — the organizers' raffle,
 * everybody of the three groups — and «Lucruri de adus», the event's checklist.
 *
 * The house's row of sub-tabs (`SubNav`, §360): plain links drawn on the server, the current one marked (`aria-current`), never
 * on paper. Each carries the event chosen on the page (the desk's select; on a results page, the page's own event); with none
 * chosen the desk, the finish line and the list pick their default as the desk does, and «Clasament», which has no page without
 * an event, and «Tombolă», which asks the chosen event whether it holds a raffle, are not drawn. A tab whose page the viewer's
 * role cannot open is not drawn either — «Clasament» is `canEnterResults`', «Cronometrare» `canRecordFinishes`', «Tombolă»
 * `canTakeRaffleList`' and only for an event that holds a raffle (one read of the event's own switch) — and every page still
 * asserts its own gate on the server (BR-REQ-060-01).
 *
 * **Five entries are wider than a phone** (about 360 pixels on their short words alone, in a 288-pixel row), so the row is not
 * `fits`: it carries `SubNavCurrent` (§731), which scrolls the current entry into view — «Lucruri de adus», the last, included —,
 * every entry is one sideways swipe away, the entry cut at the edge says there is more, and the row scrolls inside itself, never
 * the page. `compact`: below `sm` the row draws no glyphs and the short words «Sosiri» and «Lucruri», so a role's row of three —
 * the desk's volunteers: «Prezența», «Sosiri», «Lucruri» — fits a 320-pixel phone whole and the organizers' five scroll by
 * little. A row that fits is left alone by the scroller.
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
  if (canRecordFinishes(actor)) {
    items.push({
      href: withEvent(getPathname({ locale, href: "/admin/checkin/cronometrare" })),
      label: t("raceDay.tabs.timing"),
      short: t("raceDay.tabs.timingShort"),
      active: active === "timing",
      glyph: glyph("timing"),
    });
  }
  // «Tombolă» (§NNN): the organizers' tab (`canTakeRaffleList`), for an event that holds a raffle; the page asserts the role again.
  if (eventId && canTakeRaffleList(actor) && (await raffleTabShown(getDb(), eventId))) {
    items.push({ href: withEvent(getPathname({ locale, href: "/admin/checkin/tombola" })), label: t("raceDay.tabs.raffle"), active: active === "raffle", glyph: glyph("raffle") });
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
      {/* Not `fits` (§NNN): the organizers' five entries are wider than a phone, so the current one is scrolled into view. */}
      <SubNav compact label={t("raceDay.tabs.label")} items={items} />
    </Box>
  );
}
