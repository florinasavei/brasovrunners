import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  addVolunteerAction,
  addVolunteerCategoryAction,
  assignVolunteerAction,
  deleteVolunteerAction,
  deleteVolunteerCategoryAction,
  deleteVolunteerRoleAction,
  editVolunteerAction,
  editVolunteerCategoryAction,
  moveVolunteerCategoryAction,
  saveVolunteerCategoryContactAction,
  saveVolunteerRolesAction,
  recordPaperVolunteerAgreementAction,
  recordPaperVolunteerGuardianAction,
  requestVolunteerAgreementAction,
  requestVolunteerGuardianAction,
  setVolunteerStateAction,
  switchVolunteersAction,
  switchVolunteersButtonAction,
  switchVolunteersCountsAction,
  switchVolunteersListAction,
  switchVolunteersShirtsAction,
} from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import CalendarAddress from "@/modules/events/ui/CalendarAddress";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { shirtSizeShown, SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { SEX_CHOICES } from "@/modules/registrations/domain/sex";
import { formatPhone } from "@/modules/registrations/phone";
import { shownTypedDate } from "@/shared/forms/pickers/wall-values";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import TranslateCardButton from "@/modules/translate/ui/TranslateCardButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { badgeRoleText } from "../badges/badge-design";
import RoleColourFields from "../badges/ui/RoleColourFields";
import RoleColourSample from "../badges/ui/RoleColourSample";
import { CLUB_NAME } from "@/theme/brand";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { countForm } from "@/i18n/count-form";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import StatusChip from "@/shared/ui/StatusChip";
import TickButton from "@/shared/ui/TickButton";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import {
  VOLUNTEER_CATEGORIES_MAX,
  VOLUNTEER_CITY_MAX,
  VOLUNTEER_CONTACT_EMAIL_MAX,
  VOLUNTEER_CONTACT_PHONE_MAX,
  VOLUNTEER_GUARDIAN_NAME_MAX,
  VOLUNTEER_MINIMUM_AGE,
  VOLUNTEER_NAME_MAX,
  VOLUNTEER_NOTE_MAX,
  VOLUNTEER_ROLE_DESCRIPTION_MAX,
  VOLUNTEER_ROLE_NAME_MAX,
  agreementRolesStamp,
  agreementStandingOf,
  agreementStillNamesRole,
  contactParts,
  descriptionHead,
  earliestVolunteerBirthDate,
  guardianSharesAddress,
  groupRolesByCategory,
  groupsNeedHeadings,
  guardianStandingOf,
  isVolunteerMinor,
  latestVolunteerBirthDate,
  type RoleGroup,
  type RoleStanding,
  roleLabel,
  rolesWithCategoryWords,
  type VolunteerAgreementStanding,
  type VolunteerOfferClosed,
  type VolunteerState,
} from "../domain/volunteer";
import { encodeRoleBaseline, roleBaselineOf } from "../role-baseline";
import { newRoleRowKey, type RoleRowBox, roleBox, roleColourBoxesOf } from "../role-rows";
import type { VolunteersAccess } from "../domain/access";
import type { VolunteerInvitationItem } from "../invitations";
import type { VolunteerCategory, VolunteerItem, VolunteerRole } from "../volunteers";
import VolunteerAccessChoice from "./VolunteerAccessChoice";
import VolunteerBirthDateField from "./VolunteerBirthDateField";
import VolunteerInvitations from "./VolunteerInvitations";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";

/** A state's chip: its word, its glyph and its tone — never the colour alone. */
const STATE_CHIP: Record<VolunteerState, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  REGISTERED: { glyph: "open", color: "warning" },
  CONFIRMED: { glyph: "done", color: "success" },
  CANCELLED: { glyph: "cancelled", color: "default" },
};

/** The volunteer agreement's chip (§758): its words, its glyph and its tone — never the colour alone. */
const AGREEMENT_CHIP: Record<VolunteerAgreementStanding, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  accepted: { glyph: "done", color: "success" },
  linkSent: { glyph: "link", color: "default" },
  notAccepted: { glyph: "open", color: "warning" },
};

/**
 * The parent's or guardian's chip (§768): its words, its glyph and its tone — never the colour alone. Until the guardian accepts it says
 * «Acordul părintelui lipsește», a link live in their mailbox or not (that is a second, smaller chip beside it).
 */
const GUARDIAN_CHIP: Record<"accepted" | "missing", { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  accepted: { glyph: "done", color: "success" },
  missing: { glyph: "open", color: "warning" },
};

/**
 * The one-press tick (§752's pattern, the owner's rule of 2026-10-14: «nu mai folosi niciodată» a button that flips a setting):
 * a plain submit drawn as the house's checkbox with its words beside it — the glyph is the box, 24 pixels in a 44-pixel row,
 * the state in `aria-checked` and in the glyph, never the colour alone.
 */
const TICK_ROW_SX = {
  minHeight: 44,
  justifyContent: "flex-start",
  textAlign: "left",
  textTransform: "none",
  fontWeight: 400,
  fontSize: "1rem",
  color: "text.primary",
  px: 0.5,
  borderRadius: 1,
  "& .MuiButton-startIcon": { mr: 1, ml: 0 },
  "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 24 },
} as const;

type Props = {
  locale: Locale;
  eventId: string;
  /** «Primește voluntari», as saved. */
  acceptsVolunteers: boolean;
  /** «Oferim tricouri voluntarilor», as saved (§765): the people's rows show their size, and the entry's box asks it. */
  volunteersShirts: boolean;
  /** «Arată public câți voluntari mai sunt necesari», as saved (§773): the volunteers' page says how many a role needs only while it is on; the card always does. */
  volunteersShowCounts: boolean;
  /**
   * «Lista voluntarilor e publică pe pagina evenimentului», as saved (§821): the event's page draws a card «Voluntarii» with the name and the role given of
   * the confirmed volunteers who ticked «Vreau să apar pe lista publică a voluntarilor»; the card here always shows everybody.
   */
  volunteersListPublic?: boolean;
  /**
   * «Arată butonul „Vreau să fiu voluntar" pe pagina evenimentului», as saved (§835): the event's page draws the box «Căutăm voluntari» and its button only
   * while it is ticked. Unticked, the sign-up stays open (this card's «Primește voluntari» decides that) and the page is reached by its link, shown below.
   */
  volunteersButtonShown?: boolean;
  /**
   * The volunteers' page's absolute address in each language the event has a page in (§835, from `APP_BASE_URL`), for the club to copy and send by hand —
   * the way in while the button is not shown. A language with no page of its own has none.
   */
  pageLinks?: Partial<Record<Locale, string>>;
  /**
   * The notice in force describes the public list (§821, `{{volunteersList}}`, in every language): the public form asks the tick and the entry's box records it,
   * only while it does. Off, the club's tick says so and links «Documente legale»; the service refuses a new tick all the same (`changeVolunteer`).
   */
  listDescribed?: boolean;
  /** «Cine se poate oferi», as saved (§820): anyone from the event's page, the club's signed-in members, or only people the club invited. */
  access?: VolunteersAccess;
  /** The event's invitations to volunteer (§820), the newest first — read only for whoever may manage volunteers. */
  invitations?: readonly VolunteerInvitationItem[];
  /** The day the entry's date of birth is counted on, `YYYY-MM-DD` (§773, `volunteerEventDay`): the gun's, else the event's. */
  eventDay: string;
  /** The notice in force names what a volunteer says about themselves (§765): the public form asks it — else it is §758's tick. */
  profileDescribed: boolean;
  /**
   * The club may take a volunteer under eighteen (§768): the privacy notice in force names `{{volunteerMinors}}` and the
   * agreement `{{volunteerGuardian}}`, in every language. Without it the entry's guardian boxes and the guardian's link and
   * paper record wait — the service refuses them (`volunteerMinorsOpen`), so a hidden box is not the only gate.
   */
  minorsOpen: boolean;
  /** Why the public form is not on the event's page now, or null when it is (`volunteerOfferClosedFor`). */
  offerClosed: VolunteerOfferClosed | null;
  /** Whether the event is still ahead (`volunteerEventAhead`): the invitations' standing asks it, never a deadline recorded at the send (§820). */
  eventAhead?: boolean;
  roles: readonly VolunteerRole[];
  /** The headings the roles are grouped under, in the club's order, each with its contact person (§774). */
  categories: readonly VolunteerCategory[];
  standings: readonly RoleStanding[];
  volunteers: readonly VolunteerItem[];
  /** Whether a volunteer agreement is in force in every language (§758): the link and the paper need one. */
  agreementInForce: boolean;
  /** Whether the privacy notice in force describes the agreement's acceptance (§758): the link and the paper need it too. */
  agreementNoticeDescribes: boolean;
  /** The version in force per language: what «PDF de semnat» prints, posted back by «Semnat pe hârtie» (§758). */
  agreementDocumentIds: Partial<Record<Locale, string>>;
  /** The event's date and place as an acceptance would name them now, per language (`eventMergeValues`). */
  agreementEvent: Partial<Record<Locale, { eventDate: string; eventLocation: string }>>;
  /** The page's clock: whether a sent link is still live. */
  now: Date;
  /** A refused one-button form's code, already translated. */
  error?: string;
};

/** A line's words cut for an accessible name. */
function shortText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/**
 * «Voluntari» (§754): one card in the event editor, folded, with a summary line «N din M» and open on
 * arrival while anybody waits for an answer. The event's tick «Primește voluntari» and what keeps the public
 * form off the page; the event's **roles** — bilingual, how many each needs, in the order the club sets — in ONE form with one
 * «Salvează toate rolurile» (§791: a card per category, a line per role, a blank line that adds one, the delete of each a small form beside it);
 * the **people** grouped by role with «N din M» each — entered by hand, changed, confirmed, cancelled,
 * deleted; and the CSV. Backoffice only: the Organizer and the Administrators read and write it, and nobody
 * else gets the card (`canManageVolunteers`, asserted again by every action and the export).
 *
 * A Server Component of plain forms, like the event's to-dos beside it (`EventTodoCard`): every verb posts
 * to a Server Action, so the card works with scripts off, and each action asks the service, which decides by
 * role (BR-REQ-060-01) whatever buttons this draws. It sits beside the editor's save form, never inside
 * it: HTML forms cannot nest. A volunteer's address and telephone number are drawn here and nowhere else.
 */
export default async function VolunteersCard({
  locale,
  eventId,
  acceptsVolunteers,
  volunteersShirts,
  volunteersShowCounts,
  volunteersListPublic = false,
  volunteersButtonShown = true,
  pageLinks = {},
  listDescribed = false,
  access = "ANYONE",
  invitations = [],
  eventDay,
  profileDescribed,
  minorsOpen,
  offerClosed,
  eventAhead = true,
  roles,
  categories,
  standings,
  volunteers,
  agreementInForce,
  agreementNoticeDescribes,
  agreementDocumentIds,
  agreementEvent,
  now,
  error,
}: Props) {
  const t = await getTranslations("Admin");
  // The registration form's own words for its date-of-birth box (§773): the echo, the placeholder, «Scrie data ca zi, lună, an».
  const tReg = await getTranslations("Registration");
  const words = await confirmWords();
  // The editor's own control names, for the role's description (§765).
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const standingOf = new Map(standings.map((standing) => [standing.roleId, standing]));

  const pending = volunteers.filter((volunteer) => volunteer.state === "REGISTERED").length;
  // The summary counts only the roles with a number (§784): a role without one has nothing to be «din» — it is said once beside them.
  const numbered = standings.filter((standing) => standing.needed !== null);
  const withoutNumber = standings.filter((standing) => standing.needed === null);
  const totalNeeded = numbered.reduce((sum, standing) => sum + (standing.needed ?? 0), 0);
  const totalTaken = numbered.reduce((sum, standing) => sum + standing.taken, 0);
  const roleName = (role: Pick<VolunteerRole, "nameRo" | "nameEn">) => (locale === "en" ? role.nameEn : role.nameRo);
  // The roles in the order the card lists them — under their categories (§774) — each with its category's words, so a role named alone
  // says «Direcționare (Traseu)»: the assignment chips, the select, the ticks, the chips, the agreement's roles. The role's own header,
  // already under its heading, and the badge's band keep the name only.
  const labelled = rolesWithCategoryWords(categories, roles);
  const roleById = new Map(labelled.map((role) => [role.id, role]));
  const labelOf = (role: VolunteerRole) => roleLabel(roleById.get(role.id) ?? role, locale);
  // Every category with its roles — an empty one too, for its blank row — then the roles under none (§774); without a category, one group listed with no card.
  const roleGroups = groupRolesByCategory(categories, roles);
  const roleHeaded = groupsNeedHeadings(roleGroups);
  const categoryName = (category: Pick<VolunteerCategory, "nameRo" | "nameEn">) => (locale === "en" ? category.nameEn : category.nameRo);
  /** A person's roles as the agreement names them (§761): the one given and the ones chosen, in the club's order. */
  const rolesOf = (person: VolunteerItem) => ({
    assigned: (person.roleId ? roleById.get(person.roleId) : undefined) ?? null,
    chosen: person.choiceIds.flatMap((id) => roleById.get(id) ?? []),
  });
  // Offers nobody has given a role yet (§761): «De repartizat», above the roles; the cancelled ones wait for nothing.
  const unassigned = volunteers.filter((volunteer) => volunteer.roleId === null);
  const waitingForRole = unassigned.filter((volunteer) => volunteer.state !== "CANCELLED").length;
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

  const categoryBoxes = await refusalMessages({
    nameRo: t("volunteers.category.nameRo"),
    nameEn: t("volunteers.category.nameEn"),
    contactName: t("volunteers.category.contactName"),
    contactPhone: t("volunteers.category.contactPhone"),
    contactEmail: t("volunteers.category.contactEmail"),
  });
  // The refusal summary names a box of the one «Roluri» form by its role (§791): one label per row, `roles[<key>]`, which `fieldLabelOf` falls back to
  // for every box of that row — the sentence above the list says what is wrong, the link goes to the box. A blank row is «Rol nou · Traseu».
  const roleBoxes = await refusalMessages({
    ...Object.fromEntries(roles.map((role) => [`roles[${role.id}]`, role.nameRo])),
    ...Object.fromEntries(
      roleGroups.map((group) => [
        `roles[${newRoleRowKey(group.category?.id ?? null)}]`,
        group.category ? `${t("volunteers.role.newRow")} · ${categoryName(group.category)}` : t("volunteers.role.newRow"),
      ]),
    ),
  });
  const personBoxes = await refusalMessages({
    roleIds: t("volunteers.person.choices"),
    assignedRoleId: t("volunteers.person.assigned"),
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

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  /** The id of the small form behind one role's «Șterge rolul»: the button sits in the role's row, inside the one form of «Salvează toate rolurile», and names this one (`form=`). */
  const deleteFormId = (role: VolunteerRole) => `delete-role-${role.id}`;

  /**
   * One role's row in the «Roluri» card (§791; the owner, 2026-10-16: «să pot face batch edit la roluri, nu să dau save de fiecare dată, ci un
   * Save All»): a saved role, or the blank one at the end of a category — every box named by its row's key (`role-rows.ts`), all of them posted by
   * the card's one form. The names, «Câte persoane» with «Nelimitat», «Categoria» and «Poziția» stand on one line (stacked at 320 pixels); the
   * «N din M» chip, the band's sample and «Șterge rolul» under them; the description (one Română | English strip, §572) and the band's colour in
   * the row's own «Mai multe», inside the same form. `index` is the role's place among those of its category, from 0: «Poziția» shows it from 1.
   */
  const roleRowOf = (role: VolunteerRole | null, categoryId: string | null, index: number) => {
    const key = role ? role.id : newRoleRowKey(categoryId);
    const box = (name: RoleRowBox) => roleBox(key, name);
    const title = role ? role.nameRo : t("volunteers.role.newRow");
    // A name's box in the grid: the row's own, the English one with «Tradu din română» under it (§464).
    const nameBox = (side: "Ro" | "En") => (
      <RecallField
        name={box(`name${side}`)}
        label={t(`volunteers.role.col.name${side}`)}
        defaultValue={role?.[`name${side}`] ?? ""}
        // A saved role keeps both names; the blank row is a role only once a name is typed in it.
        required={role !== null}
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_NAME_MAX } }}
      />
    );
    // The two languages' descriptions, for the strip's «incomplet» mark: a role has one written and not the other.
    const written = { ro: role?.descriptionRoJson != null, en: role?.descriptionEnJson != null };
    const first = role ? descriptionHead(locale === "en" ? role.descriptionEn : role.descriptionRo).first : "";
    return (
      <Box
        component="li"
        key={key}
        data-testid={role ? "volunteer-role" : "volunteer-role-new"}
        data-role-id={role?.id}
        // The name the translate buttons say a box belongs to (`labelOfBox`): the same «Nume (EN)» is in every row.
        data-translate-row={title}
        sx={{ borderTop: 1, borderColor: "divider", pt: 1.5, pb: 1, "&:first-of-type": { borderTop: 0, pt: 0 } }}
      >
        {role === null && (
          <Typography component="p" variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t("volunteers.role.newRow")}
            <QuietHelp text={t("volunteers.role.newRowHint")} />
          </Typography>
        )}
        {/* What the form was drawn with (`role-baseline.ts`): the boxes below are compared with it, never with the role as it is stored by then. */}
        {role && <input type="hidden" name={box("was")} value={encodeRoleBaseline(roleBaselineOf(role, index + 1))} />}
        {/* The row's boxes are one group, named by the role, so a reader of the screen knows whose «Nume (RO)» it is in. */}
        <Box
          role="group"
          aria-label={title}
          sx={{
            display: "grid",
            gap: 1.5,
            alignItems: "start",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
              md:
                categories.length > 0
                  ? "minmax(0, 1.6fr) minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1.3fr) minmax(0, 0.7fr)"
                  : "minmax(0, 1.8fr) minmax(0, 1.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr)",
            },
          }}
        >
          {nameBox("Ro")}
          <Stack spacing={0.5}>
            {nameBox("En")}
            <TranslateFieldButton en={box("nameEn")} />
          </Stack>
          {/* «Câte persoane» or «Nelimitat» (§784): a number, or the house's tick (never a toggle). Ticked, the number box is hidden by the stylesheet
              alone (`:has`) — no script, so a form without scripts keeps working with the box shown; the box is never `required` (a hidden required
              box would block the press), the server decides by the tick and says «Verifică acest câmp» at the number when neither is given. */}
          <Stack spacing={0.5} data-testid="volunteer-role-needed-group" sx={{ "&:has(input[name$='.unlimited']:checked) [data-needed-box]": { display: "none" } }}>
            <RecallField
              name={box("needed")}
              type="number"
              label={t("volunteers.role.col.needed")}
              defaultValue={role ? (role.needed === null ? "" : String(role.needed)) : "1"}
              size="small"
              data-needed-box=""
              // No `min`, `max` or whole-number `step` on the box: hidden under the tick, an out-of-range or decimal number would block the press where nobody can see it. The server holds the whole numbers 1 to 1000.
              slotProps={{ htmlInput: { inputMode: "numeric", step: "any" } }}
            />
            <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <CheckboxField name={box("unlimited")} defaultChecked={role ? role.needed === null : false}>
                {t("volunteers.role.col.unlimited")}
              </CheckboxField>
              {/* The sentence about «Câte persoane» and «Nelimitat» (§784), once per card — on its first row, next to the tick it explains. */}
              {index === 0 && <QuietHelp text={t("volunteers.rolesNeededHelp")} />}
            </Stack>
          </Stack>
          {/* «Categoria» (§774): the heading the role sits under — the house's native select; «Alte roluri» is none. Drawn only once the event has a
              category: a form without the box leaves the role where it is. */}
          {categories.length > 0 && (
            <RecallField
              name={box("categoryId")}
              select
              label={t("volunteers.role.col.category")}
              defaultValue={role ? (role.categoryId ?? "") : (categoryId ?? "")}
              size="small"
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              data-testid="volunteer-role-category"
            >
              <option value="">{t("volunteers.otherCategory")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryName(category)}
                </option>
              ))}
            </RecallField>
          )}
          {/* «Poziția»: the role's place among those of its category, from 1; the blank row's is the last. */}
          <RecallField
            name={box("position")}
            type="number"
            label={t("volunteers.role.col.position")}
            defaultValue={role ? String(index + 1) : ""}
            size="small"
            slotProps={{ htmlInput: { inputMode: "numeric", step: "any" }, inputLabel: { shrink: true } }}
            placeholder={role ? undefined : t("volunteers.role.positionLast")}
          />
        </Box>
        {role && (
          <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mt: 1 }}>
            {standingChip(role)}
            {/* The band's colour on the volunteer badge (§764): the sample and its name in words, never the colour alone. */}
            <RoleColourSample colour={role.colour} label={badgeRoleText(roleName(role), locale)} locale={locale} testId="volunteer-role-colour" />
            <GlyphButton
              type="submit"
              form={deleteFormId(role)}
              icon="delete"
              color="error"
              variant="outlined"
              size="small"
              sx={{ minHeight: 44, ml: "auto" }}
              aria-label={`${t("volunteers.role.delete")}: ${labelOf(role)}`}
              data-testid="volunteer-role-delete"
            >
              {t("volunteers.role.delete")}
            </GlyphButton>
          </Stack>
        )}
        {/* «Mai multe»: what a role says beyond its line — the description in both languages, then the band's colour. Inside the form, so one press saves it too. */}
        <Panel variant="help" title={t("volunteers.role.more")} aside={first === "" ? undefined : shortText(first)} data-testid="volunteer-role-more">
          <Stack spacing={1.5} sx={{ pb: 1.5, maxWidth: 720 }}>
            {/* «Descrierea rolului» (§765): the house's rich-text editor, one Română | English strip (§572, the event editor's), both languages or neither;
                its plain words are what the agreement and the emails say. Each editor mounts when its tab comes forward (§96, §363). */}
            <Stack spacing={1} data-testid="volunteer-role-description-field">
              {/* What the description is for stays behind the «?» (§511): the title is the only line the strip needs above it. */}
              <Typography component="p" variant="body2" sx={{ fontWeight: 600 }}>
                {t("volunteers.role.descriptionTitle")}
                <QuietHelp text={t("volunteers.role.descriptionHelp", { max: String(VOLUNTEER_ROLE_DESCRIPTION_MAX) })} />
              </Typography>
              <LocaleTabPanels
                idPrefix={`role-${key}`}
                watch={{ names: [`roles[${key}].description{Locale}Body`], rule: "parity" }}
                markLabel={t("editor.tabIncomplete")}
                panels={(["ro", "en"] as const).map((language) => {
                  const side = language === "ro" ? "Ro" : "En";
                  const other = written[language === "ro" ? "en" : "ro"];
                  return {
                    locale: language,
                    label: t(`volunteers.role.language.${language}`),
                    incompleteLabel: !written[language] && other ? t("editor.tabIncomplete") : undefined,
                    content: (
                      <Stack spacing={1} sx={{ pt: 0.5 }}>
                        <LazyRichTextEditor
                          name={box(`description${side}Body`)}
                          label={t(`volunteers.role.description${side}`)}
                          summary={t(`volunteers.role.description${side}`)}
                          emptyHint={t("volunteers.role.descriptionEmpty")}
                          initialBody={(side === "Ro" ? role?.descriptionRoJson : role?.descriptionEnJson) ?? null}
                          accessibleSuffix={`${title} ${language.toUpperCase()}`}
                          features={{ media: false, tables: false }}
                          labels={rich}
                        />
                        {language === "en" && <TranslateFieldButton en={box("descriptionEnBody")} />}
                      </Stack>
                    ),
                  };
                })}
              />
            </Stack>
            {/* The role's band on its volunteer badge (§764): the same two boxes as the badges' page, saved by the same rule. */}
            <RoleColourFields names={roleColourBoxesOf(key)} colour={role?.colour ?? null} />
          </Stack>
        </Panel>
      </Box>
    );
  };

  /**
   * The boxes of «Adaugă un voluntar» and every person's «Modifică»: what the person would do (§761) — one box per
   * role, the house's `CheckboxField` posting `roleIds` once per tick — and the role given, any of the event's or
   * none yet. The service holds the rule: at least one ticked, or a role given.
   */
  const personFields = (person: VolunteerItem | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }} data-testid="volunteer-choices-field">
        <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0 }}>
          {t("volunteers.person.choices")}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("volunteers.person.choicesHelp")}
        </Typography>
        {labelled.map((role) => (
          <CheckboxField key={role.id} name="roleIds" value={role.id} defaultChecked={person?.choiceIds.includes(role.id) ?? false}>
            {labelOf(role)}
          </CheckboxField>
        ))}
      </Box>
      <RecallField
        name="assignedRoleId"
        select
        label={t("volunteers.person.assigned")}
        helperText={t("volunteers.person.assignedHelp")}
        defaultValue={person?.roleId ?? ""}
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        <option value="">{t("volunteers.person.assignedNone")}</option>
        {labelled.map((role) => (
          <option key={role.id} value={role.id}>
            {labelOf(role)}
          </option>
        ))}
      </RecallField>
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
        defaultValue={person?.email ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: 320 } }}
      />
      <RecallField
        name="phone"
        type="tel"
        label={t("volunteers.person.phone")}
        helperText={t("registrations.answers.phoneHelp")}
        defaultValue={person?.phone ?? ""}
        required
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

  const standingChip = (role: VolunteerRole) => {
    const standing = standingOf.get(role.id);
    if (!standing) return null;
    // A role without a number (§784) is never «full»: «3 · fără număr», the open glyph and no warning colour (nothing is owed).
    if (standing.needed === null) {
      return <StatusChip glyph="open" variant="outlined" label={t("volunteers.standingNoNumber", { taken: String(standing.taken) })} testId="volunteer-role-standing" />;
    }
    return (
      <StatusChip
        glyph={standing.free === 0 ? "done" : "open"}
        color={standing.free === 0 ? "success" : "warning"}
        variant="outlined"
        label={t("volunteers.standing", { taken: String(standing.taken), needed: String(standing.needed) })}
        testId="volunteer-role-standing"
      />
    );
  };

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
    return (
      <Stack spacing={1} sx={{ mt: 0.5 }} data-testid="volunteer-agreement">
        <Typography variant="body2" color="text.secondary">
          {t("volunteers.agreement.help")}
        </Typography>
        {person.agreementRequestedAt && (
          <Typography variant="caption" color="text.secondary">
            {t("volunteers.agreement.requestedLine", { when: day(person.agreementRequestedAt) })}
          </Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Box component="form" action={requestVolunteerAgreementAction} data-testid="volunteer-agreement-send-form">
            {hidden}
            <input type="hidden" name="volunteerId" value={person.id} />
            <GlyphSubmitButton icon={sent ? "resend" : "send"} label={sendLabel} pendingLabel={sendLabel} ariaLabel={`${sendLabel}: ${shortText(person.name)}`} variant="outlined" />
          </Box>
          <GlyphButton icon="print" href={pdfHref} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteer-agreement-pdf">
            {t("volunteers.agreement.pdfToSign")}
          </GlyphButton>
          <ActionForm
            action={recordPaperVolunteerAgreementAction}
            confirm={{
              title: t("volunteers.agreement.paperTitle", { name: shortText(person.name) }),
              body: t("volunteers.agreement.paperBody", { name: shortText(person.name) }),
              confirmLabel: t("volunteers.agreement.paper"),
              cancelLabel: words.cancel,
            }}
          >
            {hidden}
            <input type="hidden" name="volunteerId" value={person.id} />
            {/* What the PDF beside it prints (§758): the service refuses the record if either changed since. */}
            <input type="hidden" name="agreementDocumentId" value={agreementDocumentIds[person.locale] ?? ""} />
            <input type="hidden" name="agreementRoles" value={agreementRolesStamp(person.roleId, person.choiceIds)} />
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
          {person.guardianEmail !== null ? (
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
            <input type="hidden" name="agreementRoles" value={agreementRolesStamp(person.roleId, person.choiceIds)} />
            <GlyphSubmitButton icon="declaration" label={t("volunteers.guardian.paper")} pendingLabel={t("volunteers.guardian.paper")} variant="outlined" />
          </ActionForm>
        </Stack>
      </Stack>
    );
  };

  /** A role's name with how it stands, «Sosire · 1 din 1»: what the organizer sees before one press fills it. */
  const roleStanding = (role: VolunteerRole) =>
    role.needed === null
      ? t("volunteers.assign.standingNoNumber", { role: labelOf(role), taken: String(standingOf.get(role.id)?.taken ?? 0) })
      : t("volunteers.assign.standing", { role: labelOf(role), taken: String(standingOf.get(role.id)?.taken ?? 0), needed: String(role.needed) });

  /**
   * «Dă-i rolul …» (§761), on the offers «De repartizat» only — a person given a role changes it in «Modifică» →
   * «Rolul dat», so no press on their row moves them by mistake: one press per role the person ticked, with how it
   * stands, and the event's other roles in the select beside them — each a plain form posting the role it wants
   * (`assignVolunteerAction`), audited and told to the person by email. Nothing for a cancelled person: reopen them first.
   */
  const assignBlock = (person: VolunteerItem) => {
    if (person.state === "CANCELLED" || person.roleId !== null) return null;
    const quick = rolesOf(person).chosen;
    const others = labelled.filter((role) => !quick.some((chosen) => chosen.id === role.id));
    if (quick.length === 0 && others.length === 0) return null;
    return (
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mt: 1 }} data-testid="volunteer-assign">
        {quick.map((role) => {
          const label = t("volunteers.assign.button", { role: roleStanding(role) });
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
              {others.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleStanding(role)}
                </option>
              ))}
            </TextField>
            <GlyphSubmitButton
              icon="role"
              label={t("volunteers.assign.otherSubmit")}
              pendingLabel={t("volunteers.assign.otherSubmit")}
              ariaLabel={`${t("volunteers.assign.otherSubmit")}: ${shortText(person.name)}`}
              variant="outlined"
            />
          </Box>
        )}
      </Stack>
    );
  };

  const personRow = (person: VolunteerItem) => (
    <Box component="li" key={person.id} data-testid="volunteer-row" data-volunteer-id={person.id} data-state={person.state} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
        <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }} data-testid="volunteer-name">
          {person.name}
        </Typography>
        <StatusChip glyph={STATE_CHIP[person.state].glyph} color={STATE_CHIP[person.state].color} label={t(`volunteers.states.${person.state}`)} testId="volunteer-state" />
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
      {/* The address and the telephone number: drawn here and nowhere else, as links a thumb can press. */}
      <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2, mt: 0.5 }}>
        <Box component="a" href={`mailto:${person.email}`} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, wordBreak: "break-all" }} data-testid="volunteer-email">
          {person.email}
        </Box>
        <Box component="a" href={`tel:${person.phone}`} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }} data-testid="volunteer-phone">
          {formatPhone(person.phone)}
        </Box>
      </Stack>
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
        </Panel>
      </Stack>
    </Box>
  );

  /**
   * «Șterge rolul» (§384): its own confirmed action, outside the one form of «Salvează toate rolurile» — HTML forms do not nest, so this small form
   * stands beside it, hidden, and the role's button names it with `form=`. A role with people on it is refused, naming why (`VOLUNTEER_ROLE_HAS_PEOPLE`).
   */
  const deleteRoleForm = (role: VolunteerRole) => (
    <ActionForm
      key={role.id}
      id={deleteFormId(role)}
      hidden
      action={deleteVolunteerRoleAction}
      confirm={{
        title: t("volunteers.role.deleteTitle"),
        body: t("volunteers.role.deleteBody", { name: labelOf(role) }),
        confirmLabel: t("volunteers.role.delete"),
        cancelLabel: words.cancel,
        destructive: true,
      }}
    >
      {hidden}
      <input type="hidden" name="roleId" value={role.id} />
    </ActionForm>
  );

  /**
   * One category's sub-card in the «Roluri» card (§791): a named card (the house's `Panel`, nested like every named card of the backoffice) titled
   * with the category's name, «4 roluri» beside it and the contact person (§774) under it; then its roles' rows and, last, the blank row that adds a role.
   * The roles under no category are the last card, «Alte roluri». An event with no category has no sub-card: the rows are listed as they were.
   */
  const roleGroupOf = (group: RoleGroup<VolunteerCategory, VolunteerRole>) => {
    const rows = (
      <Stack spacing={0} component="ul" aria-label={group.category ? categoryName(group.category) : t("volunteers.rolesTitle")} sx={{ listStyle: "none", m: 0, p: 0 }}>
        {group.roles.map((role, index) => roleRowOf(role, group.category?.id ?? null, index))}
        {roleRowOf(null, group.category?.id ?? null, group.roles.length)}
      </Stack>
    );
    if (!roleHeaded) return <Box key="all">{rows}</Box>;
    return (
      <Panel
        key={group.category?.id ?? "other"}
        glyph="volunteers"
        static
        level={4}
        title={group.category ? categoryName(group.category) : t("volunteers.otherCategory")}
        aside={t(`volunteers.role.count.${countForm(group.roles.length, locale)}`, { count: String(group.roles.length) })}
        intro={group.category?.contact ? t("volunteers.categories.contactIs", { contact: contactParts(group.category.contact).join(" · ") }) : undefined}
        id={`box-volunteer-roles-${group.category?.id ?? "other"}`}
        data-testid="volunteer-role-group"
      >
        {rows}
      </Panel>
    );
  };

  /** The two names of a category, with «Copiază și tradu» (§482) in front: the English name from the Romanian one. */
  const categoryNameFields = (category: VolunteerCategory | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <TranslateAllButton />
      <RecallField
        name="nameRo"
        label={t("volunteers.category.nameRo")}
        defaultValue={category?.nameRo ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_NAME_MAX } }}
      />
      <RecallField
        name="nameEn"
        label={t("volunteers.category.nameEn")}
        defaultValue={category?.nameEn ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_NAME_MAX } }}
      />
    </Stack>
  );

  /**
   * One category of the «Categorii» fold (§774): its two names, how many roles sit under it, the arrows, «Modifică» (the names, the delete —
   * refused with a sentence while a role is under it) and «Persoana de contact» — three optional boxes with a «Salvează» of their own,
   * audited by the boxes that changed, never by their words. `index` and `count` are its place among the categories.
   */
  const categoryRow = (category: VolunteerCategory, index: number, count: number) => {
    const under = roles.filter((role) => role.categoryId === category.id).length;
    return (
      <Box component="li" key={category.id} data-testid="volunteer-category" data-category-id={category.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
          <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }} data-testid="volunteer-category-name">
            {category.nameRo}
          </Typography>
          <Typography component="span" color="text.secondary" sx={{ wordBreak: "break-word" }}>
            / {category.nameEn}
          </Typography>
          <StatusChip glyph={under > 0 ? "done" : "open"} color={under > 0 ? "success" : "warning"} variant="outlined" label={t("volunteers.categories.rolesUnder", { count: String(under) })} testId="volunteer-category-roles" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, wordBreak: "break-word" }} data-testid="volunteer-category-contact-line">
          {category.contact
            ? t("volunteers.categories.contactIs", { contact: contactParts(category.contact).join(" · ") })
            : t("volunteers.categories.contactNone")}
        </Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {([
              ["up", "moveUp", index > 0],
              ["down", "moveDown", index < count - 1],
            ] as const).map(([direction, icon, possible]) =>
              possible ? (
                <Box component="form" action={moveVolunteerCategoryAction} key={direction}>
                  {hidden}
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="direction" value={direction} />
                  <GlyphSubmitButton
                    icon={icon}
                    label={t(`volunteers.move.${direction}`)}
                    pendingLabel={t(`volunteers.move.${direction}`)}
                    ariaLabel={`${t(`volunteers.move.${direction}`)}: ${categoryName(category)}`}
                    variant="outlined"
                  />
                </Box>
              ) : null,
            )}
          </Stack>
          {/* «Persoana de contact»: empty at creation, filled in later by the club; its own form and its own «Salvează». */}
          <Panel glyph="contacts" collapsible level={3} title={t("volunteers.category.contactTitle")} data-testid="volunteer-category-contact">
            <ActionForm action={saveVolunteerCategoryContactAction} scope={`category-contact-${category.id}`} messages={categoryBoxes}>
              {hidden}
              <input type="hidden" name="categoryId" value={category.id} />
              <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
                <Typography variant="body2" color="text.secondary">
                  {t("volunteers.category.contactHelp")}
                  <QuietHelp text={t("volunteers.category.contactHelpMore")} />
                </Typography>
                <RecallField
                  name="contactName"
                  label={t("volunteers.category.contactName")}
                  defaultValue={category.contactName ?? ""}
                  size="small"
                  slotProps={{ htmlInput: { maxLength: VOLUNTEER_NAME_MAX, autoComplete: "off" } }}
                />
                <RecallField
                  name="contactPhone"
                  type="tel"
                  label={t("volunteers.category.contactPhone")}
                  helperText={t("registrations.answers.phoneHelp")}
                  defaultValue={category.contactPhone ?? ""}
                  size="small"
                  slotProps={{ htmlInput: { maxLength: VOLUNTEER_CONTACT_PHONE_MAX, inputMode: "tel", autoComplete: "off" } }}
                />
                <RecallField
                  name="contactEmail"
                  type="email"
                  label={t("volunteers.category.contactEmail")}
                  defaultValue={category.contactEmail ?? ""}
                  size="small"
                  slotProps={{ htmlInput: { maxLength: VOLUNTEER_CONTACT_EMAIL_MAX, autoComplete: "off" } }}
                />
                <Box>
                  <GlyphSubmitButton label={t("volunteers.save")} pendingLabel={t("volunteers.saving")} icon="save" />
                </Box>
              </Stack>
            </ActionForm>
          </Panel>
          <Panel variant="help" title={t("volunteers.edit")}>
            <Stack spacing={1.5} sx={{ pb: 1.5 }}>
              <ActionForm action={editVolunteerCategoryAction} scope={`category-${category.id}`} messages={categoryBoxes}>
                {hidden}
                <input type="hidden" name="categoryId" value={category.id} />
                {categoryNameFields(category)}
                <Box sx={{ mt: 1.5 }}>
                  <GlyphSubmitButton label={t("volunteers.save")} pendingLabel={t("volunteers.saving")} icon="save" />
                </Box>
              </ActionForm>
              <ActionForm
                action={deleteVolunteerCategoryAction}
                confirm={{
                  title: t("volunteers.category.deleteTitle"),
                  body: t("volunteers.category.deleteBody", { name: categoryName(category) }),
                  confirmLabel: t("volunteers.category.delete"),
                  cancelLabel: words.cancel,
                  destructive: true,
                }}
              >
                {hidden}
                <input type="hidden" name="categoryId" value={category.id} />
                <GlyphSubmitButton label={t("volunteers.category.delete")} pendingLabel={t("volunteers.category.deleting")} icon="delete" color="error" variant="outlined" />
              </ActionForm>
            </Stack>
          </Panel>
        </Stack>
      </Box>
    );
  };

  const aside =
    roles.length === 0
      ? t("volunteers.summaryNone")
      : [
          // «3 din 10», «3 din 10 + roluri fără număr»; with no numbered role at all, only the people in the roles without one (§784).
          numbered.length > 0
            ? t(withoutNumber.length > 0 ? "volunteers.summaryPlusNoNumber" : "volunteers.summary", { taken: String(totalTaken), needed: String(totalNeeded) })
            : t("volunteers.summaryOnlyNoNumber", { taken: String(withoutNumber.reduce((sum, standing) => sum + standing.taken, 0)) }),
          ...(waitingForRole > 0 ? [t("volunteers.summaryUnassigned", { count: String(waitingForRole) })] : []),
          ...(pending > 0 ? [t("volunteers.summaryPending", { count: String(pending) })] : []),
        ].join(" · ");

  return (
    <Panel
      glyph="volunteers"
      collapsible
      id="box-volunteers"
      title={t("volunteers.title")}
      aside={aside}
      openWhen={{ attention: pending > 0 || waitingForRole > 0 }}
      data-testid="event-volunteers"
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t("volunteers.intro")}
        </Typography>
        {/* «Voluntar» is also the desk's staff role: the card says these people are not it (BUSINESS.md, BR-BUS-060). */}
        <Typography variant="body2" color="text.secondary" data-testid="volunteer-not-accounts">
          {t("volunteers.notAccounts")}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}

        {/* The tick, and what keeps the public form off the page, named in words. */}
        <Stack spacing={1} data-testid="volunteer-switch">
          <Alert severity={offerClosed === null ? "success" : "info"} data-testid="volunteer-offer-state">
            {offerClosed === null
              ? t(
                  access === "ANYONE"
                    ? volunteersButtonShown ? "volunteers.offer.open" : "volunteers.offer.openHidden"
                    : access === "MEMBERS"
                      ? volunteersButtonShown ? "volunteers.offer.openMembers" : "volunteers.offer.openMembersHidden"
                      : "volunteers.offer.openInvited",
                )
              : t(`volunteers.offer.closed.${offerClosed}`)}
          </Alert>
          {/* «Primește voluntari pe pagină» (§765; the owner, 2026-10-14: «nu mai folosi niciodată» a button that flips a setting): a real tick —
              a plain form whose submit is drawn as the checkbox, the words beside it, `role="checkbox"` and `aria-checked`, 44 pixels, working with
              scripts off (the to-do list's pattern, §752). It posts the state it wants; the action behind it is the one it always was. */}
          <Box component="form" action={switchVolunteersAction} data-testid="volunteer-switch-form">
            {hidden}
            <input type="hidden" name="on" value={acceptsVolunteers ? "0" : "1"} />
            <GlyphButton
              type="submit"
              icon={acceptsVolunteers ? "tickOn" : "tickOff"}
              role="checkbox"
              aria-checked={acceptsVolunteers}
              color={acceptsVolunteers ? "success" : "inherit"}
              sx={TICK_ROW_SX}
              data-testid="volunteer-switch-tick"
            >
              {t("volunteers.switchOn")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 0.5 }}>
              {t("volunteers.switchHelp")}
            </Typography>
          </Box>
          {/* «Oferim tricouri voluntarilor» (§765): the same tick as the one above — a submit drawn as the checkbox that posts the state it wants,
              so the card's two settings behave alike and neither waits for a «Salvează». */}
          <Box component="form" action={switchVolunteersShirtsAction} data-testid="volunteer-shirts-form">
            {hidden}
            <input type="hidden" name="on" value={volunteersShirts ? "0" : "1"} />
            <GlyphButton
              type="submit"
              icon={volunteersShirts ? "tickOn" : "tickOff"}
              role="checkbox"
              aria-checked={volunteersShirts}
              color={volunteersShirts ? "success" : "inherit"}
              sx={TICK_ROW_SX}
              data-testid="volunteer-shirts-tick"
            >
              {t("volunteers.shirts.label")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 0.5 }}>
              {t("volunteers.shirts.help")}
            </Typography>
          </Box>
          {/* «Arată public câți voluntari mai sunt necesari» (§773; the §634 rule on the waiting list's count): the same tick as the two above — a submit
              drawn as the checkbox that posts the state it wants. Off, the volunteers' page says only that a role still takes people, never how many;
              the numbers on this card are the club's own and are always shown. */}
          <Box component="form" action={switchVolunteersCountsAction} data-testid="volunteer-counts-form">
            {hidden}
            <input type="hidden" name="on" value={volunteersShowCounts ? "0" : "1"} />
            <GlyphButton
              type="submit"
              icon={volunteersShowCounts ? "tickOn" : "tickOff"}
              role="checkbox"
              aria-checked={volunteersShowCounts}
              color={volunteersShowCounts ? "success" : "inherit"}
              sx={TICK_ROW_SX}
              data-testid="volunteer-counts-tick"
            >
              {t("volunteers.counts.label")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 0.5 }}>
              {t("volunteers.counts.help")}
            </Typography>
          </Box>
          {/* «Arată butonul „Vreau să fiu voluntar" pe pagina evenimentului» (§835; the owner, 2026-10-20: «I want to be able to allow registration for volunteers
              but I want to control if the button is visible on the website or not»): the same tick as the ones above — `TickButton`, a submit drawn as the checkbox that
              posts the state it wants. «Primește voluntari» stays what opens the sign-up; this decides only whether the public site advertises it. Ticked by default. */}
          <Box component="form" action={switchVolunteersButtonAction} data-testid="volunteer-button-form">
            {hidden}
            <input type="hidden" name="on" value={volunteersButtonShown ? "0" : "1"} />
            <TickButton checked={volunteersButtonShown} data-testid="volunteer-button-tick">
              {t("volunteers.button.label")}
            </TickButton>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 0.5 }}>
              {t("volunteers.button.help")}
            </Typography>
          </Box>
          {/* The page's own address, to copy (§835; `CalendarAddress`, the house's read-only box with «Copiază» beside it): the way in while the button is not shown, and
              handy while it is. Only while the event takes volunteers — before that the page does not exist. «Cine se poate oferi» still applies to whoever opens it. */}
          {acceptsVolunteers && Object.keys(pageLinks).length > 0 && (
            <Box data-testid="volunteer-page-links">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t("volunteers.link.title")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("volunteers.link.help")}
              </Typography>
              {(Object.entries(pageLinks) as Array<[Locale, string]>).map(([language, address]) => (
                <Box key={language} data-testid={`volunteer-page-link-${language}`}>
                  <CalendarAddress
                    id={`volunteer-page-link-${language}`}
                    address={address}
                    label={t(`volunteers.link.label.${language}`)}
                    copyLabel={t("volunteers.link.copy")}
                    copiedLabel={t("volunteers.link.copied")}
                    hints={[]}
                  />
                </Box>
              ))}
            </Box>
          )}
          {/* «Lista voluntarilor e publică pe pagina evenimentului» (§821; the owner, 2026-10-19: «private vs public lists of volunteers»): the same tick as the three
              above — the house's `TickButton`, a submit drawn as the checkbox that posts the state it wants. Off (the default), the list is the team's alone; on, the event's
              page names only the confirmed volunteers who ticked, under a notice that describes it. While the notice does not — ticked or not, so the club hears it
              before it ticks — the page shows nothing and the form asks no tick: the sentence says so and links the legal texts. */}
          <Box component="form" action={switchVolunteersListAction} data-testid="volunteer-list-form">
            {hidden}
            <input type="hidden" name="on" value={volunteersListPublic ? "0" : "1"} />
            <TickButton checked={volunteersListPublic} data-testid="volunteer-list-tick">
              {t("volunteers.list.label")}
            </TickButton>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 0.5 }}>
              {t("volunteers.list.help")}
            </Typography>
          </Box>
          {!listDescribed && (
            <Alert severity="info" data-testid="volunteer-list-notice-off">
              {t("volunteers.list.noticeOff")}{" "}
              <Link href="/admin/legal">{t("volunteers.list.noticeLink")}</Link>
            </Alert>
          )}
          {/* «Cine se poate oferi» (§820): under the ticks it qualifies, only while the event takes volunteers. */}
          {acceptsVolunteers && <VolunteerAccessChoice locale={locale} eventId={eventId} access={access} />}
          {/* Which form the public page draws (§765): the one that asks the person's date of birth, sex and city only while the notice in force names them. */}
          {!profileDescribed && (
            <Typography variant="body2" color="text.secondary" data-testid="volunteer-profile-off">
              {t("volunteers.offer.profileOff")}
            </Typography>
          )}
        </Stack>

        {/* «Invitații» (§820): while the choice is «Doar cu invitație de la club», and as long as any invitation exists. */}
        {acceptsVolunteers && (access === "INVITED" || invitations.length > 0) && <VolunteerInvitations locale={locale} eventId={eventId} access={access} invitations={invitations} eventAhead={eventAhead} />}

        {/* «Categorii» (§774; the owner, 2026-10-14: «categorii cu sub-categorii … Toate astea configurabile»): the headings the roles are grouped
            under on this card and on the volunteers' page — «Start / Sosire», «Traseu» —, each with its optional contact person. */}
        <Panel glyph="kind" collapsible level={3} title={t("volunteers.categories.title")} aside={t("volunteers.categories.count", { count: String(categories.length) })} id="box-volunteer-categories" data-testid="volunteer-categories">
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("volunteers.categories.intro")}
            </Typography>
            {categories.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="volunteer-categories-empty">
                {t("volunteers.categories.empty")}
              </Typography>
            ) : (
              <Stack spacing={1.5} component="ul" aria-label={t("volunteers.categories.title")} sx={{ listStyle: "none", m: 0, p: 0 }}>
                {categories.map((category, index) => categoryRow(category, index, categories.length))}
              </Stack>
            )}
            {categories.length < VOLUNTEER_CATEGORIES_MAX && (
              <Panel glyph="add" collapsible level={3} title={t("volunteers.category.addTitle")} data-testid="volunteer-category-add">
                <ActionForm action={addVolunteerCategoryAction} scope="category-new" messages={categoryBoxes}>
                  {hidden}
                  {categoryNameFields(null)}
                  <Box sx={{ mt: 1.5 }}>
                    <GlyphSubmitButton label={t("volunteers.category.add")} pendingLabel={t("volunteers.category.adding")} icon="add" />
                  </Box>
                </ActionForm>
              </Panel>
            )}
          </Stack>
        </Panel>

        {/* The roles: bilingual, how many each needs, the club's order — every one saved by the one «Salvează toate rolurile» (§791). */}
        <Panel glyph="volunteers" collapsible level={3} title={t("volunteers.rolesTitle")} aside={t("volunteers.rolesCount", { count: String(roles.length) })} id="box-volunteer-roles" data-testid="volunteer-roles">
          <Stack spacing={1.5}>
            {roles.length === 0 && (
              <Typography variant="body2" color="text.secondary" data-testid="volunteer-roles-empty">
                {t("volunteers.rolesEmpty")}
              </Typography>
            )}
            {/* ONE form around every role of every category: its rows, the blank rows and the one «Salvează toate rolurile». The translate buttons read it:
                «Tradu cardul: RO → EN» in the header row translates what is inside this scope (`data-translate-scope`, §514 adapted for a card with no
                tab row of its own). «Șterge rolul» is not in it: each role's delete is a small form beside it (`deleteRoleForm`). */}
            <ActionForm action={saveVolunteerRolesAction} scope="roles" messages={roleBoxes} data-testid="volunteer-roles-form">
              {hidden}
              <Box data-translate-scope={t("volunteers.rolesTitle")}>
                <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, mb: 1.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} data-testid="volunteer-roles-intro">
                    {t("volunteers.rolesIntro")}
                  </Typography>
                  <TranslateCardButton />
                </Stack>
                {/* The roles under their categories (§774), in the club's order, then «Alte roluri»; an event with no category lists them as before. */}
                <Stack spacing={2} data-testid="volunteer-role-groups">
                  {roleGroups.map(roleGroupOf)}
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <GlyphSubmitButton label={t("volunteers.rolesSave")} pendingLabel={t("volunteers.rolesSaving")} icon="save" />
                </Box>
              </Box>
            </ActionForm>
            {roles.map(deleteRoleForm)}
          </Stack>
        </Panel>

        {/* «Ecusoane pentru voluntari» (§764): the badges are designed and printed per role on a page of their own. */}
        <GlyphButton
          icon="badges"
          href={getPathname({ locale, href: { pathname: "/admin/events/[id]/badges", params: { id: eventId } } })}
          variant="outlined"
          sx={{ minHeight: 44, alignSelf: "flex-start" }}
          data-testid="volunteer-badges-link"
        >
          {t("volunteers.badgesLink")}
        </GlyphButton>

        {/* What waits on a parent, said once for the whole list (§768): how a minor's consent is got, or that it cannot be yet. */}
        {volunteers.some((person) => isVolunteerMinor(person.age) && person.guardianName !== null && person.guardianAcceptedAt === null && person.state !== "CANCELLED") && (
          <Typography variant="body2" color="text.secondary" data-testid={minorsOpen ? "volunteer-guardian-note" : "volunteer-guardian-closed"}>
            {t(minorsOpen ? "volunteers.guardian.help" : "volunteers.guardian.minorsClosed")}
          </Typography>
        )}

        {/* The people: first the offers nobody has given a role yet, then each role's people with «N din M». */}
        {roles.length > 0 && (
          <Stack spacing={2} data-testid="volunteer-list">
            {unassigned.length > 0 && (
              <Box component="section" aria-label={t("volunteers.unassigned.title")} data-testid="volunteer-unassigned">
                <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mb: 0.5 }}>
                  <Typography component="h3" variant="h3" sx={{ fontSize: "1.0625rem" }}>
                    {t("volunteers.unassigned.title")}
                  </Typography>
                  <StatusChip
                    glyph={waitingForRole > 0 ? "open" : "done"}
                    color={waitingForRole > 0 ? "warning" : "success"}
                    variant="outlined"
                    label={t("volunteers.summaryUnassigned", { count: String(waitingForRole) })}
                    testId="volunteer-unassigned-count"
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {waitingForRole > 0 ? t("volunteers.unassigned.intro") : t("volunteers.unassigned.empty")}
                </Typography>
                <Stack spacing={1.5} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {unassigned.map(personRow)}
                </Stack>
              </Box>
            )}
            {labelled.map((role) => {
              const mine = volunteers.filter((person) => person.roleId === role.id);
              return (
                <Box component="section" key={role.id} aria-label={labelOf(role)} data-testid="volunteer-group" data-role-id={role.id}>
                  <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
                    <Typography component="h3" variant="h3" sx={{ fontSize: "1.0625rem" }}>
                      {labelOf(role)}
                    </Typography>
                    {standingChip(role)}
                  </Stack>
                  {mine.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t("volunteers.nobody")}
                    </Typography>
                  ) : (
                    <Stack spacing={1.5} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                      {mine.map(personRow)}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}

        {/* A person the club enters by hand: the same boxes as the public form, and the organizers' note. */}
        {roles.length > 0 && (
          <Panel glyph="add" collapsible level={3} title={t("volunteers.person.addTitle")} data-testid="volunteer-add">
            <ActionForm action={addVolunteerAction} scope="volunteer-new" messages={personBoxes}>
              {hidden}
              {personFields(null)}
              <Box sx={{ mt: 1.5 }}>
                <GlyphSubmitButton label={t("volunteers.person.add")} pendingLabel={t("volunteers.person.adding")} icon="addPerson" />
              </Box>
            </ActionForm>
          </Panel>
        )}

        {volunteers.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
            <GlyphButton icon="download" href={`/api/admin/events/${eventId}/volunteers?lang=${locale}`} variant="outlined" sx={{ minHeight: 44 }} data-testid="volunteers-csv">
              {t("volunteers.csv")}
            </GlyphButton>
            <Typography variant="body2" color="text.secondary">
              {t("volunteers.csvHelp")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Panel>
  );
}
