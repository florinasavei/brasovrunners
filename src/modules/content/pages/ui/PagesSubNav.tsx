import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/**
 * The parts of the Pagini tab (§459): the pages the club writes from nothing, and «Echipa»,
 * the platform's team page whose cards the club keeps. The owner: "pagina de echipa nu e o
 * pagina custom" — so it is not a row in the pages list, and it is one press away from it.
 * «Aspect» (§488) was a third tab here; it is a setting, so it moved to «Setări» (§516), and
 * `/admin/pages/appearance` answers 308 to its new address.
 *
 * The shared `SubNav` (§360), hrefs resolved here on the server because `SubNav` takes strings.
 */
// «Membri» (§NNN): the members' pages — «Beneficiile membrilor» and the members' zone — platform
// pages like «Echipa», one press away from it.
export default async function PagesSubNav({ locale, active }: { locale: Locale; active: "pages" | "team" | "members" }) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("pages.title")}
      items={[
        { href: getPathname({ locale, href: "/admin/pages" }), label: t("pages.tabPages"), active: active === "pages" },
        { href: getPathname({ locale, href: "/admin/pages/team" }), label: t("pages.tabTeam"), active: active === "team" },
        { href: getPathname({ locale, href: "/admin/pages/members" }), label: t("pages.tabMembers"), active: active === "members" },
      ]}
    />
  );
}
