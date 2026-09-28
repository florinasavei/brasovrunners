import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import CelebrationIcon from "@mui/icons-material/Celebration";
import DrawIcon from "@mui/icons-material/Draw";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { daysPhrase, hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { cachedDeadlines, cachedEmailLeavesAt, cachedEmailWaitMinutes } from "@/modules/public-cache/reads";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { doneFamilySentence, offerHint, shortScreenEmailLeft } from "../domain/family-sitting";
import type { SubmittedFacts } from "../form-draft";
import FamilySittingOffer from "./FamilySittingOffer";

/**
 * What happens next, in three steps — the same three glyphs `RegistrationSteps` gives the
 * email, the declaration and the confirmation (§91), so a reader who saw the five-step flow
 * on the form recognises where they are: past the first step, standing on the second.
 */
const NEXT = [
  { key: "open", Icon: MarkEmailReadIcon },
  { key: "declare", Icon: DrawIcon },
  { key: "confirmed", Icon: QrCode2Icon },
] as const;

type Props = {
  eventTitle: string;
  /** The event's start, already formatted in its own zone and the reader's language. */
  whenLabel: string;
  /** The event's page, resolved by the caller with `getPathname` — a string across the boundary. */
  eventHref: string;
  /** The URL query the resend and contact pages take the event from. */
  slug: string;
  /** The inbox to open and the name to greet; null once the ten-minute cookie is gone. */
  facts: SubmittedFacts | null;
  /**
   * The participation window (§104) when it is still ahead: the declaration step then says how
   * many days before the start the confirmation is asked. Only that number is read here; the
   * deadline is `RegistrationSteps`'s longer telling, so the caller may pass its object as is.
   */
  window: { opensDays: number } | null;
  /**
   * After the first form of a would-be family (§536): the screen is then the short one — «Formularul
   * pentru Ana a ajuns.», «Emailul către ana@… pleacă la 10:15.» and, quiet after them, «Înscriu încă o
   * persoană cu această adresă» (`FamilySittingOffer`, §547) — and nothing else. `atOnce`: the club's window is 0 (§519).
   * `continueAction` is that press, a server action, never a component. `email` is the
   * address the form went to and `windowMinutes` the club's window as the action read it, both from the
   * browser's half (absent on an older half: the club's current window). `leavesAt` is when the first
   * form's email leaves, as the action computed it at submit (null: the request sent it; absent on an
   * older half: computed now).
   */
  offer?: {
    atOnce: boolean;
    email: string;
    windowMinutes?: number;
    leavesAt?: Date | null;
    /** Under `immediate` (`leavesAt` null), when the form was sent: a reload a minute later says it left (§540). */
    submittedAt?: Date;
    continueAction: (form: FormData) => Promise<void>;
  };
};

/**
 * The screen after the form: "Aproape gata, Ana!" (the owner: the check-your-email screen
 * "should be more fun"), and every fact the receipt it replaces carried.
 *
 * Warmth, not cuteness: a first name in the heading when there is one, the event and its date,
 * the address the message went to (§224), three short steps with a glyph each, the wait in
 * bold and once (§224, §513), the spam folder, how long the link lives — the club's own hours (§377),
 * the very number the link just sent was given, so this cannot promise what the platform does
 * not keep — and the sentence that keeps it true
 * for somebody who was already registered (§229). Then the two ways out when nothing arrives
 * (§205), and the way back to the event.
 *
 * **It reads the same for a first and a repeat registration.** Everything here comes from the
 * form the person just posted and the event they posted it to; nothing is read from the
 * registrations table, so the screen cannot answer whether an address was already on it — the
 * oracle `AGENTS.md` §19.4 forbids.
 *
 * A Server Component, like the rest of the flow (`AGENTS.md` §1.5): the icons are rendered
 * here as children, never handed to a client component as a prop, which is what fails
 * hydration (`GlyphChip.tsx`).
 *
 * **After the first form of a would-be family it is the short screen** (§536; the owner, 2026-09-28:
 * the screen must be clearer; the review's nits F0 and F2): the heading, then two lines — whose form
 * is in, and when its email leaves, the screen's point — and after them, since §547 one quiet text
 * press, «Înscriu încă o persoană cu această adresă», with at most one sentence under it (the owner,
 * 2026-09-28: «pare că încurajăm asta… când e doar o excepție»). No steps and no wait box: the
 * leaving time is said once, in one shape, and nothing contradicts it.
 */
export default async function CheckYourEmail({ eventTitle, whenLabel, eventHref, slug, facts, window, offer }: Props) {
  const t = await getTranslations("Registration");
  const locale = await getLocale();
  const familySentence = doneFamilySentence(facts);
  const family = familySentence !== null;
  /*
    The heading greets by first name, except where the line under it already says the name — a
    family's last screen, and the short screen's «Formularul pentru Ana a ajuns.» (the review of
    2026-09-28: the name twice in a row).
  */
  const heading = (named: boolean) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: "50%",
          bgcolor: "success.main",
          color: "success.contrastText",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CelebrationIcon />
      </Box>
      <Typography component="h2" variant="h2" sx={{ fontSize: { xs: "1.5rem", sm: "1.75rem" } }}>
        {named && facts?.firstName ? t("done.headingNamed", { name: facts.firstName }) : t("done.heading")}
      </Typography>
    </Box>
  );

  if (offer) {
    /*
      When the email leaves (§513), in the words the queue panel uses for the same message
      (`emailLeavesWords`, in its prose shape): the scheduled pass the action computed once when the
      form was sent and kept in the browser's half, or now when the request itself sent it. Never
      recomputed here (the review of 2026-09-28): a reload after the 13:15 pass would otherwise say
      «pleacă la 13:30» about an email already sent. Once the pass has come, the line says it left and
      the sentence under the press promises no hold. Nothing on this screen has to be pressed for it to leave.
    */
    const now = new Date();
    const leavesAt = offer.leavesAt !== undefined ? offer.leavesAt : await cachedEmailLeavesAt(now);
    const leaves = emailLeavesWords(leavesAt, now, locale, "prose");
    // Under «imediat» too (§540): the redirect from the submit says «pleacă acum», a reload after a minute «a plecat».
    const left = shortScreenEmailLeft({ leavesAt, submittedAt: offer.submittedAt, now });
    // The hint under the press names the club's window (§519): how long the email may wait for the next form.
    const sittingWindow = minutesPhrase(locale, offer.windowMinutes ?? (await cachedDeadlines()).familySittingMinutes);
    const hint = offerHint({ atOnce: offer.atOnce, leavesAt, now });
    // «până la 13:15» today, «până marți, 29 septembrie, la 10:00» on another day (§452: no «la» before a weekday).
    const hintKey = hint === "addHint" && leaves.key === "leavesOn" ? "addHintOn" : hint;
    const leavesLine = left
      ? t("done.leftAlready", { email: offer.email })
      : leaves.key === "leavesNow"
        ? t("done.leavesNow", { email: offer.email })
        : t(`done.${leaves.key}`, { email: offer.email, at: leaves.at });
    return (
      <Stack spacing={3} data-testid="check-email-short">
        <Box>
          {heading(false)}
          <Typography variant="body1" data-testid="check-email-form-in">
            {facts?.firstName ? t("done.formIn", { name: facts.firstName }) : t("done.formInUnnamed")}
          </Typography>
          <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 700 }} data-testid="check-email-leaves">
            {leavesLine}
          </Typography>
        </Box>
        {/* After the main content, quiet (§547): another person on the address is the exception. */}
        <FamilySittingOffer
          words={{
            add: t("sitting.addLink"),
            addPending: t("sitting.addPending"),
            hint: t(`sitting.${hintKey}`, { window: sittingWindow, at: "at" in leaves ? leaves.at : "" }),
          }}
          locale={locale}
          slug={slug}
          continueAction={offer.continueAction}
        />
      </Stack>
    );
  }

  const values = {
    confirmation: hoursPhrase(locale, (await cachedDeadlines()).confirmationHours),
    opens: daysPhrase(locale, window?.opensDays ?? 0),
  };
  // The club sends on the scheduler's tick by default (§513): the wait is then the pinger's, and
  // "within a minute" would be the promise that makes somebody fill the form in again.
  const waitMinutes = await cachedEmailWaitMinutes(new Date());
  const stepBody = (key: (typeof NEXT)[number]["key"]) =>
    key === "declare" && window ? t("done.next.declare.bodyLater", values) : t(`done.next.${key}.body`, values);
  const textLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  return (
    <Stack spacing={3}>
      <Box>
        {heading(!family)}
        <Typography variant="body1">{t("done.lead", { event: eventTitle, date: whenLabel })}</Typography>
        {/*
          A family sitting (§519): one email for everybody it sent the form for, named as typed on this
          browser — or, at a window of 0, where each person's email left on its own, the sentence that
          says so (the review of 2026-09-27).
        */}
        {familySentence && (
          <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 700 }} data-testid="check-email-family">
            {familySentence === "family" ? t("done.family", { names: (facts?.names ?? []).join(", ") }) : t("done.familyEach")}
          </Typography>
        )}
        {/*
          The address it went to (§224): "check your email" is useless to somebody who typed
          `@gmail.con`, and reading their own address back is what catches it in the second
          before they walk away.
        */}
        {facts?.email && (
          <Typography variant="body1" sx={{ mt: 0.5 }}>
            {t("submittedTo")}{" "}
            <Box component="strong" sx={{ wordBreak: "break-all" }}>
              {facts.email}
            </Box>
          </Typography>
        )}
      </Box>

      <Box component="section" aria-labelledby="check-email-next">
        <Typography id="check-email-next" component="h3" variant="h3" sx={{ fontSize: "1.125rem", mb: 1.5 }}>
          {t("done.nextTitle")}
        </Typography>
        <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {NEXT.map(({ key, Icon }, index) => (
            <Box component="li" key={key} sx={{ display: "grid", gridTemplateColumns: "40px 1fr", columnGap: 1.5, alignItems: "start" }}>
              <Box
                aria-hidden="true"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  bgcolor: index === 0 ? "primary.main" : "action.selected",
                  color: index === 0 ? "primary.contrastText" : "text.primary",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon fontSize="small" />
              </Box>
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {t(`done.next.${key}.title`)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {stepBody(key)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box sx={{ borderLeft: 3, borderColor: "primary.main", pl: 2 }}>
        {/* The wait, in bold and once (§224, §513): not knowing it is normal is what makes somebody
            fill the form in again thirty seconds later. */}
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {waitMinutes === null ? t("done.delay") : t("done.delayScheduled", { wait: minutesPhrase(locale, waitMinutes) })}
        </Typography>
        <Typography variant="body2">{t("done.notArrived", values)}</Typography>
        {/*
          The sentence that keeps this screen true (§229). Re-submitting an address that is
          already confirmed re-sends the confirmation, QR and all (§199); saying "you are already
          registered" here would answer a question about somebody else's address to anybody who
          types it (§19.4), so the sentence reads the same for everybody and only the owner of
          the inbox learns which case they are in.
        */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("submittedAlready")}
        </Typography>
      </Box>

      <Box>
        {/*
          The two ways out when the message does not arrive (§205; the owner: "trebuie să lăsăm
          oamenii să se înscrie cu orice preț"): the resend for a message lost in transit, and —
          quieter, second, present — the contact form for an address the resend cannot reach.
          Both carry the event so nobody is asked a second question.
        */}
        <Typography variant="body2" color="text.secondary">
          {t("resend.prompt")}{" "}
          <Link href={{ pathname: "/registrations/resend", query: { event: slug } }} style={textLink}>
            {t("resend.linkLabel")}
          </Link>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("resend.stillNothing")}{" "}
          <Link href={{ pathname: "/contact", query: { about: slug } }} style={textLink}>
            {t("resend.contactLinkLabel")}
          </Link>
        </Typography>
      </Box>

      <Box>
        {/* `component="a"` with a resolved path, never `component={Link}`: a component reference
            does not cross the Server → client boundary (`GlyphChip.tsx`). */}
        <Button component="a" href={eventHref} variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
          <ArrowBackIcon aria-hidden="true" sx={glyphSx("medium")} />
          {t("done.backToEvent")}
        </Button>
      </Box>
    </Stack>
  );
}
