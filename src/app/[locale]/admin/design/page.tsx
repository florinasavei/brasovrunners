import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import DesignSystem from "@/modules/design/ui/DesignSystem";
import { canReadContent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * «Sistemul de design» / "Design system" (§692): the site's look as the code draws it — the
 * tokens, the type, the shapes, the buttons, the pills, sample cards, every glyph — and the
 * redesign plan with a status per row. Reached from «Setări» → «Aspect»; read by whoever reads the
 * club's content (`canReadContent`), which the layout asserts for the status code and this page
 * asserts again (BR-REQ-060-01). It writes nothing, so there is nothing to audit.
 */
export default async function AdminDesignPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  return <DesignSystem locale={locale} />;
}
