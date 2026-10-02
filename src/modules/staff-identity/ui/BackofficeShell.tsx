import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { StaffUser } from "@/db/schema/staff-users";
import { getDb } from "@/db/client";
import { registeredBadgeBreakdown, registeredBadgeHint } from "@/modules/registrations/nav-count";
import { type AdminSection, canReadRegistrations, visibleAdminSections } from "../domain/roles";
import { STAFF_ROLE_LABEL } from "../domain/staff-labels";
import AdminTabs, { type AdminTab, type CountPill } from "./AdminTabs";
import { PAGE_WIDTH } from "@/theme/brand";
import GlyphButton from "@/shared/ui/GlyphButton";
import OpenFoldFromHash from "@/shared/ui/OpenFoldFromHash";

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
  children,
}: {
  locale: Locale;
  staffUser: Pick<StaffUser, "displayName" | "email" | "role">;
  /** The sign-out Server Action; handed in so this module never imports the app's actions. */
  signOut: (form: FormData) => Promise<void>;
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
    // «Setări» (§516): the email page, «Termene», «Aspect», «Costuri», «Anti-robot» — a bare
    // /admin/settings lands on the reader's first tab.
    settings: getPathname({ locale, href: "/admin/settings" }),
    newsletter: getPathname({ locale, href: "/admin/newsletter" }),
    staff: getPathname({ locale, href: "/admin/staff" }),
  };

  /*
    How many are signed up, beside the "Înscrieri" tab (§255).

    Read here because the shell is the one place every backoffice page passes through, and
    memoized for a minute per language inside `registeredBadgeBreakdown` so the badge costs about one indexed
    count a minute rather than one per page view — the club's database is a free Neon plan that
    bills compute time (§68). Only for the roles that may open the list — the Organizer since
    §289 — so for everybody else there is no query and no number.
  */
  const breakdown = canReadRegistrations(staffUser.role)
    ? await registeredBadgeBreakdown(getDb(), new Date(), locale)
    : null;
  /*
    The badge says who has a place (§NNN, amending §626's confirmed alone; the owner, 2026-10-02: «pune-o și
    pe cei care trebuie să confirme înregistrarea»), and a pill per group still in progress follows it: those
    completing their registration with a place (part of the badge), those awaiting the email confirmation
    and the waiting list (both outside it) — «Tot pe acest pill trebuie să afișăm și pe cei care așteaptă
    confirmarea mailului sau semnarea declarației». The tooltip says every figure.
  */
  const registered = breakdown?.withPlace ?? null;
  const pillCounts = breakdown
    ? { inProgress: breakdown.withPlace - breakdown.confirmed, awaitingEmail: breakdown.awaitingEmail, waiting: breakdown.waitlisted }
    : { inProgress: 0, awaitingEmail: 0, waiting: 0 };
  // Only above zero, each with the words a screen reader says for its glyph and number.
  const countPills: CountPill[] = [
    { kind: "inProgress" as const, count: pillCounts.inProgress, label: t("nav.registeredInProgressLabel", { count: pillCounts.inProgress }) },
    { kind: "awaitingEmail" as const, count: pillCounts.awaitingEmail, label: t("nav.registeredAwaitingEmail", { count: pillCounts.awaitingEmail }) },
    { kind: "waiting" as const, count: pillCounts.waiting, label: t("nav.registeredWaitingLabel", { count: pillCounts.waiting }) },
  ].filter((pill) => pill.count > 0);
  /*
    The tooltip says what the figures count, per event (§476): the badge's figure, its split and the rest in one line (§NNN), then
    each upcoming event with its number, the first five by start and how many more after them — so
    a reader whose list disagrees with the badge sees which event the difference is on.
  */
  const registeredHint = breakdown
    ? registeredBadgeHint(breakdown, {
        rule: ({ withPlace, confirmed, pendingPlace, waitlisted, awaitingEmail }) =>
          t("nav.registeredHint", {
            withPlace,
            confirmed: t(`nav.registeredConfirmed.${countForm(confirmed, locale)}`, { count: confirmed }),
            pendingPlace,
            waitlisted,
            awaitingEmail,
          }),
        event: (title, count, parts) => t("nav.registeredEvent", { title, count, parts }),
        withPlace: (count) => t("nav.registeredWithPlace", { count }),
        withPlaceOf: (count, capacity) => t("nav.registeredWithPlaceOf", { count, capacity }),
        awaitingEmail: (count) => t("nav.registeredAwaitingEmail", { count }),
        waitlisted: (count) => t("nav.registeredWaitlisted", { count }),
        more: (count) => t("nav.registeredMoreEvents", { count }),
      })
    : undefined;

  const tabs: AdminTab[] = visibleAdminSections(staffUser.role).map((section) => ({
    href: SECTION_HREF[section],
    label: t(`nav.${section}`),
    section,
    ...(section === "registrations" ? {
          count: registered,
          countHint: registeredHint,
          ...(countPills.length > 0 ? { countPills } : {}),
        } : {}),
    // `/devs` is «Setări»'s last tab and no section of its own (§520): the bar lights «Setări» there.
    ...(section === "settings" ? { alsoActiveOn: [getPathname({ locale, href: "/devs" })] } : {}),
  }));

  return (
    // `data-backoffice`: the public pages' background tint (§488) stops at this marker, so staff
    // always work on the platform's own paper whatever the club chose for the site.
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }} data-backoffice="">
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

      {children}

      {/* A `#fragment` naming a closed panel opens it (§336): the one part of the fold rule a
          server cannot see. Draws nothing. */}
      <OpenFoldFromHash />
    </Container>
  );
}
