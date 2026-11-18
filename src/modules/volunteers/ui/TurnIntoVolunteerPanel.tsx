import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";

/**
 * «Transformă în voluntar» on a registration's page (§948; the owner, 2026-11-15: «aș vrea să pot să „transform" un
 * alergător în voluntar și invers»): a closed fold beside «Anulează înscrierea», for the Administrator alone, holding
 * one form — the role the person takes, chosen from the event's own, and the button. The press asks first, naming both
 * emails the person gets («Înscriere anulată», then «Rolul tău de voluntar»), the freed place's offer to the first in
 * line, a printed bib that goes void, and ends in two answers, «… și trimite emailul» or «… fără email», for the person's
 * two together (§NNN).
 *
 * An event with no role yet says so and links its «Voluntari» card: a volunteer is entered with a role, and the
 * service refuses without one. Presentation only: the page draws it for a role that may manage registrations and a
 * registration that can still be cancelled, and `volunteers/transform.ts` asserts both again (BR-REQ-060-01).
 */
export default async function TurnIntoVolunteerPanel({
  locale,
  registrationId,
  name,
  roles,
  eventCardHref,
  toVolunteerAction,
  printedBib,
  freesAPlace,
}: {
  locale: string;
  registrationId: string;
  /** The registered name: who the question's email line names. */
  name: string;
  /** The event's roles in the club's order, each by its own name with its category's (`roleLabel`). */
  roles: readonly { id: string; label: string }[];
  /** The event editor's «Voluntari» card, where a role is added. */
  eventCardHref: string;
  /** `turnRunnerIntoVolunteerAction`, handed down by the page. */
  toVolunteerAction: ActionFormAction;
  /** The registration's number as the event writes it, when its bib is already on paper (§311): named before the press. */
  printedBib: string | null;
  /** The registration holds a counted place: the question says the first in line may be offered it. */
  freesAPlace: boolean;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({ roleId: t("registrations.toVolunteer.role") });
  const body = t("registrations.toVolunteer.confirmBody");

  return (
    <Panel glyph="volunteers" level={3} collapsible title={t("registrations.toVolunteer.title")} id="to-volunteer" data-testid="to-volunteer">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("registrations.toVolunteer.intro")}
      </Typography>
      {roles.length === 0 ? (
        <Stack spacing={1} sx={{ alignItems: "flex-start" }} data-testid="to-volunteer-no-roles">
          <Typography variant="body2">{t("registrations.toVolunteer.noRoles")}</Typography>
          <GlyphButton icon="role" href={eventCardHref} variant="outlined" size="small" sx={{ minHeight: 44 }}>
            {t("registrations.toVolunteer.noRolesLink")}
          </GlyphButton>
        </Stack>
      ) : (
        <ActionForm
          action={toVolunteerAction}
          messages={refusal}
          scope="to-volunteer"
          confirm={{
            title: t("registrations.toVolunteer.confirmTitle"),
            // The printed bib is named before the press (§311), as the cancellation's own question names it.
            body: printedBib !== null ? `${t("confirm.cancelRegistrationPrintedBody", { number: printedBib })} ${body}` : body,
            // Both of the person's emails, the second said with the first: «… fără email» keeps back the two.
            ...words.mail({
              to: name,
              type: "REGISTRATION_CANCELLED",
              also: [
                words.line("andType", { type: t("emails.types.VOLUNTEER_ROLE_ASSIGNED") }),
                ...(freesAPlace ? [words.nextInLineMaybe()] : []),
              ],
              optOut: true,
            }),
            confirmLabel: t("registrations.toVolunteer.action"),
            cancelLabel: words.cancel,
            destructive: true,
          }}
          data-testid="to-volunteer-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="registrationId" value={registrationId} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "flex-start" } }}>
            <RecallField
              select
              name="roleId"
              label={t("registrations.toVolunteer.role")}
              defaultValue={roles[0].id}
              size="small"
              required
              slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "to-volunteer-role" } }}
              sx={{ flex: 1, minWidth: { sm: 240 } }}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </RecallField>
            <GlyphButton icon="volunteers" type="submit" variant="outlined" sx={{ minHeight: 44 }} data-testid="to-volunteer-submit">
              {t("registrations.toVolunteer.action")}
            </GlyphButton>
          </Stack>
        </ActionForm>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {t("registrations.toVolunteer.numberNote")}
      </Typography>
    </Panel>
  );
}
