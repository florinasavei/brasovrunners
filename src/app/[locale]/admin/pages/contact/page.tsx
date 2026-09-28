import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { resolveContactRecipients } from "@/modules/contact/domain/recipients";
import { configuredGmailAddress, resolveShownContactAddresses } from "@/modules/contact/domain/shown-address";
import { readContactRecipients } from "@/modules/contact/recipients";
import { readShownContactAddress } from "@/modules/contact/shown-address";
import ContactRecipientsPanel from "@/modules/contact/ui/ContactRecipientsPanel";
import ShownAddressPanel from "@/modules/contact/ui/ShownAddressPanel";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import { canManageClubSettings, canReadContent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

/**
 * Returned to straight after a save, so never cached: without this the panel showed the values it
 * had before the press (found on 2026-09-20 on `/admin/emails`: clearing the recipients wrote the
 * row and the page went on saying the old addresses).
 */
export const dynamic = "force-dynamic";

/**
 * «Pagini» → «Contact»: where the club is written to — who reads what «Scrie-ne» sends (§164) and
 * the address the site shows and every email answers to (§442). Both cards were folds on
 * `/admin/emails`, then «Setări» → «Contact» (§516); they live here, a standard page of «Pagini»
 * (§525), because the row's «Contact» entry switched the main bar to «Setări» and the reader lost the
 * row (the owner, 2026-09-28: «ar trebui să rămân în același loc»). `/admin/settings/contact`
 * answers 308 here. Read by whoever reads the club's content — the gate the tab had, and every
 * «Pagini» entry's; changed by the Administrator (`canManageClubSettings`, §450), which the actions
 * and the services assert again.
 */
export default async function AdminContactSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const { saved } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const [recipients, shownAddress] = await Promise.all([readContactRecipients(db), readShownContactAddress(db)]);
  const mayEdit = canManageClubSettings(actor.role);

  return (
    <Stack spacing={3}>
      <PagesSubNav locale={locale} active="contact" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved === "contactRecipients" && <Alert severity="success">{t("emails.contacts.saved")}</Alert>}
        {saved === "shownContactAddress" && <Alert severity="success">{t("emails.shownAddress.saved")}</Alert>}
      </Box>

      {/* The page is these two cards alone, so they open on arrival (§336's `primary`, §516). */}
      <ContactRecipientsPanel
        locale={locale}
        recipients={recipients}
        resolved={resolveContactRecipients(recipients, env.CONTACT_FORM_TO)}
        mayEdit={mayEdit}
        openWhen={{ primary: true, saved: saved === "contactRecipients" }}
      />

      {/* «Adresa de contact afișată» (§442), beside who receives the form: both are "where the club is written to". */}
      <ShownAddressPanel
        locale={locale}
        state={shownAddress}
        mailbox={env.EMAIL_REPLY_TO ?? null}
        configuredGmail={configuredGmailAddress(env.CONTACT_SMTP_USER)}
        resolved={resolveShownContactAddresses(shownAddress, env.EMAIL_REPLY_TO, env.CONTACT_SMTP_USER)}
        mayEdit={mayEdit}
        openWhen={{ primary: true, saved: saved === "shownContactAddress" }}
      />
    </Stack>
  );
}
