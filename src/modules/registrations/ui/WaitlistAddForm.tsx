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
import { staffOfferIfMadeNow, waitlistOfferQuestion } from "../give-place-tip";

/**
 * «Adaugă pe lista de așteptare» (§872): the one-press entry onto the official waiting list — a name, an
 * address, an optional internal note (§777) and the relay tick (§33, binding as on the full form) — posted as
 * the staff entry with «Direct pe lista de așteptare» ticked (`addToWaitlistAction`): the Administrator
 * vouches for the address and the row goes through the allocator at once, to the back of the line or to a
 * declaration hold, with that state's ordinary email. Drawn under the queue's line on the event's page
 * (`back="event"`, with its own title and help) and inside its own panel on the event's registrations list
 * (the panel carries the title); the page hands the action down only to an Administrator. The full form —
 * every other answer, the person's own language — is one link away. The dialog names the email it sends
 * (§384). Its second button, «Oferă-i un loc acum» (§888), posts the same entry with `intent=offer`: the row is
 * given a place in the same press — a free one, or §642's offer — and its own question names the supplementary
 * place a full event gets (`addPlace`, the capacity it names) and the close. Presentation only.
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
  // «Oferă-i un loc acum»'s question (§642): the supplementary place and the close; null once the event has started.
  const forecast = await staffOfferIfMadeNow(eventId, locale);
  const offer = forecast ? waitlistOfferQuestion((key, values) => t(key, values), "{email}", forecast) : null;
  const emailLine = { fillFrom: ["email"], email: words.email(1), road: words.road("links"), cancelLabel: words.cancel };

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
        // The entry emails the person — the waiting-list message, the declaration or the offer — and says so (§384);
        // which question asks is the button pressed (`intent`).
        confirm={[
          ...(offer ? [{ ...emailLine, when: [{ field: "intent", equals: "offer" }], title: t("confirm.waitlistOfferTitle"), body: offer.body, confirmLabel: offer.confirmLabel }] : []),
          {
            ...emailLine,
            title: t("confirm.waitlistAddTitle"),
            // Names the address typed in the form (§875), as «Dă-i un loc acum» does (§637): the safeguard against a dictated typo.
            body: t("confirm.waitlistAddBody", { email: "{email}" }),
            confirmLabel: t("waitlistAdd.add"),
          },
        ]}
        data-testid="waitlist-add-form"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={eventId} />
        {back && <input type="hidden" name="back" value={back} />}
        {/* The capacity the offer's question named (§642): the server adds that one place and no other, and none unasked. */}
        {forecast && forecast.raisedTo !== null && <input type="hidden" name="addPlace" value={forecast.raisedTo} />}
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
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
            <GlyphButton icon="addPerson" type="submit" name="intent" value="add" variant="contained" sx={{ minHeight: 44 }} data-testid="waitlist-add-submit">
              {t("waitlistAdd.add")}
            </GlyphButton>
            {offer && (
              <GlyphButton icon="place" type="submit" name="intent" value="offer" variant="outlined" sx={{ minHeight: 44 }} data-testid="waitlist-add-offer">
                {t("waitlistAdd.offerNow")}
              </GlyphButton>
            )}
          </Stack>
          <GlyphButton icon="addPerson" href={fullForm} variant="text" size="small" sx={{ minHeight: 44 }} data-testid="waitlist-add-full-form">
            {t("waitlistAdd.longForm")}
          </GlyphButton>
        </Stack>
      </ActionForm>
    </Box>
  );
}
