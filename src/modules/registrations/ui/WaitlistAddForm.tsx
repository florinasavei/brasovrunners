import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { REGISTRATION_NOTE_MAX } from "@/db/schema/registration-notes";
import { getPathname } from "@/i18n/navigation";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { staffRegistrationConstraints } from "../constraints";

/**
 * «Adaugă pe lista de așteptare» (§NNN): the one-press entry onto the official waiting list — a name, an
 * address, an optional internal note (§777) and the relay tick (§33, binding as on the full form) — posted as
 * the staff entry with «Direct pe lista de așteptare» ticked (`addToWaitlistAction`): the Administrator
 * vouches for the address and the row goes through the allocator at once, to the back of the line or to a
 * declaration hold, with that state's ordinary email. Drawn under the queue's line on the event's page
 * (`back="event"`, with its own title and help) and inside its own panel on the event's registrations list
 * (the panel carries the title); the page hands the action down only to an Administrator. The full form —
 * every other answer, the person's own language — is one link away. The dialog names the email it sends
 * (§384). Presentation only.
 */
export default async function WaitlistAddForm({
  locale,
  eventId,
  waitlistAddAction,
  back,
  scope,
  heading,
}: {
  locale: string;
  eventId: string;
  waitlistAddAction: ActionFormAction;
  /** Where the press returns: the event's queue panel; absent, the event's registrations list. */
  back?: "event";
  /** The form's scope (§315), unique on its page. */
  scope: string;
  /** The title and the help above the boxes, where no panel carries them. */
  heading: boolean;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({
    firstName: t("waitlistAdd.firstName"),
    lastName: t("waitlistAdd.lastName"),
    email: t("waitlistAdd.email"),
    note: t("waitlistAdd.note"),
    relayedByParticipantRequest: t("registrations.relayConfirmation"),
  });
  const fullForm = `${getPathname({ locale, href: "/admin/registrations/new" })}?${new URLSearchParams({ eventId }).toString()}`;

  return (
    <Box component="section" aria-labelledby={heading ? `${scope}-title` : undefined} data-testid="waitlist-add">
      {heading && (
        <>
          <Typography id={`${scope}-title`} variant="h3" sx={{ ...HEADING_SX[3], mb: 1 }}>
            {t("waitlistAdd.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("waitlistAdd.help")}
          </Typography>
        </>
      )}
      <ActionForm
        action={waitlistAddAction}
        messages={refusal}
        scope={scope}
        // The entry emails the person — the waiting-list message, or the declaration — and says so (§384).
        confirm={{
          title: t("confirm.waitlistAddTitle"),
          body: t("confirm.waitlistAddBody"),
          email: words.email(1),
          road: words.road("links"),
          confirmLabel: t("waitlistAdd.add"),
          cancelLabel: words.cancel,
        }}
        data-testid="waitlist-add-form"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={eventId} />
        {back && <input type="hidden" name="back" value={back} />}
        <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: "100%" }}>
            <RecallField name="firstName" label={t("waitlistAdd.firstName")} fullWidth {...textFieldConstraints(staffRegistrationConstraints("firstName"))} required />
            <RecallField name="lastName" label={t("waitlistAdd.lastName")} fullWidth {...textFieldConstraints(staffRegistrationConstraints("lastName"))} required />
          </Stack>
          <RecallField name="email" label={t("waitlistAdd.email")} helperText={t("waitlistAdd.emailHelp")} fullWidth {...textFieldConstraints(staffRegistrationConstraints("email"))} required />
          <RecallField
            name="note"
            label={t("waitlistAdd.note")}
            helperText={t("waitlistAdd.noteHelp")}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: REGISTRATION_NOTE_MAX } }}
          />
          {/* The service refuses the whole entry without this (§33): the same words, the same rule, as the full form. */}
          <CheckboxField name="relayedByParticipantRequest" required>
            {t("registrations.relayConfirmation")}
          </CheckboxField>
          <GlyphButton icon="addPerson" type="submit" variant="contained" sx={{ minHeight: 44 }}>
            {t("waitlistAdd.add")}
          </GlyphButton>
          <GlyphButton icon="addPerson" href={fullForm} variant="text" size="small" sx={{ minHeight: 44 }} data-testid="waitlist-add-full-form">
            {t("waitlistAdd.longForm")}
          </GlyphButton>
        </Stack>
      </ActionForm>
    </Box>
  );
}
