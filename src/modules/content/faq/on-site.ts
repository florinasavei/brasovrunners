import type { Locale } from "@/i18n/routing";
import { cachedFaqPage } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { faqPageOnSite } from "./repository";

/**
 * Whether «Întrebări frecvente» is offered in this language (§525): the page published with a
 * question on the site — the rule the header's entry, the footer's «Despre club» link and the
 * contact page's line all read, from the public cache with its last good copy behind it (§447),
 * and false on anything that does not answer: a missing link is never an error page.
 */
export async function faqOnSite(locale: Locale): Promise<boolean> {
  try {
    return (await readWithLastGood(`nav:faq:${locale}`, async () => faqPageOnSite(await cachedFaqPage(locale)))).value;
  } catch {
    return false;
  }
}
