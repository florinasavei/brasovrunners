import { getTranslations } from "next-intl/server";
import { AdminListSkeleton } from "@/modules/staff-identity/ui/AdminSkeleton";

/** Shown while this route's server render is in flight. No client JavaScript (§1.5). */
export default async function Loading() {
  const t = await getTranslations("Admin");
  return <AdminListSkeleton label={t("loading")} />;
}
