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
import { parseSubscriberListQuery } from "@/modules/newsletter/domain/subscriber-list";
import { countNewsletterAudience, listNewsletterSends } from "@/modules/newsletter/service";
import { listNewsletterSubscribers } from "@/modules/newsletter/subscribers";
import { listPromoConsenters } from "@/modules/newsletter/promo-consenters";
import PromoConsenters from "@/modules/newsletter/ui/PromoConsenters";
import NewsletterPanel from "@/modules/newsletter/ui/NewsletterPanel";
import NewsletterSubscribers from "@/modules/newsletter/ui/NewsletterSubscribers";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canManageRegistrations, canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Reads the session and the counts, and is returned to straight after a send: never cached. */
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * «Newsletter» (§445): the backoffice's own entry, after «Emailuri» — the owner, 2026-09-26:
 * "pentru newsletter o să fie un meniu suplimentar în backoffice cu «Newsletter»". The subscribers
 * as numbers and the composer that writes to them, which `/admin/emails` held before; that page
 * keeps one line pointing here. Since §550 (the owner, 2026-09-28: «în newsletter vreau să și văd
 * abonații și mailurile lor») also the list itself, «Abonați», with the addresses, searched and
 * filtered through the address bar (`q`, `topic`, `state`) and downloadable as a CSV.
 *
 * For the roles that may send (`canSendNewsletter`: the Organizer, the Administrator, the
 * Superadministrator) — they read the list too. Anybody else — a volunteer, the Redactor, the
 * Tehnic, a member — gets a 404, the answer a route that does not exist gives (BR-REQ-060-01,
 * §376), and the navigation never offers it to them (`visibleAdminSections`). The refusal that
 * matters is again in each action, in the CSV route and in the service behind them; withdrawing an
 * address and «Dezabonează» on a row are the Administrator's alone (`canManageRegistrations`).
 */
export default async function NewsletterPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staff = await requireStaff();
  if (!canSendNewsletter(staff.role)) notFound();

  const search = await searchParams;
  const saved = one(search.saved);
  const recipients = one(search.recipients);
  const query = parseSubscriberListQuery(search);
  const db = getDb();
  const now = new Date();
  // The day's allowance for the composer's "how much leaves today", and whether the notice in force
  // lets the contact page offer the pop-up; the list under its filter.
  // And, since §NNN, who said yes to promotional materials on a registration — the same readers (§550).
  const [audience, history, volume, offered, subscribers, promo] = await Promise.all([
    countNewsletterAudience(db),
    listNewsletterSends(db),
    readEmailVolumeToday(db, now),
    noticeDescribesNewsletter(db, now),
    listNewsletterSubscribers(db, query, now),
    listPromoConsenters(db, staff, locale),
  ]);
  const sentCount = /^\d{1,9}$/.test(recipients ?? "") ? Number(recipients) : 0;
  const t = await getTranslations("Admin");
  const mayManage = canManageRegistrations(staff.role);

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
        mayWithdraw={mayManage}
        subscribers={
          <>
            <NewsletterSubscribers
              locale={locale}
              query={query}
              list={subscribers}
              mayUnsubscribe={mayManage}
              saved={saved === "newsletterUnsubscribed" || saved === "newsletterUnsubscribedGone"}
            />
            {/* The second fold (§NNN): a consent on a registration, not a subscription — its own list and its own CSV. */}
            <PromoConsenters locale={locale} list={promo} />
          </>
        }
      />
    </Stack>
  );
}
