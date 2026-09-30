import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { saveMenuOrderAction } from "@/app/[locale]/admin/pages/actions";
import type { Locale } from "@/i18n/routing";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import { menuSectionsOnSite } from "../on-site";
import { isMenuSectionKey, type MenuKey, pageIdOfMenuKey } from "../order";
import MenuOrderList, { type MenuOrderEntry } from "./MenuOrderList";

type Props = {
  locale: Locale;
  /** Every entry, in the club's order (`resolveMenuOrder`): the sections and every custom page. */
  order: readonly MenuKey[];
  /** The custom pages the order names, with the title in this language and their state. */
  pages: ReadonlyArray<{ id: string; title: string | null; editorialStatus: string }>;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/** How many names the closed fold's line shows before «…». */
const ASIDE_NAMES = 4;

/**
 * «Ordinea meniului» (§571) on «Pagini» → «Paginile clubului»: every entry the site menu can carry
 * — «Evenimente», «Calendar», «Contact», «Galerie», «Echipa», «Întrebări frecvente» and the club's
 * own pages (the members' zone is the footer's since §NNN) — in one list, the order the header and the footer draw. An entry the menu
 * leaves out today (a draft, a page with nothing on it yet) keeps its place, greyed, «nu apare
 * încă»: asked by the header's own questions (`menuSectionsOnSite`), so the card never disagrees
 * with the site. A fold, closed, its line the first names in the order; «Salvează ordinea» behind
 * the §384 question.
 */
export default async function MenuOrderPanel({ locale, order, pages, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const sections = await menuSectionsOnSite(locale);
  const byId = new Map(pages.map((page) => [page.id, page]));

  const entries: MenuOrderEntry[] = order.flatMap((key): MenuOrderEntry[] => {
    if (isMenuSectionKey(key)) {
      const name = t(`menuOrder.entries.${key}`);
      return [{ key, name, appears: sections[key], custom: false, upLabel: t("menuOrder.upNamed", { name }), downLabel: t("menuOrder.downNamed", { name }) }];
    }
    const page = byId.get(pageIdOfMenuKey(key) ?? "");
    if (!page) return [];
    const name = page.title ?? t("pages.untitled");
    return [
      {
        key,
        name,
        appears: page.editorialStatus === "PUBLISHED",
        custom: true,
        upLabel: t("menuOrder.upNamed", { name }),
        downLabel: t("menuOrder.downNamed", { name }),
      },
    ];
  });
  const shown = entries.filter((entry) => entry.appears).map((entry) => entry.name);
  const aside = shown.slice(0, ASIDE_NAMES).join(" · ") + (shown.length > ASIDE_NAMES ? " · …" : "");

  const labels = {
    listLabel: t("menuOrder.listLabel"),
    up: t("menuOrder.up"),
    down: t("menuOrder.down"),
    notYet: t("menuOrder.notYet"),
    custom: t("menuOrder.custom"),
    movedTo: t.raw("menuOrder.movedTo") as string,
    unsaved: t("menuOrder.unsaved"),
  };

  return (
    <Panel
      glyph="menuOrder"
      title={t("menuOrder.title")}
      intro={t("menuOrder.intro")}
      introMore={t("menuOrder.introMore")}
      aside={aside}
      collapsible
      openWhen={openWhen}
      id="menu-order"
      data-testid="menu-order"
    >
      {!mayEdit ? (
        <>
          <MenuOrderList entries={entries} labels={labels} mayEdit={false} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t("menuOrder.readOnly")}
          </Typography>
        </>
      ) : (
        <ActionForm
          action={saveMenuOrderAction}
          messages={await refusalMessages({ order: t("menuOrder.listLabel") })}
          confirm={{
            title: t("confirm.menuOrderTitle"),
            body: t("confirm.menuOrderBody"),
            confirmLabel: t("menuOrder.save"),
            cancelLabel: words.cancel,
          }}
          scope="menuOrder"
          data-testid="menu-order-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <MenuOrderList entries={entries} labels={labels} mayEdit />
          <Box sx={{ mt: 1.5 }}>
            <GlyphSubmitButton label={t("menuOrder.save")} pendingLabel={t("menuOrder.saving")} icon="save" />
          </Box>
        </ActionForm>
      )}
    </Panel>
  );
}
