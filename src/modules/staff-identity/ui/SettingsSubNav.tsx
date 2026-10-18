import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { PANEL_GLYPHS, type PanelGlyphName } from "@/shared/ui/panel-glyphs";
import SubNav, { type SubNavItem } from "@/shared/ui/SubNav";
import type { StaffRole } from "../domain/roles";
import {
  CONFIGURATION_TAB,
  offersConfigurationTab,
  SETTINGS_TAB_ROUTE,
  type SettingsRowEntry,
  visibleSettingsTabs,
} from "../domain/settings-tabs";

/**
 * The picture before each tab's words (§318 as amended 2026-09-27: a glyph before every tab, fold
 * and button; the owner, 2026-10-18: «vreau și la subtaburi să am iconițe»), by the name the cards'
 * table knows it by (`shared/ui/panel-glyphs.ts`, §521): a tab and the card it opens share their
 * picture where the subject is the same — the mail, the timer of «Termene», the palette of
 * «Aspect», the coin of «Costuri» — and the anti-robot check and the platform's configuration have
 * theirs, a shield and a gear. Written as objects (`glyph: "…"`) so the table's own test finds every
 * name drawn. The backoffice asks a registry by name, never an icon file (§694).
 */
const TAB_GLYPH = {
  emails: { glyph: "email" },
  deadlines: { glyph: "deadlines" },
  appearance: { glyph: "appearance" },
  costs: { glyph: "costs" },
  platform: { glyph: "antiBot" },
  configuration: { glyph: "configuration" },
} as const satisfies Record<SettingsRowEntry, { glyph: PanelGlyphName }>;

/**
 * The element for one tab: drawn here, on the server, into `SubNav`, a Server Component end to end
 * (as «Pagini»' row does, §524) — never handed to a client island, where an element prop breaks
 * hydration (`action-icons.ts`).
 */
function tabGlyph(entry: SettingsRowEntry) {
  const Glyph = PANEL_GLYPHS[TAB_GLYPH[entry].glyph];
  return <Glyph />;
}

/**
 * «Setări»'s one row of secondary tabs (§360, §516): «Emailuri», «Termene», «Aspect», «Costuri»,
 * «Anti-robot», and «Configurație» (`/devs`) last — each role offered the tabs its gates
 * open (`visibleSettingsTabs`, `offersConfigurationTab`), the current one marked with
 * `aria-current`. Every tab page renders this first and nothing above it, `/devs` included: the row
 * is the way between them, and the main bar's «Setări» is the way back — no tab carries an
 * «← Înapoi la …» of its own.
 *
 * **One row, never two (§360, §520).** `/devs` has three panels of its own (§265); it hands them in as
 * `configurationPanels`, and they take «Configurație»'s place in this row — «Configurație» (the
 * status), «Configurație · General», «Configurație · Emailuri» — rather than drawing a second row of
 * tabs under this one.
 *
 * A Server Component of anchors, like every `SubNav`: the hrefs are resolved here, because
 * `getPathname` is a server function and `SubNav` takes strings.
 */
export default async function SettingsSubNav({
  locale,
  role,
  active,
  configurationPanels,
}: {
  locale: Locale;
  role: StaffRole;
  active: SettingsRowEntry;
  /** `/devs`'s own panels, drawn in place of the single «Configurație» entry (§520). */
  configurationPanels?: readonly SubNavItem[];
}) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("nav.settings")}
      items={[
        ...visibleSettingsTabs(role).map((tab) => ({
          href: getPathname({ locale, href: SETTINGS_TAB_ROUTE[tab] }),
          label: t(`settingsTabs.${tab}`),
          active: tab === active,
          glyph: tabGlyph(tab),
        })),
        ...(!offersConfigurationTab(role)
          ? []
          : configurationPanels && configurationPanels.length > 0
            ? configurationPanels.map((panel) => ({ ...panel, glyph: panel.glyph ?? tabGlyph(CONFIGURATION_TAB) }))
            : [
                {
                  href: getPathname({ locale, href: "/devs" }),
                  label: t("settingsTabs.configuration"),
                  active: active === CONFIGURATION_TAB,
                  glyph: tabGlyph(CONFIGURATION_TAB),
                },
              ]),
      ]}
    />
  );
}
