import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import { canRecordFinishes } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";

type Props = { params: Promise<{ locale: string; id: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Sosire» (§850), the finish line's first page, under «Clasament» — whose place «Cronometrare» took (§NNN): «Ziua cursei»'s timing
 * tab, `/admin/checkin/cronometrare`. The old address is kept so a link saved on a phone, or the guide of a release before, still
 * lands on the finish line: it sends the reader on with its event (`?eventId=`). Whoever records finishes is sent on
 * (`canRecordFinishes`, the new page's own gate, asserted again there); anybody else meets the 404 an unknown page gets
 * (BR-REQ-060-01), and so do a malformed id and an event that is not there.
 */
export default async function FinishPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const actor = await requireStaff();
  if (!canRecordFinishes(actor.role)) notFound();
  if (!isUuid(id)) notFound();
  if (!(await findEventForEditing(getDb(), id))) notFound();
  redirect(`${getPathname({ locale, href: "/admin/checkin/cronometrare" })}?eventId=${encodeURIComponent(id)}`);
}
