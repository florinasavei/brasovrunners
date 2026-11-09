import { cachedToolsPage } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { toolsPageOnSite } from "./page-settings";

/**
 * Whether «Unelte» is offered (§926), for the header and the «Ordinea meniului» card: the page published with a tool on it —
 * «Întrebări frecvente»'s rule (§525) — read from the public cache, false on any failure: never an error page.
 */
export async function toolsOnSite(): Promise<boolean> {
  try {
    return (await readWithLastGood("nav:tools", async () => toolsPageOnSite(await cachedToolsPage()))).value;
  } catch {
    return false;
  }
}
