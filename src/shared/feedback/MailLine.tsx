import MailOutlinedIcon from "@mui/icons-material/MailOutlined";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { SEND_EMAIL_FIELD } from "@/shared/forms/send-email";
import CheckboxField from "@/shared/ui/CheckboxField";

/**
 * The email a press sends, said beside its button instead of in a dialog (the design «telling the owner about every
 * email a staff press sends», slice 3): for the presses that come quickly one after another or sit inside a
 * data-entry form — a volunteer's role buttons, «Adaugă voluntarul» and «Salvează» on a volunteer, the test
 * registrations, the typed-name erase, the event editor's boxes whose change sends at the next pass. A question before
 * each of those would double the taps; a line read before the press costs none.
 *
 * Not a second mechanism: the words are the dialogs' (`Admin.mailLine`, beside `Admin.confirm.mail`), named by the page
 * from the same facts — the person, the address, the email by its name in «Emailuri» — and the toast after the press
 * says what really left. A mail glyph and the sentence, then any quieter lines; a Server Component, nothing to run.
 *
 * **«Trimite emailul»** (`optOut`, slice 4): the box the dialogs draw, here in the form itself — ticked as drawn, posted
 * `on` while ticked, and followed by a hidden `off` under the same name so an unticked box still says so
 * (`shared/forms/send-email.ts#sendEmailOf`). Drawn inside the form it belongs to: a line beside a row of buttons is
 * inside their one form (the volunteer's roles), never tied to it from outside.
 */
export default function MailLine({
  text,
  also,
  optOut,
  "data-testid": testId = "mail-line",
}: {
  text: string;
  also?: readonly string[];
  /** The box's words, and its field when not `sendEmail` (the editor's window: `sendEmail.window`). */
  optOut?: { label: string; field?: string };
  "data-testid"?: string;
}) {
  const field = optOut?.field ?? SEND_EMAIL_FIELD;
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, maxWidth: 640 }} data-testid={testId}>
      <MailOutlinedIcon aria-hidden fontSize="small" sx={{ mt: 0.25, color: "text.secondary", flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          {text}
        </Typography>
        {also?.map((line) => (
          <Typography key={line} variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
            {line}
          </Typography>
        ))}
        {optOut && (
          <Box data-testid={`${testId}-send-email`}>
            {/* The box first, then its hidden `off`: the form's first value of the field is `on` exactly while it is ticked. */}
            <CheckboxField name={field} value="on" defaultChecked>
              {optOut.label}
            </CheckboxField>
            <input type="hidden" name={field} value="off" />
          </Box>
        )}
      </Box>
    </Box>
  );
}
