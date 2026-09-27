import ArticleIcon from "@mui/icons-material/Article";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import GroupsIcon from "@mui/icons-material/Groups";
import MailOutlinedIcon from "@mui/icons-material/MailOutlined";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/**
 * The parts of the Pagini tab (§459, §NNN), in two groups on one row:
 *
 * - **«Pagini standard»** — the pages the platform draws and the club fills: «Contact» (its
 *   settings live under «Setări», §516, and are one press from here), «Echipa» (the owner: "pagina
 *   de echipa nu e o pagina custom"), «Membri» — the two members' texts, «Beneficiile membrilor» and
 *   «Zona membrilor», as two cards of one page, `/admin/pages/members`. One entry for one page: two
 *   entries for two hashes of it could never both say which one is shown (review, §NNN).
 * - **«Pagini personalizate»** — the pages the club writes from nothing.
 *
 * A glyph per entry and a caption per group (`SubNavItem.glyph`, `.group`). «Aspect» (§488) was a
 * tab here; it is a setting, so it moved to «Setări» (§516), and `/admin/pages/appearance` answers
 * 308 to its new address.
 *
 * Every page that renders this has already asked `canReadContent`, which is also the gate of the
 * «Contact» settings tab (`settings-tabs.ts`), so no entry here leads to a refusal.
 *
 * The shared `SubNav` (§360), hrefs resolved here on the server because `SubNav` takes strings.
 */
export default async function PagesSubNav({ locale, active }: { locale: Locale; active: "pages" | "team" | "members" }) {
  const t = await getTranslations("Admin");
  const standard = t("pages.groupStandard");
  const custom = t("pages.groupCustom");

  return (
    <SubNav
      label={t("pages.title")}
      items={[
        { href: getPathname({ locale, href: "/admin/settings/contact" }), label: t("pages.tabContact"), group: standard, glyph: <MailOutlinedIcon /> },
        { href: getPathname({ locale, href: "/admin/pages/team" }), label: t("pages.tabTeam"), active: active === "team", group: standard, glyph: <GroupsIcon /> },
        { href: getPathname({ locale, href: "/admin/pages/members" }), label: t("pages.tabMembers"), active: active === "members", group: standard, glyph: <CardMembershipIcon /> },
        { href: getPathname({ locale, href: "/admin/pages" }), label: t("pages.tabPages"), active: active === "pages", group: custom, glyph: <ArticleIcon /> },
      ]}
    />
  );
}
