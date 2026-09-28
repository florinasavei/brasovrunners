import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readDeadlines } from "@/modules/deadlines/deadlines";
import DeadlinesPanel from "@/modules/deadlines/ui/DeadlinesPanel";
import { readAddressCap } from "@/modules/registrations/address-cap";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { readDeliveryTiming } from "@/modules/notifications/delivery-timing";
import { readOutboxDelivery } from "@/modules/notifications/outbox-delivery";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { canOpenSettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import { requireStaff } from "@/modules/staff-identity/session";
import SettingsSubNav from "@/modules/staff-identity/ui/SettingsSubNav";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

/** Returned to straight after a save, so never cached (the email tab's reason, §100). */
export const dynamic = "force-dynamic";

/**
 * «Setări» → «Termene» (§377, its own tab since §516 — it was a fold on `/admin/emails`): every
 * participant-facing deadline, the per-address limit (§389) and «Când pleacă emailurile» (§513).
 * Read by whoever reads the club's content; changed by the Administrator (`canManageClubSettings`,
 * §450), which the actions and the services assert again. The messages whose when-lines state these numbers are one tab over,
 * «Emailuri», and read them from the same setting.
 */
export default async function AdminDeadlinesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canOpenSettingsTab(actor.role, "deadlines")) notFound();

  const { saved } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();
  const [deadlines, addressCap, deliveryTiming, outboxDelivery] = await Promise.all([
    readDeadlines(db),
    readAddressCap(db),
    // «Când pleacă emailurile» (§513): on the scheduler's tick or right after the request.
    readDeliveryTiming(db),
    // How long a scheduled email waits (§513), for the setting's own words: the pinger's cadence, the
    // Administrator's interval and the governor's floor (§447), as «Emailuri» reads it for its forecast.
    readNeonBudget(now).then((budget) => readOutboxDelivery(db, now, budget.effects.jobFloorMinutes)),
  ]);

  return (
    <Stack spacing={3}>
      <SettingsSubNav locale={locale} role={actor.role} active="deadlines" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved === "deadlines" && <Alert severity="success">{t("emails.deadlines.saved")}</Alert>}
        {saved === "addressCap" && <Alert severity="success">{t("emails.addressCap.saved")}</Alert>}
        {saved === "deliveryTiming" && <Alert severity="success">{t("emails.deliveryTiming.saved")}</Alert>}
      </Box>

      {/* The tab is this card alone, so it opens on arrival (§336's `primary`, §516). */}
      <DeadlinesPanel
        locale={locale}
        state={deadlines}
        mayEdit={canManageClubSettings(actor.role)}
        openWhen={{ primary: true, saved: saved === "deadlines" || saved === "addressCap" || saved === "deliveryTiming" }}
        addressCap={addressCap}
        deliveryTiming={deliveryTiming}
        scheduledWait={outboxDelivery.scheduledWait}
      />
    </Stack>
  );
}
