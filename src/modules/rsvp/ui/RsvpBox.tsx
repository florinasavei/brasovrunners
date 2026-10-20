import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { answerRsvpAction, requestRsvpWithdrawAction } from "@/app/[locale]/events/[slug]/actions";
import { countForm } from "@/i18n/count-form";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cachedMemberDefinition, cachedRsvpMemberDescribed } from "@/modules/public-cache/reads";
import { BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { spamHintWords } from "@/modules/registrations/ui/link-wait-words";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import CheckboxField from "@/shared/ui/CheckboxField";
import Hint from "@/shared/ui/Hint";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX, PUBLIC_FOLD_SX } from "@/shared/ui/disclosure";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CLUB_NAME } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { rsvpCountText } from "../domain/summary";
import { RSVP_BOX_ID, type RsvpOutcome } from "../rsvp-box";
import type { PublicRsvps } from "../rsvp";
import { readRsvpsOf } from "./RsvpCount";
import RsvpSummary from "./RsvpSummary";
import { rsvpForgetAction, rsvpGoAction, rsvpLeaveAction, rsvpMemberAction, rsvpShowNameAction, rsvpStateAction } from "../remembered-actions";
import RsvpRemembered from "./RsvpRemembered";

/**
 * «Confirmă prezența (opțional)» (§811, «Vin!» part 1, named «Vii?» until §825; the owner, 2026-10-19: «Și pune „Confirmă prezența
 * (opțional)", ceva de genul») — the answer «Vin!» on a turn-up event the club ticked. Drawn by `EventPageView` as the LAST thing on the event
 * page (§825 amended; the owner, 2026-10-20: «adică trebuie să fie ultima chestie de pe site»), with the anchor `#vin`, **only while `rsvpOffered` says so** (the page decides, from the one rule): otherwise the page
 * shows nothing — no box, no count, no sentence. Who comes is **not in it any more**: «Cine vine (N)» is the fold right under it
 * (`RsvpCount`, anchor `#cine-vine`), so a reader who gets to the end sees both bars together.
 *
 * Not a registration: no place, no declaration — the sentence under the bar says so («Nu e o înscriere: ne ajută să știm câți venim.»).
 * The interest box's twin (`registrations/ui/RegistrationInterestForm.tsx`) in how it works — a Server Component around a Server Action,
 * the honeypot and the rendering time riding along as hidden fields, the Turnstile widget when the club switched it on, the answer a
 * sentence after a redirect, **the same sentence whatever the address turned out to mean** — plus a tick, «Vreau să apar cu numele»,
 * which is the person's own consent to a public name (§143, §396).
 *
 * **A closed fold since §812** (the owner, 2026-10-19: «Asta ar trebui să fie collapsed, ca și condițiile de participare»): the same
 * `<details>` as «Condiții de participare» (`EventPageView`) — the 44-pixel bar, the glyph, a real `h2` in the summary — closed on
 * arrival, with what a reader decides by on its line: «Confirmă prezența (opțional) · 3 vin», «… · Fii primul care confirmă» when nobody has
 * answered, «… · Tu vii ✓ · 3 vin» once the island knows this browser did (`RsvpSummary`, `domain/summary.ts`). Opened: the form (or the
 * one-tap state), its help and «Nu mai vin». The anchor `#vin` is the fold's own id, so a link to it — the calendar's «Vin! →», the
 * listing's chip, the link page's landing — opens it (`OpenFoldFromHash`, mounted by the page), and the answer a post leaves in the
 * address (`?vin=…`) opens it on the server, or the sentence would sit behind a closed bar.
 *
 * Without JavaScript the typed form stands and works. The one client island (`RsvpRemembered`) wraps it: a browser that used a
 * «Da, vin» link carries a hint cookie, and the island swaps the typed form for one tap. The page stays static for everybody.
 */
export default async function RsvpBox({
  locale,
  slug,
  eventId,
  renderedAt,
  outcome,
  rsvps: given,
}: {
  locale: Locale;
  slug: string;
  eventId: string;
  /** When this form was rendered — or, on a corrected address, when the one it corrects was. */
  renderedAt: Date;
  outcome: RsvpOutcome | null;
  /**
   * The answers the page already read (`readRsvpsOf`, §822): `EventPageView` reads them once, before the calendar's add links, so the links'
   * «N vin până acum» and this card say one number from one read. Absent, the box reads them itself; `null` is «the database is away».
   */
  rsvps?: PublicRsvps | null;
}) {
  const t = await getTranslations("Event");
  const tForm = await getTranslations("Registration");
  const siteKey = turnstileSiteKey();
  /*
    The member tick (§831): «Sunt membru al grupului {club}» with the club's sentence behind its «?» — the registration form's own words (§789, §796), read
    through the public cache — offered only while the notice in force describes the mark, so a visitor is never asked to declare what the notice does
    not say. The service asks again at every answer.
  */
  const memberOffered = await cachedRsvpMemberDescribed(new Date());
  const memberHint = (memberOffered ? await cachedMemberDefinition(locale) : null) ?? tForm("clubMemberDefinition");
  const memberTick = tForm("clubMemberDeclared", { club: CLUB_NAME });
  // The mark's word is said once, in `rsvp.memberMark`, and read into every sentence that names it.
  const mark = t("rsvp.memberMark");
  // Read once: the closed line and the fold «Cine vine» under it (the page hands both the same read) say one number, and a database that is away says neither (§281).
  const rsvps = given === undefined ? await readRsvpsOf(eventId) : given;
  const summaryWords = {
    // «3 vin» — and, when some of them are members, «3 vin · 2 membri» (§831): the count's own words, then the members' (`members` counts the named and the unnamed).
    countText:
      rsvps !== null && rsvps.count > 0
        ? rsvpCountText(
            t(`rsvp.chip.${countForm(rsvps.count, locale)}`, { count: rsvps.count }),
            rsvps.members ? t(`rsvp.members.${countForm(rsvps.members, locale)}`, { count: rsvps.members }) : null,
          )
        : null,
    emptyText: t("rsvp.summaryEmpty"),
    goingText: t("rsvp.going"),
  };

  const labels = {
    rememberedAs: t.raw("rsvp.rememberedAs") as string,
    going: t("rsvp.going"),
    cancel: t("rsvp.cancel"),
    cancelling: t("rsvp.submitting"),
    notMe: t("rsvp.notMe"),
    help: t("rsvp.help"),
    failed: t("rsvp.failed"),
    submit: t("rsvp.submit"),
    submitting: t("rsvp.submitting"),
    showName: t("rsvp.showName"),
    nameSwitch: t("rsvp.nameSwitch"),
    nameHelp: t.raw("rsvp.nameKept") as string,
    nameAsk: t("rsvp.nameAsk"),
    nameBox: t("rsvp.nameBox"),
    nameSave: t("rsvp.nameSave"),
    nameShown: t("rsvp.nameOutcome.shown"),
    nameHidden: t("rsvp.nameOutcome.hidden"),
    nameNeeded: t("rsvp.nameOutcome.name"),
    nameNone: t("rsvp.nameOutcome.none"),
    memberTick,
    memberHint,
    memberHelp: t("rsvp.memberHelp", { mark }),
    memberOn: t("rsvp.memberOutcome.on", { mark }),
    memberOff: t("rsvp.memberOutcome.off"),
    memberClosed: t("rsvp.memberOutcome.closed"),
    memberFact: t("rsvp.memberFact"),
    memberFactHelp: t("rsvp.memberFactHelp", { mark }),
  };

  return (
    <Box component="section" aria-labelledby={`${RSVP_BOX_ID}-heading`} sx={{ mt: { xs: DENSITY.gapSm, sm: 3 } }}>
      <Box
        component="details"
        id={RSVP_BOX_ID}
        data-testid="rsvp-box"
        // Closed on arrival, like «Condiții de participare»; open when the address carries an answer to read (`?vin=…`).
        open={outcome !== null || undefined}
        sx={{ ...PUBLIC_FOLD_SX, scrollMarginTop: 16 }}
      >
        <Box component="summary">
          <Typography id={`${RSVP_BOX_ID}-heading`} component="h2" variant="h2" sx={{ fontSize: "1.25rem" }}>
            <EventAvailableIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {t("rsvp.heading")}
            <RsvpSummary slug={slug} words={summaryWords} countKnown={rsvps !== null} />
          </Typography>
        </Box>
        <Box sx={{ maxWidth: 480 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("rsvp.intro")}
          </Typography>

          {outcome === "sent" ? (
            // The same sentence whether the address was new, already counted or held back by the throttle (BR-REQ-031-01
            // criterion 3): the box is not an oracle for who answered.
            <>
              <Alert severity="success" role="status" data-testid="rsvp-sent">
                {t("rsvp.done")}
              </Alert>
              {/* The email is still to come: where to look for it (§619). */}
              <Alert severity="info" sx={{ mt: 1.5 }} data-testid="spam-hint">
                {await spamHintWords()}
              </Alert>
            </>
          ) : (
            <RsvpRemembered slug={slug} locale={locale} labels={labels} memberOffered={memberOffered} actions={{ state: rsvpStateAction, go: rsvpGoAction, leave: rsvpLeaveAction, forget: rsvpForgetAction, showName: rsvpShowNameAction, member: rsvpMemberAction }}>
              {outcome === "withdrawSent" && (
                <Alert severity="info" role="status" sx={{ mb: 1.5 }} data-testid="rsvp-withdraw-sent">
                  {t("rsvp.withdrawDone")}
                </Alert>
              )}
              <form action={answerRsvpAction}>
                <Stack spacing={1.5}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="slug" value={slug} />
                  {/* Bots fill every field; a human never sees or fills this one. */}
                  <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
                  <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />

                  {(outcome === "invalid" || outcome === "captcha") && (
                    <Alert severity="error" role="alert">
                      {t(`rsvp.${outcome}`)}
                    </Alert>
                  )}

                  <TextField
                    name="email"
                    type="email"
                    label={t("rsvp.email")}
                    required
                    fullWidth
                    autoComplete="email"
                    slotProps={{ htmlInput: { maxLength: 320 } }}
                    error={outcome === "invalid"}
                  />
                  <TextField name="name" label={t("rsvp.name")} fullWidth autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} />
                  <CheckboxField name="showName">{t("rsvp.showName")}</CheckboxField>
                  {/* «Sunt membru al grupului …» (§831): the person's own declaration, off by default; the club does not check it. Posted as `clubMember`, read by the action. */}
                  {memberOffered && (
                    <CheckboxField name="clubMember" help={t("rsvp.memberHelp", { mark })}>
                      {memberTick}
                      <Hint text={memberHint} />
                    </CheckboxField>
                  )}

                  {/* Cloudflare Turnstile, when the club switched it on (§97): the same explicit widget as every other form (§185, §518, §577). */}
                  {siteKey && (
                    <Box sx={BOT_CHECK_SLOT_SX}>
                      <BotCheck siteKey={siteKey} locale={locale} attempt={renderedAt.toISOString()} notice />
                    </Box>
                  )}

                  <SubmitButton label={t("rsvp.submit")} pendingLabel={t("rsvp.submitting")} size="large">
                    <EventAvailableIcon />
                  </SubmitButton>

                  <Typography variant="body2" color="text.secondary">
                    {t("rsvp.note")} <Link href="/legal/privacy">{t("rsvp.privacy")}</Link>
                  </Typography>
                </Stack>
              </form>

              {/* «Nu mai vin»: the withdraw link by email, never saying whether the address is on the list (BR-REQ-031-01 criterion 3). */}
              <Box
                component="details"
                data-testid="rsvp-withdraw"
                sx={{ mt: 1.5, "& > summary": { ...DISCLOSURE_SUMMARY_SX, minHeight: 44, py: 0.5, fontSize: "0.9375rem" }, ...DISCLOSURE_OPEN_ARROW }}
              >
                <Box component="summary">
                  <EventBusyIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
                  {t("rsvp.withdrawSummary")}
                </Box>
                <form action={requestRsvpWithdrawAction}>
                  <Stack spacing={1.5} sx={{ pt: 1, pb: 0.5 }}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
                    <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />
                    <Typography variant="body2" color="text.secondary">
                      {t("rsvp.withdrawIntro")}
                    </Typography>
                    <TextField name="withdrawEmail" type="email" label={t("rsvp.email")} required fullWidth autoComplete="email" slotProps={{ htmlInput: { maxLength: 320 } }} />
                    <SubmitButton label={t("rsvp.withdrawSubmit")} pendingLabel={t("rsvp.withdrawSubmitting")} variant="outlined">
                      <EventBusyIcon />
                    </SubmitButton>
                  </Stack>
                </form>
              </Box>
            </RsvpRemembered>
          )}
        </Box>
      </Box>
    </Box>
  );
}
