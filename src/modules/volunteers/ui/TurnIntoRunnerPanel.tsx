import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { staffRegistrationConstraints } from "@/modules/registrations/constraints";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";

/** A volunteer's one line as a registration's two boxes: the last word the last name, the rest the first — a start the Administrator corrects. */
export function splitVolunteerName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * «Transformă în alergător» on a volunteer's page (§948; the owner, 2026-11-15: «… și invers»): a closed fold under the
 * person's block, for the Administrator alone — the Organizer, who works the volunteers, is offered none. One form: the
 * runner's two names, filled from the volunteer's one line for the Administrator to check, the relay tick the official
 * list's entry asks (§33), and the button. The press asks first, naming the address the person is registered on and the
 * email the entry sends by its outcome — the declaration to sign on a free place, or the waiting list's.
 *
 * A volunteer the club typed without an address gets the sentence that says why, and no form: a registration is its
 * address. Presentation only: the page draws it for a role that may manage registrations, an event that takes
 * registrations on the site and a volunteer who is not cancelled, and `volunteers/transform.ts` asserts again
 * (BR-REQ-060-01).
 */
export default async function TurnIntoRunnerPanel({
  locale,
  eventId,
  volunteerId,
  name,
  email,
  toRunnerAction,
}: {
  locale: string;
  eventId: string;
  volunteerId: string;
  /** The volunteer's name, one line: the two boxes start from it. */
  name: string;
  /** The volunteer's address, or null for a row the club typed without one (§865). */
  email: string | null;
  /** `turnVolunteerIntoRunnerAction`, handed down by the page. */
  toRunnerAction: ActionFormAction;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({
    firstName: t("volunteers.toRunner.firstName"),
    lastName: t("volunteers.toRunner.lastName"),
    relayedByParticipantRequest: t("registrations.relayConfirmation"),
  });
  const typed = splitVolunteerName(name);

  return (
    <Panel glyph="registrations" level={3} collapsible title={t("volunteers.toRunner.title")} id="to-runner" data-testid="to-runner">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("volunteers.toRunner.intro")}
      </Typography>
      {email === null ? (
        <Typography variant="body2" data-testid="to-runner-no-address">
          {t("volunteers.toRunner.noAddress")}
        </Typography>
      ) : (
        <ActionForm
          action={toRunnerAction}
          messages={refusal}
          scope="to-runner"
          confirm={{
            title: t("volunteers.toRunner.confirmTitle"),
            body: t("volunteers.toRunner.confirmBody", { email }),
            // The person as typed in the two boxes, and the entry's email by its outcome: no road where the two travel apart.
            ...words.mail({ to: "{firstName} {lastName}", type: "WAITLIST_JOINED", or: "COMPLETE_DECLARATION" }),
            fillFrom: ["firstName", "lastName"],
            confirmLabel: t("volunteers.toRunner.action"),
            cancelLabel: words.cancel,
          }}
          data-testid="to-runner-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="volunteerId" value={volunteerId} />
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: "100%" }}>
              <RecallField name="firstName" label={t("volunteers.toRunner.firstName")} defaultValue={typed.firstName} fullWidth {...textFieldConstraints(staffRegistrationConstraints("firstName"))} required />
              <RecallField name="lastName" label={t("volunteers.toRunner.lastName")} defaultValue={typed.lastName} fullWidth {...textFieldConstraints(staffRegistrationConstraints("lastName"))} required />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("volunteers.toRunner.namesHelp")}
            </Typography>
            {/* The entry refuses without this (§33): the same words, the same rule, as the official list's add form. */}
            <CheckboxField name="relayedByParticipantRequest" required>
              {t("registrations.relayConfirmation")}
            </CheckboxField>
            <GlyphButton icon="addPerson" type="submit" variant="outlined" sx={{ minHeight: 44 }} data-testid="to-runner-submit">
              {t("volunteers.toRunner.action")}
            </GlyphButton>
          </Stack>
        </ActionForm>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {t("volunteers.toRunner.declaration")}
      </Typography>
    </Panel>
  );
}
