import { getTranslations } from "next-intl/server";
import { PANEL_GLYPHS, type PanelGlyphName } from "@/shared/ui/panel-glyphs";
import SubNav from "@/shared/ui/SubNav";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { type TaskPanel, visibleTaskPanels } from "../domain/task-panels";

/**
 * The picture before each tab of «Sarcini» (§318 as amended 2026-09-27: a glyph before every tab,
 * fold and button; the owner, 2026-10-18: «vreau și la subtaburi să am iconițe»), by the name the
 * cards' table knows it by (`shared/ui/panel-glyphs.ts`, §521): «Club» the checklist read from the
 * system, «De făcut» the club's own lines to tick, «Sistem» the gear of «Configurație» (it leads to
 * `/devs`), «Aplicația» the wrench of the app's own work queue. Written as objects (`glyph: "…"`) so
 * the table's own test finds every name drawn. The backoffice asks a registry by name, never an
 * icon file (§694).
 */
const TAB_GLYPH = {
  club: { glyph: "todo" },
  todo: { glyph: "todoOwn" },
  system: { glyph: "configuration" },
  app: { glyph: "app" },
} as const satisfies Record<TaskPanel | "system", { glyph: PanelGlyphName }>;

/**
 * The element for one tab: drawn here, on the server, into `SubNav`, a Server Component end to end
 * (as «Setări»' row does) — never handed to a client island, where an element prop breaks
 * hydration (`action-icons.ts`).
 */
function tabGlyph(tab: TaskPanel | "system") {
  const Glyph = PANEL_GLYPHS[TAB_GLYPH[tab].glyph];
  return <Glyph />;
}

/**
 * «Sarcini»' one row of tabs (§265, §360, §397), the same on every one of the page's panels: «Club»,
 * «De făcut» (with its open count once there is one), «Sistem» — the link to `/devs`, before
 * «Aplicația» — and «Aplicația», each role offered the panels its gates open (`visibleTaskPanels`).
 * The page builds the hrefs, because a panel is a query parameter on a path it resolves
 * (`getPathname`); this draws the row, so the three places the page shows it share one builder.
 */
export default async function TasksSubNav({
  role,
  active,
  openTodo,
  panelHref,
  devsPath,
}: {
  role: StaffRole;
  active: TaskPanel;
  /** How many of the club's own lines are still open: the number in «De făcut ({count})». */
  openTodo: number;
  /** Where each panel lives, resolved by the page. */
  panelHref: Record<TaskPanel, string>;
  /** `/devs`, resolved by the page. */
  devsPath: string;
}) {
  const t = await getTranslations("Admin.tasks");

  return (
    <SubNav
      label={t("title")}
      items={visibleTaskPanels(role).flatMap((name) => [
        ...(name === "app" ? [{ href: devsPath, label: t("panel.system"), glyph: tabGlyph("system") }] : []),
        {
          href: panelHref[name],
          label: name === "todo" && openTodo > 0 ? t("panel.todoCount", { count: openTodo }) : t(`panel.${name}`),
          active: active === name,
          glyph: tabGlyph(name),
        },
      ])}
    />
  );
}
