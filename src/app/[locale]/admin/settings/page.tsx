import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { defaultSettingsTab, SETTINGS_TAB_ROUTE } from "@/modules/staff-identity/domain/settings-tabs";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * A bare `/admin/settings` — the main bar's «Setări» — lands on the reader's first tab (§516):
 * «Emailuri» for every role that opens the section. The tab row is the rest of the map.
 */
export default async function SettingsIndexPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  const tab = defaultSettingsTab(actor.role);
  if (tab === null) notFound();
  redirect(getPathname({ locale, href: SETTINGS_TAB_ROUTE[tab] }));
}
