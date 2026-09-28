import ArticleIcon from "@mui/icons-material/Article";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import GroupsIcon from "@mui/icons-material/Groups";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import MailOutlinedIcon from "@mui/icons-material/MailOutlined";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { ReactNode } from "react";
import SubNav from "@/shared/ui/SubNav";
import { PAGES_ROW_ROUTE, type PagesRowEntry } from "../pages-row";

/**
 * The parts of the Pagini tab (§459, §525, §524), in two groups on one row:
 *
 * - **«Pagini standard»** — the pages the platform draws and the club fills: «Contact»
 *   (`/admin/pages/contact`: who reads «Scrie-ne» and the address the site shows, §442 — it was
 *   «Setări» → «Contact» (§516) and pressing it switched the main bar to «Setări», so the row was
 *   gone; the owner, 2026-09-28: «ar trebui să rămân în același loc»), «Echipa» (the owner: "pagina
 *   de echipa nu e o pagina custom"), «Întrebări frecvente» (§525), «Membri» — the two members'
 *   texts, «Beneficiile membrilor» and «Zona membrilor», as two cards of one page,
 *   `/admin/pages/members`. One entry for one page: two entries for two hashes of it could never
 *   both say which one is shown (review, §524).
 * - **«Pagini personalizate»** — the pages the club writes from nothing.
 *
 * A glyph per entry and a caption per group (`SubNavItem.glyph`, `.group`). «Aspect» (§488) was a
 * tab here; it is a setting, so it moved to «Setări» (§516), and `/admin/pages/appearance` answers
 * 308 to its new address.
 *
 * Every entry is under `/admin/pages` (`PAGES_ROW_ROUTE`), so the main bar keeps «Pagini» lit on
 * each, and every page that renders this has already asked `canReadContent`, the gate of each
 * entry's page, so no entry here leads to a refusal. `active` is the entry the page's own address
 * names (`pagesRowEntryOf`); a unit test holds each page to it.
 *
 * The shared `SubNav` (§360), hrefs resolved here on the server because `SubNav` takes strings.
 */
export default async function PagesSubNav({ locale, active }: { locale: Locale; active: PagesRowEntry }) {
  const t = await getTranslations("Admin");
  const standard = t("pages.groupStandard");
  const custom = t("pages.groupCustom");
  const entry = (key: PagesRowEntry, label: string, group: string, glyph: ReactNode) => ({
    href: getPathname({ locale, href: PAGES_ROW_ROUTE[key] }),
    label,
    active: active === key,
    group,
    glyph,
  });

  return (
    <SubNav
      label={t("pages.title")}
      items={[
        entry("contact", t("pages.tabContact"), standard, <MailOutlinedIcon />),
        entry("team", t("pages.tabTeam"), standard, <GroupsIcon />),
        entry("faq", t("pages.tabFaq"), standard, <HelpOutlineIcon />),
        entry("members", t("pages.tabMembers"), standard, <CardMembershipIcon />),
        entry("pages", t("pages.tabPages"), custom, <ArticleIcon />),
      ]}
    />
  );
}
