import Alert from "@mui/material/Alert";
import { getTranslations } from "next-intl/server";
import { emailDeliveryNotice } from "@/modules/notifications/delivery-notice";
import { env } from "@/shared/config/env";

/**
 * The one sentence a tester needs before filling in a form on QA or on a laptop: that the
 * email this environment promises is not coming, or is coming only to the addresses the club
 * authorized. Rendered on the registration form and on the "check your email" screen, and on
 * production — `EMAIL_DELIVERY_MODE=live` — not at all (`delivery-notice.ts`).
 *
 * A Server Component with no state: the mode is fixed for the life of the process, and the
 * page already reads `env` for other things. A warning rather than an info, because the
 * consequence is a person waiting on an inbox.
 */
export default async function EmailDeliveryNotice() {
  const notice = emailDeliveryNotice(env);
  if (!notice) return null;
  const t = await getTranslations("Registration");
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {t(notice)}
    </Alert>
  );
}
