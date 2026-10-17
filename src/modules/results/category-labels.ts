import { getTranslations } from "next-intl/server";
import { categoryLabelOf } from "./category-words";

/**
 * A stored category (`FEMALE:from30`) in the page's language (§809, race results part 2): the words of the club's statistics
 * (§787, `Admin.registrations.statistics`), so the public table reads «Feminin, 30-39 ani» exactly as the Excel and the CSV do.
 * The catalogue's namespace is read here, not in the section, so the section's own `Event` keys stay unambiguous for the checker
 * that matches a file's keys against every namespace it names.
 */
export async function categoryLabeller(locale: string): Promise<(key: string | null) => string> {
  const admin = await getTranslations({ locale, namespace: "Admin" });
  return (key) => categoryLabelOf(key, (statisticsKey) => admin.raw(`registrations.statistics.${statisticsKey}`) as string);
}
