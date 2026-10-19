import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import SaveIcon from "@mui/icons-material/Save";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { readRsvpLink } from "@/modules/rsvp/rsvp";
import AutoConfirm from "@/modules/rsvp/ui/AutoConfirm";
import { isWithdrawnProof, REFUSED_SUFFIX, WITHDRAWN_ASKED_SUFFIX } from "@/modules/rsvp/withdrawn-proof";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { confirmRsvpAction, refuseRsvpAsksAction, setNameByLinkAction, withdrawRsvpAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ invalid?: string; retras?: string; ok?: string; nu?: string; refuz?: string; nume?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * What `?nume=` may say after the name tick (§827): names of outcomes, never a value of the person's; anything else is nothing. «Shown» and
 * «hidden» claim a state, so they are drawn only while the row says so (below): the address alone proves nothing.
 */
const NAME_OUTCOMES = ["shown", "hidden", "name", "none", "closed", "wait"] as const;

/**
 * The page a «Vin!» message's two buttons open (§811, «Vin!» part 1): «Da, vin» (`RSVP_CONFIRM`) or «Nu mai vin» (`RSVP_WITHDRAW`) —
 * one route, because the link itself says which it is.
 *
 * **The GET changes nothing** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4): a mail client's link scanner opens every link before
 * its owner does, and must count nobody and delete nobody. The page names the event and shows ONE button; the button is a POST
 * (`actions.ts`) that spends the link. A link already used, replaced or past its life says so in one sentence and points at the
 * event's page; one that is unknown says so and points at the listing. The read is throttled per link, as every token page is
 * (§19.4, `tokenAttemptAllowed`).
 *
 * **The «Vii mâine la …?» email's two buttons (§818) open this page too** — they are the same two links, minted for a row the email
 * made (`asked`). «Vin» is one press: above the button, an optional name and the tick «Vreau să apar cu numele» (the event page card's
 * own words) — a person who gives neither is counted without a name, and the newsletter never had one to lend. «Nu vin» is one press
 * that deletes the row: nobody is counted, and the page says so in the sentence the email promised. The box comes above the button (a
 * field before its submit), under the intro; the privacy notice is linked beside it, as on the event page's card.
 * **«Nu mă mai întreba la seria aceasta» (§823)** is the third link, in the question an earlier answerer receives (`RSVP_REFUSE`): the same page,
 * the same rule — the GET names the event and shows ONE button, the button is a POST (`refuseRsvpAsksAction`) that records the refusal for the
 * series and spends the link. After it, the sentence «Gata: nu te mai întrebăm» comes from a keyed proof, like «Nu mai vin»'s; no cookie is set.
 * **«Da, vin» presses itself in a browser** (§812, amending §811; the owner, 2026-10-19: «Asta ar trebui să se auto-bifeze când
 * deschid»). The page above is unchanged — the sentence, the POST form, the button — and, for a live `RSVP_CONFIRM` link whose answer
 * is not counted yet, the form is wrapped in the one island that presses that button once the page is shown in a browser
 * (`AutoConfirm`). This GET still writes nothing and does not know whether the island will run: a scanner that fetches the link without
 * running scripts, and a browser without JavaScript, see the button and count nobody; the island does not press while the page is
 * prerendered or its tab is hidden. A link sandbox that runs scripts can still count the address (accepted, see `AutoConfirm.tsx`). A spent, expired, withdrawn or already-counted link has no island, and `RSVP_WITHDRAW` is always a press
 * (it takes something away).
 * **«Nu mai vin» is also where the name is shown or hidden** (§827, amending §812; the owner, 2026-10-19: «oamenii să poată ușor să zică
 * „afișează / ascunde" numele meu public»). A live `RSVP_WITHDRAW` link of a COUNTED answer carries, above the button, the tick «Numele meu apare
 * la „Cine vine"» in its own small form (`setNameByLinkAction`): a real tick box and «Salvează», the «Numele tău» box only when the answer holds no
 * name. That POST does not spend the link, so «Nu mai vin» still works from the same page afterwards; the GET draws it and writes nothing. A spent,
 * expired or unknown link, and the unanswered question of the «Vii?» email, have no tick.
 * **Where the two meet** (the dispatcher, 2026-10-19, merging the two lanes): an asked row with no name yet keeps its one press —
 * the optional name and the tick «Vreau să apar cu numele» stand above the button, and a press that came by itself would make that
 * choice for the person. Every other live, uncounted confirm link — a named asked row included — presses itself.
 */
export default async function RsvpLinkPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { invalid, retras, ok, nu, refuz, nume } = await searchParams;
  const nameQuery = NAME_OUTCOMES.find((outcome) => outcome === nume) ?? null;
  const t = await getTranslations("Rsvp");
  const tEvent = await getTranslations("Event");
  const db = getDb();
  const now = new Date();
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  /*
    After «Nu mă mai întreba la seria aceasta» (§823): the refusal is recorded and the link is spent; the sentence comes only with the keyed
    proof the action made (an address somebody typed claims nothing), and names the event's page when the slug is the proof's.
  */
  if (refuz !== undefined && invalid === undefined && isWithdrawnProof(ok, token, `${refuz}${REFUSED_SUFFIX}`)) {
    const event = refuz ? await findPublishedEventBySlug(db, locale, refuz) : undefined;
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("askRefuseDoneTitle")}
        </Typography>
        <Stack spacing={1.5}>
          <Alert severity="success" role="status" data-testid="rsvp-refused">
            {t("askRefuseDone")}
          </Alert>
          <Typography variant="body2">
            {event ? (
              <Link href={{ pathname: "/events/[slug]", params: { slug: refuz } }} style={inlineLink}>
                {t("eventLink")}
              </Link>
            ) : (
              <Link href="/events" style={inlineLink}>
                {t("eventsLink")}
              </Link>
            )}
          </Typography>
        </Stack>
      </Container>
    );
  }

  /*
    After «Nu mai vin» (the answer and its links are gone): the sentence, and the event's page when it is known. The row is gone, so
    the database cannot say the press happened: the redirect carries a keyed proof (`withdrawn-proof.ts`), and without it (an address
    somebody typed) the page names no event and claims nothing.
  */
  if (retras !== undefined && invalid === undefined) {
    // `nu` is the email's «Nu vin» (§818): its sentence, only with the proof the action made for it (the server read it from the deleted row).
    const declined = nu !== undefined && isWithdrawnProof(ok, token, `${retras}${WITHDRAWN_ASKED_SUFFIX}`);
    const event = retras && (declined || isWithdrawnProof(ok, token, retras)) ? await findPublishedEventBySlug(db, locale, retras) : undefined;
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {declined ? t("askNoDoneTitle") : t("withdrawnTitle")}
        </Typography>
        <Stack spacing={1.5}>
          <Alert severity="success" role="status" data-testid="rsvp-withdrawn">
            {declined ? t("askNoDone") : event ? t("withdrawDone", { event: event.title }) : t("withdrawDoneNoEvent")}
          </Alert>
          <Typography variant="body2">
            {event ? (
              <Link href={{ pathname: "/events/[slug]", params: { slug: retras ?? "" } }} style={inlineLink}>
                {t("eventLink")}
              </Link>
            ) : (
              <Link href="/events" style={inlineLink}>
                {t("eventsLink")}
              </Link>
            )}
          </Typography>
        </Stack>
      </Container>
    );
  }

  const link = invalid !== undefined || !(await tokenAttemptAllowed(db, token, now)) ? null : await readRsvpLink(db, token, now);
  const live = link?.state === "live" ? link : null;
  // «Gata: numele tău apare» only when the tick is on, «nu mai apare» only when it is off: a sentence from the address alone is not drawn (the «retras» proof's reason).
  const nameOutcome = nameQuery === "shown" ? (live?.showName ? nameQuery : null) : nameQuery === "hidden" ? (live && !live.showName ? nameQuery : null) : nameQuery;
  // «Da, vin»: a POST, so the GET above counts nobody (§12.8); the island may press it, a person always can.
  const confirmForm = (
    <form action={confirmRsvpAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton label={t("confirmButton")} pendingLabel={t("confirmPending")} size="large">
        <EventAvailableIcon />
      </SubmitButton>
    </form>
  );

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {!link ? t("linkInvalid") : link.purpose === "RSVP_REFUSE" ? t("askRefuseTitle") : link.purpose === "RSVP_WITHDRAW" ? (link.asked ? t("askNoTitle") : live?.confirmed ? t("answerTitle") : t("withdrawTitle")) : link.asked ? t("askTitle") : t("confirmTitle")}
      </Typography>

      {!live ? (
        <Stack spacing={1.5} data-testid="rsvp-link-invalid">
          <Alert severity="warning">
            <AlertTitle>{t("linkInvalid")}</AlertTitle>
            {link?.state === "over"
              ? t("invalidOver")
              : link?.state === "expired"
                ? t("invalidExpired")
                : link?.state === "used" && link.confirmed && link.purpose === "RSVP_CONFIRM"
                  ? t("confirmAlready", { event: link.title })
                  : t("invalidBody")}
          </Alert>
          <Typography variant="body2">
            {link ? (
              <Link href={{ pathname: "/events/[slug]", params: { slug: link.slug } }} style={inlineLink}>
                {t("eventLink")}
              </Link>
            ) : (
              <Link href="/events" style={inlineLink}>
                {t("eventsLink")}
              </Link>
            )}
          </Typography>
        </Stack>
      ) : live.purpose === "RSVP_REFUSE" ? (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography data-testid="rsvp-refuse-intro">{t("askRefuseIntro", { event: live.title })}</Typography>
          {/* A POST, so the GET above records nothing (§12.8): the press records the refusal and spends the link. */}
          <form action={refuseRsvpAsksAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton label={t("askRefuseButton")} pendingLabel={t("withdrawPending")} size="large" variant="outlined">
              <NotificationsOffIcon />
            </SubmitButton>
          </form>
        </Stack>
      ) : live.purpose === "RSVP_CONFIRM" ? (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography data-testid="rsvp-confirm-intro">
            {live.confirmed ? t("confirmAlready", { event: live.title }) : live.asked ? t("askIntro", { event: live.title }) : t("confirmIntro", { event: live.title })}
          </Typography>
          {/* The email's «Vin» with no name yet keeps its press (the name is the person's choice); every other uncounted link presses itself. */}
          {live.asked && !live.named ? (
            <form action={confirmRsvpAction} style={{ width: "100%" }}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              {/* The email's «Vin» (§818): the name is the person's to give, here, with the same box and tick as the event page's card. */}
              {live.asked && !live.named && (
                <Stack spacing={1.5} sx={{ mb: 2 }} data-testid="rsvp-ask-name">
                  <TextField name="name" label={tEvent("rsvp.name")} fullWidth autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} />
                  <CheckboxField name="showName">{tEvent("rsvp.showName")}</CheckboxField>
                  <Typography variant="body2" color="text.secondary">
                    <Link href="/legal/privacy" style={inlineLink}>{tEvent("rsvp.privacy")}</Link>
                  </Typography>
                </Stack>
              )}
              <SubmitButton label={t("confirmButton")} pendingLabel={t("confirmPending")} size="large">
                <EventAvailableIcon />
              </SubmitButton>
            </form>
          ) : live.confirmed ? (
            confirmForm
          ) : (
            <AutoConfirm>{confirmForm}</AutoConfirm>
          )}
          {!live.confirmed && !(live.asked && !live.named) && (
            <Typography variant="body2" data-testid="rsvp-confirm-auto">
              {t("confirmAutoNote")}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("rememberNote")}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          {/* A counted answer's page does two jobs, so it opens neutral; «Nu mai vii? … se șterge» stands directly above the button it explains. */}
          {live.confirmed && <Typography data-testid="rsvp-answer-intro">{t("answerIntro", { event: live.title })}</Typography>}
          {nameOutcome !== null && (
            <Alert severity={nameOutcome === "shown" || nameOutcome === "hidden" ? "success" : "warning"} role="status" data-testid="rsvp-name-note">
              {tEvent(`rsvp.nameOutcome.${nameOutcome}`)}
            </Alert>
          )}
          {/*
            The name tick (§827): only a counted answer has a name to show; its POST reads the link and does not spend it (`setNameByLinkAction`).
            The box «Numele tău» is always there, prefilled with the name the answer holds — the person is shown what the tick publishes and may
            change it (§812: a name typed on the page with the tick off is never published unseen); blank when the answer holds none.
          */}
          {live.confirmed && (
            <form action={setNameByLinkAction} style={{ width: "100%" }} data-testid="rsvp-name-switch">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <CheckboxField name="showName" defaultChecked={live.showName} help={live.name !== null ? tEvent("rsvp.nameKept", { name: live.name }) : tEvent("rsvp.nameAsk")}>
                  {tEvent("rsvp.nameSwitch")}
                </CheckboxField>
                <TextField name="name" label={tEvent("rsvp.nameBox")} defaultValue={live.name ?? ""} fullWidth autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} />
                <SubmitButton label={tEvent("rsvp.nameSave")} pendingLabel={tEvent("rsvp.submitting")} variant="outlined">
                  <SaveIcon />
                </SubmitButton>
              </Stack>
            </form>
          )}
          <Typography data-testid="rsvp-withdraw-intro">{live.asked ? t("askNoIntro", { event: live.title }) : t("withdrawIntro", { event: live.title })}</Typography>
          <form action={withdrawRsvpAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton label={live.asked ? t("askNoButton") : t("withdrawButton")} pendingLabel={t("withdrawPending")} size="large" variant="outlined">
              <EventBusyIcon />
            </SubmitButton>
          </form>
          {/* After the email's unanswered question the browser is not remembered (`withdrawRsvpAction`): no note about a cookie. */}
          {!live.asked && (
            <Typography variant="body2" color="text.secondary" data-testid="rsvp-withdraw-remember">
              {t("withdrawRememberNote")}
            </Typography>
          )}
        </Stack>
      )}
    </Container>
  );
}
