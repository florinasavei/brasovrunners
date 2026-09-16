"use client";

import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { usePathname } from "next/navigation";

export type AdminTab = { href: string; label: string };

/**
 * The backoffice navigation.
 *
 * Three bare text links used to be the whole of it, which on a phone is three words in a row
 * that nobody reads as navigation. This is a tab bar, and it is a Client Component for exactly
 * one reason: MUI's `Tabs` is one, and the active tab depends on the current path — which a
 * layout cannot know, because a layout in the App Router receives no pathname.
 *
 * The links are ordinary anchors with real `href`s, so this is full navigation rather than
 * client-side routing: the pages behind them are Server Components that read the session and the
 * database on every request, and a client-side transition would only add a router to keep in
 * step with them. It also means the backoffice still works with JavaScript disabled — the tabs
 * are anchors in the server HTML before any of this runs.
 *
 * The hrefs arrive already resolved for the active locale, because `getPathname` is a server
 * function and the caller is a Server Component.
 */
export default function AdminTabs({ items }: { items: readonly AdminTab[] }) {
  const pathname = usePathname();

  /**
   * The longest matching href wins.
   *
   * `/ro/admin` is a prefix of `/ro/admin/registrations`, so a first-match rule would light up
   * "Events" on every page in the backoffice. Comparing lengths picks the most specific tab,
   * which is the one whose section the visitor is actually in.
   */
  const active = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <Tabs
      // `false` rather than a guess when nothing matches — a page under /admin that is not one
      // of these sections should light up no tab, and MUI warns about a value it cannot find.
      value={active?.href ?? false}
      variant="scrollable"
      scrollButtons={false}
      // At 320px three tabs do not fit; scrolling them is right, and the divider makes it look
      // like the row it is rather than like clipped text.
      sx={{ mb: 3, borderBottom: 1, borderColor: "divider", minHeight: 44 }}
    >
      {items.map((item) => (
        <Tab
          key={item.href}
          value={item.href}
          label={item.label}
          component="a"
          href={item.href}
          sx={{ minHeight: 44, textTransform: "none" }}
        />
      ))}
    </Tabs>
  );
}
