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
 * The Pagini tab's row (§459, §524, §525), in two groups: «Pagini standard» (Contact, Echipa,
 * Întrebări frecvente, Membri — the members' two texts as one page, §524) and «Pagini
 * personalizate». Every entry is under `/admin/pages` (`PAGES_ROW_ROUTE`) and gated by
 * `canReadContent`, like its page; `active` comes from `pagesRowEntryOf` (unit-tested). Hrefs are
 * resolved on the server because `SubNav` (§360) takes strings.
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
