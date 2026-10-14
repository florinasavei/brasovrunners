import { contactSmtpRoadExists } from "@/modules/contact/delivery";
import { env, type Env } from "@/shared/config/env";
import type { FeedbackRoads } from "./domain/branches";

/**
 * Which roads «Spune-ne ceva» has on this deployment (§NNN) — what the backoffice card greys a choice
 * by, what decides whether a form is offered, and what the service refuses a post by. The environment
 * alone, so no read and no cache, like `contactSmtpRoadExists` (§676):
 *
 * - **Gmail** — the contact form's SMTP road: `CONTACT_SMTP_USER` with its app password (`CONTACT_FORM_MODE`
 *   `smtp`), or the laptop's capture (`SETUP.md` §38).
 * - **Mailgun** — the email service transmits: `EMAIL_DELIVERY_MODE` `allowlist` or `live`; on a laptop
 *   and in the tests (`APP_ENV` `local` or `test`) its capture stands in, as it always did for Girl Zone,
 *   so the form works with nothing configured. A deployed environment in `capture` mode sends nothing, so
 *   Mailgun is not a road there (the row `liveEmail` on `/admin/tasks` is the steps).
 */
export function feedbackRoads(config: Pick<Env, "APP_ENV" | "EMAIL_DELIVERY_MODE" | "CONTACT_FORM_MODE"> = env): FeedbackRoads {
  return {
    gmail: contactSmtpRoadExists(config),
    mailgun: config.EMAIL_DELIVERY_MODE !== "capture" || config.APP_ENV === "local" || config.APP_ENV === "test",
  };
}
