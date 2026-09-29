import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import ContactLink from "@/shared/ui/ContactLink";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import { formatDay } from "@/i18n/dates";
import { leadPhrase } from "@/modules/deadlines/domain/duration-words";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { getDb } from "@/db/client";
import { holdsOptionalData } from "@/modules/registrations/consent-withdrawal";
import { isActiveStatus } from "@/modules/registrations/domain/state-machine";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import AskFirstButton from "@/modules/registrations/ui/AskFirstButton";
import QrWithName, { type QrWords } from "@/modules/registrations/ui/QrWithName";
import { readRaceDayContext, readSpentRegistrationLink } from "@/modules/registrations/token-actions";
import PublicFlash from "@/shared/feedback/PublicFlash";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  cancelRegistrationAction,
  selfCheckInAction,
  setListConsentFromManageAction,
  withdrawFromManageAction,
} from "./actions";
import { DENSITY } from "@/theme/density";
import FamilyChip from "@/modules/registrations/ui/FamilyChip";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{
    done?: string;
    invalid?: string;
    started?: string;
    here?: string;
    list?: string;
    withdrawn?: string;
    /** Which person a check-in or a list answer was about (§547): an id the page already lists, never a name. */
    person?: string;
  }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Manage/cancel a registration (BR-REQ-036-01). The GET shows the current state and asks for
 * explicit confirmation; nothing changes until the POST.
 *
 * **Per person since §547** (amending §77 and the family branch's QR page; the owner, 2026-09-28,
 * walking a family of three on QA): the page lists the registration the link names and every other
 * active registration of the same address at the same event (`listManagedPeople`) — each with their
 * own QR, name and race number, their state, their own public-list choice (§143) and their own
 * «Anulează înscrierea pentru <nume>», which asks first (§384). A single registration keeps a
 * one-person page. The page reveals nothing about any other address, nor about the address's other
 * events (§39): the inbox that holds this link holds the same list on «Înscrierile mele» (§77).
 *
 * **No signed declaration here any more** (§547): the PDF, with the identity document in it, travels
 * only in the email that delivered it (§85–§87); a link that anybody holding the manage email can
 * forward is not where it belongs. The page says it was sent.
 */
export default async function ManageRegistrationPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, started, here, list, withdrawn, person } = await searchParams;
  const t = await getTranslations("Registrations");
  // The words beside every QR (§547): whose it is, their number, the code.
  const qrWords: QrWords = {
    alt: (name) => t("manage.qrTitle", { name }),
    number: (number) => t("qr.number", { number }),
    code: (code) => t("qr.code", { code }),
  };

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        {/* An outcome page still opens with a heading: a document whose only content is an
            alert gives a screen reader nothing to navigate to. */}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("manage.doneTitle")}
        </Typography>
        <Alert severity="success">{t("manage.done")}</Alert>
        {/*
          A family's page (§547): the cancel spent the link, as every cancellation does (§12.8), so
          the other people on the address are reached through a fresh «Înscrierile mele» link.
        */}
        {done === "family" && (
          <Typography sx={{ mt: 2 }} data-testid="manage-done-others">
            {t("manage.doneOthers")}{" "}
            <Link href="/registrations/mine" style={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
              {t("mine.newLink")}
            </Link>
          </Typography>
        )}
        {/* The toast the cancel flashed (§427), on this outcome only. */}
        <PublicFlash accept={["unregistered"]} />
      </Container>
    );
  }

  // One token read for the page — it is throttled per presented token, so a second read here
  // would charge the participant twice. It also carries race day (BR-REQ-037-08): the code,
  // its QR, and "I am here", shown only once confirmed.
  //
  // The token is read even after a failed POST. `invalid=1` used to skip the read, so somebody
  // who had already cancelled from this link — the one action that spends it — was told the
  // link was broken rather than that the registration was cancelled and the place released.
  const context = started ? null : await readRaceDayContext(token, new Date());
  const spent =
    context && !context.ok
      ? await readSpentRegistrationLink(
          token,
          [{ purpose: "MANAGE_REGISTRATION" as const, reason: context.reason }],
          locale,
          new Date(),
        )
      : null;
  const blocked = context === null || !context.ok || Boolean(invalid);
  const live = context !== null && context.ok && !invalid ? context : null;
  const people = live?.people ?? [];
  const family = people.length > 1;
  // The event's title in this language, for the question the cancel asks (§384) — never another language's.
  const details = live ? await findEventNotificationDetails(getDb(), live.registration.eventId, locale) : undefined;
  const eventTitle = details?.locale === locale ? details.title : "";
  // Which person a check-in or list answer was about: the one the press named, else the link's own.
  const answeredFor = person ?? live?.registration.id;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("manage.title")}
      </Typography>

      {started ? (
        <Alert severity="info">{t("manage.eventStarted")}</Alert>
      ) : blocked || !live ? (
        <ActionLinkNotice locale={locale} status={spent} />
      ) : (
        <Stack spacing={3}>
          {/* The race will not run (§331): said first, and no race-day block under it. This page has no
              «Eveniment anulat» chip, so its own line names the cancellation (§NNN). */}
          {live.eventCancelled && <Alert severity="info">{t("manage.eventCancelled")}</Alert>}
          {/*
            A family on the address (§547): one heading with the family glyph, the marker naming the
            others (the family branch's «Familie»), and a card per person below.
          */}
          {family && (
            <Box>
              <Typography variant="h2" sx={{ fontSize: "1.25rem", display: "flex", alignItems: "center", gap: 1 }}>
                <FamilyRestroomIcon aria-hidden="true" />
                {t("manage.familyTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
                {t("manage.familyIntro")}
              </Typography>
              <FamilyChip label={t("mine.family")} members={live.family.map((name) => ({ name }))} testId="manage-family" />
            </Box>
          )}

          {people.map((one) => {
            const confirmed = one.status === "CONFIRMED" && one.checkinCode && !live.eventCancelled ? one.checkinCode : null;
            const active = isActiveStatus(one.status);
            const answered = answeredFor === one.id;
            return (
              <Box
                component="section"
                key={one.id}
                aria-label={one.registeredName}
                data-testid="manage-person"
                sx={family ? { border: 1, borderColor: "divider", borderRadius: 1, p: 2 } : undefined}
              >
                {family && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
                    <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 700 }} data-testid="manage-person-name">
                      {one.registeredName}
                    </Typography>
                    <Chip
                      size="small"
                      color={one.status === "CONFIRMED" ? "success" : one.status === "WAITLISTED" ? "default" : active ? "warning" : "default"}
                      label={t(`mine.status.${one.status}`)}
                      data-testid="manage-person-state"
                    />
                  </Stack>
                )}

                {confirmed && (
                  <Box sx={{ mb: 2 }}>
                    {!family && (
                      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                        {t("manage.raceDayTitle")}
                      </Typography>
                    )}
                    <Typography sx={{ mb: 2 }}>{t("manage.codeIntro")}</Typography>
                    {/* The QR with the name and the race number beside it (§547): a family's codes told apart. */}
                    <QrWithName
                      checkinCode={confirmed}
                      registeredName={one.registeredName}
                      status={one.status}
                      bibNumber={one.bibNumber}
                      size={200}
                      words={qrWords}
                    />
                    <Box sx={{ mt: 2 }}>
                      {(answered && here === "1") || one.checkedInAt ? (
                        <Alert severity="success">{t("manage.selfCheckInDone")}</Alert>
                      ) : answered && here === "0" ? (
                        <Alert severity="warning">{t("manage.selfCheckInFailed")}</Alert>
                      ) : one.selfCheckinOpen ? (
                        <form action={selfCheckInAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="token" value={token} />
                          <input type="hidden" name="registrationId" value={one.id} />
                          <Button type="submit" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                            <HowToRegIcon aria-hidden="true" sx={glyphSx("medium")} />
                            {t("manage.selfCheckIn")}
                          </Button>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {t("manage.selfCheckInHelp", { checkin: leadPhrase(locale, live.selfCheckinHours) })}
                          </Typography>
                        </form>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t("manage.selfCheckInClosed", {
                            // It opens at an hour, the club's check-in lead before the start, in the event's zone (§349, §377).
                            date: formatDay(live.selfCheckinOpensAt, { locale, timeZone: live.eventTimezone, style: "long", withTime: true, position: "inline" }),
                          })}
                        </Typography>
                      )}
                    </Box>
                    {/* The signed declaration went by email only after an online signature; a paper one at the desk (§67) had no email. */}
                    {one.declarationMethod === "EMAIL_LINK" ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} data-testid="manage-declaration-sent">
                        {t("manage.signedSent")}
                      </Typography>
                    ) : one.declarationMethod === "PAPER" ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} data-testid="manage-declaration-paper">
                        {t("manage.signedPaper")}
                      </Typography>
                    ) : null}
                    {!family && <Divider sx={{ mt: 3 }} />}
                  </Box>
                )}

                {/*
                  The public participant list, each person's own switch (BR-REQ-039-01; `DECISIONS.md`
                  §143). The manage token is read, never spent — the same page must still be able to
                  cancel — and the sentence reads the row as it stands now. `#list` is the link's own
                  person's, where the confirmation email's list link lands.
                */}
                {active && (
                  <Box id={one.own ? "list" : undefined} sx={{ mb: 2 }}>
                    {!family && (
                      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                        {t("list.title")}
                      </Typography>
                    )}
                    {answered && list === "1" && (
                      <Alert severity="success" sx={{ mb: 2 }}>
                        {t("list.changed")}
                      </Alert>
                    )}
                    {answered && list === "0" && (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        {t("list.failed")}
                      </Alert>
                    )}
                    <Typography sx={{ mb: 1 }}>
                      {family ? (one.listOptOut ? t("list.shortNotListed") : t("list.shortListed")) : one.listOptOut ? t("list.notListed") : t("list.listed")}
                    </Typography>
                    <form action={setListConsentFromManageAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="registrationId" value={one.id} />
                      <input type="hidden" name="listed" value={one.listOptOut ? "1" : "0"} />
                      <Button type="submit" variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                        {one.listOptOut ? (
                          <VisibilityIcon aria-hidden="true" sx={glyphSx("medium")} />
                        ) : (
                          <VisibilityOffIcon aria-hidden="true" sx={glyphSx("medium")} />
                        )}
                        {one.listOptOut ? t("list.optIn") : t("list.optOut")}
                      </Button>
                    </form>
                    {!family && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {t("list.help")}
                      </Typography>
                    )}
                    {!family && <Divider sx={{ mt: 3 }} />}
                  </Box>
                )}

                {/*
                  «Anulează înscrierea pentru <nume>» (§547): each person's own, asking first (§384) and
                  naming the person. `#cancel` is the link's own person's — where "I can't make it any
                  more" in the email lands (§96). The server accepts only a registration of this address
                  at this event.
                */}
                {(active || !family) && (
                  <form action={cancelRegistrationAction} id={one.own ? "cancel" : undefined} data-testid="manage-person-cancel">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="registrationId" value={one.id} />
                    {!family && <Typography sx={{ mb: 1 }}>{t("manage.prompt")}</Typography>}
                    <AskFirstButton
                      glyph="cancel"
                      label={t("manage.personCancel", { name: one.registeredName })}
                      title={t("manage.cancelTitle", { name: one.registeredName })}
                      body={t("manage.cancelBody", { name: one.registeredName, event: eventTitle })}
                      confirmLabel={t("manage.cancelConfirm")}
                      cancelLabel={t("manage.cancelBack")}
                    />
                  </form>
                )}
              </Box>
            );
          })}

          {/* What cancelling does not do, where it is done (§323): the place goes, the record stays. */}
          <Typography variant="body2" color="text.secondary">
            {t.rich("cancelKeepsRecord", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
          </Typography>

          {/*
            What was given on consent, withdrawn from here (§322; art. 7(3) GDPR: as easy as it
            was to give) — the link's own person's: another adult's consents stay theirs (§421).
            A button only for what the row still holds — never the value itself on the page — each
            its own POST, the link read and not spent, so cancel above still works. The outcome
            stays shown after the button that caused it has gone.
          */}
          {(holdsOptionalData(live.registration, "health") || holdsOptionalData(live.registration, "socials") || (withdrawn !== undefined && withdrawn !== "")) && (
            <Box component="section" id="consent">
              <Divider sx={{ mb: 3 }} />
              <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                {t("withdraw.title")}
              </Typography>
              {withdrawn === "health" && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t("withdraw.healthDone")}
                </Alert>
              )}
              {withdrawn === "socials" && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t("withdraw.socialsDone")}
                </Alert>
              )}
              {withdrawn === "0" && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("withdraw.failed")}
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("withdraw.help")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "flex-start" }}>
                {holdsOptionalData(live.registration, "health") && (
                  <form action={withdrawFromManageAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="field" value="health" />
                    <Button type="submit" variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                      <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("medium")} />
                      {t("withdraw.health")}
                    </Button>
                  </form>
                )}
                {holdsOptionalData(live.registration, "socials") && (
                  <form action={withdrawFromManageAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="field" value="socials" />
                    <Button type="submit" variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                      <DeleteOutlinedIcon aria-hidden="true" sx={glyphSx("medium")} />
                      {t("withdraw.socials")}
                    </Button>
                  </form>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </Container>
  );
}
