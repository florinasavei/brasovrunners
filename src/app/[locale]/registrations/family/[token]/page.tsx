import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { countForm } from "@/i18n/count-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { readFamilyEntryLinkPage } from "@/modules/registrations/token-actions";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import CheckboxField from "@/shared/ui/CheckboxField";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { confirmFamilyEntryAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; refused?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Another person on a registered address, confirmed from the inbox (§NNN, amending §389; the
 * owner, 2026-09-26: "în mail să îți afișez înscrierile și să zic «confirm că înscriu altă
 * persoană»").
 *
 * The page the email's one button opens. The GET reads the link and changes nothing — a mail
 * scanner opening it leaves it working (§12.8) — and shows what the press will do: who the address
 * holds at the event, the person the form named with the birth date, the consent sentence, and for
 * an adult the address holder's acknowledgement (§421). Only the POST registers, and it registers
 * straight away: the press proved the inbox, so there is no second confirmation link.
 *
 * Wrong details are not corrected here: the page says to send the form again, and this link lapses
 * by itself with the kept form. A refusal (the person is on the address already, the address is at
 * its limit, the waiting list is full) comes back to this page with the link unspent, the sentence
 * above the button.
 */
export default async function FamilyConfirmPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, refused } = await searchParams;
  const t = await getTranslations("Registrations");
  const tEvent = await getTranslations("Event");

  if (done === "declare" || done === "waitlist") {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("family.doneTitle")}
        </Typography>
        {done === "declare" && <RegistrationJourney current="declare" />}
        {/* The inbox is not named: that would put the address in the URL (§14.5). It is the one the email came to. */}
        <Alert severity="success" data-testid="family-confirmed">
          {done === "declare" ? t("family.done") : t("family.doneWaitlist")}
        </Alert>
      </Container>
    );
  }

  // One throttled read for the page; after a refused press whose link is known dead, none.
  const link = invalid ? null : await readFamilyEntryLinkPage(token, locale, new Date());

  if (!link || !link.ok) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("family.title")}
        </Typography>
        <ActionLinkNotice locale={locale} status={null} />
      </Container>
    );
  }

  // "4 persoane" / "4 people": the club's limit, in words that agree with it (§389, §341).
  const people = t(`family.people.${countForm(link.registrationsPerAddress, locale)}`, { count: link.registrationsPerAddress });
  // The refusal the press came back with, matched against the literals it may be (anybody can type a URL).
  const refusal =
    refused === ALREADY_ON_ADDRESS
      ? t("family.alreadyOnAddress")
      : refused === ADDRESS_AT_CAP
        ? t("family.atCap", { people })
        : refused === "fitnessAcknowledged"
          ? t("family.fitnessMissing")
          : refused === NO_WAITLIST
            ? tEvent("cta.fullNoWaitlist")
            : refused === WAITLIST_FULL
              ? tEvent("cta.waitlistFull")
              : refused
                ? t("family.refused")
                : null;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("family.title")}
      </Typography>

      <Stack spacing={2}>
        <Typography>{t("family.intro", { event: link.eventTitle ?? "", email: link.email })}</Typography>

        {refusal && (
          <Alert severity="warning" data-testid="family-refused">
            {refusal}
          </Alert>
        )}

        <div>
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: "1rem" }}>
            {t("family.registered")}
          </Typography>
          {link.registered.length > 0 ? (
            <Typography component="ul" data-testid="family-registered" sx={{ my: 0.5, pl: 3 }}>
              {link.registered.map((name, index) => (
                <li key={`${index}-${name}`}>{name}</li>
              ))}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("family.nobody")}
            </Typography>
          )}
        </div>

        <div data-testid="family-person">
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: "1rem" }}>
            {t("family.person")}
          </Typography>
          <Typography>{link.personName}</Typography>
          {link.personBirthDate && <Typography variant="body2">{t("family.birthDate", { date: link.personBirthDate })}</Typography>}
        </div>

        <Typography variant="body2">{t("family.next", { email: link.email, people })}</Typography>
        {link.adult && (
          <Typography variant="body2" color="text.secondary">
            {t("family.adultNote")}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {t("family.consent")}{" "}
          <Link href="/legal/privacy">{t("family.privacy")}</Link>
        </Typography>

        <form action={confirmFamilyEntryAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            {/* Another adult's fitness is theirs to declare, when they sign (§421): the holder acknowledges it. */}
            {link.adult && (
              <CheckboxField id="fitnessAcknowledged" name="fitnessAcknowledged" required>
                {t("family.fitnessAcknowledged")}
              </CheckboxField>
            )}
            <Button type="submit" variant="contained" sx={TAP_TARGET} data-testid="family-confirm">
              {t("family.action")}
            </Button>
          </Stack>
        </form>

        <Typography variant="body2" color="text.secondary">
          {t("family.wrongData")}
        </Typography>
      </Stack>
    </Container>
  );
}
