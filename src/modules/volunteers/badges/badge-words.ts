import { getTranslations } from "next-intl/server";
import type { BadgeDefaultWords, BadgeLocale } from "./badge-design";

/**
 * The platform's words on a badge when the club typed none (§NNN) — «VOLUNTAR», «Nume:», «Coordonator» —
 * in the badge's language, from the catalogue (`Admin.badges.defaults`), never a literal: the two routes
 * and the page read them here, so the sheet and the picture say the same.
 */
export async function badgeDefaultWords(locale: BadgeLocale): Promise<BadgeDefaultWords> {
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { label: t("badges.defaults.label"), name: t("badges.defaults.name"), phoneLabel: t("badges.defaults.phoneLabel") };
}
