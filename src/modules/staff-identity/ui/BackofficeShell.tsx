import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { StaffUser } from "@/db/schema/staff-users";
import { getDb } from "@/db/client";
import { registeredBadgeCount } from "@/modules/registrations/nav-count";
import { type AdminSection, canReadRegistrations, visibleAdminSections } from "../domain/roles";
import { STAFF_ROLE_LABEL } from "../domain/staff-labels";
import AdminTabs, { type AdminTab } from "./AdminTabs";
import { PAGE_WIDTH } from "@/theme/brand";
import GlyphButton from "@/shared/ui/GlyphButton";

/**
 * The backoffice's chrome — the title, who is signed in, sign out, and the tabs — around every
 * staff page: `/admin/*` through its layout, and `/devs/*` through its own (`DECISIONS.md`
 * §119; the owner: "the config page is missing the navbar"). One component, so the two shells
 * cannot drift and a section reachable from the tabs always shows the tabs.
 *
 * Wider than the public site, and only here: `md` is right for an event page a person reads
 * and wrong for a list of registrations with a status, a date, an address and an event title
 * on every row — at `md` those wrap into four lines each and the list stops being scannable.
 *
 * Which tabs a role is offered is a rule and lives with the other role rules
 * (`visibleAdminSections`), not here — it once read `role === "ADMIN"` for the whole group, and
 * a SUPERADMIN saw only the Events tab. `getPathname` is a server function, so the hrefs are
 * resolved here and the client island only decides which one is current.
 */
export default async function BackofficeShell({
  locale,
  staffUser,
  signOut,
  notice,
  children,
}: {
  locale: Locale;
  staffUser: Pick<StaffUser, "displayName" | "email" | "role">;
  /** The sign-out Server Action; handed in so this module never imports the app's actions. */
  signOut: (form: FormData) => Promise<void>;
  /** A line under the tabs, when a section has one to say — the legal-text rule on `/admin`. */
  notice?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations("Admin");

  const SECTION_HREF: Record<AdminSection, string> = {
    events: getPathname({ locale, href: "/admin" }),
    checkin: getPathname({ locale, href: "/admin/checkin" }),
    guide: getPathname({ locale, href: "/admin/guide" }),
    pages: getPathname({ locale, href: "/admin/pages" }),
    gallery: getPathname({ locale, href: "/admin/gallery" }),
    registrations: getPathname({ locale, href: "/admin/registrations" }),
    tasks: getPathname({ locale, href: "/admin/tasks" }),
    legal: getPathname({ locale, href: "/admin/legal" }),
    emails: getPathname({ locale, href: "/admin/emails" }),
    staff: getPathname({ locale, href: "/admin/staff" }),
    // Its own route rather than a backoffice page: it is read by whoever is holding the
    // hosting dashboard (BR-REQ-090-04) — and it wears the same chrome since §119.
    devs: getPathname({ locale, href: "/devs" }),
  };

  /*
    How many are signed up, beside the "Înscrieri" tab (§255).

    Read here because the shell is the one place every backoffice page passes through, and
    memoized for a minute inside `registeredBadgeCount` so the badge costs about one indexed
    count a minute rather than one per page view — the club's database is a free Neon plan that
    bills compute time (§68). Only for the roles that may open the list — the Organizer since
    §289 — so for everybody else there is no query and no number.
  */
  const registered = canReadRegistrations(staffUser.role) ? await registeredBadgeCount(getDb(), new Date()) : null;

  const tabs: AdminTab[] = visibleAdminSections(staffUser.role).map((section) => ({
    href: SECTION_HREF[section],
    label: t(`nav.${section}`),
    section,
    ...(section === "registrations" ? { count: registered, countHint: t("nav.registeredHint") } : {}),
  }));

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mb: 3, alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Box>
          <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", sm: "2rem" } }}>
            {t("title")}
          </Typography>
          {/*
            Who you are, and *which account* you are — the address, not only the display name.
            A club with two Zitadel accounts on one machine, or one person with a personal and a
            club address, cannot tell them apart from a display name, and the address is the
            identity the `staff_users` allowlist actually matches on. It is the reader's own
            address shown to themselves, so there is no disclosure here: §10.3's protections are
            about participants, and a member of staff seeing their own sign-in is not that.
          */}
          <Typography variant="body2" color="text.secondary">
            {t("signedInAs", { name: staffUser.displayName, role: STAFF_ROLE_LABEL[staffUser.role] })}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontFamily: "monospace", fontSize: "0.8125rem", wordBreak: "break-all" }}
          >
            {staffUser.email}
          </Typography>
        </Box>

        <form action={signOut}>
          <input type="hidden" name="uiLocale" value={locale} />
          <GlyphButton icon="signOut" type="submit" size="small" variant="outlined">
            {t("signOut")}
          </GlyphButton>
        </form>
      </Stack>

      {/*
        The same role gating as the bare links this replaced: a section an Administrator alone
        may open is not offered to anybody else, and the page behind it answers 404 to a typed
        URL regardless (BR-REQ-060-01).
      */}
      <AdminTabs items={tabs} />

      {notice}

      {children}
    </Container>
  );
}
