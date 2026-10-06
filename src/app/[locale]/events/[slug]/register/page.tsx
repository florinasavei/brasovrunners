import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import {
  cachedAddressCap,
  cachedCurrentApprovedDocument,
  cachedDeadlines,
  cachedFamilyRegistrationOpen,
  cachedListSocialsDisclosed,
  cachedListStatesDisclosed,
  cachedPromotionalMaterialsOffered,
  cachedPromotionalMaterialsShared,
  cachedPublicAvailability,
  cachedRefusalDisclosed,
} from "@/modules/public-cache/reads";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { isColdMiss, throughBreaker } from "@/modules/resilience/breaker";
import { newcomerWouldQueue, publicNumbersShown, waitlistCountShown } from "@/modules/events/domain/registration-cta";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { registrationState } from "@/modules/events/domain/registration-window";
import { datedOrNull } from "@/modules/events/domain/dated";
import { registrationEventWithLastGood } from "@/modules/resilience/event-copy";
import { membersEventBySlug, membersViewer } from "@/modules/events/members-only";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { readFormDraft, readSubmittedFacts } from "@/modules/registrations/form-draft";
import { UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { ERROR_SUMMARY_ID, parseInvalidFields } from "@/modules/registrations/form-errors";
import { fieldId, formViewOf } from "@/modules/registrations/form-view";
import CheckYourEmail from "@/modules/registrations/ui/CheckYourEmail";
import EmailDeliveryNotice from "@/modules/registrations/ui/EmailDeliveryNotice";
import { registrationFacts, registrationForm } from "@/modules/registrations/ui/registration-form";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import { activeBotCheckSiteKey } from "@/modules/registrations/bot-check";
import { continueFamilySittingAction, releaseFamilySittingAction, submitRegistrationAction } from "./actions";
import FamilySittingNext from "@/modules/registrations/ui/FamilySittingNext";
import { afterFormScreen, SITTING_AT_CAP, sittingCookieLive, sittingMinutesLeft, sittingNames } from "@/modules/registrations/domain/family-sitting";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { readFamilySittingCookie } from "@/modules/registrations/family-sitting-cookie";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { countForm } from "@/i18n/count-form";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ submitted?: string; error?: string; fields?: string; retry?: string; another?: string; family?: string; sent?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The registration page (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05,
 * BR-REQ-033-01 criterion 1, BR-REQ-041-01): the event, what the club's texts in force and its
 * settings switch on, and the page's own state — a refusal, the family sitting, the screen after
 * the form. The form itself is `registrationForm` (`registrations/ui/registration-form.tsx`), one
 * drawing with the editor's «Previzualizare» (§579, as amended by §586): this page reads, it draws.
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
export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const now = new Date();
  /*
    The event, with its last good copy behind it (§447). While the database is away — an outage,
    or Neon refusing on the month's quota — the page is served from that copy: the resting notice
    says so, the form is drawn disabled so nothing can be sent, and what a person typed before a
    refused press comes back from the draft cookie. Every read below that needs the database is
    skipped then; the ones the public cache answers are tried and may say nothing.
  */
  const eventRead = await registrationEventWithLastGood(locale, slug, now);
  /*
    An event for the members alone (§552): the public read never meets one, so a slug it did not
    find is asked once more for a members' session only, live, never from a copy. Anybody else gets
    the page's 404. The member registers themselves, with the account's own address (`member`).
  */
  const membersRow = eventRead.value ? undefined : await membersEventBySlug(locale, slug);
  const member = membersRow ? await membersViewer() : null;
  const found = eventRead.value ?? membersRow ?? null;
  // No form while the date is to be announced (§533): registration is «în curând» until it is,
  // and the state below would say so anyway — this says it before a date is read.
  const event = found ? datedOrNull(found) : null;
  if (!event) notFound();
  const resting = eventRead.freshness === "stale";

  // Read once: the widget is drawn when both keys are set *and* the club has not switched the
  // check off (§254). The honeypot and the timing check stand either way (§19.4). None while
  // resting: the form cannot be sent, so there is no token to ask for.
  const siteKey = resting ? undefined : await activeBotCheckSiteKey(getDb(), now);
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationOpensSoon: event.registrationOpensSoon,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") notFound();

  const { submitted, error, fields, retry, another, family, sent } = await searchParams;
  /*
    The family sitting (§519), the browser's sealed half, while its email has not left yet. After the
    first form (§536) it is one question on the screen that says to open the inbox — «Mai înscrii pe
    cineva cu aceeași adresă?» — whose «Da» opens the sitting; after every form sent from that press
    on, the sitting's own screen, with «Gata»; with `?family=1` it is the next form, the address
    fixed. Everything it shows was typed on this browser (§39).
  */
  // One person per account on a members' event (§552): no family sitting, no «Mai înscrii pe cineva».
  const sittingCookie = resting || member ? null : await readFamilySittingCookie();
  const sitting = sittingCookieLive(sittingCookie, event.id, now) ? sittingCookie : null;
  const afterForm = Boolean(submitted) && sent !== "1" ? afterFormScreen(sitting) : null;
  const sittingScreen = afterForm === "sitting";
  const familyForm = !submitted && family === "1" && sitting?.joined === true;
  /*
    The club's limit per address, said where a participant meets it (§389, §576; the owner,
    2026-09-30: up to four people on one email address, and the limit said): under the address box,
    on the family's screens, and in the refusal at the limit. A sentence about the rule, from the data
    cache — never about this address (§39). Not on a members' event (one person per account, §552),
    and only once the schema allows a family at all (`family-gate.ts`).
  */
  const [addressCap, familyOpen] = member ? [null, false] : await Promise.all([cachedAddressCap(), cachedFamilyRegistrationOpen()]);
  const capMax = addressCap?.registrationsPerAddress ?? null;
  /*
    A link from an email sent before §446, which opened this form for another person on the address
    (§389). Retired: the email now carries one confirmation of the person the form named
    (`/registrations/family/[token]`), so this is the ordinary form, and one sentence above it says
    what to do instead. Nothing is read, and nothing is spent.
  */
  const anotherLinkGone = !submitted && typeof another === "string" && another !== "";
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
   * The database was away when the form was sent (§447): a compute that could not start, or Neon
   * refusing on its monthly quota. About nothing the person typed, like the three above; the
   * draft cookie brought their answers back, and nothing was registered or sent.
   */
  const databaseAway = (fields ?? "").split(",").includes("databaseAway");
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
   * "complete this field correctly" about somebody's real birth date would be untrue. Every event
   * has a minimum since §515, never under fourteen (`effectiveMinimumAge`), so the marker always
   * has a number to say.
   */
  /*
    What the form asks of this event (`form-view.ts`): its minimum age, the birth date's bounds, the
    boxes its settings switch on — one reading with the editor's «Previzualizare» (§579, as amended
    by §586).
  */
  const view = formViewOf(event, now);
  const { minAge, stepsWindow } = view;
  const tooYoung = (fields ?? "").split(",").includes(UNDER_MINIMUM_AGE);
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
    The same, said before anybody types (§348): somebody who reached this form by its address —
    the event page offers no button then — reads why it would refuse, above the first field. The
    form stays, so a slot that opens a minute later is still one press away, and so a refusal can
    keep what was typed. The cached read the event page makes; optional, so a failure says nothing.
  */
  /*
    A family sitting's next form, refused at the club's limit per address (§543): the people this
    browser already sent fill it. A marker, like the two above; every person it counts was typed here (§39).
  */
  const sittingAtCap = refusedMarkers.includes(SITTING_AT_CAP);
  /*
    `WAITLIST` is the join form itself (§587): no place, and a list that takes people — the page
    says the event page's two sentences and how an offer works once, above the form, to the person
    who arrived from «Intră pe lista de așteptare».
  */
  let fullNotice: typeof WAITLIST_FULL | typeof NO_WAITLIST | "WAITLIST" | null = null;
  let offerHours: number | null = null;
  // `waiting` null: the club keeps the line's count private (§634), and the title says no number.
  // `capacity` null: the event says no public number at all (§668), and the title names no capacity.
  let fullCounts: { capacity: number | null; waiting: number | null } | null = null;
  if (!submitted && !error && !resting) {
    try {
      const places = await cachedPublicAvailability(event.id, now);
      if (places && newcomerWouldQueue({ availablePlaces: places.available, waitlisted: places.waitlisted, waiting: places.waiting })) {
        fullNotice = places.waitlistCapacity === 0 ? NO_WAITLIST : places.waitlistRoom === 0 ? WAITLIST_FULL : "WAITLIST";
        if (fullNotice === "WAITLIST") {
          offerHours = (await cachedDeadlines()).offerHours;
          // «Arată public numărătoarea» (§668): off in the row or the entry, no capacity and no count — the door's rule.
          const numbers = publicNumbersShown(event) && publicNumbersShown(places);
          fullCounts = {
            capacity: numbers ? places.capacity : null,
            // «Arată public câți așteaptă» sits under it (§669): one rule for both, the door's.
            waiting: numbers && waitlistCountShown(places) ? (places.waiting ?? places.waitlisted ?? 0) : null,
          };
        }
      }
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }

  // "14 ani", "20 de ani" — the event's number as the refusal's summary says it (§329).
  const minimumAge = { age: yearsPhrase(minAge, locale) };
  /*
    §396: when this event publishes a list and the notice in force describes its states, the
    «Vreau să apar» box says what the list will show beside the name. The cached read the event
    page's list makes; optional, so a failure leaves the box as it always read.
  */
  let listStatesOn = false;
  /*
    §500: the same reading for the socials — while the notice in force describes them, the form
    offers «Arată și Strava și Instagram» under «Vreau să apar» and says in the socials fold that
    they reach the site only through that tick. Off (or unread), the form is as it was.
  */
  let listSocialsOn = false;
  if (view.publishesList && !resting) {
    try {
      [listStatesOn, listSocialsOn] = await Promise.all([cachedListStatesDisclosed(now), cachedListSocialsDisclosed(now)]);
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }
  /*
    §562: «Vreau să primesc oferte și beneficii» is offered only while the privacy notice in
    force describes it (`{{promotionalMaterials}}`, every language) — on every event, whether or
    not it publishes a list. Off (or unread), the form has no box and the service keeps nothing.
  */
  let promoOn = false;
  // And, while the notice in force says the partners may receive the list (§570), the box's caption
  // says so where the yes is given — the box's words stay §562's.
  let promoShared = false;
  if (!resting) {
    try {
      [promoOn, promoShared] = await Promise.all([cachedPromotionalMaterialsOffered(now), cachedPromotionalMaterialsShared(now)]);
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }
  /*
    §636: while the terms in force carry the club's right to refuse a registration (§618's grounds,
    word for word, every language), the express box names that clause too. Off (or unread),
    the box keeps §421's words exactly.
  */
  let refusalOn = false;
  if (!resting) {
    try {
      refusalOn = await cachedRefusalDisclosed(now);
    } catch (failure) {
      unstable_rethrow(failure);
    }
  }
  /*
    The club's terms in force (§421): the tick names their version, read from the text in force and
    never typed. The public cache's read, as the legal page makes it; the service asks the database
    again when the form is sent and records the version it finds. None approved: the form says
    registrations cannot be taken, and the service refuses them.
  */
  let termsVersion: number | null = null;
  try {
    termsVersion = (await cachedCurrentApprovedDocument("TERMS", locale, now))?.version ?? null;
  } catch (failure) {
    // Only while resting may it go unread: the form cannot be sent then, and the tick says "—".
    unstable_rethrow(failure);
    if (resting) {
      // Unread, as said above.
    } else if (isColdMiss(failure)) {
      /*
        A red month's miss with no copy (§493): this page reads its event from the database on every
        visit, so the text in force is read there too rather than failing the form with a 500 — through
        the breaker, as the event itself is (`event-copy.ts`), so a database this instance knows is
        away fails at once rather than waiting on a refused connection.
      */
      termsVersion = (await throughBreaker(() => findCurrentApprovedDocument(getDb(), "TERMS", locale, now)))?.version ?? null;
    } else {
      throw failure;
    }
  }
  const t = await getTranslations("Registration");
  const capPeople = capMax === null ? "" : t(`addressCap.people.${countForm(capMax, locale)}`, { count: capMax });
  // The event page's own sentences for a full event (§348), in the refusal's summary.
  const tEvent = await getTranslations("Event");

  // What they typed before the rejection (§142), to put back in every box; nothing otherwise.
  // While resting too (§447): a press the database refused left the answers in the draft cookie.
  /*
    The next form of a family sitting (§519) starts with the boxes the family shares — the city, the
    citizenship, the guardian, the emergency contact, the emails' language — as this browser posted
    them on the sitting's earlier forms; the person's own boxes start empty. A refusal's draft, which
    holds everything typed, outranks them.
  */
  const draft = error || resting ? await readFormDraft() : familyForm && sitting?.shared ? sitting.shared : null;

  // The long form with the time (§349), in lower case inside the sentence of the screen after the
  // form ("…locul la Crosul, sâmbătă, 21 nov."). Formatted in the event's own zone.
  const whenInSentence = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" });

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* What they are signing up for (§102) — one component with the editor's preview (§579). */}
      {await registrationFacts({ view, locale, slug, submitted: Boolean(submitted) })}

      {/*
        Where the email is *not* going, said before anything promises one: on QA only the
        club's authorized addresses receive mail, on a laptop nothing is sent at all, and two
        testers stood on the screen below waiting for a message that was never coming. Nothing
        on production, where the mode is `live` (`delivery-notice.ts`). Above the journey strip
        so it is the first thing read on the form and on the check-your-email screen alike.
      */}
      {/* Served from the last good copy (§447): when, and — on a month Neon has paused — until when. */}
      <LastGoodNotice read={eventRead} />

      <EmailDeliveryNotice />

      {/* Where they are in the journey, and what happens next — the same component every page
          of this flow renders, so the answer never depends on which page they are looking at. */}
      <RegistrationJourney current={submitted && !sittingScreen ? "confirm" : "details"} />

      {/* The five steps and the waiting list, folded: the journey above says where they are,
          this says the whole of it (`DECISIONS.md` §91). */}
      {!submitted && (
        <Box sx={{ mb: 3 }}>
          <RegistrationSteps folded window={stepsWindow} reminderHoursBefore={event.reminderHoursBefore} />
        </Box>
      )}

      {sittingScreen && sitting ? (
        /*
          The sitting's screen (§519), after «Da, încă o persoană» (§536): the people so far, «Gata»
          sends the one email, «Da» the next form. The same screen after every form, whatever the
          address holds (§39).
        */
        <FamilySittingNext
          email={sitting.email}
          names={sittingNames(sitting.people)}
          // Each person's place and until when (§543), from the browser's half.
          reservation={{ people: sitting.people, until: sitting.reservedUntil ?? null }}
          sameBirthDate={sitting.sameBirthDate ?? null}
          releaseInMs={sitting.heldUntil.getTime() - now.getTime()}
          firstName={submittedFacts?.firstName ?? null}
          eventTitle={event.title}
          atOnce={sitting.atOnce === true}
          windowMinutes={sitting.windowMinutes ?? null}
          locale={locale}
          slug={slug}
          continueAction={continueFamilySittingAction}
          releaseAction={releaseFamilySittingAction}
          // «N din 4» and, at the limit, the rule in place of «Da» (§576).
          cap={familyOpen ? capMax : null}
        />
      ) : submitted ? (
        /*
          "Aproape gata, Ana!" — the screen after the form, in `CheckYourEmail.tsx`. It carries
          every fact the receipt it replaced had: the address (§224), the wait in bold and once
          (§224), the Spam and Promotions box, the sentence that keeps it true for somebody already
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
          /*
            After the first form (§536): the short screen — whose form is in, when its email leaves,
            and «Mai înscrii pe cineva cu aceeași adresă?» with its one button. Its email leaves on the
            club's timing: nothing here waits for a press. The same screen after every first form,
            whatever the address holds (§39).
          */
          offer={
            afterForm === "offer" && sitting
              ? {
                  atOnce: sitting.atOnce === true,
                  email: sitting.email,
                  windowMinutes: sitting.windowMinutes,
                  // Computed once when the form was sent, never at render (the review of 2026-09-28).
                  leavesAt: sitting.emailLeavesAt,
                  // Under «imediat», when the form was sent: a reload after a minute says the email left (§540).
                  submittedAt: sitting.emailSubmittedAt,
                  continueAction: continueFamilySittingAction,
                }
              : undefined
          }
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
          {/* The form cannot be sent while resting (§447); what was typed stays in the boxes below. */}
          {resting && !submitted && (
            <Alert severity="info" sx={{ mb: 2 }} data-testid="registration-resting">
              {t("restingForm")}
            </Alert>
          )}
          {/* The refusal a press met while the database was away is what the notice above says. */}
          {error && !(resting && databaseAway) && (
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
                {databaseAway
                  ? t("errors.databaseAwayTitle")
                  : throttled
                    ? t("errors.throttledTitle")
                    : tooFast
                      ? t("errors.tooFastTitle")
                      : t("errors.title")}
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
              {databaseAway ? (
                t("errors.databaseAway")
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
              ) : sittingAtCap ? (
                <Box component="span" data-testid="registration-sitting-at-cap">
                  {t("errors.sittingAtCap", { people: capPeople })}
                </Box>
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
                        <MuiLink href={`#${fieldId(name)}`}>
                          {t(`fieldNames.${name}`)}
                        </MuiLink>
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

          {/* A link from an older email for another person (§389), opened: one sentence, then the ordinary form (§446). */}
          {anotherLinkGone && !error && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="another-person-link-gone">
              {t("another.linkGone")}
            </Alert>
          )}

          {/*
            The form itself (`registrationForm`, one drawing with the editor's «Previzualizare»,
            §579 as amended by §586): the notices before the first field, the boxes this event's
            settings switch on, the consents and the send button.
          */}
          {await registrationForm({
            view,
            locale,
            slug,
            now,
            settings: { termsVersion, refusalOn, listStatesOn, listSocialsOn, promoOn, promoShared, capMax, familyOpen, siteKey },
            address: member
              ? { kind: "member", email: member.email }
              : familyForm && sitting
                ? { kind: "sitting", email: sitting.email, peopleSoFar: sitting.people.length }
                : { kind: "typed" },
            invalid,
            refusal: { tooYoung, emergencySame, captchaFailed, tooFast, retry: retry === "1" },
            draft: draft ?? null,
            resting,
            fullNotice,
            fullCounts,
            offerHours,
            action: submitRegistrationAction,
            /*
              The next person of a family sitting (§519): who was sent so far, that nothing waiting is
              mailed yet, and the way back to «Gata» without filling this one in.
            */
            familyIntro:
              familyForm && sitting ? (
                <Alert severity="success" icon={false} sx={{ mb: 2 }} data-testid="family-sitting-intro">
                  <AlertTitle>{t("sitting.formTitle")}</AlertTitle>
                  <Typography variant="body2">{t("sitting.formSoFar", { names: sittingNames(sitting.people).join(", ") })}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {/*
                      How long is left, on the server's clock at this render (§519): the email leaves by
                      itself then unless this form is sent — sending it starts the window again. At a
                      window of 0 nothing waits: this person's email leaves when the form is sent.
                    */}
                    {sitting.atOnce
                      ? t("sitting.formAtOnce")
                      : t("sitting.formLeft", { minutes: minutesPhrase(locale, Math.max(1, sittingMinutesLeft(sitting.heldUntil.getTime() - now.getTime()))) })}{" "}
                    <MuiLink href={`${getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug } } })}?submitted=1`} sx={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
                      {t("sitting.formBack")}
                    </MuiLink>
                  </Typography>
                </Alert>
              ) : null,
          })}

        </>
      )}
    </Container>
  );
}
