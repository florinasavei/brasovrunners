import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { getTranslations } from "next-intl/server";
import { updateClubNoticesAction } from "@/app/[locale]/admin/settings/emails/actions";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { formatAddressList } from "@/modules/contact/domain/recipients";
import type { ClubNoticesState } from "@/modules/notifications/club-notices";
import { mailboxesReceivingCopies, type DeclarationCopies } from "@/modules/notifications/domain/club-notices";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

type Props = {
  locale: Locale;
  notices: ClubNoticesState;
  declarations: DeclarationCopies;
  /** Who may change these lists (§291): the Administrator; `updateClubNotices` refuses anybody else. */
  mayEdit: boolean;
  /** Why the fold opens by itself, as the page knows it: this panel's save just landed (§336). */
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
 * Since §559 the one form holds three nested folds — the signed declarations, the confirmation
 * notice, the copy of the participants' emails — each with its list in force and its boxes, and
 * the one Save sits under them.
 *
 * **The warning above the Bcc box is not decoration.** A signed declaration carries the
 * participant's name, their signature and — masked in the club's copy since §320 — the identity
 * document they typed at signing. A Bcc delivers that to a
 * mailbox nobody on the message can see, which is exactly why somebody asks for it and exactly
 * why the person setting it should be looking at those words when they do.
 */
export default async function ClubNoticesPanel({ locale, notices, declarations, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  /*
    The mailboxes that receive anything from these lists, for the closed fold's summary (§336).
    The declaration's Cc and Bcc count only while it has a "to": the alert below says of idle
    ones that none is sent, and the summary must not say they receive copies.
  */
  const mailboxes = mailboxesReceivingCopies(declarations, notices);
  /*
    The declaration's Cc and Bcc are kept while nothing sends them: a copy needs an address it is
    *for* (§244, `resolveDeclarationCopies`), and "Nicio adresă" alone read as a Bcc that had not
    saved (§457). Said in words next to the lists, with the addresses.
  */
  const idleDeclarationCopies = declarations.to === null && declarations.cc.length + declarations.bcc.length > 0;
  // A list box grows with what it holds, so every address typed into it is in view (§457).
  const listBox = { multiline: true, minRows: 1, maxRows: 6 } as const;
  // A fold's closed line names its mailboxes, as the card's own line does (§457), or «—» for none.
  const namesOf = (addresses: readonly string[]) =>
    t("emails.clubNotices.folds.addresses", { addresses: formatAddressList(addresses) || "—" });
  const declarationsAside =
    declarations.to === null
      ? t("emails.clubNotices.folds.declarations.asideNone")
      : declarations.cc.length + declarations.bcc.length === 0
        ? t("emails.clubNotices.folds.declarations.asideNoCopies", { to: declarations.to })
        : t("emails.clubNotices.folds.declarations.aside", { to: declarations.to, cc: declarations.cc.length, bcc: declarations.bcc.length });
  /*
    The three folds inside the card (§559; the owner, 2026-09-29, on the one long form: «și aici
    trebuie să fie mai multe acordeoane nested»): one per thing the club sends itself, each closed
    with its summary line (§336). They open for the card's own save — the one Save stores all three
    lists, so each shows its result. A refusal is not a page parameter here: the action returns it
    as the kept form's state (§315) and never redirects with `?error=`, so the page has nothing to
    pass; `ActionFormIsland` opens the fold around each box the refusal names (`revealField` →
    `openFoldsAround`) and with JavaScript off `BOXED_DISCLOSURE_SX` shows it. The idle declaration
    copies are something to act on, so that fold opens for them too.
  */
  const saved = Boolean(openWhen?.saved);

  const declarationsFold = (
    <Panel glyph="declaration"
      level={3}
      title={t("emails.clubNotices.folds.declarations.title")}
      aside={declarationsAside}
      collapsible
      openWhen={{ saved, attention: idleDeclarationCopies }}
      id="club-notices-declarations"
      data-testid="club-notices-declarations"
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.clubNotices.source.${declarations.source}`, {
          to: declarations.to ?? "—",
          cc: formatAddressList(declarations.cc) || "—",
          bcc: formatAddressList(declarations.bcc) || "—",
        })}
      </Typography>
      {idleDeclarationCopies && (
        <Alert severity="warning" sx={{ py: 0.5, mt: 0.5 }} data-testid="club-notices-idle-copies">
          {t("emails.clubNotices.declarationCopiesIdle", {
            cc: formatAddressList(declarations.cc) || "—",
            bcc: formatAddressList(declarations.bcc) || "—",
          })}
        </Alert>
      )}
      {mayEdit && (
        <Stack spacing={1.5} sx={{ maxWidth: 560, mt: 1.5 }}>
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
            {...listBox}
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
            {...listBox}
            label={t("emails.clubNotices.declarationsBcc")}
            defaultValue={formatAddressList(notices.declarations.bcc)}
            size="small"
            helperText={t("emails.clubNotices.declarationsBccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
        </Stack>
      )}
    </Panel>
  );

  const confirmationsFold = (
    <Panel glyph="confirmation"
      level={3}
      title={t("emails.clubNotices.folds.confirmations.title")}
      aside={namesOf(notices.confirmations.to)}
      collapsible
      openWhen={{ saved }}
      id="club-notices-confirmations"
      data-testid="club-notices-confirmations"
    >
      {/* Every list in force is named, the confirmation notices too, so nothing saved is only in a box (§457). */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t("emails.clubNotices.confirmationsInForce", {
          to: formatAddressList(notices.confirmations.to) || "—",
        })}
      </Typography>
      {mayEdit && (
        <Stack spacing={1.5} sx={{ maxWidth: 560, mt: 1.5 }}>
          <RecallField
            name="confirmationsTo"
            {...listBox}
            label={t("emails.clubNotices.confirmationsTo")}
            defaultValue={formatAddressList(notices.confirmations.to)}
            size="small"
            helperText={t("emails.clubNotices.confirmationsToHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
        </Stack>
      )}
    </Panel>
  );

  const participantsFold = (
    <Panel glyph="copy"
      level={3}
      title={t("emails.clubNotices.folds.participants.title")}
      aside={namesOf(notices.participants.bcc)}
      collapsible
      openWhen={{ saved }}
      id="club-notices-participants"
      data-testid="club-notices-participants"
    >
      {/* The hidden copies of every participant message, named in force like the lists above (2026-09-22). */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t("emails.clubNotices.participantsInForce", {
          bcc: formatAddressList(notices.participants.bcc) || "—",
        })}
      </Typography>
      {mayEdit && (
        <Stack spacing={1.5} sx={{ maxWidth: 560, mt: 1.5 }}>
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
            {...listBox}
            label={t("emails.clubNotices.participantsBcc")}
            defaultValue={formatAddressList(notices.participants.bcc)}
            size="small"
            helperText={t("emails.clubNotices.participantsBccHelp")}
            helpMore={t("emails.clubNotices.participantsBccHelpMore")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
        </Stack>
      )}
    </Panel>
  );

  return (
    <Panel glyph="notices"
      title={t("emails.clubNotices.title")}
      intro={t("emails.clubNotices.intro")}
      /*
        The closed fold names the mailboxes, not only how many (§457; the owner: "trebuie să pot
        vedea pe cine am pus în BCC"): the club's own addresses, read by the roles this panel is
        drawn for (`maySeeQueue`), so the summary may carry them.
      */
      aside={
        mailboxes.length > 0
          ? t("emails.clubNotices.asideNames", { count: mailboxes.length, addresses: formatAddressList(mailboxes) })
          : t("emails.clubNotices.aside", { count: 0 })
      }
      collapsible
      openWhen={openWhen}
      id="club-notices"
      data-testid="club-notices"
    >
      {notices.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.clubNotices.updatedAt", {
            when: formatDay(notices.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {declarationsFold}
          {confirmationsFold}
          {participantsFold}
          <Typography variant="body2" color="text.secondary">
            {t("emails.clubNotices.readOnly")}
          </Typography>
        </Stack>
      ) : (
      <Box sx={{ mt: 1 }}>
      {/* A refused list comes back as typed (§315). One form around the three folds, one Save under them. */}
      <ActionForm
        action={updateClubNoticesAction}
        // Who receives the signed declarations and the confirmations, with their personal data (§384).
        confirm={{ title: t("confirm.clubNoticesTitle"), body: t("confirm.clubNoticesBody"), confirmLabel: t("emails.clubNotices.save"), cancelLabel: words.cancel }}
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
        <Stack spacing={1}>
          {declarationsFold}
          {confirmationsFold}
          {participantsFold}
          <Box sx={{ pt: 0.5 }}>
            <GlyphSubmitButton label={t("emails.clubNotices.save")} pendingLabel={t("emails.clubNotices.saving")} icon="save" />
          </Box>
        </Stack>
      </ActionForm>
      </Box>
      )}
    </Panel>
  );
}
