import type { Locale } from "@/i18n/routing";
import { cachedFaqPage } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { faqPageOnSite } from "./repository";

/**
 * Whether «Întrebări frecvente» is offered in this language (§525), for the header, footer and
 * contact page; read from the public cache (§447), false on any failure — never an error page.
 */
export async function faqOnSite(locale: Locale): Promise<boolean> {
  try {
    return (await readWithLastGood(`nav:faq:${locale}`, async () => faqPageOnSite(await cachedFaqPage(locale)))).value;
  } catch {
    return false;
  }
}
