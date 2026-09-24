import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { getTranslations } from "next-intl/server";
import { updateClubNoticesAction } from "@/app/[locale]/admin/emails/actions";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { formatAddressList } from "@/modules/contact/domain/recipients";
import type { ClubNoticesState } from "@/modules/notifications/club-notices";
import type { DeclarationCopies } from "@/modules/notifications/domain/club-notices";
import type { Locale } from "@/i18n/routing";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

type Props = {
  locale: Locale;
  notices: ClubNoticesState;
  declarations: DeclarationCopies;
  /** Who may change these lists (§291): the Administrator; `updateClubNotices` refuses anybody else. */
  mayEdit: boolean;
  /** Why the fold opens by itself, as the page knows it: this panel's save just landed (§NNN). */
  openWhen?: FoldOpenWhen;
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
 * participant's name, their signature and — masked in the club's copy since §320 — the identity
 * document they typed at signing. A Bcc delivers that to a
 * mailbox nobody on the message can see, which is exactly why somebody asks for it and exactly
 * why the person setting it should be looking at those words when they do.
 */
export default async function ClubNoticesPanel({ locale, notices, declarations, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  /*
    How many mailboxes receive anything from these lists, for the closed fold's summary (§NNN):
    the declaration copy as it resolves (the setting, or `DECLARATIONS_ARCHIVE_TO`), the
    confirmation notices and the hidden copies of the participants' messages. A mailbox on two
    lists is one mailbox, compared without case the way the lists themselves drop a repeat.
  */
  const mailboxes = new Set(
    [declarations.to, ...declarations.cc, ...declarations.bcc, ...notices.confirmations.to, ...notices.participants.bcc]
      .filter((address): address is string => Boolean(address))
      .map((address) => address.toLowerCase()),
  ).size;

  return (
    <Panel
      title={t("emails.clubNotices.title")}
      intro={t("emails.clubNotices.intro")}
      aside={t("emails.clubNotices.aside", { count: mailboxes })}
      collapsible
      openWhen={openWhen}
      id="club-notices"
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
      <Box sx={{ mt: 1.5 }}>
      {/* A refused list comes back as typed (§315). */}
      <ActionForm
        action={updateClubNoticesAction}
        messages={await refusalMessages({
          declarationsTo: t("emails.clubNotices.declarationsTo"),
          declarationsCc: t("emails.clubNotices.declarationsCc"),
          declarationsBcc: t("emails.clubNotices.declarationsBcc"),
          confirmationsTo: t("emails.clubNotices.confirmationsTo"),
          participantsBcc: t("emails.clubNotices.participantsBcc"),
        })}
        // Three forms share /admin/emails; each summary and box id carries its own prefix (`fieldId`).
        scope="notices"
        data-testid="club-notices-form"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <RecallField
            name="declarationsTo"
            label={t("emails.clubNotices.declarationsTo")}
            defaultValue={notices.declarations.to}
            size="small"
            helperText={t("emails.clubNotices.declarationsToHelp")}
            slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off", spellCheck: false, inputMode: "email" } }}
          />
          <RecallField
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
          <RecallField
            name="declarationsBcc"
            label={t("emails.clubNotices.declarationsBcc")}
            defaultValue={formatAddressList(notices.declarations.bcc)}
            size="small"
            helperText={t("emails.clubNotices.declarationsBccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <RecallField
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
            The warning sits above the box, as the declaration's does (§244). Until §320 this copy
            was a Bcc on the participant's own envelope, action links and QR included, so a mailbox
            on it could act in their place (§12.8); it is a separate club copy now, stripped of all
            of that (`render.ts`), and the warning says what it does still carry.
          */}
          <Alert severity="warning" sx={{ py: 0.5 }}>
            {t("emails.clubNotices.participantsBccWarning")}
          </Alert>
          <RecallField
            name="participantsBcc"
            label={t("emails.clubNotices.participantsBcc")}
            defaultValue={formatAddressList(notices.participants.bcc)}
            size="small"
            helperText={t("emails.clubNotices.participantsBccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <Box>
            <GlyphSubmitButton label={t("emails.clubNotices.save")} pendingLabel={t("emails.clubNotices.saving")} icon="save" />
          </Box>
        </Stack>
      </ActionForm>
      </Box>
      )}
    </Panel>
  );
}
