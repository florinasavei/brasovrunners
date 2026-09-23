import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import { getTranslations } from "next-intl/server";
import { updateClubNoticesAction } from "@/app/[locale]/admin/emails/actions";
import { formatAddressList } from "@/modules/contact/domain/recipients";
import type { ClubNoticesState } from "@/modules/notifications/club-notices";
import type { DeclarationCopies } from "@/modules/notifications/domain/club-notices";
import type { Locale } from "@/i18n/routing";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  locale: Locale;
  notices: ClubNoticesState;
  declarations: DeclarationCopies;
  /** Who may change these lists (§291): the Administrator; `updateClubNotices` refuses anybody else. */
  mayEdit: boolean;
};

/**
 * Who at the club receives a copy of a signed declaration, and who is told when somebody
 * confirms (`DECISIONS.md` §244, §245).
 *
 * The shape §100 and §164 set: a Server Component with one form, ordinary text boxes and a
 * Save, with the list in force printed above it so "I saved it and nothing changed" cannot
 * happen. The address list format is §164's — commas or semicolons — and it is imported from
 * there rather than re-implemented, because two parsers for one typed line is two behaviours.
 *
 * **The warning above the Bcc box is not decoration.** A signed declaration carries the
 * participant's name and the identity document they typed at signing. A Bcc delivers that to a
 * mailbox nobody on the message can see, which is exactly why somebody asks for it and exactly
 * why the person setting it should be looking at those words when they do.
 */
export default async function ClubNoticesPanel({ locale, notices, declarations, mayEdit }: Props) {
  const t = await getTranslations("Admin");

  return (
    <Panel
      title={t("emails.clubNotices.title")}
      intro={t("emails.clubNotices.intro")}
      collapsible
      data-testid="club-notices"
    >

      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.clubNotices.source.${declarations.source}`, {
          to: declarations.to ?? "—",
          cc: formatAddressList(declarations.cc) || "—",
          bcc: formatAddressList(declarations.bcc) || "—",
        })}
      </Typography>
      {/* The hidden copies of every participant message, named in force like the lists above (2026-09-22). */}
      <Typography variant="body2" sx={{ fontWeight: 500, mt: 0.5 }}>
        {t("emails.clubNotices.participantsInForce", {
          bcc: formatAddressList(notices.participants.bcc) || "—",
        })}
      </Typography>
      {notices.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.clubNotices.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              hourCycle: "h23",
              timeZone: "Europe/Bucharest",
            }).format(notices.updatedAt),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.clubNotices.readOnly")}
        </Typography>
      ) : (
      <Box component="form" action={updateClubNoticesAction} sx={{ mt: 1.5 }}>
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <TextField
            name="declarationsTo"
            label={t("emails.clubNotices.declarationsTo")}
            defaultValue={notices.declarations.to}
            size="small"
            helperText={t("emails.clubNotices.declarationsToHelp")}
            slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off", spellCheck: false, inputMode: "email" } }}
          />
          <TextField
            name="declarationsCc"
            label={t("emails.clubNotices.declarationsCc")}
            defaultValue={formatAddressList(notices.declarations.cc)}
            size="small"
            helperText={t("emails.clubNotices.declarationsCcHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          {/* The warning sits above the box it is about, where it is read before it is needed. */}
          <Alert severity="warning" sx={{ py: 0.5 }}>
            {t("emails.clubNotices.bccWarning")}
          </Alert>
          <TextField
            name="declarationsBcc"
            label={t("emails.clubNotices.declarationsBcc")}
            defaultValue={formatAddressList(notices.declarations.bcc)}
            size="small"
            helperText={t("emails.clubNotices.declarationsBccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <TextField
            name="confirmationsTo"
            label={t("emails.clubNotices.confirmationsTo")}
            defaultValue={formatAddressList(notices.confirmations.to)}
            size="small"
            helperText={t("emails.clubNotices.confirmationsToHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          {/*
            A hidden copy of every message a real participant receives (2026-09-22). The helper
            says what it does and what it costs in one sentence: each address is one more message
            against the Mailgun allowance for every participant message — the figure the plan panel
            above and `/admin/tasks` count through `messagesPerCompletedRegistration`.
          */}
          {/*
            The warning sits above the box, as the declaration's does (§244) — and this copy is the
            stronger one: every email to a participant carries their own action links and, on the
            confirmation, the QR code, so a mailbox on the Bcc can act in their place (§12.8).
          */}
          <Alert severity="warning" sx={{ py: 0.5 }}>
            {t("emails.clubNotices.participantsBccWarning")}
          </Alert>
          <TextField
            name="participantsBcc"
            label={t("emails.clubNotices.participantsBcc")}
            defaultValue={formatAddressList(notices.participants.bcc)}
            size="small"
            helperText={t("emails.clubNotices.participantsBccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <Box>
            <SubmitButton label={t("emails.clubNotices.save")} pendingLabel={t("emails.clubNotices.saving")} />
          </Box>
        </Stack>
      </Box>
      )}
    </Panel>
  );
}
