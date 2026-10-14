import { getTranslations } from "next-intl/server";
import { type BadgeDefaultWords, type BadgeDesign, type BadgeLocale, badgeLabelText, badgeWords } from "./badge-design";

/**
 * The platform's words on a badge when the club typed none (§NNN) — «VOLUNTAR», «Nume:», «Coordonator» —
 * in the badge's language, from the catalogue (`Admin.badges.defaults`), never a literal: the two routes
 * and the page read them here, so the sheet and the picture say the same.
 */
export async function badgeDefaultWords(locale: BadgeLocale): Promise<BadgeDefaultWords> {
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { label: t("badges.defaults.label"), name: t("badges.defaults.name"), phoneLabel: t("badges.defaults.phoneLabel") };
}

/**
 * «VOLUNTAR» as a badge in `locale` prints it — the club's word in that language, else the platform's, in
 * capitals: what the page shows beside a role's colour and names for the badges «fără rol», so a club that
 * typed its own word («STAFF») is never shown one that will not print.
 */
export async function badgeLabelIn(design: BadgeDesign, locale: BadgeLocale): Promise<string> {
  return badgeLabelText(badgeWords(design, locale, "", await badgeDefaultWords(locale)).label, locale);
}
