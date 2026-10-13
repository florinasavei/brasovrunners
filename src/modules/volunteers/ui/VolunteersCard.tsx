import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  addVolunteerAction,
  addVolunteerRoleAction,
  deleteVolunteerAction,
  deleteVolunteerRoleAction,
  editVolunteerAction,
  editVolunteerRoleAction,
  moveVolunteerRoleAction,
  setVolunteerStateAction,
  switchVolunteersAction,
} from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { formatPhone } from "@/modules/registrations/phone";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import {
  VOLUNTEER_NAME_MAX,
  VOLUNTEER_NEEDED_MAX,
  VOLUNTEER_NOTE_MAX,
  VOLUNTEER_ROLE_DESCRIPTION_MAX,
  VOLUNTEER_ROLE_NAME_MAX,
  type RoleStanding,
  type VolunteerOfferClosed,
  type VolunteerState,
} from "../domain/volunteer";
import type { VolunteerItem, VolunteerRole } from "../volunteers";

/** A state's chip: its word, its glyph and its tone — never the colour alone. */
const STATE_CHIP: Record<VolunteerState, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  REGISTERED: { glyph: "open", color: "warning" },
  CONFIRMED: { glyph: "done", color: "success" },
  CANCELLED: { glyph: "cancelled", color: "default" },
};

type Props = {
  locale: Locale;
  eventId: string;
  /** «Primește voluntari», as saved. */
  acceptsVolunteers: boolean;
  /** Why the public form is not on the event's page now, or null when it is (`volunteerOfferClosedFor`). */
  offerClosed: VolunteerOfferClosed | null;
  roles: readonly VolunteerRole[];
  standings: readonly RoleStanding[];
  volunteers: readonly VolunteerItem[];
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
 * form off the page; the event's **roles** — bilingual, how many each needs, in the order the club sets;
 * the **people** grouped by role with «N din M» each — entered by hand, changed, confirmed, cancelled,
 * deleted; and the CSV. Backoffice only: the Organizer and the Administrators read and write it, and nobody
 * else gets the card (`canManageVolunteers`, asserted again by every action and the export).
 *
 * A Server Component of plain forms, like the event's to-dos beside it (`EventTodoCard`): every verb posts
 * to a Server Action, so the card works with scripts off, and each action asks the service, which decides by
 * role (BR-REQ-060-01) whatever buttons this draws. It sits beside the editor's save form, never inside
 * it: HTML forms cannot nest. A volunteer's address and telephone number are drawn here and nowhere else.
 */
export default async function VolunteersCard({ locale, eventId, acceptsVolunteers, offerClosed, roles, standings, volunteers, error }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const standingOf = new Map(standings.map((standing) => [standing.roleId, standing]));

  const pending = volunteers.filter((volunteer) => volunteer.state === "REGISTERED").length;
  const totalNeeded = roles.reduce((sum, role) => sum + role.needed, 0);
  const totalTaken = standings.reduce((sum, standing) => sum + standing.taken, 0);
  const roleName = (role: Pick<VolunteerRole, "nameRo" | "nameEn">) => (locale === "en" ? role.nameEn : role.nameRo);
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

  const roleBoxes = await refusalMessages({
    nameRo: t("volunteers.role.nameRo"),
    nameEn: t("volunteers.role.nameEn"),
    needed: t("volunteers.role.needed"),
    descriptionRo: t("volunteers.role.descriptionRo"),
    descriptionEn: t("volunteers.role.descriptionEn"),
  });
  const personBoxes = await refusalMessages({
    roleId: t("volunteers.person.role"),
    name: t("volunteers.person.name"),
    email: t("volunteers.person.email"),
    phone: t("volunteers.person.phone"),
    note: t("volunteers.person.note"),
  });

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  /** The five boxes of «Adaugă un rol» and every role's «Modifică». */
  const roleFields = (role: VolunteerRole | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <RecallField
        name="nameRo"
        label={t("volunteers.role.nameRo")}
        defaultValue={role?.nameRo ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_NAME_MAX } }}
      />
      <RecallField
        name="nameEn"
        label={t("volunteers.role.nameEn")}
        defaultValue={role?.nameEn ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_NAME_MAX } }}
      />
      <RecallField
        name="needed"
        type="number"
        label={t("volunteers.role.needed")}
        helperText={t("volunteers.role.neededHelp")}
        defaultValue={String(role?.needed ?? 1)}
        required
        size="small"
        slotProps={{ htmlInput: { min: 1, max: VOLUNTEER_NEEDED_MAX, inputMode: "numeric" } }}
      />
      <RecallField
        name="descriptionRo"
        label={t("volunteers.role.descriptionRo")}
        helperText={t("volunteers.role.descriptionHelp", { max: String(VOLUNTEER_ROLE_DESCRIPTION_MAX) })}
        defaultValue={role?.descriptionRo ?? ""}
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_DESCRIPTION_MAX } }}
      />
      <RecallField
        name="descriptionEn"
        label={t("volunteers.role.descriptionEn")}
        defaultValue={role?.descriptionEn ?? ""}
        size="small"
        slotProps={{ htmlInput: { maxLength: VOLUNTEER_ROLE_DESCRIPTION_MAX } }}
      />
    </Stack>
  );

  /** The boxes of «Adaugă un voluntar» and every person's «Modifică». */
  const personFields = (person: VolunteerItem | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <RecallField
        name="roleId"
        select
        label={t("volunteers.person.role")}
        defaultValue={person?.roleId ?? roles[0]?.id ?? ""}
        required
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {roleName(role)}
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

  const personRow = (person: VolunteerItem) => (
    <Box component="li" key={person.id} data-testid="volunteer-row" data-volunteer-id={person.id} data-state={person.state} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
        <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }} data-testid="volunteer-name">
          {person.name}
        </Typography>
        <StatusChip glyph={STATE_CHIP[person.state].glyph} color={STATE_CHIP[person.state].color} label={t(`volunteers.states.${person.state}`)} testId="volunteer-state" />
        <StatusChip glyph={person.source === "PUBLIC" ? "link" : "club"} variant="outlined" label={t(`volunteers.sources.${person.source}`)} />
      </Stack>
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

  const roleRow = (role: VolunteerRole, index: number) => (
    <Box component="li" key={role.id} data-testid="volunteer-role" data-role-id={role.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
        <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }} data-testid="volunteer-role-name">
          {role.nameRo}
        </Typography>
        <Typography component="span" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          / {role.nameEn}
        </Typography>
        {standingChip(role)}
      </Stack>
      {(role.descriptionRo || role.descriptionEn) && (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          {[role.descriptionRo, role.descriptionEn].filter(Boolean).join(" / ")}
        </Typography>
      )}
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {([
            ["up", "moveUp", index > 0],
            ["down", "moveDown", index < roles.length - 1],
          ] as const).map(([direction, icon, possible]) =>
            possible ? (
              <Box component="form" action={moveVolunteerRoleAction} key={direction}>
                {hidden}
                <input type="hidden" name="roleId" value={role.id} />
                <input type="hidden" name="direction" value={direction} />
                <GlyphSubmitButton
                  icon={icon}
                  label={t(`volunteers.move.${direction}`)}
                  pendingLabel={t(`volunteers.move.${direction}`)}
                  ariaLabel={`${t(`volunteers.move.${direction}`)}: ${roleName(role)}`}
                  variant="outlined"
                />
              </Box>
            ) : null,
          )}
        </Stack>
        <Panel variant="help" title={t("volunteers.edit")}>
          <Stack spacing={1.5} sx={{ pb: 1.5 }}>
            <ActionForm action={editVolunteerRoleAction} scope={`role-${role.id}`} messages={roleBoxes}>
              {hidden}
              <input type="hidden" name="roleId" value={role.id} />
              {roleFields(role)}
              <Box sx={{ mt: 1.5 }}>
                <GlyphSubmitButton label={t("volunteers.save")} pendingLabel={t("volunteers.saving")} icon="save" />
              </Box>
            </ActionForm>
            <ActionForm
              action={deleteVolunteerRoleAction}
              confirm={{
                title: t("volunteers.role.deleteTitle"),
                body: t("volunteers.role.deleteBody", { name: roleName(role) }),
                confirmLabel: t("volunteers.role.delete"),
                cancelLabel: words.cancel,
                destructive: true,
              }}
            >
              {hidden}
              <input type="hidden" name="roleId" value={role.id} />
              <GlyphSubmitButton label={t("volunteers.role.delete")} pendingLabel={t("volunteers.role.deleting")} icon="delete" color="error" variant="outlined" />
            </ActionForm>
          </Stack>
        </Panel>
      </Stack>
    </Box>
  );

  const aside =
    roles.length === 0
      ? t("volunteers.summaryNone")
      : `${t("volunteers.summary", { taken: String(totalTaken), needed: String(totalNeeded) })}${pending > 0 ? ` · ${t("volunteers.summaryPending", { count: String(pending) })}` : ""}`;

  return (
    <Panel
      glyph="volunteers"
      collapsible
      id="box-volunteers"
      title={t("volunteers.title")}
      aside={aside}
      openWhen={{ attention: pending > 0 }}
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
            {offerClosed === null ? t("volunteers.offer.open") : t(`volunteers.offer.closed.${offerClosed}`)}
          </Alert>
          <Box component="form" action={switchVolunteersAction}>
            {hidden}
            <input type="hidden" name="on" value={acceptsVolunteers ? "0" : "1"} />
            <GlyphSubmitButton
              icon={acceptsVolunteers ? "turnOff" : "turnOn"}
              label={t(acceptsVolunteers ? "volunteers.switchOff" : "volunteers.switchOn")}
              pendingLabel={t(acceptsVolunteers ? "volunteers.switchOff" : "volunteers.switchOn")}
              variant="outlined"
            />
          </Box>
        </Stack>

        {/* The roles: bilingual, how many each needs, the club's order. */}
        <Panel glyph="volunteers" collapsible level={3} title={t("volunteers.rolesTitle")} aside={t("volunteers.rolesCount", { count: String(roles.length) })} id="box-volunteer-roles" data-testid="volunteer-roles">
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("volunteers.rolesIntro")}
            </Typography>
            {roles.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="volunteer-roles-empty">
                {t("volunteers.rolesEmpty")}
              </Typography>
            ) : (
              <Stack spacing={1.5} component="ul" aria-label={t("volunteers.rolesTitle")} sx={{ listStyle: "none", m: 0, p: 0 }}>
                {roles.map(roleRow)}
              </Stack>
            )}
            <Panel glyph="add" collapsible level={3} title={t("volunteers.role.addTitle")} data-testid="volunteer-role-add">
              <ActionForm action={addVolunteerRoleAction} scope="role-new" messages={roleBoxes}>
                {hidden}
                {roleFields(null)}
                <Box sx={{ mt: 1.5 }}>
                  <GlyphSubmitButton label={t("volunteers.role.add")} pendingLabel={t("volunteers.role.adding")} icon="add" />
                </Box>
              </ActionForm>
            </Panel>
          </Stack>
        </Panel>

        {/* The people, grouped by role with «N din M». */}
        {roles.length > 0 && (
          <Stack spacing={2} data-testid="volunteer-list">
            {roles.map((role) => {
              const mine = volunteers.filter((person) => person.roleId === role.id);
              return (
                <Box component="section" key={role.id} aria-label={roleName(role)} data-testid="volunteer-group" data-role-id={role.id}>
                  <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
                    <Typography component="h3" variant="h3" sx={{ fontSize: "1.0625rem" }}>
                      {roleName(role)}
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
