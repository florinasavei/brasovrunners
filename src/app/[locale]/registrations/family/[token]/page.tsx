import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { countForm } from "@/i18n/count-form";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { readFamilyEntryLinkPage, readFamilySittingLinkPage } from "@/modules/registrations/token-actions";
import FamilySittingConfirm from "@/modules/registrations/ui/FamilySittingConfirm";
import DrawIcon from "@mui/icons-material/Draw";
import Button from "@mui/material/Button";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { DENSITY } from "@/theme/density";
import { confirmFamilyEntryAction, confirmFamilySittingAction, declineFamilyEntryAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; refused?: string; decline?: string; wizard?: string; nobody?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Another person on a registered address, confirmed from the inbox (§446, amending §389; the
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

  const { done, invalid, refused, decline, wizard, nobody } = await searchParams;
  const t = await getTranslations("Registrations");
  const tEvent = await getTranslations("Event");

  // «Nu înscriu această persoană» was pressed (§468): the kept form is deleted and nobody registered.
  if (done === "declined") {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("family.declinedTitle")}
        </Typography>
        <Alert severity="info" data-testid="family-declined">
          {t("family.declined")}
        </Alert>
      </Container>
    );
  }

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

  /*
    A family confirmed with one press (§NNN), and somebody on its list did not join — or nobody has
    a declaration to sign (the waiting list). What happened, as sentences for the markers in the
    address, and the way into the declarations when there are some: the pass the press handed this
    browser carries the wizard on the declaration page under this same link.
  */
  if (done === "family") {
    const markers = new Set((refused ?? "").split(","));
    const refusals = [
      markers.has(ADDRESS_AT_CAP) ? t("familySitting.refusedAtCap") : null,
      markers.has(ALREADY_ON_ADDRESS) ? t("familySitting.refusedAlready") : null,
      markers.has("waitlist") ? t("familySitting.refusedWaitlist") : null,
      markers.has("other") ? t("familySitting.refusedOther") : null,
    ].filter((sentence): sentence is string => sentence !== null);
    /*
      Nobody joined (`nobody=1`): every kept form unticked, or every person refused. The address was
      not confirmed and nobody registered, so the page says that, never «the registrations are made».
    */
    const nobodyJoined = nobody === "1";
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {nobodyJoined ? t("familySitting.nobodyTitle") : t("familySitting.doneTitle")}
        </Typography>
        {!nobodyJoined && <RegistrationJourney current="declare" />}
        <Stack spacing={2}>
          {nobodyJoined ? (
            <Alert severity="info" data-testid="family-sitting-nobody">
              {refusals.length > 0 ? t("familySitting.nobodyRefused") : t("familySitting.nobody")}
            </Alert>
          ) : (
            <Alert severity="success" data-testid="family-sitting-done">
              {t("familySitting.done")}
            </Alert>
          )}
          {refusals.map((sentence) => (
            <Alert key={sentence} severity="warning" data-testid="family-sitting-refused">
              {sentence}
            </Alert>
          ))}
          {wizard === "1" ? (
            <div>
              <Button
                component="a"
                href={getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } })}
                variant="contained"
                sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}
                data-testid="family-sitting-sign"
              >
                <DrawIcon aria-hidden="true" sx={glyphSx("medium")} />
                {t("familySitting.sign")}
              </Button>
            </div>
          ) : nobodyJoined ? null : (
            <Typography>{t("familySitting.nothingToSign")}</Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("familySitting.mineHint")} <Link href="/registrations/mine">{t("familySitting.mine")}</Link>
          </Typography>
        </Stack>
      </Container>
    );
  }

  // One throttled read for the page; after a refused press whose link is known dead, none.
  const link = invalid ? null : await readFamilyEntryLinkPage(token, locale, new Date());
  /*
    Not one person's link: perhaps a family's (§NNN) — the same token purpose, read again without a
    second charge, since this request already paid its one attempt above.
  */
  const sittingLink =
    !invalid && link && !link.ok && !link.throttled ? await readFamilySittingLinkPage(token, locale, new Date(), { charge: false }) : null;
  if (sittingLink?.ok) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {sittingLink.eventTitle ? t("familySitting.title", { event: sittingLink.eventTitle }) : t("familySitting.titlePlain")}
        </Typography>
        <RegistrationJourney current="confirm" />
        <FamilySittingConfirm locale={locale} token={token} link={sittingLink} refused={refused} action={confirmFamilySittingAction} />
      </Container>
    );
  }

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

  const personBlock = (
    <div data-testid="family-person">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: "1rem" }}>
        {t("family.person")}
      </Typography>
      <Typography sx={{ fontWeight: 700 }}>{link.personName}</Typography>
      {link.personBirthDate && <Typography variant="body2">{t("family.birthDate", { date: link.personBirthDate })}</Typography>}
    </div>
  );

  /*
    «Nu înscriu această persoană» (§468): the email's second button opens this shape of the page. It
    reads the link like the confirmation does and changes nothing (§12.8); only the press deletes.
    The way back is the same page without the marker — the link is still unspent.
  */
  if (decline === "1") {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("family.declineTitle")}
        </Typography>
        <Stack spacing={2}>
          <Typography>{t("family.declineIntro", { event: link.eventTitle ?? "", email: link.email })}</Typography>
          {personBlock}
          <form action={declineFamilyEntryAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <div data-testid="family-decline">
              <SubmitButton label={t("family.decline")} pendingLabel={t("family.declinePending")} size="medium">
                <PersonRemoveIcon />
              </SubmitButton>
            </div>
          </form>
          <Typography>
            <Link href={{ pathname: "/registrations/family/[token]", params: { token } }}>{t("family.declineBack")}</Link>
          </Typography>
        </Stack>
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

        {personBlock}

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
            {/*
              The shared send button (§371): it paints "Se înscrie…" at once and holds a second
              press, which would otherwise find the token spent and land on "this link no longer
              works" after the first press had registered the person.
            */}
            <div data-testid="family-confirm">
              <SubmitButton label={t("family.action")} pendingLabel={t("family.actionPending")} runner size="medium" />
            </div>
          </Stack>
        </form>

        <Typography variant="body2" color="text.secondary">
          {t("family.wrongData")}
        </Typography>

        {/* The other answer to the same link (§468), quieter than the confirmation: the kept form deleted, nobody registered. */}
        <form action={declineFamilyEntryAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <div data-testid="family-decline">
            <SubmitButton label={t("family.decline")} pendingLabel={t("family.declinePending")} variant="outlined" size="medium">
              <PersonRemoveIcon />
            </SubmitButton>
          </div>
        </form>
      </Stack>
    </Container>
  );
}
