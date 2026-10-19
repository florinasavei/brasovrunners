import ChecklistIcon from "@mui/icons-material/Checklist";
import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { submitVolunteerAction } from "@/app/[locale]/events/[slug]/volunteers/actions";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import PublicFlash from "@/shared/feedback/PublicFlash";
import { BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import SexField from "@/modules/registrations/ui/SexField";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import CheckboxField from "@/shared/ui/CheckboxField";
import { FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import LegalLink from "@/shared/ui/LegalLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CLUB_NAME } from "@/theme/brand";
import { ageOn, yearsPhrase } from "@/modules/registrations/domain/age";
import { cachedMemberDefinition } from "@/modules/public-cache/reads";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import Hint from "@/shared/ui/Hint";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";
import {
  earliestVolunteerBirthDate,
  groupRolesByCategory,
  groupsNeedHeadings,
  latestVolunteerBirthDate,
  VOLUNTEER_ADULT_AGE,
  VOLUNTEER_CITY_MAX,
  VOLUNTEER_GUARDIAN_NAME_MAX,
  VOLUNTEER_MESSAGE_MAX,
  VOLUNTEER_MINIMUM_AGE,
  VOLUNTEER_NAME_MAX,
} from "../domain/volunteer";
import GuardianFields from "./GuardianFields";
import VolunteerCategoryCard from "./VolunteerCategoryCard";
import VolunteerContactLine, { hasVolunteerContact } from "./VolunteerContactLine";
import VolunteerDone, { type VolunteerSent } from "./VolunteerDone";
import VolunteerSteps from "./VolunteerSteps";
import VolunteerRoleChip, { RoleChipRow } from "./VolunteerRoleChip";
import type { PublicVolunteerCategory, PublicVolunteerRole } from "../volunteers";
import { VOLUNTEER_BOX_ID, type VolunteerBox as BoxName, type VolunteerOutcome, type VolunteerTyped } from "./volunteer-box";

/**
 * «Vreau să fiu voluntar» — the form of the volunteers' own page (§754; the owner, 2026-10-13: «I want to register
 * volunteers for a race»; since §768, 2026-10-14: «formularul trebuie să fie pagină separată, nu embedded în pagina
 * evenimentului», so it lives at `/evenimente/<slug>/voluntari`, not in a fold of the event's page): one plain form —
 * «Ce ești dispus(ă) să faci», one chip per role that still needs people, its description behind a «?» and, when the club
 * ticked «Arată public câți voluntari mai sunt necesari», how many it still needs, as many ticked as the person would do (§761; the owner, 2026-10-14: «poate bifa mai multe atribuțiuni din ce e
 * dispus să facă»), the name, the address, the telephone number, an optional message, the consent tick that names the
 * privacy notice, and — since §758 — the tick that accepts the volunteer agreement in force. The organizers then give
 * the person one role. The page owns the title and the event's date and place; this is the form and the answers to it.
 *
 * A Server Component around a Server Action, like the «Anunță-mă» box: it works with scripts off (native checkboxes; the
 * only islands are the telephone box, the guardian's block and the anti-bot widget, each with a no-script fallback of
 * its own), the honeypot and the rendering time ride along as hidden fields, Turnstile shows when the club switched it
 * on, and the answer comes back as a sentence after a redirect to the same page — the same one for a new person and for
 * a repeat (BR-REQ-031-01 criterion 3) — with the house's flash toast beside it (§427).
 *
 * **Steps, thank-you and width (§800; the owner, 2026-10-16: «trebuie să îi spunem voluntarului care sunt pașii și că urmează să îl
 * aprobăm», then «e prea îngust tot formularul»).** Under the intro stands «Cum funcționează voluntariatul» (`VolunteerSteps`, open at once: the page is the
 * form itself, as the registration form's steps are open; the fold is for a page that is not the form); after a send the box is the thank-you with «Ce urmează» (`VolunteerDone`); and the form spans the
 * page, which is the register page's width, its boxes in two columns from `md` up as the registration form's.
 *
 * The page draws this only while the offer's conditions hold (`readVolunteerOffer`, `volunteerOfferClosedFor`); the
 * action asks again.
 *
 * What the person says about themselves (§765; the owner, 2026-10-14): while the notice in force names it (`profile`),
 * the form asks «Data nașterii» (§773, instead of «Vârsta»: the registration form's own `BirthDateField`, the age on the
 * event's day at least 14 since §768 — the tick «Am cel puțin 18 ani» is gone, the date answers it), «Sex» (the registration form's own `SexField`, its words), «Orașul» (its city
 * box's words), the optional ticks «Am mai fost voluntar în trecut la alte curse» and «Fac parte din grupul {club}» (the
 * club's name from `CLUB_NAME`, as the registration form's member tick draws it — the person's claim, checked against
 * nothing) and, only while the event gives T-shirts (`shirts`), «Mărimea tricoului» — the kit's sizes. While it does not,
 * the form is §758's, with its tick, and takes adults only. Each role's description is its document, behind the «?» on its chip
 * (`RoleDescription`).
 *
 * **Under eighteen (§768).** While the notice in force names `{{volunteerMinors}}` and the agreement `{{volunteerGuardian}}`
 * (`minors`), a person of fourteen to seventeen also gives their parent's or guardian's name and address and ticks
 * «Părintele sau tutorele meu știe și e de acord»: the block is `GuardianFields`, always drawn without scripts and shown
 * by the age typed with them. While it is not (`minors` false), a typed age under eighteen is refused with the sentence
 * that says the club cannot take minors yet.
 */
export default async function VolunteerBox({
  locale,
  slug,
  eventTitle,
  whenInSentence,
  sent,
  roles,
  categories = [],
  shirts,
  showCounts,
  eventDay,
  profile,
  minors,
  outcome,
  refused,
  typed,
  renderedAt,
  attempt,
  lock,
}: {
  locale: Locale;
  slug: string;
  /** The event's title and its start in its own zone and the page's language, written to stand inside a sentence — lower-case weekday, «la» before the hour (§452); null when held back (§533): the thank-you's lead names them (§800). */
  eventTitle: string;
  whenInSentence: string | null;
  /** What the send kept for the thank-you (§800): the first name and the address typed; null when the browser has none. */
  sent: VolunteerSent | null;
  /** Only the roles that still need people, in the club's order. */
  roles: readonly PublicVolunteerRole[];
  /**
   * The event's categories (§774), in the club's order: the roles are listed under their headings, a category with no open role
   * is not drawn, and the roles under none follow under «Alte activități» — or are simply listed when the event has no category.
   */
  categories?: readonly PublicVolunteerCategory[];
  /** «Oferim tricouri voluntarilor» is on for this event (§765): the form asks «Mărimea tricoului». */
  shirts: boolean;
  /**
   * «Arată public câți voluntari mai sunt necesari» is on for this event (§773): each role's chip says how many people it still needs. Off, it says
   * nothing of the kind (a role shown has places by construction, §761; §780 amended) — the one flag every public number about volunteers asks (`VolunteerOffer.showCounts`).
   */
  showCounts: boolean;
  /** The day the date of birth is counted on, `YYYY-MM-DD` (`volunteerEventDay`, §773): the gun's, else the event's. */
  eventDay: string;
  /** The notice in force names what a volunteer says about themselves (§765): the form asks it — else §758's tick «Am cel puțin 18 ani». */
  profile: boolean;
  /** The club may take a person under eighteen (§768): the notice and the agreement in force both describe minors — the form draws the guardian's block. */
  minors: boolean;
  outcome: VolunteerOutcome | null;
  /** The boxes a refusal named (`?vfields=`). */
  refused: readonly BoxName[];
  /** What was typed before a refusal, from the sealed draft (§142). */
  typed: VolunteerTyped;
  /** When this form was rendered — or, on a corrected one, when the one it corrects was (§146's `since`). */
  renderedAt: Date;
  /** This render's own time: Turnstile resets on it, so a refusal never posts the spent token again (§185). */
  attempt: string;
  /**
   * Who may offer (§NNN): the form of a signed-in member (`member`: the account's name, its address locked, «Fac parte din grupul» ticked
   * and locked) or of an emailed invitation (`invite`: the invited address locked, and the link's secret posted back so the server can
   * spend it). Absent for «Oricine». The server asserts both again — a locked box is a courtesy, never the permission.
   */
  lock?: { kind: "member"; email: string; name: string } | { kind: "invite"; email: string; secret: string };
}) {
  const t = await getTranslations("Event");
  const tForm = await getTranslations("Registration");
  const siteKey = turnstileSiteKey();
  const invalid = new Set<BoxName>(refused);
  const roleName = (role: PublicVolunteerRole) => (locale === "en" ? role.nameEn : role.nameRo);
  // The roles under their categories (§774): only the headings that have a role still needing people; the heading words are the club's.
  const groups = groupRolesByCategory(categories, roles, { withRoles: true });
  const headed = groupsNeedHeadings(groups);
  // Some category drawn has a contact person (§774): the steps and the thank-you point to it («scrisă la categoria ta»).
  const hasContact = headed && groups.some((group) => group.category !== null && hasVolunteerContact(group.category.contact));
  const roleDoc = (role: PublicVolunteerRole) => (locale === "en" ? role.descriptionEnJson : role.descriptionRoJson);
  const roleWords = (role: PublicVolunteerRole) => (locale === "en" ? role.descriptionEn : role.descriptionRo);
  // «mai sunt necesare 10 persoane» only while the club ticked «Arată public câți voluntari mai sunt necesari» (§773); otherwise nothing: a role
  // shown has places by construction (§761), so the default «mai sunt locuri» that every chip repeated is gone (§780, amended). A role without
  // a number (§784) has none to say, whatever the setting.
  const needs = (role: PublicVolunteerRole) =>
    showCounts && role.free !== null ? t(`volunteers.needs.${countForm(role.free, locale)}`, { count: role.free }) : null;
  const countrySearchWords = {
    search: tForm("countrySearch.search"),
    noMatch: tForm("countrySearch.noMatch"),
    open: tForm("countrySearch.open"),
    close: tForm("countrySearch.close"),
  };
  const fieldId = (name: string) => `volunteer-${name}`;
  // «14 ani» / «14 years» and «18 ani» / «18 years», the unit in the words every age is said with (§440).
  const age = yearsPhrase(VOLUNTEER_MINIMUM_AGE, locale);
  const adultAge = yearsPhrase(VOLUNTEER_ADULT_AGE, locale);
  // The roles ticked before a refusal (§142), still offered: a role that filled meanwhile is simply not drawn.
  const ticked = new Set((typed.roleIds ?? "").split(",").filter((id) => roles.some((role) => role.id === id)));
  /*
    «Data nașterii» says one of three sentences after a refusal (§773, the age's three of §768): a date that gives under eighteen on the
    event's day, while the club cannot take minors yet, says so; one that gives under the minimum (fourteen), or a day after the event,
    says «cel puțin 14 ani»; anything else — no date, half a date, a century ago — is the registration form's «Scrie data ca zi, lună, an».
  */
  const typedDate = readTypedDate(typed.birthDate ?? "");
  const typedAge = typedDate === "" ? null : ageOn(typedDate, eventDay);
  const birthSentence =
    typedAge === null
      ? "birthDate"
      : typedAge < VOLUNTEER_MINIMUM_AGE
        ? "birthDateMinimum"
        : typedAge < VOLUNTEER_ADULT_AGE && !minors
          ? "birthDateMinors"
          : "birthDate";
  /** A refusal's sentence for one box, in the form's own words (`{age}` is the minimum's phrase, §758's tick says eighteen). */
  const refusal = (name: BoxName) => {
    // «Scrie data ca zi, lună, an» is the registration form's own sentence, the box's live one too (`tForm`): one set of words for one rule.
    if (name === "birthDate" && birthSentence === "birthDate") return tForm("birthDateUnreadable");
    return t(`volunteers.errors.${name === "birthDate" ? birthSentence : name}`, { age: name === "adult" ? adultAge : age });
  };

  return (
    <Box id={VOLUNTEER_BOX_ID} component="section" aria-label={t("volunteers.title")} data-testid="volunteer-box" sx={{ scrollMarginTop: 16 }}>
      <Box>
        {outcome === "done" ? (
          // The same sentence whether the person was new or already on the list (BR-REQ-031-01 criterion 3).
          <>
            {/*
              The thank-you is the registration's «Aproape gata, Ana!» for a volunteer (§800): the green-disc heading, the lead, when the
              receipt email comes and «Ce urmează» (`VolunteerDone`). Where the club takes minors, the parent's consent is on the list for
              everybody — never a hint about who was typed (§768).
            */}
            <VolunteerDone eventTitle={eventTitle} when={whenInSentence} sent={sent} minors={minors} contact={hasContact} />
            {/* The toast the send flashed (§427), here and on no other state of this page. */}
            <PublicFlash accept={["volunteerSent"]} />
          </>
        ) : roles.length === 0 ? (
          // Every role filled while the person typed: thanked, and no form with nothing to choose from.
          <Alert severity="info" role="status" data-testid="volunteer-all-full" sx={{ mt: 1 }}>
            {t("volunteers.allFull")}
          </Alert>
        ) : (
          <Stack component="form" action={submitVolunteerAction} spacing={2} data-testid="volunteer-form" sx={{ mt: 1 }}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
            <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />
            {/* The emailed invitation's secret (§NNN), posted back as it came: the server finds the invitation by its hash and spends it with the sign-up. */}
            {lock?.kind === "invite" && <input type="hidden" name="invite" value={lock.secret} />}

            {lock && (
              <Alert severity="info" role="note" data-testid="volunteer-lock-note">
                {t(lock.kind === "member" ? "volunteers.lock.leadMember" : "volunteers.lock.leadInvite")}
              </Alert>
            )}

            <Typography variant="body2" color="text.secondary">
              {t("volunteers.intro")}
            </Typography>

            {/*
              «Cum funcționează voluntariatul» (§800; the owner, 2026-10-16: «trebuie să îi spunem voluntarului care sunt pașii și că urmează să
              îl aprobăm»): the four steps, under the intro and above the roles, folded the way the register page draws its own (`RegistrationSteps
              folded`), the summary saying the one fact a visitor wants first — that the organizers choose the role and confirm the person —
              and the third step saying it in full.
            */}
            <VolunteerSteps minors={minors} contact={hasContact} />

            {outcome && (
              <Alert severity={outcome === "full" ? "warning" : "error"} role="alert" data-testid={`volunteer-${outcome}`}>
                {t(`volunteers.${outcome}`)}
                {outcome === "invalid" && refused.length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {refused.map((name) => (
                      <li key={name}>
                        {/* `{age}` is the minimum's phrase (§758); the other sentences take none and ignore it. */}
                        <a href={`#${fieldId(name)}`}>{refusal(name)}</a>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}

            {/*
              «Ce ești dispus(ă) să faci» (§761): one chip per role that still needs people — its name, then, when the club asked, how
              many it still needs, and its description behind a «?» — ticked as many as the person would do. Native checkboxes
              posting one name (`roleIds`) with several values, so it works with scripts off; at least one is the
              service's rule, said at the group after a refused post (and in the summary above, linking here).
            */}
            <Box
              component="fieldset"
              id={fieldId("roleIds")}
              aria-describedby={[`${fieldId("roleIds")}-help`, `${fieldId("roleIds")}-note`, invalid.has("roleIds") ? `${fieldId("roleIds")}-error` : null].filter(Boolean).join(" ")}
              sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}
              data-testid="volunteer-roles"
            >
              <Typography component="legend" sx={{ fontWeight: 600, p: 0 }}>
                <ChecklistIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
                {t("volunteers.choices")}
                <span aria-hidden="true">{" *"}</span>
              </Typography>
              <Typography id={`${fieldId("roleIds")}-help`} variant="body2" color="text.secondary">
                {t("volunteers.choicesHelp")}
              </Typography>
              {invalid.has("roleIds") && (
                <FormHelperText id={`${fieldId("roleIds")}-error`} error data-testid="volunteer-roles-error" sx={{ mx: 0 }}>
                  {t("volunteers.errors.roleIds")}
                </FormHelperText>
              )}
              {/*
                The roles, each category its own card (§780, amending §774; the owner, 2026-10-15: «nu e clară gruparea pe categorii!»): a bordered
                box on the paper surface, calm — a header with the category's glyph, its name as the level-3 heading, «4 roluri», a hairline, the
                contact line (§774) when the club set one, and the roles inside it as chips in a wrap row (`VolunteerRoleChip`: the pill is the
                checkbox's label, a «?» on it opens the role's description), a clear step between two cards, «Alte activități» last with the
                same look (the owner, 2026-10-16: «nu-mi place designul pt asta»). An event with no category shows the chips under no heading.
              */}
              <Stack spacing={3} sx={{ mt: 1.5 }} data-testid="volunteer-role-groups">
                {groups.map((group) => {
                  const chips = (
                    <RoleChipRow>
                      {group.roles.map((role) => (
                        <VolunteerRoleChip
                          key={role.id}
                          id={role.id}
                          name={roleName(role)}
                          needs={needs(role)}
                          ticked={ticked.has(role.id)}
                          doc={roleDoc(role)}
                          words={roleWords(role)}
                          helpLabel={t("volunteers.roleHelp", { name: roleName(role) })}
                        />
                      ))}
                    </RoleChipRow>
                  );
                  if (!headed) return <Box key="all">{chips}</Box>;
                  return (
                    <VolunteerCategoryCard
                      key={group.category?.id ?? "other"}
                      id={group.category?.id ?? "other"}
                      title={group.category ? (locale === "en" ? group.category.nameEn : group.category.nameRo) : t("volunteers.otherCategory")}
                      count={t(`volunteers.roleCount.${countForm(group.roles.length, locale)}`, { count: group.roles.length })}
                      contact={group.category && hasVolunteerContact(group.category.contact) ? <VolunteerContactLine contact={group.category.contact} label={t("volunteers.contactLabel")} /> : undefined}
                    >
                      {chips}
                    </VolunteerCategoryCard>
                  );
                })}
              </Stack>
              {/*
                The kinder note (§773; the owner, 2026-10-14: «Și pusă o notă mai drăguță»), right under the roles' list: the person may be
                asked to cover another responsibility, thanked, and told they will be contacted. A banner (§797; the owner, 2026-10-16: «Asta ar
                trebui să fie într-un banner, să fie mai vizibil»): the house's information notice — the `Alert` of `severity="info"` as
                the register page and the check-your-email screen draw theirs, with its own info glyph — a clear step above and below.
                Static text, not a live message: the Alert's default `role="alert"` is replaced by `role="note"`, so a screen reader reads it
                with the group (the fieldset names its id) and does not announce it on load. (An `undefined` role passed through `slotProps` from
                this Server Component does not survive the hand-over to the client Alert — the browser kept `role="alert"` — hence the string.)
              */}
              <Alert
                id={`${fieldId("roleIds")}-note`}
                severity="info"
                role="note"
                sx={{ mt: 2, mb: 1 }}
                data-testid="volunteer-roles-note"
              >
                {t("volunteers.choicesNote")}
              </Alert>
            </Box>

            {/*
              The boxes in two columns from `md` up, one below — the registration form's own pairing (`registration-form.tsx`, BR-REQ-041-01 is
              phone-first and the phone is unchanged): on the left what a volunteer cannot be reached without — the name, the address and
              the telephone number — beside what they say about themselves. §800 (the owner, 2026-10-16: «e prea îngust tot formularul»): the
              page is the register page's width (`PAGE_WIDTH`) and the form is no longer capped at 560 pixels, so the categories' cards and
              the chips above span the whole column and the boxes below keep half of it each. **Two columns only while there is a right one**
              (`profile`): without it the three boxes take the whole width, never half of it beside nothing. The optional message, the
              consents and the button close the form at full width, after every required box — the registration form's order, on a phone and
              in the tab order.
            */}
            <Box
              data-testid="volunteer-fields"
              sx={profile ? { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 4, rowGap: 2, alignItems: "start" } : undefined}
            >
            <Stack spacing={2} sx={{ minWidth: 0 }}>
            <TextField
              id={fieldId("name")}
              name="name"
              label={t("volunteers.name")}
              required
              fullWidth
              autoComplete="name"
              defaultValue={typed.name ?? (lock?.kind === "member" ? lock.name : undefined)}
              error={invalid.has("name")}
              slotProps={{ htmlInput: { maxLength: VOLUNTEER_NAME_MAX } }}
            />
            <TextField
              id={fieldId("email")}
              name="email"
              type="email"
              label={t("volunteers.email")}
              helperText={lock ? t(lock.kind === "member" ? "volunteers.lock.emailMember" : "volunteers.lock.emailInvite") : t("volunteers.emailHelp")}
              required
              fullWidth
              autoComplete="email"
              defaultValue={lock ? lock.email : typed.email}
              error={invalid.has("email")}
              // A locked address is read-only, not disabled: it is posted with the form (and checked again on the server).
              slotProps={{ htmlInput: { maxLength: 320, ...(lock ? { readOnly: true } : {}) } }}
            />

            {/* The country and the digits (§84): what is kept is one number a phone can dial. */}
            <PhoneField
              invalidLabel={tForm("phoneInvalid")}
              tooShortLabel={tForm("phoneTooShort")}
              validLabel={tForm("phoneValid")}
              name="phone"
              draft={typed.phone !== undefined || typed.phoneCountry !== undefined ? { country: typed.phoneCountry, national: typed.phone } : undefined}
              id={fieldId("phone")}
              label={tForm("phone")}
              countryLabel={tForm("phoneCountry")}
              countryOrder={phoneCountryOrder(locale)}
              countryNames={phoneCountryLabels(locale)}
              searchWords={countrySearchWords}
              required
              autoComplete="tel-national"
              error={invalid.has("phone")}
              helperText={invalid.has("phone") ? tForm("errors.phone") : t("volunteers.phoneHelp")}
            />
            </Stack>

            {/* …and, beside them from `md` up, what the person says about themselves (§765): the right column of the registration form's own pairing. */}
            {profile && (
              <Stack spacing={2} sx={{ minWidth: 0 }} data-testid="volunteer-profile">
                {/*
                  «Data nașterii» and «Sex» (§765, §773; the owner, 2026-10-14: «în loc de vârstă vreau să treacă data nașterii»): the registration
                  form's own date box — `BirthDateField`, typed day first with its mask and, with scripts off, a plain text box the server reads —
                  whose age on the event's day is at least the platform's minimum, so the tick «Am cel puțin 18 ani» is gone; and the
                  registration form's own sex box.
                */}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <BirthDateField
                    id={fieldId("birthDate")}
                    name="birthDate"
                    label={tForm("birthDate")}
                    defaultValue={typed.birthDate ?? ""}
                    required
                    fullWidth
                    autoComplete="bday"
                    error={invalid.has("birthDate")}
                    errorText={refusal("birthDate")}
                    help={minors ? t("volunteers.profile.birthDateHelpMinors", { age }) : t("volunteers.profile.birthDateHelp", { age: adultAge })}
                    min={earliestVolunteerBirthDate(eventDay)}
                    max={latestVolunteerBirthDate(eventDay)}
                    eventDay={eventDay}
                    locale={locale}
                    echoTemplate={tForm("birthDateEcho", { date: "{date}", age: "{age}" })}
                    placeholder={tForm("birthDatePlaceholder")}
                    unreadable={tForm("birthDateUnreadable")}
                    tooYoung={t("volunteers.errors.birthDateMinimum", { age })}
                    picker={{ label: tForm("birthDatePicker") }}
                  />
                  <SexField
                    id={fieldId("sex")}
                    name="sex"
                    label={tForm("sex")}
                    placeholder={tForm("sexChoose")}
                    answers={{ FEMALE: tForm("sexOptions.FEMALE"), MALE: tForm("sexOptions.MALE") }}
                    defaultValue={typed.sex}
                    error={invalid.has("sex")}
                    helperText={invalid.has("sex") ? t("volunteers.errors.sex") : undefined}
                  />
                </Stack>
                {/*
                  The parent or guardian of a person under eighteen (§768): drawn hidden (open when the age typed before a refusal says
                  a minor) with no box `required` and no asterisk — an adult is never shown it, scripts off open it with a
                  `<noscript>` rule — and the island follows the age typed, marking the three boxes required while it shows them;
                  the server refuses a minor's post without them either way (`refuseGuardianBoxes`).
                */}
                {minors && (
                  <GuardianFields
                    birthDateId={fieldId("birthDate")}
                    eventDay={eventDay}
                    minimumAge={VOLUNTEER_MINIMUM_AGE}
                    adultAge={VOLUNTEER_ADULT_AGE}
                    startOpen={typedAge !== null && typedAge >= VOLUNTEER_MINIMUM_AGE && typedAge < VOLUNTEER_ADULT_AGE}
                  >
                    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }} data-testid="volunteer-guardian">
                      <Typography component="legend" sx={{ fontWeight: 600, p: 0 }}>
                        <FamilyRestroomIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
                        {t("volunteers.guardian.title")}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {t("volunteers.guardian.intro")}
                      </Typography>
                      <Stack spacing={2}>
                        <TextField
                          id={fieldId("guardianName")}
                          name="guardianName"
                          label={t("volunteers.guardian.name")}
                          fullWidth
                          autoComplete="off"
                          defaultValue={typed.guardianName}
                          error={invalid.has("guardianName")}
                          helperText={invalid.has("guardianName") ? t("volunteers.errors.guardianName") : undefined}
                          slotProps={{ htmlInput: { maxLength: VOLUNTEER_GUARDIAN_NAME_MAX } }}
                        />
                        <TextField
                          id={fieldId("guardianEmail")}
                          name="guardianEmail"
                          type="email"
                          label={t("volunteers.guardian.email")}
                          fullWidth
                          autoComplete="off"
                          defaultValue={typed.guardianEmail}
                          error={invalid.has("guardianEmail")}
                          helperText={invalid.has("guardianEmail") ? t("volunteers.errors.guardianEmail") : t("volunteers.guardian.emailHelp")}
                          slotProps={{ htmlInput: { maxLength: 320 } }}
                        />
                        <CheckboxField
                          name="guardianAware"
                          id={fieldId("guardianAware")}
                          error={invalid.has("guardianAware") ? t("volunteers.errors.guardianAware") : undefined}
                          requiredMessage={t("volunteers.errors.guardianAware")}
                        >
                          {t("volunteers.guardian.aware")}
                        </CheckboxField>
                      </Stack>
                    </Box>
                  </GuardianFields>
                )}
                <TextField
                  id={fieldId("city")}
                  name="city"
                  label={t("volunteers.profile.city")}
                  required
                  fullWidth
                  autoComplete="address-level2"
                  defaultValue={typed.city}
                  error={invalid.has("city")}
                  helperText={invalid.has("city") ? t("volunteers.errors.city") : undefined}
                  slotProps={{ htmlInput: { maxLength: VOLUNTEER_CITY_MAX } }}
                />
                {/* «Mărimea tricoului» (§765), only while the event gives T-shirts — the kit's own sizes, «Fără tricou» first. */}
                {shirts && (
                  <TextField
                    id={fieldId("shirtSize")}
                    name="shirtSize"
                    label={t("volunteers.profile.shirt")}
                    select
                    fullWidth
                    defaultValue={typed.shirtSize ?? ""}
                    error={invalid.has("shirtSize")}
                    helperText={invalid.has("shirtSize") ? t("volunteers.errors.shirtSize") : t("volunteers.profile.shirtHelp")}
                    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                    data-testid="volunteer-shirt"
                  >
                    <option value="">{tForm("tshirtSizes.NONE")}</option>
                    {SHIRT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </TextField>
                )}
                {/* Two optional ticks (§765): unticked is «nu», not an unanswered question; the club's group is the person's own claim, like the registration form's. */}
                <Box>
                  <CheckboxField name="volunteeredBefore" id={fieldId("volunteeredBefore")} defaultChecked={typed.volunteeredBefore === "on"}>
                    {t("volunteers.profile.before")}
                  </CheckboxField>
                  {/* A signed-in member (§NNN): the club's own account says it. The box is shown ticked and locked; the value rides in a hidden field, and the server sets it from the account whatever is posted. */}
                  {lock?.kind === "member" && <input type="hidden" name="clubMember" value="on" />}
                  <CheckboxField name="clubMember" id={fieldId("clubMember")} defaultChecked={lock?.kind === "member" || typed.clubMember === "on"} disabled={lock?.kind === "member"}>
                    {t("volunteers.profile.club", { club: CLUB_NAME })}
                    {/* The «?» of the registration form's own member tick, with the same words (§789): the club's sentence from «Pagini» → «Membri», else the platform's. */}
                    <Hint text={(await cachedMemberDefinition(locale)) ?? tForm("clubMemberDefinition")} />
                  </CheckboxField>
                </Box>
              </Stack>
            )}
            </Box>

            {/* The optional message, after the required boxes and at the form's full width. */}
            <TextField
              id={fieldId("message")}
              name="message"
              label={t("volunteers.message")}
              helperText={t("volunteers.messageHelp", { max: VOLUNTEER_MESSAGE_MAX })}
              fullWidth
              multiline
              minRows={2}
              defaultValue={typed.message}
              error={invalid.has("message")}
              slotProps={{ htmlInput: { maxLength: VOLUNTEER_MESSAGE_MAX } }}
            />

            {siteKey && (
              <Box sx={BOT_CHECK_SLOT_SX}>
                <BotCheck siteKey={siteKey} locale={locale} attempt={attempt} notice />
              </Box>
            )}

            {/*
              The consent itself: one tick, the person's own act, naming the notice it rests on — the house's
              CheckboxField (the refusal said at the box, §616) and LegalLink (the notice in a new tab, so this
              form, which keeps nothing until it is sent, is still there when the reader comes back, §197).
            */}
            <Box data-testid="volunteer-consent">
              <CheckboxField
                name="consent"
                id={fieldId("consent")}
                required
                error={invalid.has("consent") ? t("volunteers.errors.consent") : undefined}
                requiredMessage={t("volunteers.errors.consent")}
              >
                {t("volunteers.consent")}{" "}
                <LegalLink href="/legal/privacy" newTabLabel={tForm("opensInNewTab")}>
                  {t("volunteers.privacyLinkLabel")}
                </LegalLink>
                .
              </CheckboxField>
            </Box>

            {/*
              The volunteer agreement (§758): the person's acceptance of the text in force, linked in a new tab like the
              notice — its blanks (the name, the role, the event) are filled in the copy the email carries — and the
              platform's minimum age, fourteen, with a parent or guardian under eighteen (`VOLUNTEER_MINIMUM_AGE`,
              `VOLUNTEER_ADULT_AGE`). Both required; the service refuses either missing.
            */}
            <Box data-testid="volunteer-agreement">
              <CheckboxField
                name="agreement"
                id={fieldId("agreement")}
                required
                error={invalid.has("agreement") ? t("volunteers.errors.agreement") : undefined}
                requiredMessage={t("volunteers.errors.agreement")}
              >
                {t("volunteers.agreement")}{" "}
                <LegalLink href="/legal/volunteer-agreement" newTabLabel={tForm("opensInNewTab")}>
                  {t("volunteers.agreementLinkLabel")}
                </LegalLink>
                .
              </CheckboxField>
            </Box>
            {/* §758's tick, only while the notice does not name what a volunteer says about themselves: with the age asked, the age answers it (§765). */}
            {!profile && (
              <Box data-testid="volunteer-adult">
                <CheckboxField
                  name="adult"
                  id={fieldId("adult")}
                  required
                  error={invalid.has("adult") ? t("volunteers.errors.adult", { age: adultAge }) : undefined}
                  requiredMessage={t("volunteers.errors.adult", { age: adultAge })}
                >
                  {t("volunteers.adult", { age: adultAge })}
                </CheckboxField>
              </Box>
            )}

            <SubmitButton label={t("volunteers.submit")} pendingLabel={t("volunteers.submitting")} size="large">
              <VolunteerActivismIcon />
            </SubmitButton>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
