import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/**
 * The parts of the Pagini tab (§459, §NNN): the pages the club writes from nothing, and the
 * platform's standard pages whose contents the club keeps — «Echipa» and «Întrebări frecvente».
 * The owner: "pagina de echipa nu e o pagina custom" — so neither is a row in the pages list, and
 * each is one press away from it. The list itself shows the two groups, standard and custom.
 * «Aspect» (§488) was a tab here; it is a setting, so it moved to «Setări» (§516), and
 * `/admin/pages/appearance` answers 308 to its new address.
 *
 * The shared `SubNav` (§360), hrefs resolved here on the server because `SubNav` takes strings.
 */
export default async function PagesSubNav({ locale, active }: { locale: Locale; active: "pages" | "team" | "faq" }) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("pages.title")}
      items={[
        { href: getPathname({ locale, href: "/admin/pages" }), label: t("pages.tabPages"), active: active === "pages" },
        { href: getPathname({ locale, href: "/admin/pages/team" }), label: t("pages.tabTeam"), active: active === "team" },
        { href: getPathname({ locale, href: "/admin/pages/faq" }), label: t("pages.tabFaq"), active: active === "faq" },
      ]}
    />
  );
}
