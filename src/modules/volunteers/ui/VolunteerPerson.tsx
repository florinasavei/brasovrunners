import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  assignVolunteerAction,
  deleteVolunteerAction,
  editVolunteerAction,
  recordPaperVolunteerAgreementAction,
  recordPaperVolunteerGuardianAction,
  requestVolunteerAgreementAction,
  requestVolunteerGuardianAction,
  setVolunteerStateAction,
  unassignVolunteerAction,
} from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { shirtSizeShown, SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { SEX_CHOICES } from "@/modules/registrations/domain/sex";
import { formatPhone } from "@/modules/registrations/phone";
import { shownTypedDate } from "@/shared/forms/pickers/wall-values";
import { CLUB_NAME } from "@/theme/brand";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { FACTS_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";
import {
  VOLUNTEER_CITY_MAX,
  VOLUNTEER_GUARDIAN_NAME_MAX,
  VOLUNTEER_MINIMUM_AGE,
  VOLUNTEER_NAME_MAX,
  VOLUNTEER_NOTE_MAX,
  agreementRolesStamp,
  agreementStandingOf,
  agreementStillNamesRole,
  earliestVolunteerBirthDate,
  groupRolesByCategory,
  groupsNeedHeadings,
  guardianSharesAddress,
  guardianStandingOf,
  isVolunteerMinor,
  latestVolunteerBirthDate,
  type RoleGroup,
  type RoleStanding,
  roleLabel,
  rolesWithCategoryWords,
  type VolunteerAgreementStanding,
  type VolunteerState,
} from "../domain/volunteer";
import type { VolunteerCategory, VolunteerItem, VolunteerRole } from "../volunteers";
import VolunteerBirthDateField from "./VolunteerBirthDateField";

/**
 * One volunteer, in full (§754, §761, §837, §839): the name with its chips, the contact, what the person said about themselves,
 * the roles given and offered, the agreement and the guardian's, the verbs and the «Modifică» form. Drawn by the event editor's
 * «Voluntari» card for each person in a role's group, and by the person's own page under «Voluntari» (§839) — one component, so the
 * two never disagree about a person; every form posts to the same Server Actions, which ask the service for the role again.
 *
 * `context` is what every person of one event shares: the roles with their categories, how each stands, the event's switches,
 * the texts in force and the clock. `returnTo` is where a one-button verb comes back to (§839): the person's own page, when it is
 * drawn there, else the card.
 */
export type VolunteerPersonContext = {
  locale: Locale;
  eventId: string;
  roles: readonly VolunteerRole[];
  categories: readonly VolunteerCategory[];
  standings: readonly RoleStanding[];
  /** «Oferim tricouri voluntarilor», as saved (§765). */
  volunteersShirts: boolean;
  /** The notice in force names what a volunteer says about themselves (§765). */
  profileDescribed: boolean;
  /** The club may take a volunteer under eighteen (§768). */
  minorsOpen: boolean;
  /** The notice in force describes the public list (§821). */
  listDescribed: boolean;
  /** The day the entry's date of birth is counted on (§773). */
  eventDay: string;
  agreementInForce: boolean;
  agreementNoticeDescribes: boolean;
  agreementDocumentIds: Partial<Record<Locale, string>>;
  agreementEvent: Partial<Record<Locale, { eventDate: string; eventLocation: string }>>;
  now: Date;
  /** The admin path a verb returns to, when not the card: the person's own page (§839). */
  returnTo?: string;
};

/** The pencil at the end of a person's line: the edit verb's glyph, by name (§318). */
const PencilIcon = ACTION_ICONS.edit;

export const STATE_CHIP: Record<VolunteerState, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  REGISTERED: { glyph: "open", color: "warning" },
  CONFIRMED: { glyph: "done", color: "success" },
  CANCELLED: { glyph: "cancelled", color: "default" },
};

export const AGREEMENT_CHIP: Record<VolunteerAgreementStanding, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  accepted: { glyph: "done", color: "success" },
  linkSent: { glyph: "link", color: "default" },
  notAccepted: { glyph: "open", color: "warning" },
};

export const GUARDIAN_CHIP: Record<"accepted" | "missing", { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  accepted: { glyph: "done", color: "success" },
  missing: { glyph: "open", color: "warning" },
};

export function shortText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** The boxes of the person's form, named for a refusal's summary (`ActionForm`'s `messages`). */
export async function volunteerPersonBoxes(t: Awaited<ReturnType<typeof getTranslations<"Admin">>>) {
  return refusalMessages({
    roleIds: t("volunteers.person.choices"),
    assignedRoleIds: t("volunteers.person.assigned"),
    name: t("volunteers.person.name"),
    email: t("volunteers.person.email"),
    phone: t("volunteers.person.phone"),
    note: t("volunteers.person.note"),
    birthDate: t("volunteers.person.birthDate"),
    sex: t("volunteers.person.sex"),
    city: t("volunteers.person.city"),
    shirtSize: t("volunteers.person.shirt"),
    guardianName: t("volunteers.person.guardianName"),
    guardianEmail: t("volunteers.person.guardianEmail"),
  });
}

/** The hidden fields every form of a person posts: the language, the event and, from the person's page, where to come back to (§839). */
export function volunteerHiddenFields(context: Pick<VolunteerPersonContext, "locale" | "eventId" | "returnTo">) {
  return (
    <>
      <input type="hidden" name="uiLocale" value={context.locale} />
      <input type="hidden" name="eventId" value={context.eventId} />
      {context.returnTo && <input type="hidden" name="returnTo" value={context.returnTo} />}
    </>
  );
}

/** What every person's blocks share, derived once from the context. */
async function sharedOf(context: VolunteerPersonContext) {
  const { locale, categories, roles, standings } = context;
  const t = await getTranslations("Admin");
  // The registration form's own words for its date-of-birth box (§773): the echo, the placeholder, «Scrie data ca zi, lună, an».
  const tReg = await getTranslations("Registration");
  const words = await confirmWords();
  const standingOf = new Map(standings.map((standing) => [standing.roleId, standing]));
  // A role named alone says «Direcționare (Traseu)» (§774): the chips, the ticks, the agreement's roles.
  const labelled = rolesWithCategoryWords(categories, roles);
  const roleById = new Map(labelled.map((role) => [role.id, role]));
  const labelOf = (role: VolunteerRole) => roleLabel(roleById.get(role.id) ?? role, locale);
  /** A person's roles as the agreement names them (§761): the ones given (§837) and the ones chosen, each in the club's order. */
  const rolesOf = (person: VolunteerItem) => ({
    assigned: person.roleIds.flatMap((id) => roleById.get(id) ?? []),
    chosen: person.choiceIds.flatMap((id) => roleById.get(id) ?? []),
  });
  /*
    The roles under their categories (§774, §840; the owner, 2026-10-21: «on the volunteer individual page, the roles should be grouped
    by category, as in any other page»): the boxes of «Modifică» and the select of «Alt rol» list them under the category's heading,
    each role by its own name — the heading says the category, as the public form and the «Roluri» card do. An event with no
    category has one group and no heading, and a role named alone keeps saying «Direcționare (Traseu)».
  */
  const roleGroups = groupRolesByCategory(categories, roles, { withRoles: true });
  const headed = groupsNeedHeadings(roleGroups);
  const groupName = (group: RoleGroup<VolunteerCategory, VolunteerRole>) =>
    group.category ? (locale === "en" ? group.category.nameEn : group.category.nameRo) : t("volunteers.otherCategory");
  const nameOf = (role: VolunteerRole) => (locale === "en" ? role.nameEn : role.nameRo);
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const hidden = volunteerHiddenFields(context);
  return { t, tReg, words, standingOf, labelled, labelOf, roleGroups, headed, groupName, nameOf, rolesOf, day, hidden };
}

/**
 * The boxes of «Adaugă un voluntar» and every person's «Modifică»: what the person would do (§761) — one box per
 * role, the house's `CheckboxField` posting `roleIds` once per tick — and the roles given (§837), the same boxes
 * posting `assignedRoleIds`: any of the event's, one or several, or none yet. The service holds the rule: at least
 * one ticked, or a role given.
 */
export async function VolunteerPersonFields({ person, context }: { person: VolunteerItem | null; context: VolunteerPersonContext }) {
  const { locale, volunteersShirts, profileDescribed, minorsOpen, listDescribed, eventDay } = context;
  const { t, tReg, labelOf, roleGroups, headed, groupName, nameOf } = await sharedOf(context);
  /*
    The address and the telephone number (§NNN; the owner, 2026-10-28: «as vrea sa pot adaug si fara adresa de mail si telefon, doar sa
    fie asa pe lista»): each optional for a row the club types — the boxes say so, and what an empty address means — and required, as the
    public form asked them, on a row the person typed there. The service holds the same rule (`volunteerStaffInputSchemaFor`).
  */
  const contactRequired = person?.source === "PUBLIC";
  /** One group's boxes under its category's heading (§840); without categories, the boxes alone, each role named as before. */
  const roleBoxes = (name: "roleIds" | "assignedRoleIds", ticked: (role: VolunteerRole) => boolean) =>
    roleGroups.map((group) => {
      const boxes = group.roles.map((role) => (
        <CheckboxField key={role.id} name={name} value={role.id} defaultChecked={ticked(role)}>
          {headed ? nameOf(role) : labelOf(role)}
        </CheckboxField>
      ));
      if (!headed) return <Box key="all">{boxes}</Box>;
      return (
        <Box key={group.category?.id ?? "other"} role="group" aria-label={groupName(group)} sx={{ mt: 1 }} data-testid="volunteer-role-category">
          <Typography variant="caption" sx={{ display: "block", fontWeight: 600, color: "text.secondary" }}>
            {groupName(group)}
          </Typography>
          {boxes}
        </Box>
      );
    });
  return (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }} data-testid="volunteer-choices-field">
        <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0 }}>
          {t("volunteers.person.choices")}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("volunteers.person.choicesHelp")}
        </Typography>
        {roleBoxes("roleIds", (role) => person?.choiceIds.includes(role.id) ?? false)}
      </Box>
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }} data-testid="volunteer-assigned-field">
        <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0 }}>
          {t("volunteers.person.assigned")}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("volunteers.person.assignedHelp")}
        </Typography>
        {roleBoxes("assignedRoleIds", (role) => person?.roleIds.includes(role.id) ?? false)}
      </Box>
      <RecallField
        name="name"
        label={t("volunteers.person.name")}
        defaultValue={person?.name ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_NAME_MAX } }}
      />
      <RecallField
        name="email"
        type="email"
        label={t("volunteers.person.email")}
        helperText={contactRequired ? undefined : t("volunteers.person.emailHelp")}
        defaultValue={person?.email ?? ""}
        required={contactRequired}
        size="small"
        slotProps={{ htmlInput: { maxLength: 320 } }}
      />
      <RecallField
        name="phone"
        type="tel"
        label={t("volunteers.person.phone")}
        helperText={contactRequired ? t("registrations.answers.phoneHelp") : t("volunteers.person.phoneHelp")}
        defaultValue={person?.phone ?? ""}
        required={contactRequired}
        size="small"
        slotProps={{ htmlInput: { maxLength: 40, inputMode: "tel" } }}
      />
      {/* What the person told the organizers (§765): every box optional here, drawn only while the privacy notice in force names them
          (`profileDescribed`) — the service refuses them otherwise, so a hidden box is not the only gate. */}
      {profileDescribed && (
        <>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          {/* «Data nașterii» (§773, instead of «Vârsta»): the registration form's own box, its mask and its echo, counted on the event's day. A row from
              before the date has an age and no date: the box is empty, and the line says the age it keeps until a date is typed. */}
          <VolunteerBirthDateField
            label={t("volunteers.person.birthDate")}
            defaultValue={person?.dateOfBirth ?? ""}
            help={
              person && person.age !== null && person.dateOfBirth === null
                ? t("volunteers.person.birthDateKept", { age: yearsPhrase(person.age, locale) })
                : t(minorsOpen ? "volunteers.person.birthDateHelpMinors" : "volunteers.person.birthDateHelp", { age: yearsPhrase(VOLUNTEER_MINIMUM_AGE, locale) })
            }
            min={earliestVolunteerBirthDate(eventDay)}
            max={latestVolunteerBirthDate(eventDay)}
            eventDay={eventDay}
            locale={locale}
            words={{
              echoTemplate: tReg("birthDateEcho", { date: "{date}", age: "{age}" }),
              placeholder: tReg("birthDatePlaceholder"),
              unreadable: tReg("birthDateUnreadable"),
              pickerLabel: tReg("birthDatePicker"),
              tooYoung: t("volunteers.person.birthDateTooYoung", { age: yearsPhrase(VOLUNTEER_MINIMUM_AGE, locale) }),
            }}
          />
          <RecallField
            name="sex"
            select
            label={t("volunteers.person.sex")}
            defaultValue={person?.sex ?? ""}
            size="small"
            fullWidth
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            <option value="">{t("volunteers.person.sexNone")}</option>
            {SEX_CHOICES.map((sex) => (
              <option key={sex} value={sex}>
                {t(`registrations.answers.sex.${sex}`)}
              </option>
            ))}
          </RecallField>
        </Stack>
        {/* The parent or guardian of a person under eighteen (§768): a named card, open while the person is one. The boxes are drawn while the club may take
            minors (`minorsOpen`) or the person already is one; the service holds the rule either way (`volunteerMinorsOpen`, `refuseGuardianBoxes`). */}
        {minorsOpen || isVolunteerMinor(person?.age) ? (
          <Panel
            glyph="volunteers"
            collapsible
            level={3}
            title={t("volunteers.person.guardianTitle")}
            aside={person?.guardianName ?? undefined}
            openWhen={{ attention: isVolunteerMinor(person?.age) }}
            data-testid="volunteer-guardian-field"
          >
            <Stack spacing={1.5} sx={{ pb: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                {t("volunteers.person.guardianHelp")}
              </Typography>
              <RecallField
                name="guardianName"
                label={t("volunteers.person.guardianName")}
                defaultValue={person?.guardianName ?? ""}
                size="small"
                slotProps={{ htmlInput: { maxLength: VOLUNTEER_GUARDIAN_NAME_MAX, autoComplete: "off" } }}
              />
              <RecallField
                name="guardianEmail"
                type="email"
                label={t("volunteers.person.guardianEmail")}
                defaultValue={person?.guardianEmail ?? ""}
                size="small"
                slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off" } }}
              />
            </Stack>
          </Panel>
        ) : (
          <Typography variant="body2" color="text.secondary" data-testid="volunteer-minors-off-field">
            {t("volunteers.offer.minorsOff")}
          </Typography>
        )}
        <RecallField
          name="city"
          label={t("volunteers.person.city")}
          defaultValue={person?.city ?? ""}
          size="small"
          slotProps={{ htmlInput: { maxLength: VOLUNTEER_CITY_MAX, autoComplete: "off" } }}
        />
        {/* The T-shirt's size, only while the event gives T-shirts: «Fără tricou» is none. A size left from before stays, shown nowhere. */}
        {volunteersShirts && (
          <RecallField
            name="shirtSize"
            select
            label={t("volunteers.person.shirt")}
            defaultValue={shirtSizeShown(true, person?.shirtSize) ?? ""}
            size="small"
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            <option value="">{t("volunteers.person.shirtNone")}</option>
            {SHIRT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </RecallField>
        )}
        <Box>
          <CheckboxField name="volunteeredBefore" defaultChecked={person?.volunteeredBefore ?? false}>
            {t("volunteers.person.before")}
          </CheckboxField>
          <CheckboxField name="clubMember" defaultChecked={person?.clubMember ?? false}>
            {t("volunteers.person.club", { club: CLUB_NAME })}
          </CheckboxField>
        </Box>
        </>
      )}
      {/* «Vrea să apară pe lista publică a voluntarilor» (§821): the organizers' record of the person's own tick — drawn while the notice describes the list, and for a
          person already ticked (so it can be cleared). The service refuses a new tick without the notice, and records who did it in the audit trail. */}
      {(listDescribed || person?.listOptIn) && (
        <Box data-testid="volunteer-list-optin-field">
          <CheckboxField name="listOptIn" defaultChecked={person?.listOptIn ?? false} help={listDescribed ? t("volunteers.person.listOptInHelp") : t("volunteers.person.listOptInOff")}>
            {t("volunteers.person.listOptIn")}
          </CheckboxField>
        </Box>
      )}
      <RecallField
        name="note"
        label={t("volunteers.person.note")}
        helperText={t("volunteers.person.noteHelp", { max: String(VOLUNTEER_NOTE_MAX) })}
        defaultValue={person?.note ?? ""}
        size="small"
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_NOTE_MAX } }}
      />
    </Stack>
  );
}

/**
 * One person's full block: `as` is where it is drawn — a row fold in the card's groups (`li`: the name, the state and the roles
 * given on its line, the block inside), or the block open on the person's own page (`section`), whose header says the name and the state.
 */
export default async function VolunteerPerson({ person, context, as = "li" }: { person: VolunteerItem; context: VolunteerPersonContext; as?: "li" | "section" }) {
  const { locale, eventId, volunteersShirts, minorsOpen, agreementInForce, agreementNoticeDescribes, agreementDocumentIds, agreementEvent, now } = context;
  const { t, words, standingOf, labelled, labelOf, roleGroups, headed, groupName, nameOf, rolesOf, day, hidden } = await sharedOf(context);
  const personBoxes = await volunteerPersonBoxes(t);
  const personFields = (one: VolunteerItem | null) => <VolunteerPersonFields person={one} context={context} />;

  /** One button that posts the state it wants (`setVolunteerStateAction`), never a toggle. */
  const stateButton = (person: VolunteerItem, state: VolunteerState, label: string, icon: "confirm" | "cancel" | "undo") => (
    <Box component="form" action={setVolunteerStateAction} data-testid={`volunteer-${state.toLowerCase()}-form`}>
      {hidden}
      <input type="hidden" name="volunteerId" value={person.id} />
      <input type="hidden" name="state" value={state} />
      <GlyphSubmitButton icon={icon} label={label} pendingLabel={label} ariaLabel={`${label}: ${shortText(person.name)}`} variant="outlined" />
    </Box>
  );

  /**
   * The volunteer agreement for one person (§758): when it was accepted, how and which version — and the role it
   * names when the person has moved since; or, not accepted yet, the two ways to get it — the link by email, or
   * the PDF to sign at the desk and «Semnat pe hârtie». Nothing to do for a cancelled person; nothing to send while
   * no agreement is in force (the card says so, and the service refuses anyway).
   */
  const agreementBlock = (person: VolunteerItem) => {
    const pdfHref = `/api/admin/events/${eventId}/volunteers/${person.id}/agreement`;
    if (person.agreementAcceptedAt && person.agreementMethod) {
      // The role the accepted text names, against the person's roles now (§761): the one given, or what they chose.
      const moved =
        person.agreementRoleName !== null &&
        !agreementStillNamesRole(person.agreementRoleName, rolesOf(person), person.agreementLocale ?? person.locale);
      // The date and the place the accepted text named, against the event's own now, in that text's language.
      const eventNow = person.agreementLocale ? agreementEvent[person.agreementLocale] : undefined;
      const elsewhere =
        eventNow !== undefined &&
        person.agreementEventDate !== null &&
        person.agreementEventLocation !== null &&
        (person.agreementEventDate !== eventNow.eventDate || person.agreementEventLocation !== eventNow.eventLocation);
      return (
        <Stack spacing={0.5} sx={{ mt: 0.5 }} data-testid="volunteer-agreement">
          <Typography variant="body2" color="text.secondary">
            {t("volunteers.agreement.acceptedLine", {
              version: String(person.agreementVersion ?? ""),
              how: t(`volunteers.agreement.methods.${person.agreementMethod}`),
              when: day(person.agreementAcceptedAt),
            })}
          </Typography>
          {moved && (
            <Typography variant="body2" color="text.secondary" data-testid="volunteer-agreement-other-role">
              {t("volunteers.agreement.otherRole", { role: person.agreementRoleName ?? "" })}
            </Typography>
          )}
          {elsewhere && (
            <Typography variant="body2" color="text.secondary" data-testid="volunteer-agreement-other-place">
              {t("volunteers.agreement.otherPlace", { date: person.agreementEventDate ?? "", place: person.agreementEventLocation ?? "" })}
            </Typography>
          )}
          <Box>
            <GlyphButton icon="pdf" href={pdfHref} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteer-agreement-pdf">
              {t("volunteers.agreement.pdf")}
            </GlyphButton>
          </Box>
        </Stack>
      );
    }
    if (person.state === "CANCELLED") return null;
    if (!agreementInForce) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="volunteer-agreement-missing">
          {t("volunteers.agreement.missing")}
        </Typography>
      );
    }
    if (!agreementNoticeDescribes) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="volunteer-agreement-notice-missing">
          {t("volunteers.agreement.noticeMissing")}
        </Typography>
      );
    }
    const sent = agreementStandingOf(person, now) === "linkSent" || person.agreementRequestedAt !== null;
    const sendLabel = sent ? t("volunteers.agreement.resend") : t("volunteers.agreement.send");
    // A row with no address (§NNN) is sent nothing: no link — one line says why where its button would be — and no copy after the paper.
    const noAddress = person.email === null;
    return (
      <Stack spacing={1} sx={{ mt: 0.5 }} data-testid="volunteer-agreement">
        <Typography variant="body2" color="text.secondary">
          {t(noAddress ? "volunteers.agreement.helpPaper" : "volunteers.agreement.help")}
        </Typography>
        {person.agreementRequestedAt && (
          <Typography variant="caption" color="text.secondary">
            {t("volunteers.agreement.requestedLine", { when: day(person.agreementRequestedAt) })}
          </Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {noAddress ? (
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }} data-testid="volunteer-agreement-no-email">
              {t("volunteers.agreement.noEmail")}
            </Typography>
          ) : (
            <Box component="form" action={requestVolunteerAgreementAction} data-testid="volunteer-agreement-send-form">
              {hidden}
              <input type="hidden" name="volunteerId" value={person.id} />
              <GlyphSubmitButton icon={sent ? "resend" : "send"} label={sendLabel} pendingLabel={sendLabel} ariaLabel={`${sendLabel}: ${shortText(person.name)}`} variant="outlined" />
            </Box>
          )}
          <GlyphButton icon="print" href={pdfHref} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteer-agreement-pdf">
            {t("volunteers.agreement.pdfToSign")}
          </GlyphButton>
          <ActionForm
            action={recordPaperVolunteerAgreementAction}
            confirm={{
              title: t("volunteers.agreement.paperTitle", { name: shortText(person.name) }),
              body: t(noAddress ? "volunteers.agreement.paperBodyNoEmail" : "volunteers.agreement.paperBody", { name: shortText(person.name) }),
              confirmLabel: t("volunteers.agreement.paper"),
              cancelLabel: words.cancel,
            }}
          >
            {hidden}
            <input type="hidden" name="volunteerId" value={person.id} />
            {/* What the PDF beside it prints (§758): the service refuses the record if either changed since. */}
            <input type="hidden" name="agreementDocumentId" value={agreementDocumentIds[person.locale] ?? ""} />
            <input type="hidden" name="agreementRoles" value={agreementRolesStamp(person.roleIds, person.choiceIds)} />
            <GlyphSubmitButton icon="declaration" label={t("volunteers.agreement.paper")} pendingLabel={t("volunteers.agreement.paper")} variant="outlined" />
          </ActionForm>
        </Stack>
      </Stack>
    );
  };

  /**
   * The parent's or guardian's agreement for one person under eighteen (§768): when it was accepted, how and which version
   * — or, not yet, the two ways to get it: the link by email (when the organizer has the address), or the PDF to sign at the
   * desk and «Acordul părintelui pe hârtie». Nothing for an adult, nothing to do for a cancelled person; the link and the
   * paper wait while the club may not take minors (the card says so, and the service refuses anyway).
   */
  const guardianBlock = (person: VolunteerItem) => {
    if (!isVolunteerMinor(person.age) || person.guardianName === null) return null;
    const pdfHref = `/api/admin/events/${eventId}/volunteers/${person.id}/agreement`;
    if (person.guardianAcceptedAt && person.guardianMethod) {
      return (
        <Stack spacing={0.5} sx={{ mt: 0.5 }} data-testid="volunteer-guardian">
          <Typography variant="body2" color="text.secondary">
            {t("volunteers.guardian.acceptedLine", {
              guardian: person.guardianName,
              version: String(person.guardianVersion ?? ""),
              how: t(`volunteers.guardian.methods.${person.guardianMethod}`),
              when: day(person.guardianAcceptedAt),
            })}
          </Typography>
          <Box>
            <GlyphButton icon="pdf" href={pdfHref} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteer-guardian-pdf">
              {t("volunteers.guardian.pdf")}
            </GlyphButton>
          </Box>
        </Stack>
      );
    }
    if (person.state === "CANCELLED") return null;
    // While the texts do not describe minors the link and the paper wait: the card says so once (`guardianNote`), not on every row.
    if (!minorsOpen) return null;
    const sent = guardianStandingOf(person, now) === "linkSent" || person.guardianRequestedAt !== null;
    const sendLabel = sent ? t("volunteers.guardian.resend") : t("volunteers.guardian.send");
    return (
      <Stack spacing={1} sx={{ mt: 0.5 }} data-testid="volunteer-guardian">
        {person.guardianRequestedAt && (
          <Typography variant="caption" color="text.secondary">
            {t("volunteers.guardian.requestedLine", { when: day(person.guardianRequestedAt) })}
          </Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {person.email === null ? (
            // A volunteer the club typed with no address (§NNN) is sent nothing, the parent's link included: one line says why, the paper stays.
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }} data-testid="volunteer-guardian-volunteer-no-email">
              {t("volunteers.guardian.volunteerNoEmail")}
            </Typography>
          ) : person.guardianEmail !== null ? (
            <Box component="form" action={requestVolunteerGuardianAction} data-testid="volunteer-guardian-send-form">
              {hidden}
              <input type="hidden" name="volunteerId" value={person.id} />
              <GlyphSubmitButton icon={sent ? "resend" : "send"} label={sendLabel} pendingLabel={sendLabel} ariaLabel={`${sendLabel}: ${shortText(person.name)}`} variant="outlined" />
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" data-testid="volunteer-guardian-no-email">
              {t("volunteers.guardian.noEmail")}
            </Typography>
          )}
          <GlyphButton icon="print" href={`${pdfHref}?for=guardian`} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteer-guardian-pdf-to-sign">
            {t("volunteers.guardian.pdfToSign")}
          </GlyphButton>
          <ActionForm
            action={recordPaperVolunteerGuardianAction}
            confirm={{
              title: t("volunteers.guardian.paperTitle", { name: shortText(person.name) }),
              body: t("volunteers.guardian.paperBody", { name: shortText(person.name) }),
              confirmLabel: t("volunteers.guardian.paper"),
              cancelLabel: words.cancel,
            }}
          >
            {hidden}
            <input type="hidden" name="volunteerId" value={person.id} />
            {/* What the PDF beside it prints (§768): the service refuses the record if either changed since. */}
            <input type="hidden" name="agreementDocumentId" value={agreementDocumentIds[person.locale] ?? ""} />
            <input type="hidden" name="agreementRoles" value={agreementRolesStamp(person.roleIds, person.choiceIds)} />
            <GlyphSubmitButton icon="declaration" label={t("volunteers.guardian.paper")} pendingLabel={t("volunteers.guardian.paper")} variant="outlined" />
          </ActionForm>
        </Stack>
      </Stack>
    );
  };

  /** A role's name with how it stands, «Sosire · 1 din 1»: what the organizer sees before one press fills it. */
  const roleStanding = (role: VolunteerRole, label = labelOf(role)) =>
    role.needed === null
      ? t("volunteers.assign.standingNoNumber", { role: label, taken: String(standingOf.get(role.id)?.taken ?? 0) })
      : t("volunteers.assign.standing", { role: label, taken: String(standingOf.get(role.id)?.taken ?? 0), needed: String(role.needed) });

  /**
   * «Dă-i rolul …» (§761) and, for a person who already has one, «Dă-i și rolul …» (§837): one press per role the person
   * ticked and does not hold yet, with how it stands, and the event's other roles in the select beside them — each a plain
   * form posting the role it wants (`assignVolunteerAction`), which adds that role to the ones held, audited and told to
   * the person by email naming them all. A role held is taken back with «Ia-i rolul …» on its chip (`givenBlock`), or in
   * «Modifică» → «Rolurile date». Nothing for a cancelled person: reopen them first.
   */
  const assignBlock = (person: VolunteerItem) => {
    if (person.state === "CANCELLED") return null;
    const held = new Set(person.roleIds);
    const quick = rolesOf(person).chosen.filter((role) => !held.has(role.id));
    const others = labelled.filter((role) => !held.has(role.id) && !quick.some((chosen) => chosen.id === role.id));
    if (quick.length === 0 && others.length === 0) return null;
    const some = held.size > 0;
    return (
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mt: 1 }} data-testid="volunteer-assign">
        {quick.map((role) => {
          const label = t(some ? "volunteers.assign.alsoButton" : "volunteers.assign.button", { role: roleStanding(role) });
          return (
            <Box component="form" action={assignVolunteerAction} key={role.id} data-testid="volunteer-assign-form">
              {hidden}
              <input type="hidden" name="volunteerId" value={person.id} />
              <input type="hidden" name="roleId" value={role.id} />
              <GlyphSubmitButton
                icon="role"
                label={label}
                pendingLabel={label}
                ariaLabel={`${label}: ${shortText(person.name)}`}
                variant="outlined"
              />
            </Box>
          );
        })}
        {others.length > 0 && (
          <Box component="form" action={assignVolunteerAction} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }} data-testid="volunteer-assign-other">
            {hidden}
            <input type="hidden" name="volunteerId" value={person.id} />
            <TextField
              name="roleId"
              select
              label={t("volunteers.assign.other")}
              defaultValue={others[0]?.id ?? ""}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "aria-label": `${t("volunteers.assign.other")}: ${shortText(person.name)}` } }}
              sx={{ minWidth: 200 }}
            >
              {/* The other roles under their categories (§840): one group per category, each role by its own name with how it stands. */}
              {roleGroups.map((group) => {
                const offered = group.roles.filter((role) => others.some((other) => other.id === role.id));
                if (offered.length === 0) return null;
                const options = offered.map((role) => (
                  <option key={role.id} value={role.id}>
                    {headed ? roleStanding(role, nameOf(role)) : roleStanding(role)}
                  </option>
                ));
                return headed ? (
                  <optgroup key={group.category?.id ?? "other"} label={groupName(group)}>
                    {options}
                  </optgroup>
                ) : (
                  options
                );
              })}
            </TextField>
            <GlyphSubmitButton
              icon="role"
              label={t(some ? "volunteers.assign.alsoOtherSubmit" : "volunteers.assign.otherSubmit")}
              pendingLabel={t(some ? "volunteers.assign.alsoOtherSubmit" : "volunteers.assign.otherSubmit")}
              ariaLabel={`${t(some ? "volunteers.assign.alsoOtherSubmit" : "volunteers.assign.otherSubmit")}: ${shortText(person.name)}`}
              variant="outlined"
            />
          </Box>
        )}
      </Stack>
    );
  };

  /**
   * The roles given (§837), as chips under «Roluri date:» — a word and a glyph, never colour alone — each with «Ia-i rolul …»,
   * a plain form posting that one role (`unassignVolunteerAction`): the others stand, the person is told what stands. Drawn
   * only for a person with a role; a cancelled person keeps the chips and loses the presses (nothing to announce to them).
   */
  const givenBlock = (person: VolunteerItem) => {
    const given = rolesOf(person).assigned;
    if (given.length === 0) return null;
    return (
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 0.5 }} data-testid="volunteer-given">
        <Typography component="span" variant="body2" color="text.secondary">
          {t("volunteers.person.givenLine")}:
        </Typography>
        {given.map((role) => (
          <Stack key={role.id} direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
            <StatusChip glyph="given" variant="outlined" label={labelOf(role)} testId="volunteer-given-role" />
            {person.state !== "CANCELLED" && (
              <Box component="form" action={unassignVolunteerAction} data-testid="volunteer-unassign-form">
                {hidden}
                <input type="hidden" name="volunteerId" value={person.id} />
                <input type="hidden" name="roleId" value={role.id} />
                <GlyphSubmitButton
                  icon="cancel"
                  label={t("volunteers.assign.remove", { role: labelOf(role) })}
                  pendingLabel={t("volunteers.assign.remove", { role: labelOf(role) })}
                  ariaLabel={`${t("volunteers.assign.remove", { role: labelOf(role) })}: ${shortText(person.name)}`}
                  variant="text"
                  size="small"
                />
              </Box>
            )}
          </Stack>
        ))}
      </Stack>
    );
  };

  /*
    The block itself, the same in both places: the chips of where the person came from and how the agreements stand, what they
    said about themselves, the contact, then the verbs — the roles, the agreements, the state — «Modifică», and «Șterge voluntarul»
    last. Drawn inside the card's row fold; drawn open on the person's own page, under the header that already names them (§839).
  */
  const body = (
    <>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }} data-testid="volunteer-status">
        <StatusChip glyph={person.source === "PUBLIC" ? "link" : "club"} variant="outlined" label={t(`volunteers.sources.${person.source}`)} />
        {/* The volunteer agreement (§758): accepted, a link waiting, or «contract neacceptat încă» — in words, never by colour alone.
            A cancelled person who never accepted is asked nothing: no chip to act on. */}
        {(() => {
          const standing = agreementStandingOf(person, now);
          if (person.state === "CANCELLED" && standing !== "accepted") return null;
          return (
            <StatusChip
              glyph={AGREEMENT_CHIP[standing].glyph}
              color={AGREEMENT_CHIP[standing].color}
              variant="outlined"
              label={t(`volunteers.agreement.${standing}`)}
              testId="volunteer-agreement-state"
            />
          );
        })()}
        {/* The parent's or guardian's agreement (§768), for a volunteer under eighteen only: «Acordul părintelui lipsește», a link sent, or received —
            in words, never by colour alone. A cancelled person waiting on nothing shows none. */}
        {(() => {
          const standing = guardianStandingOf(person, now);
          if (standing === "notNeeded" || (person.state === "CANCELLED" && standing !== "accepted")) return null;
          const chip = GUARDIAN_CHIP[standing === "accepted" ? "accepted" : "missing"];
          return (
            <>
              <StatusChip
                glyph={chip.glyph}
                color={chip.color}
                variant="outlined"
                label={t(standing === "accepted" ? "volunteers.guardian.accepted" : "volunteers.guardian.missing")}
                testId="volunteer-guardian-state"
              />
              {standing === "linkSent" && (
                <StatusChip glyph="link" variant="outlined" label={t("volunteers.guardian.linkSent")} testId="volunteer-guardian-link" />
              )}
            </>
          );
        })()}
      </Stack>
      {/* What the person said about themselves (§765), small: two chips — «a mai fost voluntar» and the club's group, the person's own claims, in words and a glyph —
          and one line of the rest in the row's details. Nothing for a person who said nothing. */}
      {(person.volunteeredBefore || person.clubMember || person.listOptIn) && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }} data-testid="volunteer-claims">
          {/* «Vrea pe lista publică» (§821): the person wants to appear — named on the event's page only once confirmed, while the club's list is public and the notice describes it. */}
          {person.listOptIn && <StatusChip glyph="wantsList" variant="outlined" label={t("volunteers.chips.wantsList")} testId="volunteer-on-list" />}
          {person.volunteeredBefore && <StatusChip glyph="experience" variant="outlined" label={t("volunteers.chips.before")} testId="volunteer-before" />}
          {person.clubMember && <StatusChip glyph="club" variant="outlined" label={t("volunteers.chips.club", { club: CLUB_NAME })} testId="volunteer-club" />}
        </Stack>
      )}
      {(() => {
        const size = shirtSizeShown(volunteersShirts, person.shirtSize);
        const facts = [
          // «17 ani (12.03.2009)» (§773): the age on the event's day and the date it came from; a row from before the date shows the age alone.
          person.age !== null ? `${yearsPhrase(person.age, locale)}${person.dateOfBirth !== null ? ` (${shownTypedDate(person.dateOfBirth)})` : ""}` : null,
          person.sex !== null ? t(`registrations.answers.sex.${person.sex}`) : null,
          person.city !== null ? t("volunteers.person.cityValue", { city: person.city }) : null,
          size !== null ? t("volunteers.person.shirtValue", { size }) : null,
        ].filter((fact): fact is string => fact !== null);
        return facts.length > 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }} data-testid="volunteer-facts">
            {facts.join(" · ")}
          </Typography>
        ) : null;
      })()}
      {/* The parent or guardian of a volunteer under eighteen (§768): the name, beside the age; the address is a link a thumb can press. */}
      {isVolunteerMinor(person.age) && person.guardianName !== null && (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }} data-testid="volunteer-guardian-line">
          {t("volunteers.person.guardianValue", { name: person.guardianName })}
          {person.guardianEmail !== null && (
            <>
              {" · "}
              <Box component="a" href={`mailto:${person.guardianEmail}`} sx={{ ...INLINE_TAP_TARGET, wordBreak: "break-all" }} data-testid="volunteer-guardian-email">
                {person.guardianEmail}
              </Box>
            </>
          )}
        </Typography>
      )}
      {/* A guardian's address that is the volunteer's own (§389: a family on one address) is no refusal, but the organizer's confirm is the human check: it is said. */}
      {isVolunteerMinor(person.age) && guardianSharesAddress(person.email, person.guardianEmail) && (
        <Box sx={{ mt: 0.5 }}>
          <StatusChip glyph="family" variant="outlined" label={t("volunteers.guardian.sameAddress")} testId="volunteer-guardian-same-address" />
        </Box>
      )}
      {/* The address and the telephone number: drawn here and nowhere else, as links a thumb can press — each only when the row has it
          (§NNN): no `mailto:` or `tel:` to nothing. A row the club typed with no address says once that the person is on the list only. */}
      {(person.email !== null || person.phone !== null) && (
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2, mt: 0.5 }}>
          {person.email !== null && (
            <Box component="a" href={`mailto:${person.email}`} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, wordBreak: "break-all" }} data-testid="volunteer-email">
              {person.email}
            </Box>
          )}
          {person.phone !== null && (
            <Box component="a" href={`tel:${person.phone}`} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }} data-testid="volunteer-phone">
              {formatPhone(person.phone)}
            </Box>
          )}
        </Stack>
      )}
      {person.email === null && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="volunteer-no-email">
          {t("volunteers.person.noEmail")}
        </Typography>
      )}
      {person.message && (
        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
          <Box component="span" sx={{ fontWeight: 600 }}>
            {t("volunteers.person.messageLabel")}:{" "}
          </Box>
          {person.message}
        </Typography>
      )}
      {person.note && (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          <Box component="span" sx={{ fontWeight: 600 }}>
            {t("volunteers.person.noteLabel")}:{" "}
          </Box>
          {person.note}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("volunteers.since", { when: day(person.createdAt) })}
      </Typography>

      {/* What the person would do (§761): the roles they ticked, as chips — a word and a glyph, never colour alone. */}
      {person.choiceIds.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 0.5 }} data-testid="volunteer-choices">
          <Typography component="span" variant="body2" color="text.secondary">
            {t("volunteers.person.offeredFor")}:
          </Typography>
          {rolesOf(person).chosen.map((role) => (
            <StatusChip key={role.id} glyph="offered" variant="outlined" label={labelOf(role)} testId="volunteer-choice" />
          ))}
        </Stack>
      )}

      {givenBlock(person)}

      {assignBlock(person)}

      {agreementBlock(person)}

      {guardianBlock(person)}

      <Stack spacing={1} sx={{ mt: 1 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {person.state !== "CONFIRMED" && stateButton(person, "CONFIRMED", t("volunteers.confirm"), "confirm")}
          {person.state === "REGISTERED" && stateButton(person, "CANCELLED", t("volunteers.cancel"), "cancel")}
          {person.state === "CONFIRMED" && stateButton(person, "CANCELLED", t("volunteers.cancel"), "cancel")}
          {person.state === "CANCELLED" && stateButton(person, "REGISTERED", t("volunteers.reopen"), "undo")}
        </Stack>
        <Panel variant="help" title={t("volunteers.edit")}>
          <Stack spacing={1.5} sx={{ pb: 1.5 }}>
            <ActionForm action={editVolunteerAction} scope={`volunteer-${person.id}`} messages={personBoxes}>
              {hidden}
              <input type="hidden" name="volunteerId" value={person.id} />
              {personFields(person)}
              <Box sx={{ mt: 1.5 }}>
                <GlyphSubmitButton label={t("volunteers.save")} pendingLabel={t("volunteers.saving")} icon="save" />
              </Box>
            </ActionForm>
          </Stack>
        </Panel>
        {/* «Șterge voluntarul» last, as every row's delete (§842): it asks first. */}
        <ActionForm
          action={deleteVolunteerAction}
          confirm={{
            title: t("volunteers.deleteTitle"),
            body: t("volunteers.deleteBody", { name: shortText(person.name) }),
            confirmLabel: t("volunteers.delete"),
            cancelLabel: words.cancel,
            destructive: true,
          }}
        >
          {hidden}
          <input type="hidden" name="volunteerId" value={person.id} />
          <GlyphSubmitButton label={t("volunteers.delete")} pendingLabel={t("volunteers.deleting")} icon="delete" color="error" variant="outlined" />
        </ActionForm>
      </Stack>
    </>
  );

  if (as === "section") {
    // The person's own page (§839): its header already says the name and the state, so the block is drawn open, under it, without them.
    return (
      <Box component="section" id={`volunteer-${person.id}`} aria-label={person.name} data-testid="volunteer-row" data-volunteer-id={person.id} data-state={person.state}>
        {body}
      </Box>
    );
  }

  /*
    The card's row (§842, `shared/ui/row-fold.ts`; the owner, 2026-10-21: «they look like they are from a different app»): the house's
    row fold, the roles' and the checkpoints' shape — the line in words, the name, the state and the roles given (or «De repartizat»),
    the pencil at the end, and a press anywhere on it opens the person's block in place. The address `#volunteer-<id>` names the fold
    itself, so «vezi la …» and a link from elsewhere land on it open (`OpenFoldFromHash`). The fold is keyed on what the line says, so a
    verb that changed it — «Confirmă», a role given — draws it closed on its new line; one that did not leaves it as it was.
  */
  const given = rolesOf(person).assigned;
  return (
    <Box component="li" data-testid="volunteer-row" data-volunteer-id={person.id} data-state={person.state} sx={ROW_SX}>
      <Box component="details" id={`volunteer-${person.id}`} key={[person.name, person.state, ...person.roleIds].join("\u0001")} data-testid="volunteer-edit">
        <Box component="summary" title={t("volunteers.edit")} data-testid="volunteer-edit-toggle" sx={SUMMARY_SX}>
          <Box sx={{ gridArea: "words", minWidth: 0 }}>
            <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }} data-testid="volunteer-name">
              {person.name}
            </Typography>
          </Box>
          <Box sx={FACTS_SX}>
            <StatusChip glyph={STATE_CHIP[person.state].glyph} color={STATE_CHIP[person.state].color} label={t(`volunteers.states.${person.state}`)} testId="volunteer-state" />
            {given.length > 0 ? (
              <StatusChip glyph="given" variant="outlined" label={given.map(labelOf).join(", ")} testId="volunteer-row-roles" />
            ) : person.state !== "CANCELLED" ? (
              <StatusChip glyph="open" color="warning" variant="outlined" label={t("volunteers.unassigned.title")} testId="volunteer-row-roles" />
            ) : null}
          </Box>
          <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
        </Box>
        <Box sx={{ pb: 1.5, pt: 0.5 }}>{body}</Box>
      </Box>
    </Box>
  );
}
