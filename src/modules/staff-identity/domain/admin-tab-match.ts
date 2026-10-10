/**
 * Which tab of the main bar an address lights (`AdminTabs`), as a pure function so a unit test can
 * walk the addresses a reader lands on.
 *
 * The longest matching href wins. `/ro/admin` is a prefix of `/ro/admin/registrations`, so a
 * first-match rule would light up "Events" on every page in the backoffice; comparing lengths picks
 * the most specific tab, which is the one whose section the visitor is actually in. A tab that also
 * stands for an address outside its own path (`alsoActiveOn`) is measured by the same rule: «Setări»
 * lights on `/devs` (§520), where no tab's own href matches, and on `/admin/design` (§692), where
 * only the bare `/admin` root does — a root that is a prefix of every backoffice address, so the
 * longer address the tab stands for is the more specific match.
 *
 * A section's parts therefore live under its href — «Pagini»'s «Contact» is `/admin/pages/contact`
 * since the owner's «ar trebui să rămân în același loc» (2026-09-28) — so the bar never jumps to
 * another section while the reader walks one section's row.
 */
export function activeAdminTabHref(
  items: readonly { href: string; alsoActiveOn?: readonly string[] }[],
  pathname: string,
): string | null {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const own = items.filter((item) => under(item.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const also = items.find((item) => item.alsoActiveOn?.some((address) => under(address) && address.length > (own?.href.length ?? 0)));
  return (also ?? own)?.href ?? null;
}
