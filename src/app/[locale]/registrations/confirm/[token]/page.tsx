import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { hoursPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedDeadlines } from "@/modules/public-cache/reads";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import ConfirmOnArrival from "@/modules/registrations/ui/ConfirmOnArrival";
import { spamHintWords } from "@/modules/registrations/ui/link-wait-words";
import { emailDelayNotice } from "@/modules/registrations/ui/email-delay-notice";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import {
  readConfirmedOnAddress,
  readRegistrationTokenContext,
  readReplacedActionLink,
  readSpentRegistrationLink,
} from "@/modules/registrations/token-actions";
import { confirmEmailAction } from "./actions";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; eventOff?: string; full?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The email-confirmation landing page (AGENTS.md §13.2). The GET here only *reads* the token
 * context — `readRegistrationTokenContext` runs inside a read-only transaction — so a mail
 * scanner fetching this link before a human sees it cannot confirm anything; only the explicit
 * POST below can.
 *
 * The POST is then pressed for them (§238; the owner: "when I click from the mail I wanna
 * auto-confirm the email") — by `ConfirmOnArrival`, on the client, once the page has
 * hydrated. A scanner issues the GET and runs no JavaScript, so it never reaches the press.
 */
export default async function ConfirmEmailPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, eventOff, full } = await searchParams;
  const t = await getTranslations("Registrations");

  // No place and the waiting list full (§348): nothing was confirmed and the link was not spent,
  // so the page says why and that the same link can be opened again. `closed` is an event with no
  // waiting list at all, said without mentioning one.
  if (full) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("confirm.title")}
        </Typography>
        <Alert severity="warning" data-testid="confirm-waitlist-full">
          {/* How long the link stays good: the club's hours (§377), which a link sent now was given. */}
          {t(full === "closed" ? "confirm.noWaitlist" : "confirm.waitlistFull", {
            confirmation: hoursPhrase(locale, (await cachedDeadlines()).confirmationHours),
          })}
        </Alert>
      </Container>
    );
  }

  // The link was good, but the event was cancelled or is over (§331): nothing was allocated and
  // nothing sent, and the page says why rather than "confirmed, now sign".
  if (eventOff) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("confirm.title")}
        </Typography>
        <Alert severity="info">{t("confirm.eventOff")}</Alert>
      </Container>
    );
  }

  if (done) {
    // One click proved the inbox (§588): with more than one person on it, the page names each and their next step.
    const people = await readConfirmedOnAddress(token, new Date());
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        {/* Every page in this journey opens with an h1, this one included. A page whose only
            content is an alert leaves a screen-reader heading list with a gap where the
            outcome should be, and "what happened" is the one thing somebody arriving here
            wants. */}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("confirm.doneTitle")}
        </Typography>
        {/* While the club's emails are late (§NNN): the declaration's email is one of them. */}
        {await emailDelayNotice({ sx: { mb: 2 } })}
        {/* Confirmed is not finished: the declaration is still to sign, and the hold that
            protects their place is running. Saying "done" alone loses people here. */}
        {done !== "waitlist" && <RegistrationJourney current="declare" declaration="emailJustSent" />}
        <Alert severity="success">{t("confirm.done")}</Alert>
        {/* On the waiting list there is no declaration to sign yet, so the page says what is true instead. */}
        {done === "waitlist" && (
          <Alert severity="info" sx={{ mt: 2 }} data-testid="confirm-waitlist">
            {t("confirm.doneWaitlist")}
          </Alert>
        )}
        {people.length > 1 && (
          <Alert severity="info" icon={false} sx={{ mt: 2 }} data-testid="confirm-address-people">
            <Typography sx={{ fontWeight: 600 }}>{t("confirm.doneFor")}</Typography>
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
              {people.map((person, index) => (
                <li key={index}>
                  <strong>{person.name}</strong> — {t(`confirm.next.${person.status}`)}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {/* After the people list, which names the email still to come: where to look for it (§NNN). */}
        <Alert severity="info" sx={{ mt: 2 }} data-testid="spam-hint">
          {await spamHintWords()}
        </Alert>
      </Container>
    );
  }

  /**
   * The token is read even when the POST came back `invalid=1`.
   *
   * That flag used to short-circuit straight to "this link is no longer valid", which is how
   * somebody who double-pressed Confirm in two tabs was told her registration had failed. The
   * read costs one throttled attempt either way, and it is the only way the page can tell a
   * spent link from a wrong one. A live token plus `invalid=1` still refuses: something else
   * went wrong with the press, and re-offering the button would hide it.
   */
  const context = await readRegistrationTokenContext(token, "VERIFY_REGISTRATION_EMAIL");
  const spent = context.ok
    ? null
    : await readSpentRegistrationLink(
        token,
        [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: context.reason }],
        locale,
        new Date(),
      );
  // A newer email replaced this link (§NNN): said so, in place of the generic refusal.
  const replaced = context.ok
    ? null
    : await readReplacedActionLink(token, [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: context.reason }], locale, new Date());

  const journeyStep = spent ? spent.step : ("confirm" as const);

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("confirm.title")}
      </Typography>

      {/* A spent link moves the stepper to where the registration actually is, and drops it
          entirely once there is no journey left (cancelled, lapsed). */}
      {journeyStep === "declare" ? (
        <RegistrationJourney current="declare" declaration="emailReceived" />
      ) : (
        journeyStep && <RegistrationJourney current={journeyStep} />
      )}

      {!context.ok || invalid ? (
        <ActionLinkNotice locale={locale} status={spent} replaced={replaced} />
      ) : (
        <form action={confirmEmailAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <Typography sx={{ mb: 2 }}>{t("confirm.prompt")}</Typography>
          {/* Presses itself as soon as the page has hydrated (§238). The POST is still a
              POST, which is what keeps a mail scanner's GET from spending the token. */}
          <ConfirmOnArrival
            label={t("confirm.action")}
            pendingLabel={t("confirm.pending")}
          />
        </form>
      )}
    </Container>
  );
}
