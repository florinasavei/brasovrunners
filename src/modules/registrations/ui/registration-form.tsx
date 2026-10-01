import BadgeIcon from "@mui/icons-material/Badge";
import CampaignIcon from "@mui/icons-material/Campaign";
import DescriptionIcon from "@mui/icons-material/Description";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import GroupsIcon from "@mui/icons-material/Groups";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ShareIcon from "@mui/icons-material/Share";
import ShieldIcon from "@mui/icons-material/Shield";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { fullThanksPhrase, waitlistOfferPhrase } from "@/modules/events/ui/counted-phrases";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { ageRuleVariant, yearsPhrase } from "@/modules/registrations/domain/age";
import { NO_WAITLIST, WAITLIST_FULL } from "@/modules/registrations/domain/waitlist";
import { countryOptions } from "@/modules/registrations/countries";
import { SECOND_ATTEMPT_FIELD } from "@/modules/registrations/fields";
import { fieldId, REGISTRATION_FORM_ID, type RegistrationFormView } from "@/modules/registrations/form-view";
import { acceptanceAfterRefusal, REGISTRATION_FORM_FIELDS } from "@/modules/registrations/form-errors";
import { countryName } from "@/modules/registrations/names";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { BOT_CHECK_ERROR_ATTRIBUTE, BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import ClubForMember from "@/modules/registrations/ui/ClubForMember";
import { emailDelayNotice } from "@/modules/registrations/ui/email-delay-notice";
import EmailTwice from "@/modules/registrations/ui/EmailTwice";
import GuardianForMinor from "@/modules/registrations/ui/GuardianForMinor";
import HiddenForMinor from "@/modules/registrations/ui/HiddenForMinor";
import NationalityField from "@/modules/registrations/ui/NationalityField";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import ReadAndAgree from "@/modules/registrations/ui/ReadAndAgree";
import SexField from "@/modules/registrations/ui/SexField";
import ShownWithSocial from "@/modules/registrations/ui/ShownWithSocial";
import { FAMILY_SITTING_FIELD } from "@/modules/registrations/domain/family-sitting";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import CheckboxField from "@/shared/ui/CheckboxField";
import { CONSENT_DENSITY } from "@/shared/ui/consent-density";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import Hint from "@/shared/ui/Hint";
import LegalLink from "@/shared/ui/LegalLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { countForm } from "@/i18n/count-form";
import { CLUB_NAME } from "@/theme/brand";

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
 * The editor's «Previzualizare» (§579, amended by §586): the form drawn as a participant sees it,
 * sending nothing. `word` is «previzualizare» in the form's language, carried by the disabled
 * send button as the preview's door carries it.
 */
export type RegistrationFormPreview = { word: string };

/**
 * What a registration of this event may be put to by the club's texts and settings in force — read
 * by the caller: the register page through the public cache, the editor's preview straight from
 * the database (§579: a preview neither reads nor fills the cache).
 */
export type RegistrationFormSettings = {
  /** The terms in force (§421): their version, named by the tick; null while none is approved. */
  termsVersion: number | null;
  /** The notice in force describes the public list's states (§396). */
  listStatesOn: boolean;
  /** The notice in force describes the socials on the list (§500). */
  listSocialsOn: boolean;
  /** The notice in force describes «oferte și beneficii» (§562), and that partners may receive it (§570). */
  promoOn: boolean;
  promoShared: boolean;
  /** The club's limit per address (§389, §576), and whether the schema takes a family at all. */
  capMax: number | null;
  familyOpen: boolean;
  /** Cloudflare's widget, when drawn (§97, §254): never in a preview (§577). */
  siteKey: string | undefined;
};

/** Whose address the form takes: typed twice (§206), a member's account (§552), or the family sitting's (§519). */
export type RegistrationFormAddress =
  | { kind: "typed" }
  | { kind: "member"; email: string }
  | { kind: "sitting"; email: string; peopleSoFar: number };

/**
 * **What the register page and the editor's preview both draw above the form (§102)**: the title,
 * the date and the place, the cost, the links to the event, its rules and the two legal texts, and
 * who may enter. Moved out of `register/page.tsx` unchanged, so the preview (§579) is the page.
 *
 * **Awaited, not mounted** — `{await registrationFacts(…)}`, like `registrationForm` below: the
 * caller gets the finished elements, so the register page stays one tree its tests draw with the
 * synchronous renderer, as it was before the form moved here.
 */
export async function registrationFacts({ view, locale, slug, submitted }: { view: RegistrationFormView; locale: Locale; slug: string; submitted: boolean }): Promise<ReactNode> {
  const { event, hasRules, costHost, minAge } = view;
  const t = await getTranslations("Registration");
  // The event page's own words for a place still to be announced (§328), one key for every surface.
  const tEvent = await getTranslations("Event");
  // "14 ani", "20 de ani" — the event's number as this page's sentences say it (§329).
  const minimumAge = { age: yearsPhrase(minAge, locale) };
  // What they are signing up for, on the form itself (§102): the date, the place, and the
  // event's page, its rules and the two legal texts as links — the owner: "show the race date,
  // details and TOS on the sign-up form as links". Formatted in the event's own zone.
  // The long form with the time (§349), capitalised where it starts the line.
  const whenLabel = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true });
  /*
    What is being paid for, and where (§343), the same short phrase the event page's facts say
    (`EventFacts`) — never a raw URL, only the host a runner recognises ("Linkuri și fișiere",
    §332). Null for an event whose cost has not been stated, which is not the same as free.
  */
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
  const factLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight, marginRight: 16 } as const;

  return (
    <>
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
            a warning. Two forms, so it reads right whatever the number (§515: never under
            fourteen): under eighteen it names who registers a minor, eighteen or more says nothing about parents, and the
            same sentence stands on the event page. Gone once the form has been sent: by then it
            has been answered. */}
        {!submitted && (
          <Typography variant="body2" color="text.secondary" data-testid="age-rule">
            {t(`ageRule.${ageRuleVariant(minAge)}`, minimumAge)}
          </Typography>
        )}
      </Box>
    </>
  );
}

export type RegistrationFormInput = {
  view: RegistrationFormView;
  locale: Locale;
  slug: string;
  /** The render's instant: the timing check's field (§194). */
  now: Date;
  settings: RegistrationFormSettings;
  address: RegistrationFormAddress;
  /** The boxes a refusal named (`parseInvalidFields`), and the markers that say which rule refused (§47). */
  invalid: ReadonlySet<string>;
  refusal: { tooYoung: boolean; emergencySame: boolean; captchaFailed: boolean; tooFast: boolean; retry: boolean };
  /** What was typed before a refusal (§142), or the family's shared boxes (§519). */
  draft: Readonly<Record<string, string>> | null;
  /** The database is away (§447): the form is drawn disabled, and nothing can be sent. */
  resting: boolean;
  /**
   * No place and nothing to join (§348), said before anybody types — or `WAITLIST`, the join form
   * itself (§587): no place, and a list that takes people.
   */
  fullNotice: typeof WAITLIST_FULL | typeof NO_WAITLIST | "WAITLIST" | null;
  /** For `WAITLIST`: the event's places and how many already wait, for the thank-you lead (§587). */
  fullCounts: { capacity: number; waiting: number } | null;
  /** For `WAITLIST`: the club's offer window («Termene», `offerHours`, §377); null says no offer sentence. */
  offerHours: number | null;
  /** The family sitting's next form (§519): who was sent so far, above the form. */
  familyIntro?: ReactNode;
  /** The Server Action the form posts to; absent in a preview, which posts nothing. */
  action?: (form: FormData) => Promise<void>;
  preview?: RegistrationFormPreview;
};

/**
 * **The registration form (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05,
 * BR-REQ-033-01 criterion 1, BR-REQ-041-01)** — one drawing for the register page and the
 * editor's «Previzualizare» (§579, amended by §586), so the preview is the form a participant meets,
 * never a second copy that drifts (§187's lesson). Awaited by its caller, like `registrationFacts`.
 *
 * Why this is one page and not a wizard is `DECISIONS.md` §47: every way of splitting it keeps
 * partial answers somewhere, and each place costs more than the length it saves.
 *
 * **In a preview** nothing can be sent: no action, no hidden field the service reads (the event's
 * address, the timing check, the honeypot, the terms version shown, the second try), no Turnstile —
 * no widget, no script, no token field (§577) — and the send button drawn disabled with
 * «previzualizare». The boxes are plain empty inputs a staff member may type in to feel the form.
 */
export async function registrationForm({
  view,
  locale,
  slug,
  now,
  settings,
  address,
  invalid,
  refusal,
  draft,
  resting,
  fullNotice,
  fullCounts,
  offerHours,
  familyIntro,
  action,
  preview,
}: RegistrationFormInput): Promise<ReactNode> {
  const { event, hasRules, askShirt, askHealth, minAge } = view;
  const { termsVersion, listStatesOn, listSocialsOn, promoOn, promoShared, capMax, familyOpen } = settings;
  const siteKey = preview ? undefined : settings.siteKey;
  const { tooYoung, emergencySame, captchaFailed, tooFast, retry } = refusal;
  const member = address.kind === "member" ? address : null;
  const sitting = address.kind === "sitting" ? address : null;
  const familyForm = sitting !== null;
  const t = await getTranslations("Registration");
  const tEvent = await getTranslations("Event");
  // "14 ani", "20 de ani" — the event's number as this page's sentences say it (§329).
  const minimumAge = { age: yearsPhrase(minAge, locale) };
  const capPeople = capMax === null ? "" : t(`addressCap.people.${countForm(capMax, locale)}`, { count: capMax });
  const capRule = familyOpen && capMax !== null && capMax > 1 ? t("addressCap.rule", { people: capPeople }) : null;
  const earliestBirthDate = view.birthDate.earliest;
  const latestBirthDate = view.birthDate.latest;
  // Names from the platform, order from the reader's own collation (`countries.ts`).
  const countries = countryOptions(locale, (code) => countryName(code, locale));
  // The phone prefixes' order and names, sorted and named here and only drawn in the browser
  // (§324): the two runtimes' ICU data name countries differently, and computing either again
  // in the browser broke hydration.
  const phoneOrder = phoneCountryOrder(locale);
  const phoneNames = phoneCountryLabels(locale);
  // The two country pickers' search words (§463), as plain strings for the islands (§353).
  const countrySearchWords = {
    search: t("countrySearch.search"),
    noMatch: t("countrySearch.noMatch"),
    open: t("countrySearch.open"),
    close: t("countrySearch.close"),
  };
  /*
  What was typed before a rejected submission (§142), by field name.

  Named `prefill` rather than `typed`: the i18n checker reads every `t…(` call as a translation
  lookup (`t\w*\(`), so `prefill("privacyAcknowledged")` was being counted as a missing message
  key. It passed for years only because every name it had been given — `email`, `city` — also
  happened to exist in the catalogue.
*/
  const prefill = (name: string, fallback?: string) => draft?.[name] ?? fallback;
  /*
    The terms tick is the one box the draft does not simply bring back (§421): a refusal naming it
    returns it unticked, and says so when the version in force moved (`acceptanceAfterRefusal`).
  */
  const acceptance = acceptanceAfterRefusal({ invalid, draft, versionInForce: termsVersion });
  /**
   * The props every text field shares: its anchor, its name, whether it was rejected, and the
   * message under it when it was.
   *
   * `docs/PRACTICES.md` § Accessibility asks for an error stated next to its field rather than
   * only in a summary at the top. MUI derives `aria-describedby` from `helperText`, so the
   * message is announced with the field instead of having to be hunted for.
   */
  const field = (name: string, help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: prefill(name),
  });

  return (
    <>
      {/* No terms approved (§421): there is nothing to accept, and the service would refuse. */}
      {termsVersion === null && !resting && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="registration-terms-missing">
          {t("terms.missing")}
        </Alert>
      )}
      {fullNotice === "WAITLIST" ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="registration-waitlist-notice">
          <AlertTitle>{fullCounts ? fullThanksPhrase(tEvent, locale, fullCounts.capacity, fullCounts.waiting) : tEvent("cta.fullLead")}</AlertTitle>
          <Typography variant="body2">{tEvent("cta.fullJoin")}</Typography>
          {offerHours !== null && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {waitlistOfferPhrase(tEvent, locale, offerHours)}
            </Typography>
          )}
        </Alert>
      ) : (
        fullNotice && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="registration-full-notice">
            {fullNotice === NO_WAITLIST ? tEvent("cta.fullNoWaitlist") : tEvent("cta.waitlistFull")}
          </Alert>
        )
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
        Said once (§546): the two section markers that repeated it are gone.
      */}
      <Alert severity="info" icon={false} sx={{ mb: 2 }}>
        {event.participantListVisibility === "NAMES" ? t("privacyBannerWithList") : t("privacyBanner")}
      </Alert>
      {familyIntro}
      {/* A preview's form has no action (§579, amended by §586): nothing it holds is posted anywhere. */}
      <form action={preview ? undefined : action} id={REGISTRATION_FORM_ID} data-preview={preview ? "true" : undefined}>
        {/*
          The try after a refusal (§282). The action reads this back and lets the submission
          through whatever the hidden trap says: a password manager refills that trap on
          every render, so refusing twice for the same reason would loop a real person
          forever — which is precisely how somebody gives up on entering a race.
        */}
        {retry && !preview && <input type="hidden" name={SECOND_ATTEMPT_FIELD} value="1" />}
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
        {tooFast && !resting && !preview && (
          <Box sx={{ display: "flex", mb: 2 }}>
            <SubmitButton
              label={t("errors.tooFastResend")}
              pendingLabel={t("submitting")}
              runner
              awaitsBotCheck={Boolean(siteKey)}
              botCheckHint={t("botCheckWait")}
              botCheckTickHint={t("botCheckTick")}
              botCheckExpiredHint={t("botCheckExpired")}
              botCheckValveHint={t("botCheckValve")}
              slowHint={t("submitSlow")}
              size="medium"
            />
          </Box>
        )}
        {/*
          Disabled as one while resting (§447): a disabled fieldset turns off every control inside
          it — nothing can be typed, pressed or sent — and still shows what the draft brought back.
        */}
        <Box component="fieldset" disabled={resting} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Stack spacing={2}>
          {/* What the service reads beside the boxes — none of it in a preview, which sends nothing. */}
          {!preview && (
            <>
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
            </>
          )}

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
          {/* No «Confidențial» marker under the heading any more (§546): the banner above the
              form says where every answer goes, once. */}
          <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
            {t("sections.about")}
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

          {/* No help at rest (§546): the minimum age is the line above the form, and the date in
              words under the box (§467), its helper since §561, says the age on race day. A
              refusal for age says the rule (§321, §329) rather than "complete this field
              correctly". Typed day first — «11.05.1990» — never the browser's own date box,
              which drew the digits in the browser's order (§561), nor the backoffice's MUI
              picker (§345): a birth date decades back is faster typed than paged to, and this
              page stays free of the picker's library. The bounds are the server's: a date in
              the future, or one under this event's minimum age on the race day, is refused
              by the box itself rather than a round trip. */}
          <BirthDateField
            id={fieldId("birthDate")}
            name="birthDate"
            label={t("birthDate")}
            defaultValue={prefill("birthDate")}
            required
            autoComplete="bday"
            error={invalid.has("birthDate")}
            errorText={tooYoung ? t("errors.tooYoung", minimumAge) : t("errors.field")}
            min={earliestBirthDate}
            max={latestBirthDate}
            eventDay={view.eventDay}
            locale={locale}
            echoTemplate={t("birthDateEcho", { date: "{date}", age: "{age}" })}
            placeholder={t("birthDatePlaceholder")}
            unreadable={t("birthDateUnreadable")}
            tooYoung={t("errors.tooYoung", minimumAge)}
          />

          {/* The city, required and right after the birth date (§467; the owner, 2026-09-26:
              "orașul ar trebui să fie obligatoriu, pune după data nașterii"), reversing
              §322's optional fold. The country the runner lives in comes first (§510): a city
              means little without it, and a citizenship is not where somebody lives. The
              citizenship's own searchable native select (§463), required and on Romania unless
              the runner says otherwise; stored and exported, never shown publicly. */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <NationalityField
              {...field("country")}
              label={t("country")}
              // A blank from an older draft comes back as Romania, as the citizenship does.
              defaultValue={prefill("country") || "RO"}
              countries={countries}
              words={countrySearchWords}
            />
            <TextField
              {...field("city")}
              label={t("city")}
              required
              fullWidth
              autoComplete="address-level2"
            />
          </Stack>

          {/* «Feminin» or «Masculin», each with its glyph (§554, amending §510): a dropdown again
              (§555), «Feminin» first — a native select behind an empty «Alege…», nothing
              pre-chosen, required by the browser, the §422 list and the server; «Prefer să nu
              spun» is no longer an answer. What it is for stays under it (§322, §546): a
              category ranking, which the label cannot say. */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <SexField
              {...field("sex", t("sexHelp"))}
              label={t("sex")}
              placeholder={t("sexChoose")}
              answers={{ FEMALE: t("sexOptions.FEMALE"), MALE: t("sexOptions.MALE") }}
            />
            {/*
              Citizenship, required and pre-chosen on Romania (§432; the owner, 2026-09-26:
              "cetățenia ar trebui să fie obligatorie; by default pune Român") — most entrants
              are, so a Romanian runner just leaves it. It was optional in the fold on the
              right (§322); the server now refuses a public form without it. A native select the
              server draws and the form posts, searchable once the island runs (§463): the
              owner, "vreau searchbox să pot găsi țara".
            */}
            <NationalityField
              {...field("nationality")}
              label={t("nationality")}
              // A blank from an older draft comes back as Romania too, never an empty select.
              defaultValue={prefill("nationality") || "RO"}
              countries={countries}
              words={countrySearchWords}
            />
          </Stack>

          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.contact")}
          </Typography>

          {/*
            The address, twice, typed by hand (§206). QA's outbox holds three bounced
            messages to "…@gmail.con": one letter, and the confirmation link goes nowhere
            while the screen says to check the inbox.
          */}
          {/*
            The next form of a family sitting (§519): the address is the sitting's, said back in
            bold and not asked again — the server takes it from the browser's sealed half.
          */}
          {member ? (
            /*
              A members' event (§552): the account's own address, said back in bold and not asked —
              the server takes it from the session, whatever is posted. One person per account.
            */
            <Box data-testid="members-address">
              {/* In a preview there is no member (§579): the line names the account, and nothing is posted. */}
              {!preview && (
                <>
                  <input type="hidden" name="email" value={member.email} />
                  <input type="hidden" name="emailConfirm" value={member.email} />
                </>
              )}
              <Typography variant="body2" color="text.secondary">
                {t("membersAddressLabel")}
              </Typography>
              <Typography sx={{ fontWeight: 700, wordBreak: "break-all" }}>{member.email}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("membersAddressHelp")}
              </Typography>
            </Box>
          ) : familyForm && sitting ? (
            <Box data-testid="family-sitting-address">
              <input type="hidden" name={FAMILY_SITTING_FIELD} value="1" />
              <Typography variant="body2" color="text.secondary">
                {t("sitting.addressLabel")}
              </Typography>
              <Typography sx={{ fontWeight: 700, wordBreak: "break-all" }}>{sitting.email}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("sitting.addressHelp")}
              </Typography>
              {/* How many so far, out of the limit (§576): the people this browser sent, and this one. */}
              {familyOpen && capMax !== null && (
                <Typography variant="body2" color="text.secondary" data-testid="address-cap-count">
                  {t(`sitting.count.${countForm(capMax, locale)}`, { count: Math.min(sitting.peopleSoFar + 1, capMax), max: capMax })}
                </Typography>
              )}
            </Box>
          ) : (
          <>
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
            // No help at rest (§546): the address is typed twice, and the line above the form
            // already says the email comes to confirm it.
            defaultValue={prefill("email")}
            defaultConfirmValue={prefill("emailConfirm")}
            error={invalid.has("email") || invalid.has("emailConfirm")}
            helperText={invalid.has("email") || invalid.has("emailConfirm") ? t("errors.field") : undefined}
          />
          {/*
            The limit per address, under the box (§576, amending §546's "no help at rest" for this one
            fact): the owner asked for it said, and the form is where a family starts.
          */}
          {capRule && (
            <Typography variant="body2" color="text.secondary" data-testid="address-cap-rule">
              {capRule}
            </Typography>
          )}
          </>
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
            searchWords={countrySearchWords}
            required
            autoComplete="tel-national"
            error={invalid.has("phone")}
            helperText={invalid.has("phone") ? t("errors.phone") : t("phoneHelp")}
          />

          {/*
            Required because somebody has to be reachable if a runner is not (BR-BUS-031).
            `autoComplete="off"` on both: this is deliberately somebody *else's* name and
            number, and a phone offering the runner's own would be accepted by reflex.
          */}
          <Stack spacing={2}>
            {/* A third person's name and number (§322): the runner is the one who can tell
                them, so the form says to, when they would be rung, and that both are deleted
                seven days after the event (§421). */}
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
              searchWords={countrySearchWords}
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
              <BadgeIcon aria-hidden sx={FOLD_GLYPH_SX} />
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
              <GroupsIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {/* «tricou» only when the event gives one (§554): the kit card's tick. */}
              {askShirt ? t("disclosure.race", { club: CLUB_NAME }) : t("disclosure.raceNoShirt", { club: CLUB_NAME })}
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

              {/* The T-shirt's size, only for an event that gives one (§554, «Kit de participare»):
                  otherwise no box at all, and the server stores NONE whatever a stale form posts. */}
              {askShirt && (
                <TextField
                  {...field("tshirtSize")}
                  label={t("tshirtSize")}
                  select
                  defaultValue={prefill("tshirtSize", "NONE")}
                >
                  <MenuItem value="NONE">{t("tshirtSizes.NONE")}</MenuItem>
                  {SHIRT_SIZES.map((size) => (
                    <MenuItem key={size} value={size}>
                      {size}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {/*
                The club, filled in and locked while the tick above is on (§215; the owner:
                "if people check that they are brasov runners members, the club input must be
                auto-filled and readonly"). The same fact was being written three ways —
                "BRASOV RUNNERS", "Brasov runners", "BvR" — and the export read them as three
                clubs. The tick still grants nothing (§48); the service writes the same name
                whatever the browser did, so a form filled with JavaScript off records it too.
              */}
              <ClubForMember
                {...field("clubName")}
                label={t("clubName")}
                memberCheckboxId={fieldId("clubMemberDeclared")}
                clubName={CLUB_NAME}
                lockedHelperText={t("clubNameFromMembership")}
              />
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
              {/* One helper, under the name (§546): required under eighteen — the box carries no
                  asterisk, because it is shown by the birth date — who signs, and whose email. */}
              <TextField
                {...field("guardianName", t("guardianHelp"))}
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
              Another adult's, sent from an address registered already (§421, §446), are that
              adult's to give: the service keeps none of them for the confirmation. */}
          <HiddenForMinor
            birthDateId={fieldId("birthDate")}
            forceOpen={invalid.has("stravaUrl") || invalid.has("instagramHandle")}
          >
          <Box component="details" sx={disclosureSx}>
            <Typography component="summary" variant="body2">
              <ShareIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {t("disclosure.socials")}
            </Typography>
            <Stack spacing={2} sx={{ pb: 2 }}>
              {/* "Nu apar pe site" stops being the whole truth once the list can print them (§500). */}
              <Typography variant="body2" color="text.secondary">
                {listSocialsOn ? t("socialsHelpList") : t("socialsHelp")}
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
                {...field("instagramHandle")}
                label={t("instagramHandle")}
                placeholder="@numele.tau"
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
            </Stack>
          </Box>
          </HiddenForMinor>

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

            For another adult sent from an address registered already (§421, §446), the health
            note is art. 9 data only that adult can consent to: the service keeps none of it.

            Drawn only when the event asks it (§557, the editor's «Informații medicale»): the
            club collects art. 9 data only where it decided to. The server ignores a posted note
            for any other event, so a stale form is never refused.
          */}
          {askHealth && (() => {
            const healthBlock = (
          <Box component="details" sx={disclosureSx} open={invalid.has("healthConsent")}>
            <Typography component="summary" variant="body2">
              <MedicalServicesIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {t("disclosure.health")}
            </Typography>
            <Stack spacing={2} sx={{ pb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t("healthIntro")}
              </Typography>
              <TextField
                {...field("healthNotes")}
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
            return healthBlock;
          })()}

          </Stack>
          </Box>

          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.consents")}
          </Typography>

          {/*
            «Acorduri», compacted (§570; the owner: "Also these need to be more compacted!"): its
            own Stack with no gap between rows, the boxes small and still 44 to the thumb, the
            labels in body2, each helper a caption under its label (`CONSENT_DENSITY`). Every
            word the legal reviews fixed (§425, §556) is unchanged.
          */}
          <Stack spacing={0} sx={{ gap: `${CONSENT_DENSITY.rowGapPx}px`, minWidth: 0 }} data-testid="registration-consents">

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
            club's terms (§421): those have a tick of their own, below, that names them.
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
              tickLabel={t("rules.tick")}
              // A refusal about another field brings the tick back as posted (§286, §422).
              defaultAgreed={prefill("rulesAcknowledged") === "on"}
              href={`${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } })}#rules`}
              document={event.rulesJson}
            />
          ) : (
            <CheckboxField id={fieldId("rulesAcknowledged")} name="rulesAcknowledged" required dense defaultChecked={prefill("rulesAcknowledged") === "on"}>
              <MenuBookIcon aria-hidden data-testid="consent-glyph" />
              {t("rules.plainPage")}{" "}
              <LegalLink href={{ pathname: "/events/[slug]", params: { slug } }} newTabLabel={t("opensInNewTab")}>
                {t("rules.pageLink")}
              </LegalLink>
            </CheckboxField>
          )}
          {/*
            The club's terms, accepted expressly (§421; Codul civil art. 1203): one tick, in both
            branches above, never folded, naming the version in force and the unusual clauses.
            The link opens in a tab of its own (§197), like the facts line's.
          */}
          {/* The version this render's tick names, posted alongside it (§421, finding (7)):
              what lets the service tell this tick apart from a newer version approved
              between the render and the submit, rather than silently recording the newer
              one under an older tick. */}
          {termsVersion !== null && !preview && <input type="hidden" name="termsVersionShown" value={termsVersion} />}
          {/* A refusal about the tick never brings it back ticked (§421): a version that moved
              between the render and the submit is said here, above the box, and read anew. */}
          {acceptance.changed && (
            <Alert severity="warning" sx={{ mb: 1 }} data-testid="registration-terms-changed">
              {t("terms.changed")}
            </Alert>
          )}
          <CheckboxField id={fieldId("termsAccepted")} name="termsAccepted" required dense defaultChecked={acceptance.ticked}>
            <DescriptionIcon aria-hidden data-testid="consent-glyph" />
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
          <CheckboxField id={fieldId("fitnessDeclared")} name="fitnessDeclared" required dense defaultChecked={prefill("fitnessDeclared") === "on"}>
            <MedicalServicesIcon aria-hidden data-testid="consent-glyph" />
            {t("fitnessDeclared")}
          </CheckboxField>
          <CheckboxField id={fieldId("privacyAcknowledged")} name="privacyAcknowledged" required dense defaultChecked={prefill("privacyAcknowledged") === "on"}>
            <ShieldIcon aria-hidden data-testid="consent-glyph" />
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
                  {/* What the list shows beside the name, once the notice in force says so (§396) —
                      the same three words the list prints, from its own catalogue keys; the
                      caption under the tick (§570). The tick names the list and the results as one
                      disclosure: «… pe lista de participanți & rezultate» (the owner, 2026-09-29). */}
                  <CheckboxField
                    name="listOptIn"
                    dense
                    defaultChecked={prefill("listOptIn") === "on"}
                    help={
                      listStatesOn
                        ? t("listOptInStates", {
                            pending: tEvent("startList.states.pending"),
                            waitlisted: tEvent("startList.states.waitlisted"),
                            confirmed: tEvent("startList.states.confirmed"),
                          })
                        : undefined
                    }
                    helpTestId="list-opt-in-states"
                    optional={t("optionalSuffix")}
                  >
                    {/* The trophy (round 2): the list and the results, one disclosure behind one tick. */}
                    <EmojiEventsIcon aria-hidden data-testid="consent-glyph" />
                    {t("listOptIn")}
                  </CheckboxField>
                  {/*
                    The socials beside the name (§500), behind the notice in force and asked as a
                    consent of its own: never folded (§59), never pre-ticked, and meaningless
                    without the list tick above and a social typed in the fold — the service
                    keeps it only with both. Adults only, like the socials themselves (§323):
                    hidden and disabled once the birth date says under eighteen. And asked only
                    once there is something to show (`ShownWithSocial`): hidden and disabled
                    until the Strava or the Instagram box holds a value — shown without
                    JavaScript, where nothing typed is known.
                  */}
                  {listSocialsOn && (
                    <HiddenForMinor birthDateId={fieldId("birthDate")}>
                      <ShownWithSocial
                        inputIds={[fieldId("stravaUrl"), fieldId("instagramHandle")]}
                        forceOpen={prefill("listSocials") === "on"}
                      >
                        <CheckboxField name="listSocials" dense defaultChecked={prefill("listSocials") === "on"} help={t("listSocialsHelp")} helpTestId="list-socials-help" optional={t("optionalSuffix")}>
                          <ShareIcon aria-hidden data-testid="consent-glyph" />
                          {t("listSocials")}
                        </CheckboxField>
                      </ShownWithSocial>
                    </HiddenForMinor>
                  )}
                </>
              );
              return listQuestion;
            })()}
          {/*
            «Oferte și beneficii» (§562): a consent of its own, under the list tick — the owner's
            sentence as the label, ending in its full stop, the club named from `CLUB_NAME`, then
            « — opțional» like every optional box of the block (round 2 of §570, amending §562's
            «Opțional.» at the head of the helper line);
            optional, never pre-ticked, never required, never folded (§59). Asked only while the
            notice in force describes it; the service keeps a tick only under a notice that
            names it, never on another adult's family form (§421), never from staff. The glyph
            leads the words, drawn here in the Server Component as the label's own child.
          */}
          {promoOn && (
            <CheckboxField name="promoConsent" dense defaultChecked={prefill("promoConsent") === "on"} help={promoShared ? `${t("promo.help")} ${t("promo.shared")}` : t("promo.help")} helpTestId="promo-consent-help" optional={t("optionalSuffix")}>
              <CampaignIcon aria-hidden data-testid="promo-consent-glyph" />
              {t("promo.label", { club: CLUB_NAME })}
            </CheckboxField>
          )}
          </Stack>

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
            id={fieldId("preferredLocale")}
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
            <Box id={fieldId("captcha")} sx={BOT_CHECK_SLOT_SX}>
              {/* The one form whose send button holds a press for the check (§518). */}
              <BotCheck siteKey={siteKey} locale={locale} attempt={now.toISOString()} notice heldPress />
              {captchaFailed && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }} {...{ [BOT_CHECK_ERROR_ATTRIBUTE]: "true" }}>
                  {t("errors.captcha")}
                </Typography>
              )}
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
          {preview ? (
            /*
              The editor's preview (§579, amended by §586): the send button where it stands, with its
              runner and its words, disabled and marked «previzualizare» as the preview's door is —
              a preview sends nothing.
            */
            <Button variant="contained" size="large" fullWidth disabled data-testid="registration-submit-preview" sx={WITH_GLYPH_SX}>
              <DirectionsRunIcon aria-hidden="true" sx={glyphSx("large")} />
              {t("submit")} · {preview.word}
            </Button>
          ) : resting ? (
            <Button variant="contained" size="large" fullWidth disabled data-testid="registration-submit-resting" sx={WITH_GLYPH_SX}>
              <DirectionsRunIcon aria-hidden="true" sx={glyphSx("large")} />
              {t("submit")}
            </Button>
          ) : (
          <SubmitButton
            label={t("submit")}
            pendingLabel={t("submitting")}
            // The club's runner (§318; the owner: "butoanele de trimitere înscriere și contact
            // trebuie să aibă și iconița cu un alergător") — standing at rest, running while
            // the form is in flight. Decoration: the label is the button's name.
            runner
            incompleteHint={t("incompleteHint")}
            /*
              Every required field still empty, listed above the button and going to it
              (§422) — named by the same short names the refusal summary at the top uses.
            */
            missingTitle={t("missingTitle")}
            missingNames={{
              ...Object.fromEntries(REGISTRATION_FORM_FIELDS.map((name) => [name, t(`fieldNames.${name}`)])),
              // Not only what is missing but what to do about it: the box does not tick on a
              // press, so "Condițiile concursului" alone sent people to press it (§422).
              // Only when the panel is actually the read-and-tick one — an event with no
              // rules of its own shows a plain box linking to its page, where the field's
              // own name is the right thing to list (review finding 1).
              ...(hasRules ? { rulesAcknowledged: t("rules.missing") } : {}),
            }}
            /*
              Only when a widget is actually on the page (§285). With no keys, or with the
              club's switch off, there is no token to wait for and waiting would be a button
              dimmed for a check that is not running.
            */
            awaitsBotCheck={Boolean(siteKey)}
            botCheckHint={t("botCheckWait")}
            botCheckTickHint={t("botCheckTick")}
            botCheckExpiredHint={t("botCheckExpired")}
            botCheckValveHint={t("botCheckValve")}
            slowHint={t("submitSlow")}
            size="large"
            fullWidth
          />
          )}
          {/* Under the send button, while the club's emails are late (§NNN): one line, before the press. */}
          {!preview && !resting && (await emailDelayNotice({ variant: "short" }))}
        </Stack>
        </Box>
      </form>
    </>
  );
}
