import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { SpentRegistrationLink } from "@/modules/registrations/token-actions";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * What an email action link says when it cannot open its form.
 *
 * Two shapes, one component, because every page in the journey owes both and §13.2 owes the
 * second one a way out:
 *
 * - **`status` given** — the link was spent, and the registration is somewhere. Say where, and
 *   name the next step (`domain/link-status.ts` decides which).
 * - **`status` null** — the generic invalid-or-expired refusal §13.2 requires, now with the
 *   resend path §13.2 also requires and which the sentence only ever gestured at ("you can ask
 *   for a new one from the event page" — from a page that did not link to one).
 *
 * Rendered on the server with no client island; the only interactive thing on it is a link.
 *
 * Severity is `success` wherever the person's place is safe. That is the whole point of the
 * change: the old page coloured a completed registration as a failure, somebody read it as
 * one, and stopped short of her declaration.
 *
 * What is deliberately absent from the status shape: the address, the name, the check-in code,
 * the race number, the declaration PDF, anybody else. The link this page was reached with
 * already implied one registration for one event; it did not imply the rest, and a spent link
 * is not the place to hand it over. The desk code and the QR stay behind a live
 * `MANAGE_REGISTRATION` link.
 */
export default async function ActionLinkNotice({
  locale,
  status,
}: {
  locale: Locale;
  status: SpentRegistrationLink | null;
}) {
  const t = await getTranslations("Registrations");

  /**
   * Both destinations carry the event when we know it. `/registrations/resend` narrows its
   * search to that event's registration when it is given one, and falls back to "their most
   * recent active registration" when the slug means nothing — so a missing translation costs
   * nothing here.
   */
  const resendHref =
    getPathname({ locale, href: "/registrations/resend" }) +
    (status?.eventSlug ? `?event=${encodeURIComponent(status.eventSlug)}` : "");

  if (!status) {
    return (
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Alert severity="warning" sx={{ alignSelf: "stretch" }}>
          {t("invalidOrExpired")}
        </Alert>
        {/* `component="a"` with a resolved path, never `component={Link}`: a React element as
            a prop from a Server Component is what §14.1 forbids, and a string is not one. */}
        <Button component="a" href={resendHref} variant="contained" sx={TAP_TARGET}>
          {t("spent.resendAction")}
        </Button>
      </Stack>
    );
  }

  const settled = status.message === "CANCELLED" || status.message === "LAPSED";

  const eventHref = status.eventSlug
    ? getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: status.eventSlug } } })
    : getPathname({ locale, href: "/events" });

  return (
    <Stack spacing={2}>
      <Alert severity={settled ? "info" : "success"}>
        <AlertTitle>{t(`spent.${status.message}.title`)}</AlertTitle>
        {t(`spent.${status.message}.body`)}
      </Alert>

      {status.eventTitle && (
        <Typography variant="body2" color="text.secondary">
          {t("spent.event", { event: status.eventTitle })}
        </Typography>
      )}

      {status.next === "RESEND" && (
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <Typography variant="body2">{t("spent.resendHelp")}</Typography>
          <Button component="a" href={resendHref} variant="contained" sx={TAP_TARGET}>
            {t("spent.resendAction")}
          </Button>
        </Stack>
      )}

      {status.next === "REGISTER_AGAIN" && (
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <Typography variant="body2">{t("spent.registerAgainHelp")}</Typography>
          <Button component="a" href={eventHref} variant="outlined" sx={TAP_TARGET}>
            {t("spent.registerAgainAction")}
          </Button>
        </Stack>
      )}

      {/* Waitlisted: nothing to press. `deriveAllowedResendMessageType` returns nothing for
          that status, so a "send it again" button would promise an email nobody queues. */}
      {status.next === "NONE" && <Typography variant="body2">{t("spent.waitHelp")}</Typography>}
    </Stack>
  );
}
