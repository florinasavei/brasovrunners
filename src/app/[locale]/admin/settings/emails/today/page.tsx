import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { readEmailJournal } from "@/modules/notifications/journal";
import { readOutboxDelivery } from "@/modules/notifications/outbox-delivery";
import { departureContextOf } from "@/modules/notifications/ui/departure-words";
import EmailJournal from "@/modules/notifications/ui/EmailJournal";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import SettingsSubNav from "@/modules/staff-identity/ui/SettingsSubNav";

type Props = { params: Promise<{ locale: string }> };

/** The day as it stands: read at every visit, never from a cache. */
export const dynamic = "force-dynamic";

/**
 * «Setări» → «Emailuri» → «Emailuri azi» (the design «telling the owner about every email a staff press sends»,
 * slice 1, its section 5): every email of the club's day, with the person's name and address, grouped by the press
 * that queued it — what waits now, then what left today — and who got the same email more than once.
 *
 * **The Administrator's and the Superadministrator's alone**, asserted here on the server
 * (`requireStaffCapability(canManageRegistrations)`, BR-REQ-060-01): it names people and addresses, which they
 * already read on the list, in the exports and in the queue. The desk's roles, the Organizer and the Tehnic role
 * never open it (§289, §38); the links to it are drawn only for the two roles, and a hidden link is not the gate.
 * `/devs` keeps its counts only.
 */
export default async function EmailsTodayPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staff = await requireStaffCapability(canManageRegistrations);

  const db = getDb();
  const now = new Date();
  // The page's one "now": the day's rows, the Mailgun count and every waiting row's departure are read at it.
  const [journal, volume, delivery] = await Promise.all([
    readEmailJournal(db, now, locale),
    readEmailVolumeToday(db, now),
    // The governor's floor as the queue panel reads it (§447), so a waiting row says the queue's own time.
    readNeonBudget(now).then((budget) => readOutboxDelivery(db, now, budget.effects.jobFloorMinutes)),
  ]);

  return (
    <Stack spacing={3}>
      {/* «Emailuri» stays marked: this page is a part of that tab, reached from it. */}
      <SettingsSubNav locale={locale} role={staff.role} active="emails" />
      <EmailJournal locale={locale} journal={journal} volume={volume} departure={departureContextOf({ now, delivery, volume })} now={now} />
    </Stack>
  );
}
