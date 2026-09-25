import FemaleIcon from "@mui/icons-material/Female";
import MaleIcon from "@mui/icons-material/Male";
import PersonIcon from "@mui/icons-material/Person";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { cachedCurrentApprovedDocument, cachedListStatesDisclosed, cachedPublicAvailability } from "@/modules/public-cache/reads";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import LegalLink from "@/shared/ui/LegalLink";
import { routing } from "@/i18n/routing";
import ReadAndAgree from "@/modules/registrations/ui/ReadAndAgree";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import { costUrlHost } from "@/modules/events/domain/cost";
import { registrationState } from "@/modules/events/domain/registration-window";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { countryOptions } from "@/modules/registrations/countries";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import { readFormDraft, readSubmittedFacts } from "@/modules/registrations/form-draft";
import { SECOND_ATTEMPT_FIELD, UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { ageRuleVariant, dayIn, latestBirthDateFor, yearsPhrase } from "@/modules/registrations/domain/age";
import { acceptanceAfterRefusal, ERROR_SUMMARY_ID, parseInvalidFields } from "@/modules/registrations/form-errors";
import { countryName } from "@/modules/registrations/names";
import CheckYourEmail from "@/modules/registrations/ui/CheckYourEmail";
import EmailDeliveryNotice from "@/modules/registrations/ui/EmailDeliveryNotice";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";
import {
  OPTION_GLYPH_SX,
  OPTION_LABEL_SX,
  OPTION_ROW_SX,
  SELECT_WITH_GLYPHS_SX,
} from "@/shared/ui/select-option";
import CheckboxField from "@/shared/ui/CheckboxField";
import GuardianForMinor from "@/modules/registrations/ui/GuardianForMinor";
import HiddenForMinor from "@/modules/registrations/ui/HiddenForMinor";
import ShownForMinor from "@/modules/registrations/ui/ShownForMinor";
import EmailTwice from "@/modules/registrations/ui/EmailTwice";
import ClubForMember from "@/modules/registrations/ui/ClubForMember";
import Flag from "@/shared/ui/Flag";
import Hint from "@/shared/ui/Hint";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import SubmitButton from "@/shared/ui/SubmitButton";
import { activeBotCheckSiteKey } from "@/modules/registrations/bot-check";
import { readAddressCap } from "@/modules/registrations/address-cap";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS, ANOTHER_LINK_INVALID, ANOTHER_PERSON_PARAM } from "@/modules/registrations/domain/family";
import { readAnotherPersonLink } from "@/modules/registrations/token-actions";
import { countForm } from "@/i18n/count-form";
import TurnstileWidget from "@/modules/registrations/ui/TurnstileWidget";
import { submitRegistrationAction } from "./actions";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { env } from "@/shared/config/env";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ submitted?: string; error?: string; fields?: string; retry?: string; another?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** The anchor a field is reached by from the error summary. Prefixed so it cannot collide. */
const fieldId = (name: string) => `f-${name}`;


/**
 * An optional group, **open by default** since 2026-09-17. It was collapsed to shorten the page
 * (`DECISIONS.md` §47, 580px saved), and the cost turned out to be the one thing the club cares
 * about in that group: the field for a runner's own club sat behind a summary nobody opened,
 * and the owner reported the field as missing. Open, the page is longer and everything on it is
 * seen; the element stays a `<details>` so anybody who wants it shorter can fold it. Native,
 * styled to read as a panel.
 *
 * `<details>` and not a disclosure component: it opens with JavaScript switched off, costs no
 * client island (AGENTS.md §1.5), and is already how this codebase collapses things — the
 * display-name field below and the destructive actions on the registrations list.
 */
const disclosureSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  px: 2,
  // The shared summary (§325): a flex row with its own arrow on the heading's line.
  "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
  ...DISCLOSURE_OPEN_ARROW,
} as const;

/**
 * The registration form (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05,
 * BR-REQ-033-01 criterion 1, BR-REQ-041-01).
 *
 * Only for an event that is `INTERNAL` and currently open — anything else 404s rather than
 * showing a form that cannot submit, the same reasoning `sign-in/page.tsx` gives for not
 * rendering a switcher nobody can use.
 *
 * ## Why this is one page and not a wizard
 *
 * Recorded in full in `DECISIONS.md` §47. In short: every way of splitting this across steps
 * has to keep partial answers somewhere, and each place costs more than the length it saves —
 * hidden fields would echo health text (GDPR Article 9) into the markup of every later step,
 * a partial row would put a half-registration in front of the allocator, and a client wizard
 * would trade the browser's own translated, accessible validation for hand-written validation
 * on the one page that has to work everywhere. What actually made the page long is that a
 * third of it asks for things nobody has to answer, so those are collapsed and the rest is not.
 */
/** The form's own id, so the refusal's button can submit it from outside (§282). */
const REGISTRATION_FORM_ID = "registration-form";

export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const event = await findPublishedEventBySlug(getDb(), locale, slug);
  if (!event) notFound();

  const now = new Date();
  // Read once: the widget is drawn when both keys are set *and* the club has not switched the
  // check off (§254). The honeypot and the timing check stand either way (§19.4).
  const siteKey = await activeBotCheckSiteKey(getDb(), now);
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") notFound();

  const { submitted, error, fields, retry, another } = await searchParams;
  /*
    The form for another person on a registered address (§389), opened from the link emailed to it.
    Read, never spent — a GET changes nothing (§12.8), and a mail scanner opening the link leaves it
    working; the submission spends it. A link that works puts the form in its family shape: the
    address fixed and shown, the telephone optional. One that does not — spent, lapsed, for another
    event — says so in one sentence above the ordinary form, and nothing else.
  */
  const anotherSecret = !submitted && typeof another === "string" && another !== "" ? another : undefined;
  const anotherLink = anotherSecret ? await readAnotherPersonLink(anotherSecret, event.id, now) : null;
  const family = anotherLink?.ok ? { secret: anotherSecret as string, email: anotherLink.email } : null;
  const anotherLinkGone = Boolean(anotherSecret) && !family;
  // Only meaningful on the screen that follows a successful submit (§224): the inbox to open
  // and the first name to greet, from the form just posted, never from the registrations table.
  const submittedFacts = submitted ? await readSubmittedFacts() : null;

  /**
   * Which boxes to mark, when the server rejected the form.
   *
   * Names only — nothing typed goes into a URL. Reaching this at all should be rare: every
   * constraint below is also a native one, so a browser refuses the submission first and
   * points at the offending field without a round trip. This is the fallback for the cases
   * the browser cannot know about, and for a form posted without JavaScript or by a bot.
   *
   * The parameter is matched against the known field names rather than trusted, because
   * anybody can type one into a URL (`form-errors.ts`).
   */
  const rejected = parseInvalidFields(fields);
  const invalid = new Set<string>(rejected);
  /**
   * The anti-bot check is a rejection about nothing the person typed (§176), so it is not one
   * of the form's fields and `parseInvalidFields` drops it. Read from the raw parameter, matched
   * against the one literal it may be — anybody can type into a URL.
   */
  const captchaFailed = (fields ?? "").split(",").includes("captcha");
  /**
   * The timing check asked again rather than discarding the submission (§194). Like the captcha
   * above it is a rejection about nothing the person typed, so it is read from the raw parameter
   * and matched against the one literal it may be.
   */
  const tooFast = (fields ?? "").split(",").includes("tooFast");
  /**
   * The per-address throttle, refused out loud since §217 closed the last silent drop. Like
   * the two above it is about nothing the person typed, so it is read from the raw parameter
   * and matched against the one literal it may be.
   */
  const throttled = (fields ?? "").split(",").includes("throttled");
  /**
   * The emergency contact was the runner's own number (§228). A marker rather than a field,
   * like the two above, so the summary can still link the field while the sentence beneath it
   * says which of the two rules refused it — "that number is not valid" is untrue and was what
   * this said (§231).
   */
  const emergencySame = (fields ?? "").split(",").includes("emergencySame");
  /**
   * Under the event's minimum age on the day of the race (§321, §329). The same kind of marker
   * as the one above: the summary links the birth date, and this says which rule refused it —
   * "complete this field correctly" about somebody's real birth date would be untrue. Never on
   * an event with no minimum, whatever a typed-in address says: "the minimum age is 0" is no rule.
   */
  const tooYoung = event.minAge > 0 && (fields ?? "").split(",").includes(UNDER_MINIMUM_AGE);
  /**
   * No place, and the waiting list full — or no waiting list at all (§348). A rule about the
   * event, like the throttle's marker: read from the raw parameter, matched against the two
   * literals it may be, and said with the event page's own sentence.
   */
  const refusedMarkers = (fields ?? "").split(",");
  const waitlistRefusal = refusedMarkers.includes(NO_WAITLIST)
    ? NO_WAITLIST
    : refusedMarkers.includes(WAITLIST_FULL)
      ? WAITLIST_FULL
      : null;
  /*
    The three refusals of the form behind the emailed link (§389), each a marker matched against its
    one literal. The first two only ever reach a page that holds the link — whoever reads them has
    read the address's inbox, so they may say what they are about (§39); the third is the link
    itself no longer working, said on the plain form it sends the person back to. The limit is the
    club's setting, read now, in words that agree with the number.
  */
  const alreadyOnAddress = refusedMarkers.includes(ALREADY_ON_ADDRESS);
  const addressAtCap = refusedMarkers.includes(ADDRESS_AT_CAP);
  const anotherLinkRefused = refusedMarkers.includes(ANOTHER_LINK_INVALID);
  const capCount = addressAtCap || family ? (await readAddressCap(getDb())).cap.registrationsPerAddress : null;
  /*
    The same, said before anybody types (§348): somebody who reached this form by its address —
    the event page offers no button then — reads why it would refuse, above the first field. The
    form stays, so a slot that opens a minute later is still one press away, and so a refusal can
    keep what was typed. The cached read the event page makes; optional, so a failure says nothing.
  */
  let fullNotice: typeof WAITLIST_FULL | typeof NO_WAITLIST | null = null;
  if (!submitted && !error) {
    try {
      const places = await cachedPublicAvailability(event.id, now);
      if (places?.available === 0) {
        fullNotice = places.waitlistCapacity === 0 ? NO_WAITLIST : places.waitlistRoom === 0 ? WAITLIST_FULL : null;
      }
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }

  /*
    BR-REQ-031-04 criterion 4 and the minimum age (§321), expressed where the browser can enforce
    them too. The upper bound is the latest birth date that still reaches this event's own
    minimum (`events.min_age`, §329) on the race's own day in the race's own zone — computed here,
    for this event, from the arithmetic the server refuses with — so the picker never offers a
    date the submission would be turned back for. Today stays a bound as well: for an event with
    no minimum, and for the event absurdly far ahead that would allow a future date.
  */
  const today = now.toISOString().slice(0, 10);
  const youngestAllowed = latestBirthDateFor(event.minAge, dayIn(event.startsAt, event.timezone));
  const latestBirthDate = youngestAllowed < today ? youngestAllowed : today;
  // "14 ani", "20 de ani" — the event's number as this page's sentences say it (§329).
  const minimumAge = { age: yearsPhrase(event.minAge, locale) };
  const hasMinimumAge = event.minAge > 0;
  const earliestBirthDate = new Date(
    Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  /*
    §396: when this event publishes a list and the notice in force describes its states, the
    «Vreau să apar» box says what the list will show beside the name. The cached read the event
    page's list makes; optional, so a failure leaves the box as it always read.
  */
  let listStatesOn = false;
  if (event.participantListVisibility === "NAMES") {
    try {
      listStatesOn = await cachedListStatesDisclosed(now);
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }
  /*
    The club's terms in force (§NNN): the tick names their version, read from the text in force and
    never typed. The public cache's read, as the legal page makes it; the service asks the database
    again when the form is sent and records the version it finds. None approved: the form says
    registrations cannot be taken, and the service refuses them.
  */
  const termsVersion = (await cachedCurrentApprovedDocument("TERMS", locale, now))?.version ?? null;
  const t = await getTranslations("Registration");
  // "4 persoane" / "4 people": the club's limit per address, in words that agree with it (§389, §341).
  const people = capCount !== null ? t(`another.people.${countForm(capCount, locale)}`, { count: capCount }) : "";
  // The event page's own words for a place still to be announced (§328), one key for every surface.
  const tEvent = await getTranslations("Event");
  const legal = await getTranslations("Legal");
  // Names from the platform, order from the reader's own collation (`countries.ts`).
  const countries = countryOptions(locale, (code) => countryName(code, locale));
  // The phone prefixes' order and names, sorted and named here and only drawn in the browser
  // (§324): the two runtimes' ICU data name countries differently, and computing either again
  // in the browser broke hydration.
  const phoneOrder = phoneCountryOrder(locale);
  const phoneNames = phoneCountryLabels(locale);

  /**
   * The props every text field shares: its anchor, its name, whether it was rejected, and the
   * message under it when it was.
   *
   * `docs/PRACTICES.md` § Accessibility asks for an error stated next to its field rather than
   * only in a summary at the top. MUI derives `aria-describedby` from `helperText`, so the
   * message is announced with the field instead of having to be hunted for.
   */
  // What they typed before the rejection (§142), to put back in every box; nothing otherwise.
  const draft = error ? await readFormDraft() : null;
  /*
  What was typed before a rejected submission (§142), by field name.

  Named `prefill` rather than `typed`: the i18n checker reads every `t…(` call as a translation
  lookup (`t\w*\(`), so `prefill("privacyAcknowledged")` was being counted as a missing message
  key. It passed for years only because every name it had been given — `email`, `city` — also
  happened to exist in the catalogue.
*/
  const prefill = (name: string, fallback?: string) => draft?.[name] ?? fallback;
  /*
    The terms tick is the one box the draft does not simply bring back (§NNN): a refusal naming it
    returns it unticked, and says so when the version in force moved (`acceptanceAfterRefusal`).
  */
  const acceptance = acceptanceAfterRefusal({ invalid, draft, versionInForce: termsVersion });
  const field = (name: string, help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: prefill(name),
  });

  // What they are signing up for, on the form itself (§102): the date, the place, and the
  // event's page, its rules and the two legal texts as links — the owner: "show the race date,
  // details and TOS on the sign-up form as links". Formatted in the event's own zone.
  // The long form with the time (§349): capitalised where it starts the line, and in lower case
  // inside the sentence of the screen after the form ("…locul la Crosul, sâmbătă, 21 nov.").
  const whenLabel = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true });
  const whenInSentence = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" });
  const hasRules = !isRichTextEmpty(readRichText(event.rulesJson));
  /*
    What is being paid for, and where (§343), the same short phrase the event page's facts say
    (`EventFacts`) — never a raw URL, only the host a runner recognises ("Linkuri și fișiere",
    §332). Null for an event whose cost has not been stated, which is not the same as free.
  */
  const costHost = event.costUrl ? costUrlHost(event.costUrl) : null;
  const costLine: ReactNode = (() => {
    if (event.costType === "PAID") {
      const main = event.costAmount ? tEvent("costPaidAmount", { amount: event.costAmount }) : tEvent("costValues.PAID");
      if (!event.costUrl || !costHost) return main;
      return (
        <>
          {main} ·{" "}
          <MuiLink href={event.costUrl} target="_blank" rel="noopener noreferrer">
            {tEvent("costPaidWhere", { host: costHost })}
          </MuiLink>
        </>
      );
    }
    if (event.costType === "DONATION") {
      if (!event.costUrl || !costHost) return tEvent("costValues.DONATION");
      return (
        <>
          <MuiLink href={event.costUrl} target="_blank" rel="noopener noreferrer">
            {tEvent("costDonation", { host: costHost })}
          </MuiLink>
          {event.costAmount ? ` · ${tEvent("costDonationSuggested", { amount: event.costAmount })}` : ""}
        </>
      );
    }
    if (event.costType === "FREE") return tEvent("costValues.FREE");
    return null;
  })();
  // The third step of the wizard (§104): "confirm a week before" only while that week is ahead.
  const window = confirmationWindow(event);
  const stepsWindow =
    window && window.opensAt.getTime() > now.getTime()
      ? { opensDays: event.confirmationOpensDaysBefore, deadlineDays: event.confirmationDeadlineDaysBefore }
      : null;
  const factLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight, marginRight: 16 } as const;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title", { event: event.title })}
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {whenLabel}
          {/* The place, or the sentence that it is still to be announced (§328) — the same words
              as the event page; the query withholds the typed place itself. */}
          {event.locationToBeAnnounced ? ` · ${tEvent("locationToBeAnnounced")}` : event.locationName ? ` · ${event.locationName}` : ""}
        </Typography>
        {/* What a participant pays, and where (§343) — the same short phrase the event page's
            own facts say (`EventFacts`), so the two never disagree. */}
        {costLine && (
          <Typography variant="body2" color="text.secondary">
            {costLine}
          </Typography>
        )}
        <Box sx={{ display: "flex", flexWrap: "wrap" }}>
          <Link href={{ pathname: "/events/[slug]", params: { slug } }} style={factLink}>
            {t("facts.details")}
          </Link>
          {hasRules && (
            <Link href={{ pathname: "/events/[slug]", params: { slug }, hash: "rules" }} style={factLink}>
              {t("facts.rules")}
            </Link>
          )}
          {/* The two reference texts open in a tab of their own (§197): a half-filled form
               must not depend on the browser restoring it after a Back. */}
          <LegalLink href="/legal/terms" newTabLabel={t("opensInNewTab")} style={factLink}>
            {t("facts.terms")}
          </LegalLink>
          <LegalLink href="/legal/privacy" newTabLabel={t("opensInNewTab")} style={factLink}>
            {t("facts.privacy")}
          </LegalLink>
        </Box>
        {/* Who may enter, among the facts of what is being signed up for and before the first
            field (§321): the event's own minimum age (§329), and who fills the form in for a
            minor (§108). A line, not a banner — it is a condition of the race like its date, not
            a warning. Three sentences, so it reads right whatever the number: no minimum says
            only who registers a minor, eighteen or more says nothing about parents, and the
            same sentence stands on the event page. Gone once the form has been sent: by then it
            has been answered. */}
        {!submitted && (
          <Typography variant="body2" color="text.secondary" data-testid="age-rule">
            {t(`ageRule.${ageRuleVariant(event.minAge)}`, minimumAge)}
          </Typography>
        )}
      </Box>

      {/*
        Where the email is *not* going, said before anything promises one: on QA only the
        club's authorized addresses receive mail, on a laptop nothing is sent at all, and two
        testers stood on the screen below waiting for a message that was never coming. Nothing
        on production, where the mode is `live` (`delivery-notice.ts`). Above the journey strip
        so it is the first thing read on the form and on the check-your-email screen alike.
      */}
      <EmailDeliveryNotice />

      {/* Where they are in the journey, and what happens next — the same component every page
          of this flow renders, so the answer never depends on which page they are looking at. */}
      <RegistrationJourney current={submitted ? "confirm" : "details"} />

      {/* The five steps and the waiting list, folded: the journey above says where they are,
          this says the whole of it (`DECISIONS.md` §91). */}
      {!submitted && (
        <Box sx={{ mb: 3 }}>
          <RegistrationSteps folded window={stepsWindow} reminderHoursBefore={event.reminderHoursBefore} />
        </Box>
      )}

      {submitted ? (
        /*
          "Aproape gata, Ana!" — the screen after the form, in `CheckYourEmail.tsx`. It carries
          every fact the receipt it replaced had: the address (§224), the wait in bold and once
          (§224), the spam folder, the sentence that keeps it true for somebody already
          registered (§229), the resend and the contact form (§205) — and adds the first name,
          the event and its date, what happens next in three steps, and the way back.
          The owner: it "should be more fun". It reads the same for a first and a repeat
          registration: nothing on it is read from the registrations table (§19.4).
        */
        <CheckYourEmail
          eventTitle={event.title}
          whenLabel={whenInSentence}
          eventHref={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } })}
          slug={slug}
          facts={submittedFacts}
          window={stepsWindow}
        />
      ) : (
        <>
          {/*
            The error summary, and what the redirect lands on.

            `submitRegistrationAction` sends a rejection back to `#registration-errors`, so the
            browser scrolls here and — because this is focusable — puts focus here, rather than
            leaving somebody at the top of a long page with no idea what happened. That is the
            fix for the round trip that used to drop a person above the whole form.
            `role="alert"` covers the case where the browser restores a scroll position instead.

            Each rejected field is a link to its own anchor, which is the one pattern that needs
            no JavaScript: following it moves focus to the input itself.
          */}
          {error && (
            <Alert
              /*
                Quieter for the anti-bot refusal (§282; the owner, of the red panel: "trebuie sa
                fie mai subtila"). Nothing is wrong with what they typed and nothing needs
                hunting down — a check guessed, and the next press goes through. Red is for the
                rejections that ask somebody to change something.
              */
              /*
                Red after all (§286; the owner: "asta ar trebui sa fie cu rosu"). §282 made it
                information because nothing the person typed was wrong — but what a reader needs
                first is that the submission did **not** go through, and blue reads as a remark.
              */
              severity="error"
              id={ERROR_SUMMARY_ID}
              role="alert"
              tabIndex={-1}
              sx={{ mb: 2 }}
            >
              <AlertTitle>
                {throttled ? t("errors.throttledTitle") : tooFast ? t("errors.tooFastTitle") : t("errors.title")}
              </AlertTitle>
              {/*
                The anti-bot check, said in words (§176; the owner: "trebuie să ne putem
                înscrie man!").

                A token Cloudflare does not confirm — a widget that never rendered, a challenge
                that timed out while somebody filled a long form, a bad minute on the network —
                comes back as `fields=captcha`. `captcha` is not one of the form's fields, so
                the summary filtered it out and fell through to "verifică datele completate",
                which sends a person hunting through twenty inputs that are all correct. It is
                the one rejection that is about nothing they typed, so it is said first and on
                its own, and the catalogue already had the sentence for it.
              */}
              {alreadyOnAddress ? (
                // Behind the emailed link (§389): this runner is on the address already, and the
                // link still works for somebody else.
                t("another.alreadyOnAddress")
              ) : addressAtCap ? (
                // Behind the emailed link (§389): the address has the club's limit; nothing was registered.
                t("another.atCap", { people })
              ) : anotherLinkRefused ? (
                // The link is spent, lapsed or for another event: the plain form, and how to get a new one.
                t("another.linkGone")
              ) : waitlistRefusal ? (
                /*
                  No place and nothing to join (§348): the event page's own sentence, and that
                  nothing was registered or sent. Everything typed is still in the boxes below,
                  for the moment a slot opens — the refusal is about the event, not the form.
                */
                <>
                  {waitlistRefusal === NO_WAITLIST ? tEvent("cta.fullNoWaitlist") : tEvent("cta.waitlistFull")}
                  <Box sx={{ mt: 0.5 }}>{t("errors.waitlistFullNothingSent")}</Box>
                </>
              ) : captchaFailed ? (
                t("errors.captcha")
              ) : throttled ? (
                // Their own address, their own count: this tells them about themselves and
                // nothing about who else is registered, which is the oracle §19.4 forbids.
                t("errors.throttled")
              ) : tooFast ? (
                /*
                  The anti-bot refusal, said **here** and not only beside the button (§217).

                  This is where the browser lands and where focus goes, and `tooFast` is not one
                  of the form's fields — so the summary used to fall through to "verifică datele
                  completate", which is the same trap the captcha comment above describes: a red
                  box telling somebody to check twenty inputs that are all correct, while the one
                  sentence that explains what happened sat at the far end of a long form. The
                  owner: "they need visuals on this! so that they know!"
                */
                /*
                  Said in full, and with the button right here (§282; the owner: "I want clear
                  visual feedback when people are not let through"). Three things somebody needs
                  at this moment and had to infer: that nothing was registered, that no email is
                  coming — the promise §217 forbids making falsely — and that pressing again will
                  work, without scrolling back down a form of twenty fields to find the button.
                */
                <>
                  {t("errors.tooFast")}
                  <Box sx={{ mt: 0.5 }}>{t("errors.tooFastNothingSent")}</Box>
                </>
              ) : rejected.length > 0 ? (
                <>
                  {t("errors.fieldsIntro")}
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                    {rejected.map((name) => (
                      <li key={name}>
                        <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                        {/* The rule, where the browser lands (§321): a birth date refused for age
                            is not a typo to hunt for, and the sentence says what would be accepted. */}
                        {name === "birthDate" && tooYoung && <>: {t("errors.tooYoung", minimumAge)}</>}
                      </li>
                    ))}
                  </Box>
                </>
              ) : (
                t("errors.generic")
              )}
            </Alert>
          )}

          {/* The form for another person on the address (§389): whose address, and what happens next. */}
          {family && (
            <Alert severity="info" sx={{ mb: 2 }} data-testid="another-person-notice">
              <AlertTitle>{t("another.title")}</AlertTitle>
              {t("another.intro", { email: family.email, people })}
            </Alert>
          )}
          {/* A link that no longer works, opened (§389): one sentence, then the ordinary form. */}
          {anotherLinkGone && !error && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="another-person-link-gone">
              {t("another.linkGone")}
            </Alert>
          )}

          {/* No terms approved (§NNN): there is nothing to accept, and the service would refuse. */}
          {termsVersion === null && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="registration-terms-missing">
              {t("terms.missing")}
            </Alert>
          )}
          {fullNotice && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="registration-full-notice">
              {fullNotice === NO_WAITLIST ? tEvent("cta.fullNoWaitlist") : tEvent("cta.waitlistFull")}
            </Alert>
          )}

          {/*
            What the asterisk means, said once, before the first field that uses one.

            Every required input already carries `required`, so the browser refuses the
            submission and moves focus to the first field that is not filled — that is native
            validation and it needs no JavaScript. What was missing is the *legend*: MUI marks a
            required `TextField` with an asterisk and nothing on the page said what an asterisk
            meant, so "which of these must I fill in" had no answer until you pressed the button.
          */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("requiredLegend")}
          </Typography>
          {/*
            What is published and what is not, before the first field asks for anything (§171;
            the owner: "la formularul de înscriere trebuie să fie clar ce date sunt publice și
            ce date sunt confidențiale").

            A form that asks for a birth date, a phone number, a next of kin and a health note
            owes the person reading it one sentence about where any of that goes — and the
            answer here is unusually good, so it is worth saying: nothing is published unless
            the event has a start list *and* the box below is ticked, and then only the name.
            The two section markers repeat it where each block of fields is.
          */}
          <Alert severity="info" icon={false} sx={{ mb: 2 }}>
            {event.participantListVisibility === "NAMES" ? t("privacyBannerWithList") : t("privacyBanner")}
          </Alert>
          <form action={submitRegistrationAction} id={REGISTRATION_FORM_ID}>
            {/*
              The try after a refusal (§282). The action reads this back and lets the submission
              through whatever the hidden trap says: a password manager refills that trap on
              every render, so refusing twice for the same reason would loop a real person
              forever — which is precisely how somebody gives up on entering a race.
            */}
            {retry === "1" && <input type="hidden" name={SECOND_ATTEMPT_FIELD} value="1" />}
            {/*
              The way out, **inside** the form (§282).

              It was in the alert above, with `form="registration-form"`, which is valid HTML and
              submits nothing here: a Server Action is driven by React from the form's own submit
              handler, and a submitter outside the element never reaches it. The e2e case caught
              it — one refusal in the server log and no second request at all.
            */}
            {/*
              The same runner as the send button below (§318), through `SubmitButton`'s flag
              rather than a glyph by name: the verbs' registry is the backoffice's and must not
              reach a public page. The row is a flex container so the button keeps its own width.
            */}
            {/*
              And the same hold for Cloudflare's token (§285, §304; §324): this press sends the
              same form, and the widget below has been redrawn for the new render, so a press
              before it answers would buy the refusal it is meant to get past. Held, then sent
              when the token lands — never dropped.
            */}
            {tooFast && (
              <Box sx={{ display: "flex", mb: 2 }}>
                <SubmitButton
                  label={t("errors.tooFastResend")}
                  pendingLabel={t("submitting")}
                  runner
                  awaitsBotCheck={Boolean(siteKey)}
                  botCheckHint={t("botCheckWait")}
                  slowHint={t("submitSlow")}
                  size="medium"
                />
              </Box>
            )}
            <Stack spacing={2}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              {/* Bots fill every field; a human never sees or fills this one. */}
              <input
                type="text"
                name="honeypot"
                autoComplete="off"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
              />
              <input type="hidden" name="renderedAt" value={now.toISOString()} />
              {/* The link's secret, back to the action that spends it (§389) — never kept in the draft. */}
              {family && <input type="hidden" name={ANOTHER_PERSON_PARAM} value={family.secret} />}

              {/*
                Two columns from `md` up, one below (BR-REQ-041-01 is phone-first and the phone
                is unchanged). Left: what a registration cannot be accepted without. Right: the
                three optional groups, open, beside the required set rather than after it — on a
                laptop the form used a 600px column of a 1200px page and scrolled for three
                screens; now the whole of it is one screen (the owner, 2026-09-17: "use the space
                more efficiently"). `alignItems: flex-start` so a short right column does not
                stretch to match the left. The consents and the button stay full width beneath
                both, because they close the form and must not look like part of one half.
              */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  columnGap: 4,
                  rowGap: 2,
                  alignItems: "start",
                }}
              >
              <Stack spacing={2} sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
                {t("sections.about")}
              </Typography>
              {/* The marker under each block (§171): where these answers go. */}
              <Typography variant="caption" color="text.secondary">
                {t("confidentialNote")}
              </Typography>

              {/*
                BR-REQ-031-04. The legal name is asked in two parts because that is what a
                declaration, a results table and an age category each need separately; the
                display name is asked once, right underneath, so the difference between "who you
                are" and "what a start list shows" is visible when somebody decides it.
              */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  {...field("firstName")}
                  label={t("firstName")}
                  required
                  autoComplete="given-name"
                  fullWidth
                />
                <TextField
                  {...field("lastName")}
                  label={t("lastName")}
                  required
                  autoComplete="family-name"
                  fullWidth
                />
              </Stack>

              <TextField
                {...field("birthDate")}
                /* The event's minimum age and the categories, in the help (§321, §329) — only the
                   categories on an event with no minimum; a refusal for age says the rule again
                   rather than "complete this field correctly". Left native, not the backoffice's
                   MUI picker (`shared/forms/pickers`, `DECISIONS.md` §345): a runner's own birth
                   date is decades back, faster typed than paged through a calendar month by
                   month, and this box is public — the picker never ships here anyway. */
                helperText={
                  invalid.has("birthDate")
                    ? tooYoung
                      ? t("errors.tooYoung", minimumAge)
                      : t("errors.field")
                    : hasMinimumAge
                      ? t("birthDateHelp", minimumAge)
                      : t("birthDateHelpNoMinimum")
                }
                type="date"
                label={t("birthDate")}
                required
                autoComplete="bday"
                slotProps={{
                  inputLabel: { shrink: true },
                  // The same bounds the server applies — a date in the future, or one under this
                  // event's minimum age on the race day — so the picker refuses them itself
                  // rather than a round trip.
                  htmlInput: { min: earliestBirthDate, max: latestBirthDate },
                }}
              />

              {/* What the answer is for, under the field (§322): a category ranking, and "prefer
                  not to say" is an answer. */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  {...field("sex", t("sexHelp"))}
                  label={t("sex")}
                  select
                  required
                  fullWidth
                  defaultValue={prefill("sex", "UNSPECIFIED")}
                  sx={SELECT_WITH_GLYPHS_SX}
                >
                  {/* A glyph beside each answer (§171; the owner: "pune iconițe chiar și la
                      sex"). As **children** of the item, never as a prop across the boundary —
                      see `CheckboxField` for what an element-valued prop costs — and MUI shows
                      the chosen item's children in the closed field, so the mark stays.

                      Which is also why the row is declared twice: the children travel to the
                      closed field, the item's own `sx` does not. `select-option.ts` says what
                      that cost before it was laid out in both places. */}
                  <MenuItem value="FEMALE" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <FemaleIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.FEMALE")}
                    </Box>
                  </MenuItem>
                  <MenuItem value="MALE" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <MaleIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.MALE")}
                    </Box>
                  </MenuItem>
                  <MenuItem value="UNSPECIFIED" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <PersonIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.UNSPECIFIED")}
                    </Box>
                  </MenuItem>
                </TextField>
              </Stack>

              <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
                {t("sections.contact")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("contactNote")}
              </Typography>

              {/*
                The address, twice, typed by hand (§206). QA's outbox holds three bounced
                messages to "…@gmail.con": one letter, and the confirmation link goes nowhere
                while the screen says to check the inbox.
              */}
              {family ? (
                /*
                  The address the link was sent to, fixed (§389): shown so the person knows where
                  the next message goes, read-only, and never posted — the action takes the address
                  from the token, so nothing typed here could move a registration to another inbox.
                */
                <TextField
                  id={fieldId("email")}
                  label={t("email")}
                  value={family.email}
                  helperText={t("another.emailFixed")}
                  fullWidth
                  slotProps={{ htmlInput: { readOnly: true, "aria-readonly": true, "data-testid": "another-person-email" } }}
                />
              ) : (
                <EmailTwice
                  name="email"
                  confirmName="emailConfirm"
                  fieldId={fieldId("email")}
                  confirmFieldId={fieldId("emailConfirm")}
                  label={t("email")}
                  confirmLabel={t("emailConfirm")}
                  mismatchLabel={t("emailMismatch")}
                  noPasteLabel={t("emailNoPaste")}
                  allowPasteLabel={t("emailAllowPaste")}
                  invalidLabel={t("emailInvalid")}
                  suggestionLabel={t.raw("emailSuggestion") as string}
                  useSuggestionLabel={t("emailUseSuggestion")}
                  help={t("emailHelp")}
                  defaultValue={prefill("email")}
                  defaultConfirmValue={prefill("emailConfirm")}
                  error={invalid.has("email") || invalid.has("emailConfirm")}
                  helperText={invalid.has("email") || invalid.has("emailConfirm") ? t("errors.field") : undefined}
                />
              )}
              {/* The country and the digits (§84): what is stored is one number a phone can dial. */}
              <PhoneField
                invalidLabel={t("phoneInvalid")}
                tooShortLabel={t("phoneTooShort")}
                validLabel={t("phoneValid")}
                name="phone"
                draft={draft ? { country: draft.phoneCountry, national: draft.phone } : undefined}
                id={fieldId("phone")}
                label={t("phone")}
                countryLabel={t("phoneCountry")}
                countryOrder={phoneOrder}
                countryNames={phoneNames}
                // Optional for another person on the address (§389): often a child with no phone of
                // their own; the emergency contact below is still asked.
                required={!family}
                autoComplete="tel-national"
                error={invalid.has("phone")}
                helperText={invalid.has("phone") ? t("errors.phone") : family ? t("another.phoneOptional") : t("phoneHelp")}
              />

              {/*
                Required because somebody has to be reachable if a runner is not (BR-BUS-031).
                `autoComplete="off"` on both: this is deliberately somebody *else's* name and
                number, and a phone offering the runner's own would be accepted by reflex.
              */}
              <Stack spacing={2}>
                {/* A third person's name and number (§322): the runner is the one who can tell
                    them, so the form says to, and says when they would be rung. */}
                <TextField
                  {...field("emergencyContactName", t("emergencyContactHelp"))}
                  label={t("emergencyContactName")}
                  required
                  fullWidth
                  autoComplete="off"
                />
                <PhoneField
                  invalidLabel={t("phoneInvalid")}
                  tooShortLabel={t("phoneTooShort")}
                  validLabel={t("phoneValid")}
                  name="emergencyContactPhone"
                  draft={draft ? { country: draft.emergencyContactPhoneCountry, national: draft.emergencyContactPhone } : undefined}
                  id={fieldId("emergencyContactPhone")}
                  label={t("emergencyContactPhone")}
                  countryLabel={t("phoneCountry")}
                  countryOrder={phoneOrder}
                  countryNames={phoneNames}
                  required
                  autoComplete="off"
                  /* The contact must be somebody else (§228), said as it is typed and refused
                     by the browser rather than by a round trip (§231). */
                  mustDifferFromName="phone"
                  mustDifferLabel={t("errors.emergencySame")}
                  error={invalid.has("emergencyContactPhone")}
                  helperText={
                    invalid.has("emergencyContactPhone")
                      ? emergencySame
                        ? t("errors.emergencySame")
                        : t("errors.phone")
                      : undefined
                  }
                />
              </Stack>

              </Stack>

              {/*
                Everything from here to the consents is optional. The three groups are open by
                default (DECISIONS.md §59) and still foldable, each summary naming what it holds.

                The consents below the columns are never folded: BR-REQ-072-01 criterion 1 and
                BR-REQ-039-01 require the choice to be *presented*, and a question behind a
                summary nobody opens has not been put to anyone.
              */}
              <Stack spacing={2} sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
                {t("sections.optional")}
              </Typography>
              {/*
                BR-REQ-039-02. Closed by default, because the default answer is the common one:
                a start list says the name you just gave. Opening it changes what is published
                without changing who the declaration is signed by.
              */}
              {env.FEATURE_DISPLAY_NAME && (
              <Box component="details" open sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("displayNameToggle")}
                </Typography>
                <Stack spacing={1.5} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("displayNameHelp")}
                  </Typography>
                  <TextField
                    {...field("displayName")}
                    label={t("displayName")}
                    placeholder={t("displayNamePlaceholder")}
                    autoComplete="nickname"
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                </Stack>
              </Box>
              )}
              <Box component="details" open sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.race", { club: CLUB_NAME })}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  {/*
                    BR-REQ-031-06. First in the group, and the reason the summary names the club:
                    a member looking for where to say so finds it by the word "Brașov Runners"
                    rather than by opening every disclosure on the page.

                    It sits beside `clubName` because they are the same question asked twice —
                    somebody who ticks this is in the club whose name they would otherwise type.
                    It is a claim and it grants nothing; `DECISIONS.md` §48 says why it is not
                    checked against `staff_users`.
                  */}
                  <CheckboxField id={fieldId("clubMemberDeclared")} name="clubMemberDeclared" defaultChecked={prefill("clubMemberDeclared") === "on"}>
                    {t("clubMemberDeclared", { club: CLUB_NAME })}
                    {/* What the claim means, where it is claimed (§189): "grup" rather than
                        "echipă", because the club is a group somebody runs with and not a squad
                        somebody is selected for, and the tooltip says where the line is. */}
                    <Hint text={t("clubMemberHint")} />
                  </CheckboxField>

                  <TextField
                    {...field("tshirtSize")}
                    label={t("tshirtSize")}
                    select
                    defaultValue={prefill("tshirtSize", "NONE")}
                  >
                    <MenuItem value="NONE">{t("tshirtSizes.NONE")}</MenuItem>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <MenuItem key={size} value={size}>
                        {size}
                      </MenuItem>
                    ))}
                  </TextField>

                  {/*
                    The club, filled in and locked while the tick above is on (§215; the owner:
                    "if people check that they are brasov runners members, the club input must be
                    auto-filled and readonly"). The same fact was being written three ways —
                    "BRASOV RUNNERS", "Brasov runners", "BvR" — and the export read them as three
                    clubs. The tick still grants nothing (§48); the service writes the same name
                    whatever the browser did, so a form filled with JavaScript off records it too.
                  */}
                  <ClubForMember
                    {...field("clubName", t("optional"))}
                    label={t("clubName")}
                    memberCheckboxId={fieldId("clubMemberDeclared")}
                    clubName={CLUB_NAME}
                    lockedHelperText={t("clubNameFromMembership")}
                  />
                </Stack>
              </Box>

              {/*
                Where the runner is from (§322): optional, and on this side of the form for that
                reason. It was required on the left, and the privacy notice could not say why —
                nothing the club does with a registration reads either answer. What it is for is
                said above the two fields, and the country starts unanswered rather than on
                Romania: a pre-chosen answer is an answer nobody gave.
              */}
              <Box component="details" open sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.origin")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("originHelp")}
                  </Typography>
                  <TextField
                    {...field("nationality")}
                    label={t("nationality")}
                    select
                    fullWidth
                    defaultValue={prefill("nationality", "")}
                    slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    sx={SELECT_WITH_GLYPHS_SX}
                  >
                    <MenuItem value="" sx={OPTION_ROW_SX}>
                      <Box component="span" sx={OPTION_LABEL_SX}>
                        {t("nationalityNone")}
                      </Box>
                    </MenuItem>
                    {/*
                      The flag before the name (§171), from the set `scripts/sync-flags.mjs`
                      already copies into `public/flags/` — which that script's own comment
                      anticipated for exactly this ("will show many when a participant can state
                      their country"). Normalised to 4:3, so a column of two hundred names does
                      not wobble between Romania's 2:3 and the United Kingdom's 1:2.

                      Not the regional-indicator emoji, which Windows draws as two boxed capitals
                      — and Windows is what the club's own laptop runs.
                    */}
                    {countries.map((country) => (
                      <MenuItem key={country.code} value={country.code} sx={OPTION_ROW_SX}>
                        {/* The flag is `display: block` and 20×15; the fixed box is what stops it
                            taking a line of its own in the closed field and what keeps every
                            country name starting at the same x. */}
                        <Box component="span" sx={OPTION_GLYPH_SX}>
                          <Flag code={country.code} width={20} />
                        </Box>
                        <Box component="span" sx={OPTION_LABEL_SX}>
                          {country.label}
                        </Box>
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField {...field("city")} label={t("city")} autoComplete="address-level2" />
                </Stack>
              </Box>

              {/*
                A minor's parent or guardian (§108, §185, §188): shown when the birth date says so.

                It was a fold — "Părinte sau tutore" — and the owner read an opened fold as a
                question he now had to answer: "mă disperă faza cu tutorele!". He was right about
                the shape. §185 made it a tick, which was the right shape and the wrong question:
                the form already asks for the birth date, and the birth date is the answer, so
                asking twice only invites the two answers to disagree — and the server would then
                refuse an unticked minor over a field nobody had been shown.

                The rule has not moved: the server requires a guardian when the birth date gives
                under eighteen, whatever the browser drew. `forceOpen` is that verdict coming
                back — a rejection naming the field opens the block whatever the date box now
                holds, so an error never points at something invisible.
              */}
              <GuardianForMinor birthDateId={fieldId("birthDate")} forceOpen={invalid.has("guardianName")}>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {t("guardianHelp")}
                  </Typography>
                  <TextField
                    {...field("guardianName", t("guardianNameHelp"))}
                    label={t("guardianName")}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                </Stack>
              </GuardianForMinor>

              {/* Socials, optional and folded (§106): the club follows back and tags; never
                  published by the platform. Closed by default — it is the one section a
                  person can skip without the form being any less complete. Adults only
                  (§323): gone once the birth date says under eighteen — disabled as well as
                  hidden, so neither box is validated or posted — and never stored for a minor
                  whatever is posted. A rejection naming either box shows it whatever the date.
                  Never on the family form (§NNN): a minor keeps none, and another adult's
                  socials are that adult's to give — the service drops them whatever is posted. */}
              {!family && (
              <HiddenForMinor
                birthDateId={fieldId("birthDate")}
                forceOpen={invalid.has("stravaUrl") || invalid.has("instagramHandle")}
              >
              <Box component="details" sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.socials")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("socialsHelp")}
                  </Typography>
                  <TextField
                    {...field("stravaUrl", t("stravaUrlHelp"))}
                    label={t("stravaUrl")}
                    placeholder="https://www.strava.com/athletes/12345"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                  <TextField
                    {...field("instagramHandle", t("instagramHandleHelp"))}
                    label={t("instagramHandle")}
                    placeholder="@numele.tau"
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 40 } }}
                  />
                </Stack>
              </Box>
              </HiddenForMinor>
              )}

              {/*
                BR-REQ-031-05. Health data is an Article 9 special category, so it gets its own
                disclosure rather than a line inside the group above, its own consent, and
                wording that says plainly it may be left empty. The server refuses text without
                the tick rather than silently dropping either one.

                Closed now, and second (§171; the owner: "nu e clar cu informațiile medicale,
                trebuie să bifeze doar «declar că sunt apt»"). The block asked for free text
                first and a consent under it, which reads as "tell us your conditions" — so the
                one thing the club actually needs from everybody, the fitness statement, was
                nowhere and this was everywhere. The statement is a required tick down in the
                consents; this is the optional note for the person who wants the medical team
                to know something, and it says so.

                On the family form, only for a minor (§NNN): the parent consents for the child;
                another adult's health note is art. 9 data only that adult can consent to.
              */}
              {(() => {
                const healthBlock = (
              <Box component="details" sx={disclosureSx} open={invalid.has("healthConsent")}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.health")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("healthIntro")}
                  </Typography>
                  <TextField
                    {...field("healthNotes", t("healthNotesHelp"))}
                    label={t("healthNotes")}
                    multiline
                    minRows={2}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                  />
                  <CheckboxField id={fieldId("healthConsent")} name="healthConsent" defaultChecked={prefill("healthConsent") === "on"}>
                    {`${t("healthConsent")} — ${t("optionalSuffix")}`}
                  </CheckboxField>
                </Stack>
              </Box>
                );
                return family ? (
                  <ShownForMinor birthDateId={fieldId("birthDate")} forceOpen={invalid.has("healthConsent") || invalid.has("healthNotes")}>
                    {healthBlock}
                  </ShownForMinor>
                ) : (
                  healthBlock
                );
              })()}

              </Stack>
              </Box>

              <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
                {t("sections.consents")}
              </Typography>

              {/*
                The one consent that is required, and the only one — BR-REQ-031-02.

                The asterisk comes from `FormControlLabel`, which reads `required` off the
                control it wraps. It used to be added by hand here, from a reading of MUI that
                was true once and is not true of the installed version — the two together
                rendered "nota de confidențialitate * *" on the form. The optional consent below
                says "optional" in words, so the difference is legible without pressing anything.
                The public-results consent that stood beside it is gone (§322): there are no
                results to consent to, and a consent to nothing informs nobody.
              */}
              {/*
                "Declar că sunt apt" (§171), required, and first among the consents because it
                is the one every entrant makes about themselves. Treated as data concerning
                health, kept as evidence under art. 9(2)(f) GDPR — only the moment it was made is
                stored, never a condition or a diagnosis. The declaration signed later says the
                same thing at length; this is it asked at the moment of entering.
              */}
              {/*
                The race's own conditions, read before they can be agreed to (§195).

                Only when this event wrote any. An event with no rules of its own has nothing to
                open, so the tick points at the event's own page as a plain link — the requirement
                is the same, the panel would just be an empty box. It no longer points at the
                club's terms (§NNN): those have a tick of their own, below, that names them.
              */}
              {hasRules ? (
                <ReadAndAgree
                  name="rulesAcknowledged"
                  fieldId={fieldId("rulesAcknowledged")}
                  title={t("rules.panelTitle", { event: event.title })}
                  openLabel={t("rules.open")}
                  readingLabel={t("rules.reading")}
                  agreedLabel={t("rules.agreed")}
                  agreeButtonLabel={t("rules.agreeButton")}
                  keepReadingLabel={t("rules.keepReading")}
                  closeLabel={t("rules.close")}
                  plainLabel={t("rules.plain")}
                  href={`${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } })}#rules`}
                  document={event.rulesJson}
                />
              ) : (
                <CheckboxField id={fieldId("rulesAcknowledged")} name="rulesAcknowledged" required defaultChecked={prefill("rulesAcknowledged") === "on"}>
                  {t("rules.plainPage")}{" "}
                  <LegalLink href={{ pathname: "/events/[slug]", params: { slug } }} newTabLabel={t("opensInNewTab")}>
                    {t("rules.pageLink")}
                  </LegalLink>
                </CheckboxField>
              )}
              {/*
                The club's terms, accepted expressly (§NNN; Codul civil art. 1203): one tick, in both
                branches above, never folded, naming the version in force and the unusual clauses.
                The link opens in a tab of its own (§197), like the facts line's.
              */}
              {/* The version this render's tick names, posted alongside it (§NNN, finding (7)):
                  what lets the service tell this tick apart from a newer version approved
                  between the render and the submit, rather than silently recording the newer
                  one under an older tick. */}
              {termsVersion !== null && <input type="hidden" name="termsVersionShown" value={termsVersion} />}
              {/* A refusal about the tick never brings it back ticked (§NNN): a version that moved
                  between the render and the submit is said here, above the box, and read anew. */}
              {acceptance.changed && (
                <Alert severity="warning" sx={{ mb: 1 }} data-testid="registration-terms-changed">
                  {t("terms.changed")}
                </Alert>
              )}
              <CheckboxField id={fieldId("termsAccepted")} name="termsAccepted" required defaultChecked={acceptance.ticked}>
                {t.rich("terms.accept", {
                  version: termsVersion ?? "—",
                  // The words as one string: `LegalLink` names itself from a string child.
                  terms: (chunks) => (
                    <LegalLink href="/legal/terms" newTabLabel={t("opensInNewTab")}>
                      {[chunks].flat().join("")}
                    </LegalLink>
                  ),
                })}
              </CheckboxField>
              {/*
                The fitness statement. On the family form (§389, §NNN) it is the parent's to make
                for a minor, as on the ordinary form, and nobody's to make for another adult: then
                the address holder acknowledges that the person makes it in the declaration they
                sign. The birth date decides which one is shown; the server decides which one is owed.
              */}
              {family ? (
                <>
                  <ShownForMinor birthDateId={fieldId("birthDate")} forceOpen={invalid.has("fitnessDeclared")}>
                    <CheckboxField id={fieldId("fitnessDeclared")} name="fitnessDeclared" required defaultChecked={prefill("fitnessDeclared") === "on"}>
                      {t("fitnessDeclared")}
                    </CheckboxField>
                  </ShownForMinor>
                  <HiddenForMinor birthDateId={fieldId("birthDate")} forceOpen={invalid.has("fitnessAcknowledged")}>
                    <CheckboxField id={fieldId("fitnessAcknowledged")} name="fitnessAcknowledged" required defaultChecked={prefill("fitnessAcknowledged") === "on"}>
                      {t("another.fitnessAcknowledged")}
                    </CheckboxField>
                  </HiddenForMinor>
                </>
              ) : (
                <CheckboxField id={fieldId("fitnessDeclared")} name="fitnessDeclared" required defaultChecked={prefill("fitnessDeclared") === "on"}>
                  {t("fitnessDeclared")}
                </CheckboxField>
              )}
              <CheckboxField id={fieldId("privacyAcknowledged")} name="privacyAcknowledged" required defaultChecked={prefill("privacyAcknowledged") === "on"}>
                {t("privacyPrefix")}{" "}
                <LegalLink href="/legal/privacy" newTabLabel={t("opensInNewTab")}>
                  {t("privacyLinkLabel")}
                </LegalLink>
              </CheckboxField>
              {/*
                BR-REQ-039-01, `DECISIONS.md` §85, §143. Asked only when this event publishes a
                start list, and asked the way round the other consents are (the owner: "it
                should be the other way: 'I want to be on the participant list'") — a tick puts
                the name on, no tick keeps it off. A question about a list that does not exist
                is noise. Switching the list on later means asking the people already
                registered — the notice, not a pre-answered box.
              */}
              {event.participantListVisibility === "NAMES" &&
                (() => {
                  const listQuestion = (
                    <>
                      <CheckboxField name="listOptIn" defaultChecked={prefill("listOptIn") === "on"}>
                        {`${t("listOptIn")} — ${t("optionalSuffix")}`}
                      </CheckboxField>
                      {/* What the list shows beside the name, once the notice in force says so (§396) —
                          the same three words the list prints, from its own catalogue keys. */}
                      {listStatesOn && (
                        <Typography variant="body2" color="text.secondary" data-testid="list-opt-in-states" sx={{ mt: -0.5 }}>
                          {t("listOptInStates", {
                            pending: tEvent("startList.states.pending"),
                            waitlisted: tEvent("startList.states.waitlisted"),
                            confirmed: tEvent("startList.states.confirmed"),
                          })}
                        </Typography>
                      )}
                    </>
                  );
                  // On the family form, a minor's only (§NNN): another adult consents to the list themselves.
                  return family ? <ShownForMinor birthDateId={fieldId("birthDate")}>{listQuestion}</ShownForMinor> : listQuestion;
                })()}

              {/*
                Pressable, always, and deliberately — and, since 2026-09-17, honest about it.

                A submit button *disabled* until a form validates cannot say why: somebody using
                a screen reader meets a control that does nothing and is told nothing, and
                somebody with a mouse is left hunting for the field they missed. Pressing it is
                what produces the answer — the browser refuses, focuses the first unfilled field
                and says what it wants, in the reader's own language. So the button stays
                pressable. What the owner asked for is the *signal* that the form is not yet
                complete, and `SubmitButton` gives that: dimmed, with one sentence beneath it,
                while any required field is empty, and a press still runs the browser's check.
                One client island, shared with every other form here.
              */}
              {/* The language of the emails and the declaration (§97): the page's, unless said otherwise. */}
              <TextField
                name="preferredLocale"
                label={t("preferredLocale")}
                helperText={t("preferredLocaleHelp")}
                select
                fullWidth
                defaultValue={prefill("preferredLocale", locale)}
              >
                <MenuItem value="ro">{t("preferredLocaleOptions.ro")}</MenuItem>
                <MenuItem value="en">{t("preferredLocaleOptions.en")}</MenuItem>
              </TextField>

              {/* Cloudflare Turnstile, when the club switched it on (§97), drawn and reset by
                  its own island (§185) — the implicit widget could not survive a re-render. */}
              {siteKey && (
                <Box id={fieldId("captcha")}>
                  <TurnstileWidget siteKey={siteKey} locale={locale} attempt={now.toISOString()} />
                  {captchaFailed && (
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                      {t("errors.captcha")}
                    </Typography>
                  )}
                  {/* Who sees what for the check, where the check is (§323): a third party
                      receives the address and the browser's signals, and the form says so. */}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {legal("botCheckNotice")}
                  </Typography>
                </Box>
              )}
              {/*
                The refusal is said **once** now (§286; the owner, of the two panels and two
                buttons: "exista un pic de reduntanta la butoanele alea").

                §194 put this copy beside the button because the summary at the top said nothing
                useful about the anti-bot check. It does now — the title, the two sentences and a
                button that sends the form from where the browser lands — so a second panel
                repeating it above the submit button is the same words twice on one screen.
              */}
              <SubmitButton
                label={t("submit")}
                pendingLabel={t("submitting")}
                // The club's runner (§318; the owner: "butoanele de trimitere înscriere și contact
                // trebuie să aibă și iconița cu un alergător") — standing at rest, running while
                // the form is in flight. Decoration: the label is the button's name.
                runner
                incompleteHint={t("incompleteHint")}
                /*
                  Only when a widget is actually on the page (§285). With no keys, or with the
                  club's switch off, there is no token to wait for and waiting would be a button
                  dimmed for a check that is not running.
                */
                awaitsBotCheck={Boolean(siteKey)}
                botCheckHint={t("botCheckWait")}
                slowHint={t("submitSlow")}
                size="large"
                fullWidth
              />
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
