import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  resendVolunteerInvitationAction,
  sendVolunteerInvitationsAction,
  withdrawVolunteerInvitationAction,
} from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import RadioField from "@/shared/ui/RadioField";
import StatusChip from "@/shared/ui/StatusChip";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import { invitationStandingOf, VOLUNTEER_INVITATION_BATCH_MAX, VOLUNTEER_INVITATION_MESSAGE_MAX, type VolunteerInvitationStanding, type VolunteersAccess } from "../domain/access";
import type { VolunteerInvitationItem } from "../invitations";

/** A standing's chip: its word, its glyph and its tone — never the colour alone. */
const STANDING_CHIP: Record<VolunteerInvitationStanding, { glyph: StatusGlyphName; color: "warning" | "success" | "default" }> = {
  open: { glyph: "link", color: "warning" },
  used: { glyph: "done", color: "success" },
  withdrawn: { glyph: "cancelled", color: "default" },
  expired: { glyph: "cancelled", color: "default" },
};

/**
 * «Invitații» (§820, amending §754 and §768): the fold of the «Voluntari» card where the club writes to the people it wants as
 * volunteers when «Cine se poate oferi» says «Doar cu invitație de la club». A box «Adrese (una pe rând)», an optional «Mesaj», the
 * email's language and «Trimite invitațiile»; under it the list — the address, where it stands (sent, used, withdrawn, expired) and
 * «Retrimite» / «Retrage» on each open one as confirmed actions. An invitation holds nothing and counts nothing: no role's seat and
 * no race's place (`invitations.ts`).
 *
 * Drawn while the choice is «Doar cu invitație de la club», or while invitations exist (the list outlives the choice: changing it
 * deletes none, and a sent link keeps working). The send is offered only under that choice; a list under another says so in words.
 * The card's role gate stands behind it: the Organizer and the Administrators (`canManageVolunteers`), asserted again by every
 * action and the service. A Server Component of plain forms; the addresses are drawn here and on no public page.
 *
 * REUSE: `Panel` (the fold), `ActionForm` + `RecallField` (a refusal keeps what was typed, §315), `RadioField` (the language, a choice),
 * `GlyphSubmitButton` (a glyph before every verb), `StatusChip` (a standing in words and glyph), `confirmWords` (the dialogs), and for the
 * club's line `LocaleTabPanels` with `RecallField` and «Tradu din română» — the line is in both languages or neither (§354), as the email
 * has a half in each (§96).
 */
export default async function VolunteerInvitations({
  locale,
  eventId,
  access,
  invitations,
  eventAhead,
}: {
  locale: Locale;
  eventId: string;
  access: VolunteersAccess;
  invitations: readonly VolunteerInvitationItem[];
  /** Whether the event is still ahead (`volunteerEventAhead`): a link works while it is, whatever deadline was recorded at the send. */
  eventAhead: boolean;
}) {
  const t = await getTranslations("Admin");
  const dialog = await confirmWords();
  const messages = await refusalMessages({ addresses: t("volunteers.invite.addresses"), messageRo: t("volunteers.invite.messageRo"), messageEn: t("volunteers.invite.messageEn") });
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const rows = invitations.map((invitation) => ({ invitation, standing: invitationStandingOf(invitation, eventAhead) }));
  const open = rows.filter((row) => row.standing === "open").length;
  const used = rows.filter((row) => row.standing === "used").length;
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  return (
    <Panel
      glyph="invite"
      collapsible
      level={3}
      title={t("volunteers.invite.title")}
      aside={t("volunteers.invite.summary", { open: String(open), used: String(used) })}
      id="box-volunteer-invitations"
      data-testid="volunteer-invitations"
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t("volunteers.invite.intro")}
        </Typography>

        {access === "INVITED" ? (
          <ActionForm action={sendVolunteerInvitationsAction} scope="invitations" messages={messages} data-testid="volunteer-invite-form">
            {hidden}
            <Stack spacing={1.5}>
              <RecallField
                name="addresses"
                label={t("volunteers.invite.addresses")}
                helperText={t("volunteers.invite.addressesHelp", { max: String(VOLUNTEER_INVITATION_BATCH_MAX) })}
                multiline
                minRows={3}
                fullWidth
                required
                autoComplete="off"
                slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none", inputMode: "email" } }}
              />
              {/* The club's line, in both languages or neither (§354): each half of the email says its own, never the other's. */}
              <Stack spacing={0.5} data-testid="volunteer-invite-message">
                <LocaleTabPanels
                  idPrefix="volunteer-invite-message"
                  watch={{ names: ["message{Locale}"], rule: "parity" }}
                  markLabel={t("editor.tabIncomplete")}
                  panels={(["ro", "en"] as const).map((language) => ({
                    locale: language,
                    label: t(language === "ro" ? "volunteers.invite.localeRo" : "volunteers.invite.localeEn"),
                    content: (
                      <Stack spacing={1} sx={{ pt: 0.5 }}>
                        <RecallField
                          name={language === "ro" ? "messageRo" : "messageEn"}
                          label={t(language === "ro" ? "volunteers.invite.messageRo" : "volunteers.invite.messageEn")}
                          multiline
                          minRows={2}
                          fullWidth
                          slotProps={{ htmlInput: { maxLength: VOLUNTEER_INVITATION_MESSAGE_MAX, lang: language } }}
                        />
                        {/* «Tradu din română» (§464): the English line from the Romanian one. */}
                        {language === "en" && <TranslateFieldButton en="messageEn" />}
                      </Stack>
                    ),
                  }))}
                />
                <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
                  {t("volunteers.invite.messageHelp", { max: String(VOLUNTEER_INVITATION_MESSAGE_MAX) })}
                </Typography>
              </Stack>
              <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0 }}>
                  {t("volunteers.invite.language")}
                </Typography>
                <Box role="radiogroup" aria-label={t("volunteers.invite.language")}>
                  <RadioField name="inviteLocale" value="ro" defaultChecked={locale === "ro"}>
                    {t("volunteers.invite.localeRo")}
                  </RadioField>
                  <RadioField name="inviteLocale" value="en" defaultChecked={locale === "en"}>
                    {t("volunteers.invite.localeEn")}
                  </RadioField>
                </Box>
              </Box>
              <Box>
                <GlyphSubmitButton icon="send" label={t("volunteers.invite.send")} pendingLabel={t("volunteers.invite.sending")} />
              </Box>
            </Stack>
          </ActionForm>
        ) : (
          <Typography variant="body2" color="text.secondary" data-testid="volunteer-invite-off">
            {t("volunteers.invite.notInvitedOnly")}
          </Typography>
        )}

        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="volunteer-invite-empty">
            {t("volunteers.invite.empty")}
          </Typography>
        ) : (
          <Stack component="ul" spacing={1.5} aria-label={t("volunteers.invite.title")} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="volunteer-invite-list">
            {rows.map(({ invitation, standing }) => (
              <Box
                component="li"
                key={invitation.id}
                data-testid="volunteer-invite-row"
                data-standing={standing}
                sx={{ borderTop: 1, borderColor: "divider", pt: 1.5, "&:first-of-type": { borderTop: 0, pt: 0 } }}
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
                      <Typography sx={{ overflowWrap: "anywhere", fontWeight: 600 }} data-testid="volunteer-invite-address">
                        {invitation.deliveryEmail}
                      </Typography>
                      <StatusChip glyph={STANDING_CHIP[standing].glyph} color={STANDING_CHIP[standing].color} variant="outlined" label={t(`volunteers.invite.state.${standing}`)} testId="volunteer-invite-state" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {t("volunteers.invite.sentAt", { at: day(invitation.sentAt) })}
                      {invitation.invitedByName ? ` · ${t("volunteers.invite.by", { name: invitation.invitedByName })}` : ""}
                      {invitation.resentAt ? ` · ${t("volunteers.invite.resentAt", { at: day(invitation.resentAt) })}` : ""}
                      {invitation.usedAt ? ` · ${t("volunteers.invite.usedAt", { at: day(invitation.usedAt) })}` : ""}
                      {invitation.withdrawnAt && !invitation.usedAt ? ` · ${t("volunteers.invite.withdrawnAt", { at: day(invitation.withdrawnAt) })}` : ""}
                    </Typography>
                  </Box>
                  {standing === "open" && (
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <ActionForm
                        action={resendVolunteerInvitationAction}
                        confirm={{ title: t("volunteers.invite.resendTitle"), body: t("volunteers.invite.resendBody"), email: dialog.email(1), confirmLabel: t("volunteers.invite.resend"), cancelLabel: dialog.cancel }}
                        data-testid="volunteer-invite-resend-form"
                      >
                        {hidden}
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <GlyphSubmitButton icon="resend" label={t("volunteers.invite.resend")} pendingLabel={t("volunteers.invite.resending")} variant="outlined" size="small" />
                      </ActionForm>
                      <ActionForm
                        action={withdrawVolunteerInvitationAction}
                        confirm={{ title: t("volunteers.invite.withdrawTitle"), body: t("volunteers.invite.withdrawBody"), destructive: true, confirmLabel: t("volunteers.invite.withdraw"), cancelLabel: dialog.cancel }}
                        data-testid="volunteer-invite-withdraw-form"
                      >
                        {hidden}
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <GlyphSubmitButton icon="revoke" label={t("volunteers.invite.withdraw")} pendingLabel={t("volunteers.invite.withdrawing")} variant="text" color="error" size="small" />
                      </ActionForm>
                    </Stack>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Panel>
  );
}
