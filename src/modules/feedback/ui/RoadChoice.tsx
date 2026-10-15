import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { FEEDBACK_VIAS, type FeedbackVia } from "@/modules/feedback/domain/branches";
import RadioField from "@/shared/ui/RadioField";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";

/** The words of the pair, read by the caller from `Admin.emails.feedbackForms.via` (so this stays a plain function, rendered in a test as it is on the page). */
export type RoadWords = {
  legend: string;
  gmail: string;
  mailgun: string;
  gmailHint: string;
  mailgunHint: string;
  gmailMissing: string;
  mailgunMissing: string;
  steps: string;
  gmailNotice: string;
  noticeSteps: string;
  gmailCopy: string;
};

/** The pair's words from the `Admin` translator, both cards alike: the keys are `emails.feedbackForms.via.*`. */
export function roadWords(t: (key: string) => string): RoadWords {
  const via = (key: keyof RoadWords) => t(`emails.feedbackForms.via.${key}`);
  return {
    legend: via("legend"),
    gmail: via("gmail"),
    mailgun: via("mailgun"),
    gmailHint: via("gmailHint"),
    mailgunHint: via("mailgunHint"),
    gmailMissing: via("gmailMissing"),
    mailgunMissing: via("mailgunMissing"),
    steps: via("steps"),
    gmailNotice: via("gmailNotice"),
    noticeSteps: via("noticeSteps"),
    gmailCopy: via("gmailCopy"),
  };
}

type Props = {
  /** The radios' name: `howItWentVia`, `via`. */
  name: string;
  /** The group's test id; each choice is `<testId>-<via>`, its missing-road note `<testId>-<via>-missing`. */
  testId: string;
  /** The road checked: the saved one, else the form's default (`defaultViaFor`). */
  current: FeedbackVia;
  /** Per road, why it cannot be newly chosen here: the deployment lacks it (`missing`), or the notice in force does not say so yet (`notice`, Girl Zone's Gmail). */
  blocked: Readonly<Record<FeedbackVia, "missing" | "notice" | null>>;
  words: RoadWords;
  /** Where the steps of each road are (the «Sarcini» row) and where the legal texts are, already localized. */
  tasksPath: string;
  legalPath: string;
  /** The quiet caption under a form left on Gmail (§NNN): a copy stays in the club's mailbox. Off for Girl Zone, whose own note says it. */
  gmailCopyCaption?: boolean;
  /** What follows the pair inside the same group (Girl Zone's note and her fallback tick). */
  children?: ReactNode;
};

/** Where the steps of each road are: the row of «Sarcini» that carries them (`contactForm`: the club's Gmail, `liveEmail`: Mailgun). */
const STEPS_ROW: Readonly<Record<FeedbackVia, string>> = { gmail: "task-contactForm", mailgun: "task-liveEmail" };

/**
 * «Prin ce trimitem» (§772, §NNN): the one pair of native radios — the club's Gmail or Mailgun, Mailgun marked «recomandat» —
 * that «Spune-ne ceva» draws under each of its four forms and «Scrie-ne» draws once (`ContactRecipientsPanel`), so the two cards
 * say the same words in the same way. A Server Component with no state; a road the deployment lacks is greyed, with a sentence and
 * a link to its steps, and stays checked when it is what was saved. Never a toggle: a choice is radios.
 */
export default function RoadChoice({ name, testId, current, blocked, words, tasksPath, legalPath, gmailCopyCaption = false, children }: Props) {
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, mt: 1.5, p: 0, minWidth: 0 }} data-testid={testId}>
      <Typography component="legend" variant="body2" sx={{ fontWeight: 600, p: 0 }} data-via-legend="">
        {words.legend}
      </Typography>
      {FEEDBACK_VIAS.map((via) => (
        <Box key={via} data-testid={`${testId}-${via}`}>
          <RadioField name={name} value={via} defaultChecked={current === via} disabled={blocked[via] !== null}>
            {words[via]}
          </RadioField>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6, mt: -0.5 }}>
            {words[`${via}Hint`]}
          </Typography>
          {blocked[via] === "missing" && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }} data-testid={`${testId}-${via}-missing`}>
              {words[`${via}Missing`]}{" "}
              <MuiLink href={`${tasksPath}#${STEPS_ROW[via]}`} sx={INLINE_TAP_TARGET}>
                {words.steps}
              </MuiLink>
            </Typography>
          )}
          {blocked[via] === "notice" && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }} data-testid={`${testId}-${via}-notice`}>
              {words.gmailNotice}{" "}
              <MuiLink href={legalPath} sx={INLINE_TAP_TARGET}>
                {words.noticeSteps}
              </MuiLink>
            </Typography>
          )}
        </Box>
      ))}
      {gmailCopyCaption && current === "gmail" && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid={`${testId}-gmail-copy`}>
          {words.gmailCopy}
        </Typography>
      )}
      {children}
    </Box>
  );
}
