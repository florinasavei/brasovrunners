import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { routing } from "@/i18n/routing";
import { noticeDescribesNewsletter } from "@/modules/legal-documents/repository";
import { countNewsletterAudience, listNewsletterSends } from "@/modules/newsletter/service";
import NewsletterPanel from "@/modules/newsletter/ui/NewsletterPanel";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canManageRegistrations, canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; recipients?: string }>;
};

/** Reads the session and the counts, and is returned to straight after a send: never cached. */
export const dynamic = "force-dynamic";

/**
 * «Newsletter» (§445): the backoffice's own entry, after «Emailuri» — the owner, 2026-09-26:
 * "pentru newsletter o să fie un meniu suplimentar în backoffice cu «Newsletter»". The subscribers
 * as numbers and the composer that writes to them, which `/admin/emails` held before; that page
 * keeps one line pointing here.
 *
 * For the roles that may send (`canSendNewsletter`: the Organizer, the Administrator, the
 * Superadministrator). Anybody else — a volunteer, the Redactor, the Tehnic — gets a 404, the
 * answer a route that does not exist gives (BR-REQ-060-01, §376), and the navigation never offers
 * it to them (`visibleAdminSections`). The refusal that matters is again in each action and in the
 * service behind it; withdrawing an address is the Administrator's alone (`canManageRegistrations`).
 */
export default async function NewsletterPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staff = await requireStaff();
  if (!canSendNewsletter(staff.role)) notFound();

  const { saved, recipients } = await searchParams;
  const db = getDb();
  const now = new Date();
  // Numbers only, never an address; the day's allowance for the composer's "how much leaves today";
  // and whether the notice in force lets the contact page offer the pop-up.
  const [audience, history, volume, offered] = await Promise.all([
    countNewsletterAudience(db),
    listNewsletterSends(db),
    readEmailVolumeToday(db, now),
    noticeDescribesNewsletter(db, now),
  ]);
  const sentCount = /^\d{1,9}$/.test(recipients ?? "") ? Number(recipients) : 0;
  const t = await getTranslations("Admin");

  return (
    <Stack spacing={3}>
      {/* The send's and the withdrawal's outcomes: how many it was queued for, a second press, an address removed or not found. */}
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved === "newsletterSent" && (
          <Alert severity="success" data-testid="newsletter-sent-banner">
            {t(`newsletter.sent.${countForm(sentCount, locale)}`, { count: sentCount })}
          </Alert>
        )}
        {saved === "newsletterDuplicate" && <Alert severity="info">{t("newsletter.duplicate")}</Alert>}
        {saved === "newsletterWithdrawn" && <Alert severity="success">{t("newsletter.withdrawn")}</Alert>}
        {saved === "newsletterNotFound" && <Alert severity="info">{t("newsletter.notFound")}</Alert>}
      </Box>

      <NewsletterPanel
        locale={locale}
        audience={audience}
        history={history}
        volume={volume}
        offered={offered}
        mayWithdraw={canManageRegistrations(staff.role)}
      />
    </Stack>
  );
}
