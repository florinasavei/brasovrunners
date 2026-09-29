import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DrawIcon from "@mui/icons-material/Draw";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import UnsubscribeIcon from "@mui/icons-material/Unsubscribe";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { confirmationDueMoment } from "@/modules/registrations/domain/hold-deadlines";
import { readMyRegistrations } from "@/modules/registrations/my-registrations";
import { cachedPromotionalMaterialsOffered } from "@/modules/public-cache/reads";
import PublicFlash from "@/shared/feedback/PublicFlash";
import ContactLink from "@/shared/ui/ContactLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  cancelFromMyRegistrationsAction,
  selfCheckInFromMyRegistrationsAction,
  setListConsentFromMyRegistrationsAction,
  setPromoConsentFromMyRegistrationsAction,
  startFamilySigningFromMyRegistrationsAction,
  withdrawFromMyRegistrationsAction,
} from "./actions";
import { declarationStateKey, isSignable } from "@/modules/registrations/domain/family-signing";
import { DENSITY } from "@/theme/density";
import FamilyChip from "@/modules/registrations/ui/FamilyChip";
import QrWithName, { type QrWords } from "@/modules/registrations/ui/QrWithName";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{
    done?: string;
    invalid?: string;
    started?: string;
    here?: string;
    hereFailed?: string;
    list?: string;
    listFailed?: string;
    withdrawn?: string;
    field?: string;
    withdrawFailed?: string;
    /** The offers-and-benefits switch (§NNN): the registration it saved, or refused. */
    promo?: string;
    promoFailed?: string;
  }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every active registration of the person holding the link (BR-REQ-036-04, `DECISIONS.md`
 * §77): the event, the state, the code and its QR once confirmed, "I am here" from the day
 * before, and cancel. A GET reads and never writes; every button is its own POST. An invalid,
 * expired or used token renders the same sentence every token page renders.
 */
export default async function MyRegistrationsPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, started, here, hereFailed, list, listFailed, withdrawn, field, withdrawFailed, promo, promoFailed } = await searchParams;
  const t = await getTranslations("Registrations");
  // The words beside every QR (§547): whose it is, their number, the code.
  const qrWords: QrWords = {
    alt: (name) => t("manage.qrTitle", { name }),
    number: (number) => t("qr.number", { number }),
    code: (code) => t("qr.code", { code }),
  };
  /*
    The page's one toast slot (§427): the cancel's, on its own outcome page, and «Semnează
    declarațiile» refused for an address with nobody left to walk (§471, nit found in review), on
    the list it lands back on. Each flash is written only before the redirect to its own branch.
  */
  const flashSlot = <PublicFlash accept={["unregistered", "familySignNothingLeft", "familySignOneLeft"]} />;

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("mine.cancelledTitle")}
        </Typography>
        <Alert severity="success">{t("mine.cancelled")}</Alert>
        {/* The toast the cancel flashed (§427). */}
        {flashSlot}
        <Typography sx={{ mt: 2 }}>
          <Link href="/registrations/mine">{t("mine.newLink")}</Link>
        </Typography>
      </Container>
    );
  }

  // One token read for the page — throttled per presented token.
  const now = new Date();
  const context = invalid ? { ok: false as const } : await readMyRegistrations(getDb(), token, locale, now);
  /*
    Offers and benefits (§NNN, second fix round): «Înscrierile mele» is a door out only. The address
    link cannot tell the holder from another adult on the same address, and the notice names this
    page as a way to withdraw, never to give — so a row that says yes gets «Nu mai vreau», and a row
    that says no gets one sentence pointing to where the yes is given: the registration's own page
    (the link in its email) or the declaration. The server refuses a yes from here (FORBIDDEN).
    The sentence only while the notice in force describes the offers; «Nu mai vreau» always.
  */
  const promoOn = context.ok ? await cachedPromotionalMaterialsOffered(now) : false;
  /** The offers-and-benefits line for one registration (§NNN): its answer, and the way out when it is yes. */
  const promoSwitch = (item: { id: string; promoConsent: boolean }, closed = false) => (
    <Stack spacing={1} sx={{ mt: 1.5 }} data-testid="my-promo">
      {promo === item.id && (
        <Alert severity="success" sx={{ py: 0 }}>
          {t("promo.changed")}
        </Alert>
      )}
      {promoFailed === item.id && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {t("promo.failed")}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" data-testid="my-promo-state">
          {item.promoConsent ? t(closed ? "promo.closedYes" : "promo.yes") : t("promo.no")}
        </Typography>
        {item.promoConsent && (
          <form action={setPromoConsentFromMyRegistrationsAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="registrationId" value={item.id} />
            <input type="hidden" name="consent" value="0" />
            <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
              <UnsubscribeIcon aria-hidden="true" sx={glyphSx("small")} />
              {t("promo.optOut")}
            </Button>
          </form>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" data-testid={item.promoConsent ? undefined : "my-promo-where"}>
        {item.promoConsent ? t("promo.help") : t("promo.whereToSayYes")}
      </Typography>
    </Stack>
  );

  /*
    A family's declarations, signed as one wizard (§471): every event at which this address holds
    two or more declarations still to sign gets one button, which exchanges this link on the server
    for the wizard's pass and opens the declaration page — the same steps an emailed link opens.
  */
  const familySigning = context.ok
    ? [...new Set(context.items.filter((item) => !item.eventCancelled && isSignable(item.status)).map((item) => item.eventId))]
        .map((eventId) => context.items.filter((item) => item.eventId === eventId && isSignable(item.status)))
        .filter((items) => items.length > 1)
    : [];

  /** The declaration's line under one person (§519), or null where there is nothing to say (cancelled). */
  const declarationLine = (item: { status: Parameters<typeof declarationStateKey>[0]; declarationSignedAt: Date | null; eventTimezone: string }) => {
    const key = declarationStateKey(item.status, item.declarationSignedAt);
    if (key === null) return null;
    if (key === "signed" && item.declarationSignedAt) {
      return t("mine.declaration.signed", {
        when: formatDay(item.declarationSignedAt, { locale, timeZone: item.eventTimezone, style: "long", position: "inline" }),
      });
    }
    return t(`mine.declaration.${key}`);
  };

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("mine.listTitle")}
      </Typography>

      {started && <Alert severity="info" sx={{ mb: 2 }}>{t("manage.eventStarted")}</Alert>}
      {context.ok && flashSlot}
      {/* A closed registration whose last consent data was just withdrawn leaves the list (§324), so the answer is said here. */}
      {withdrawn &&
        context.ok &&
        !context.items.some((item) => item.id === withdrawn) &&
        !context.closed.some((item) => item.id === withdrawn) && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {field === "socials" ? t("withdraw.socialsDone") : t("withdraw.healthDone")}
          </Alert>
        )}
      {/* A closed registration whose last consent was the promotional one leaves the list once withdrawn (§NNN). */}
      {promo &&
        context.ok &&
        !context.items.some((item) => item.id === promo) &&
        !context.closed.some((item) => item.id === promo) && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {t("promo.changed")}
          </Alert>
        )}

      {!context.ok ? (
        <>
          <Alert severity="warning">{t("invalidOrExpired")}</Alert>
          <Typography sx={{ mt: 2 }}>
            <Link href="/registrations/mine">{t("mine.newLink")}</Link>
          </Typography>
        </>
      ) : context.items.length === 0 && context.pending.length === 0 ? (
        <Typography>{t("mine.empty")}</Typography>
      ) : (
        <>
        {/*
          People sent on the form and not confirmed yet (§446, §519): not registrations — nobody holds
          a place for them — so a line each, and where the button that registers them is.
        */}
        {context.pending.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="my-pending-people">
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {t("mine.pending.title")}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {context.pending.map((person) => (
                <Typography component="li" variant="body2" key={person.id}>
                  {person.eventTitle
                    ? t("mine.pending.person", { name: person.name, event: person.eventTitle })
                    : person.name}
                </Typography>
              ))}
            </Box>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("mine.pending.how")}
            </Typography>
          </Alert>
        )}
        {familySigning.map((items) => (
          <Alert key={items[0].eventId} severity="info" sx={{ mb: 2 }} data-testid="my-family-signing">
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t("mine.familySign.body", {
                event: items[0].eventTitle ?? "",
                names: items.map((item) => item.registeredName).join(", "),
              })}
            </Typography>
            <form action={startFamilySigningFromMyRegistrationsAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="eventId" value={items[0].eventId} />
              <Button type="submit" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                <DrawIcon aria-hidden="true" sx={glyphSx("medium")} />
                {t("mine.familySign.action")}
              </Button>
            </form>
          </Alert>
        ))}
        <Stack component="ul" spacing={2} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {context.items.map((item) => (
            <Box
              component="li"
              key={item.id}
              data-testid="my-registration"
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Typography variant="h2" sx={{ fontSize: "1.125rem" }}>
                  {item.eventSlug ? (
                    <Link href={{ pathname: "/events/[slug]", params: { slug: item.eventSlug } }}>
                      {item.eventTitle ?? item.eventId}
                    </Link>
                  ) : (
                    (item.eventTitle ?? item.eventId)
                  )}
                </Typography>
                <Chip
                  size="small"
                  color={item.status === "CONFIRMED" ? "success" : item.status === "WAITLISTED" ? "default" : "warning"}
                  label={t(`mine.status.${item.status}`)}
                />
                {/* The race will not run (§331); the registration's own state stays beside it. */}
                {item.eventCancelled && <Chip size="small" color="error" label={t("mine.eventCancelledChip")} />}
              </Stack>
              {/*
                Whose registration this is (§389): one address may carry a family, each person a
                registration of their own, so every row names its runner. Behind the address's own
                link, which is the one place the names on it may be read.
              */}
              <Typography variant="body1" sx={{ fontWeight: 600 }} data-testid="my-registration-name">
                {t("mine.runner", { name: item.registeredName })}
              </Typography>
              {/*
                The family marker (§543; the owner, 2026-09-28: «trebuie un marker pentru familie»): the
                other people on this address at the same event, from this page's own list — nothing more
                is read, and nothing about another address (§39).
              */}
              <Box sx={{ mt: 0.5 }}>
                <FamilyChip
                  label={t("mine.family")}
                  members={context.items
                    .filter((other) => other.eventId === item.eventId && other.id !== item.id)
                    .map((other) => ({ name: other.registeredName }))}
                  testId="my-registration-family"
                />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: declarationLine(item) ? 0.5 : 1.5 }}>
                {formatDay(item.eventStartsAt, { locale, timeZone: item.eventTimezone, style: "long", withTime: true })}
              </Typography>
              {/*
                Where this person's declaration stands (§519; the owner: «pagina „Toate înscrierile
                mele” arată starea declarației fiecăruia»): signed with its day, to sign, asked after
                the address is confirmed, or asked when the waiting list offers a place.
              */}
              {declarationLine(item) && (
                <Typography variant="body2" sx={{ mb: 1.5 }} data-testid="my-registration-declaration">
                  {declarationLine(item)}
                </Typography>
              )}
              {item.eventCancelled && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  {t("mine.eventCancelled")}
                </Alert>
              )}
              {/*
                By when to confirm (§104, §407; the owner: "nu e clar când pot confirma"): a place
                held for a declaration, still ahead of its deadline, says the date — and "până la
                start" beside it when the deadline is the start itself (`confirmationDueMoment`).
                Not a waiting-list offer: its email already says its day, and paper on race day
                does not answer an offer.
              */}
              {/*
                A family's reserved place (§543), still ahead: the same instant the family's email names,
                so the page and the email agree on whose place is held and until when.
              */}
              {!item.eventCancelled && item.status === "PENDING_EMAIL_CONFIRMATION" && item.holdExpiresAt && item.holdExpiresAt.getTime() > now.getTime() && (
                <Typography variant="body2" sx={{ mb: 1.5 }} data-testid="my-registration-reserved">
                  {t("mine.reservedUntil", {
                    until: formatDay(item.holdExpiresAt, { locale, timeZone: item.eventTimezone, style: "long", withTime: true, position: "inline" }),
                  })}
                </Typography>
              )}
              {!item.eventCancelled &&
                item.status === "PENDING_DECLARATION" &&
                item.holdExpiresAt &&
                item.holdExpiresAt.getTime() > now.getTime() && (
                  <Typography variant="body2" sx={{ mb: 1.5 }} data-testid="my-registration-confirm-by">
                    {t("mine.confirmBy", {
                      due: confirmationDueMoment(
                        locale,
                        { at: item.holdExpiresAt, startsAt: item.eventStartsAt },
                        formatDay(item.holdExpiresAt, { locale, timeZone: item.eventTimezone, style: "long", withTime: true, position: "inline" }),
                      ),
                    })}
                  </Typography>
                )}

              {/* No desk code or QR for a race that will not run: the desk is closed (§331). */}
              {/*
                The QR with the person's name and race number beside it (§547): a family's codes
                told apart at a glance. The number is the one rule's (`raceNumberOf`), «—» while none
                is given; it exists once the registration is confirmed, and nothing qualifies it.
              */}
              {item.status === "CONFIRMED" && item.checkinCode && !item.eventCancelled && (
                <Box sx={{ mb: 1.5 }}>
                  <QrWithName checkinCode={item.checkinCode} registeredName={item.registeredName} status={item.status} bibNumber={item.bibNumber} size={160} words={qrWords} />
                </Box>
              )}

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                {item.status === "CONFIRMED" &&
                  (here === item.id || item.checkedInAt ? (
                    <Alert severity="success" sx={{ py: 0 }}>
                      {t("manage.selfCheckInDone")}
                    </Alert>
                  ) : hereFailed === item.id ? (
                    <Alert severity="warning" sx={{ py: 0 }}>
                      {t("manage.selfCheckInFailed")}
                    </Alert>
                  ) : item.selfCheckinOpen ? (
                    <form action={selfCheckInFromMyRegistrationsAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="registrationId" value={item.id} />
                      <Button type="submit" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                        <HowToRegIcon aria-hidden="true" sx={glyphSx("medium")} />
                        {t("manage.selfCheckIn")}
                      </Button>
                    </form>
                  ) : null)}
                <form action={cancelFromMyRegistrationsAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="registrationId" value={item.id} />
                  <Button type="submit" variant="outlined" color="error" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                    <EventBusyIcon aria-hidden="true" sx={glyphSx("small")} />
                    {t("mine.cancel")}
                  </Button>
                </form>
              </Stack>
              {/* What cancelling does not do, where it is done (§323): the place goes, the record stays. */}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t.rich("cancelKeepsRecord", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
              </Typography>

              {/*
                The public participant list, the participant's own switch (BR-REQ-039-01;
                `DECISIONS.md` §143): the answer as it stands, and the button that sets the other
                one. The link is read, never spent — as "I am here" above — so cancel stays.
              */}
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {list === item.id && (
                  <Alert severity="success" sx={{ py: 0 }}>
                    {t("list.changed")}
                  </Alert>
                )}
                {listFailed === item.id && (
                  <Alert severity="warning" sx={{ py: 0 }}>
                    {t("list.failed")}
                  </Alert>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    {item.listed ? t("list.shortListed") : t("list.shortNotListed")}
                  </Typography>
                  <form action={setListConsentFromMyRegistrationsAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="registrationId" value={item.id} />
                    <input type="hidden" name="listed" value={item.listed ? "0" : "1"} />
                    <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                      {item.listed ? <VisibilityOffIcon aria-hidden="true" sx={glyphSx("small")} /> : <VisibilityIcon aria-hidden="true" sx={glyphSx("small")} />}
                      {item.listed ? t("list.optOut") : t("list.optIn")}
                    </Button>
                  </form>
                </Stack>
              </Stack>

              {/*
                The offers and benefits (§NNN): «Nu mai vreau» whenever the row says yes; a no only says
                where the yes is given, while the notice in force describes them. The link is read, never
                spent, as the list switch above. Separate from the newsletter, and the words say so.
              */}
              {(item.promoConsent || promoOn) && promoSwitch(item)}

              {/*
                What was given on consent, withdrawn from here (§322; art. 7(3) GDPR). A button
                only for what this registration still holds — the page knows *whether*, never
                *what* — and the link is read, not spent, so cancel above still works.
              */}
              {(item.holdsHealthNote || item.holdsSocials || withdrawn === item.id || withdrawFailed === item.id) && (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {withdrawn === item.id && (
                    <Alert severity="success" sx={{ py: 0 }}>
                      {field === "socials" ? t("withdraw.socialsDone") : t("withdraw.healthDone")}
                    </Alert>
                  )}
                  {withdrawFailed === item.id && (
                    <Alert severity="warning" sx={{ py: 0 }}>
                      {t("withdraw.failed")}
                    </Alert>
                  )}
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                    {item.holdsHealthNote && (
                      <form action={withdrawFromMyRegistrationsAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="registrationId" value={item.id} />
                        <input type="hidden" name="field" value="health" />
                        <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                          <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("small")} />
                          {t("withdraw.health")}
                        </Button>
                      </form>
                    )}
                    {item.holdsSocials && (
                      <form action={withdrawFromMyRegistrationsAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="registrationId" value={item.id} />
                        <input type="hidden" name="field" value="socials" />
                        <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                          <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("small")} />
                          {t("withdraw.socials")}
                        </Button>
                      </form>
                    )}
                  </Stack>
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
        </>
      )}

      {/*
        The registrations that are over — checked in, cancelled, expired — and still hold what
        was given on consent (§324): the health note until seven days after the event, the
        Strava and Instagram with the registration. "Delete them at any time from My
        registrations" is true for these too; the two buttons and nothing else, since there is
        nothing left to manage.
      */}
      {context.ok && context.closed.length > 0 && (
        <Box component="section" sx={{ mt: 3 }} data-testid="my-closed-registrations">
          <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 0.5 }}>
            {t("mine.closedTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("mine.closedHelp")}
          </Typography>
          <Stack component="ul" spacing={2} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {context.closed.map((item) => (
              <Box component="li" key={item.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>{item.eventTitle ?? item.eventId}</Typography>
                  <Chip size="small" label={t(`mine.status.${item.status}`)} />
                </Stack>
                {/* Whose data the buttons below withdraw (§389, §420): one address may carry several runners. */}
                <Typography variant="body1" data-testid="my-closed-registration-name">
                  {t("mine.runner", { name: item.registeredName })}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {formatDay(item.eventStartsAt, { locale, timeZone: item.eventTimezone, style: "long" })}
                </Typography>
                {withdrawn === item.id && (
                  <Alert severity="success" sx={{ py: 0, mb: 1 }}>
                    {field === "socials" ? t("withdraw.socialsDone") : t("withdraw.healthDone")}
                  </Alert>
                )}
                {withdrawFailed === item.id && (
                  <Alert severity="warning" sx={{ py: 0, mb: 1 }}>
                    {t("withdraw.failed")}
                  </Alert>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                  {item.holdsHealthNote && (
                    <form action={withdrawFromMyRegistrationsAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="registrationId" value={item.id} />
                      <input type="hidden" name="field" value="health" />
                      <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                        <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("small")} />
                        {t("withdraw.health")}
                      </Button>
                    </form>
                  )}
                  {item.holdsSocials && (
                    <form action={withdrawFromMyRegistrationsAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="registrationId" value={item.id} />
                      <input type="hidden" name="field" value="socials" />
                      <Button type="submit" variant="text" size="small" sx={{ minHeight: 44, ...WITH_GLYPH_SX }}>
                        <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("small")} />
                        {t("withdraw.socials")}
                      </Button>
                    </form>
                  )}
                </Stack>
                {/* A consent to offers and benefits outlives the place (§NNN): only the way out here. */}
                {item.promoConsent && promoSwitch(item, true)}
                {/* Withdrawn just now, while the card stays for its other data: the answer, and no way back in here. */}
                {!item.promoConsent && promo === item.id && (
                  <Alert severity="success" sx={{ py: 0, mt: 1.5 }}>
                    {t("promo.changed")}
                  </Alert>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Container>
  );
}
