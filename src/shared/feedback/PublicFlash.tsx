import { getTranslations } from "next-intl/server";
import { readPublicFlash } from "./flash";
import FlashToast from "./FlashToast";
import type { PublicToastKey } from "./public-toasts";

/**
 * Where a public page says its flow's outcome in a toast (§NNN, through §384's flash).
 *
 * A Server Component the page renders in its success branch only — `?sent=1`, `?done=…` — with
 * the keys that branch can have been sent: it reads the flash the action wrote, translates it
 * here, in the page's language (`Feedback.public`), and hands the island a sentence. A flash it
 * does not accept renders nothing and is left alone. No flash — a refresh, a shared link, a visit
 * after the island already cleared it — renders nothing either, and the page's own banner stays
 * the answer, as it always was; with JavaScript off the banner is the whole answer.
 */
export default async function PublicFlash({ accept }: { accept: readonly PublicToastKey[] }) {
  const notice = await readPublicFlash();
  if (!notice || !accept.includes(notice.key)) return null;
  const t = await getTranslations("Feedback");
  return <FlashToast kind={notice.kind} sentence={t(`public.${notice.key}`)} closeLabel={t("close")} />;
}
