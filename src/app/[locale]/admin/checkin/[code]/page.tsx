import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findRegistrationByCheckinCode } from "@/modules/registrations/admin-repository";
import { isCheckinCode, normalizeCheckinCode } from "@/modules/registrations/checkin-code";
import DeskRow from "@/modules/registrations/ui/DeskRow";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * What a scanned QR opens (BR-REQ-037-08): one runner, and the button that hands them their
 * number. Behind staff sign-in like the rest of the backoffice — a participant who scans their
 * own code lands on the sign-in page, which is the point: the code identifies, it does not
 * authorize. A code nobody has is a sentence with a way back, not a 404, because at a desk the
 * likeliest cause is a mistyped letter.
 */
export default async function ScannedCodePage({ params, searchParams }: Props) {
  const { locale, code: raw } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const code = normalizeCheckinCode(raw);
  const row = isCheckinCode(code) ? await findRegistrationByCheckinCode(getDb(), code, locale) : undefined;

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/checkin">{t("desk.backToDesk")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("desk.scannedTitle")}
      </Typography>
      <div id="admin-alert" tabIndex={-1}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved && <Alert severity="success">{t(`desk.saved.${saved}`)}</Alert>}
      </div>
      {row ? (
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
          <DeskRow row={row} locale={locale} back="code" showEvent />
        </Stack>
      ) : (
        <Alert severity="warning">{t("desk.unknownCode")}</Alert>
      )}
    </Stack>
  );
}
