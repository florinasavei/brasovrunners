import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { getTranslations } from "next-intl/server";
import { updateContactRecipientsAction } from "@/app/[locale]/admin/pages/contact/actions";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { formatAddressList, type ResolvedContactRecipients } from "@/modules/contact/domain/recipients";
import type { ContactRecipientsState } from "@/modules/contact/recipients";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import CheckboxField from "@/shared/ui/CheckboxField";
import { countForm } from "@/i18n/count-form";
import { getPathname } from "@/i18n/navigation";
import type { FeedbackRoads, FeedbackVia } from "@/modules/feedback/domain/branches";
import RoadChoice, { roadWords } from "@/modules/feedback/ui/RoadChoice";

type Props = {
  locale: Locale;
  recipients: ContactRecipientsState;
  resolved: ResolvedContactRecipients;
  /**
   * Who may change the list (§291). Everybody who opens the page reads where messages go; only
   * the Administrator writes it, and `updateContactRecipients` refuses anybody else — the owner:
   * "organizatorul nu ar trebui sa poata edita cine primeste mesajele CC si BCC".
   */
  mayEdit: boolean;
  /** Messages the tick held back in the last 30 days (§744 (amends §310)): a count, never a message. */
  heldBack: number;
  /** The road «Scrie-ne» leaves by now: the saved choice, else the default (`contactViaFor`, §NNN). */
  via: FeedbackVia;
  /** Which roads this deployment has (`feedbackRoads`): one it lacks is greyed, with the steps that give it. */
  roads: FeedbackRoads;
  /** Why the fold opens by itself, as the page knows it: this panel's save just landed (§336). */
  openWhen?: FoldOpenWhen;
};

/**
 * Who reads what "Scrie-ne" sends (`DECISIONS.md` §164; the owner: "I wanna allow CC on the
 * contact form so that [the Administrator] can receive emails… configurable in the app").
 *
 * The email plan's own shape (§100): a Server Component with one form, two ordinary text
 * boxes and a Save. No JavaScript decides anything; the service validates each address and
 * writes the audit row. The account the message *leaves* from is not here and never will be —
 * a Gmail app password belongs in the environment, not in a table the backoffice can read
 * (AGENTS.md §14.5) — so the panel names the two variables and shows neither's value.
 */
export default async function ContactRecipientsPanel({ locale, recipients, resolved, mayEdit, heldBack, via, roads, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const tasksPath = getPathname({ locale, href: "/admin/tasks" });
  const legalPath = getPathname({ locale, href: "/admin/legal" });

  /*
    Closed by default (§336; the owner, 2026-09-23: "'Cine primește mesajele de contact' should
    be closed by default"), with where the messages go right now in the summary — the one thing
    anybody opens this panel to check. Since §559 the summary counts the CC and BCC in force too
    (the owner, 2026-09-29: «trebuie să am o setare de CC și BCC și pentru mailurile trimise de pe
    pagina de contact» — the setting existed since §164 and nobody could tell from the card).
  */
  // The 30-day count sits beside the tick: shown when the tick is on or a message was ever stopped.
  const heldBackCount =
    recipients.holdBackSuspected || heldBack > 0 ? (
      <Typography variant="body2" color="text.secondary" data-testid="contact-held-back">
        {t(`emails.contacts.heldBack.${countForm(heldBack, locale)}`, { count: heldBack })}
      </Typography>
    ) : null;
  const listBox = { multiline: true, minRows: 1, maxRows: 6 } as const;
  return (
    <Panel glyph="contacts"
      title={t("emails.contacts.title")}
      intro={t("emails.contacts.intro")}
      aside={
        // Counted, not named: the summary is one line at 360 px (§336); the lists are in the
        // sentence inside. No copies at all reads «fără copii», never two zeros (§559).
        resolved.cc.length + resolved.bcc.length === 0
          ? t("emails.contacts.asideNoCopies", { to: formatAddressList(resolved.to) || t("emails.contacts.asideNobody") })
          : t("emails.contacts.aside", {
              to: formatAddressList(resolved.to) || t("emails.contacts.asideNobody"),
              cc: resolved.cc.length,
              bcc: resolved.bcc.length,
            })
      }
      collapsible
      openWhen={openWhen}
      id="contact-recipients"
      data-testid="contact-recipients"
    >

      {/* Where the list in force comes from, so "I saved it and nothing changed" cannot happen. */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.contacts.source.${resolved.source}`, {
          to: formatAddressList(resolved.to) || "—",
          cc: formatAddressList(resolved.cc) || "—",
          // Named, not counted: this is the backoffice, and the Administrator who set the hidden
          // copies is the one reading them back. Hidden from the message, never from the club.
          bcc: formatAddressList(resolved.bcc) || "—",
        })}
      </Typography>
      {recipients.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.contacts.updatedAt", {
            when: formatDay(recipients.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t("emails.contacts.readOnly")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="contact-hold-back-state">
            {t(recipients.holdBackSuspected ? "emails.contacts.holdBackOn" : "emails.contacts.holdBackOff")}
          </Typography>
          {/* The road «Scrie-ne» leaves by, as the four forms' card says it (§NNN). */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="contact-via-state">
            {t("emails.feedbackForms.via.legend")}: {t(`emails.feedbackForms.via.state${via === "gmail" ? "Gmail" : "Mailgun"}`)}
          </Typography>
          {heldBackCount}
        </>
      ) : (
      <Box sx={{ mt: 1.5 }}>
      {/* A refused list comes back as typed, so one mistyped address is corrected, not retyped (§315). */}
      <ActionForm
        action={updateContactRecipientsAction}
        messages={await refusalMessages({ to: t("emails.contacts.to"), cc: t("emails.contacts.cc"), bcc: t("emails.contacts.bcc"), via: t("emails.feedbackForms.via.legend") })}
        // Three forms share /admin/emails; each summary and box id carries its own prefix (`fieldId`).
        confirm={{ title: t("confirm.contactRecipientsTitle"), body: t("confirm.contactRecipientsBody"), confirmLabel: t("emails.contacts.save"), cancelLabel: words.cancel }}
        scope="contacts"
        data-testid="contact-recipients-form"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
          {/*
            The three boxes grow with what they hold (§457's shape): one address per line is read
            as well as commas (`parseAddressList`), and every address typed stays in view. What CC
            and BCC mean is one sentence above them, and what happens to a repeat one below (§559).
          */}
          <Typography variant="body2" color="text.secondary" data-testid="contact-copies-help">
            {t("emails.contacts.copiesHelp")}
          </Typography>
          <RecallField
            name="to"
            label={t("emails.contacts.to")}
            defaultValue={formatAddressList(recipients.to)}
            size="small"
            {...listBox}
            helperText={t("emails.contacts.toHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <RecallField
            name="cc"
            label={t("emails.contacts.cc")}
            defaultValue={formatAddressList(recipients.cc)}
            size="small"
            {...listBox}
            helperText={t("emails.contacts.ccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <RecallField
            name="bcc"
            label={t("emails.contacts.bcc")}
            defaultValue={formatAddressList(recipients.bcc)}
            size="small"
            {...listBox}
            helperText={t("emails.contacts.bccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <Typography variant="caption" color="text.secondary">
            {t("emails.contacts.repeats")}
          </Typography>
          {/* «Prin ce trimitem» (§772, §NNN): the pair the four forms' card draws (`RoadChoice`), Mailgun recommended; the default of a form with no saved road. */}
          <RoadChoice
            name="via"
            testId="contact-via"
            current={via}
            words={roadWords((key) => t(key as never))}
            blocked={{ gmail: roads.gmail ? null : "missing", mailgun: roads.mailgun ? null : "missing" }}
            tasksPath={tasksPath}
            legalPath={legalPath}
            gmailCopyCaption
          />
          <Typography variant="caption" color="text.secondary" data-testid="contact-via-why">
            {t("emails.feedbackForms.via.why")}
          </Typography>
          {/* §744 (amends §310): off by default; ticked, a «[posibil spam]» message is counted and not emailed. */}
          <CheckboxField name="holdBackSuspected" defaultChecked={recipients.holdBackSuspected} help={t("emails.contacts.holdBackHelp")}>
            {t("emails.contacts.holdBack")}
          </CheckboxField>
          {heldBackCount}
          <Box>
            <GlyphSubmitButton label={t("emails.contacts.save")} pendingLabel={t("emails.contacts.saving")} icon="save" />
          </Box>
        </Stack>
      </ActionForm>
      </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("emails.contacts.sender")}
      </Typography>
    </Panel>
  );
}
