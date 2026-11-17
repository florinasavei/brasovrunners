import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import type { EmailOutcome } from "@/modules/notifications/domain/email-outcome";
import type { EmailSummary } from "@/modules/notifications/email-summaries";
import { emailTypeName, type T } from "@/modules/notifications/ui/EmailJournal";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  /** The person's emails in short (`email-summaries.ts`); undefined for a row the reader was not asked about — nothing is drawn. */
  summary: EmailSummary | undefined;
  /** The person's own «Emailuri» (`#emailuri` on the volunteer's page and on the registration's), where every email is. */
  href: string;
  /** Whose emails these are, for the link's accessible name. */
  personName: string;
  locale: Locale;
  /** The list page's own translator, `getTranslations("Admin")`: a page of a hundred rows asks for it once. */
  t: T;
};

/**
 * A cell of a few lines, on the wide table and on a phone's card. On the wide table it stands on a floor of sixteen rem
 * (§943's lesson: a full table squeezes a column of wrapping words to its heading, a word to a line), where an email
 * takes about two lines. A lower floor was measured and buys nothing on a real list (§960): with a race's usual states
 * the list's other columns leave less room on the owner's 1858-px screen than this one's heading needs, so it would
 * only make each email three lines and the row taller. The cap, twenty-eight rem, is never reached: on the backoffice's
 * widest frame (1990 px) the column measured 307 px, an email still two lines. A phone's card keeps its own width. An
 * email wraps to two lines or more on both, so six pixels stand between two of them — two pixels left a phone's
 * right-aligned lines reading as one block. `overflow-wrap`, not `word-break`: only a word too long for the line breaks
 * inside.
 */
const CELL_SX = {
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
  minWidth: { xs: 0, md: "16rem" },
  maxWidth: { md: "28rem" },
  overflowWrap: "break-word",
} as const;

/**
 * The ink of each outcome — the colour of the fold's own chip for it (`EmailJournal.tsx#DepartedChip`, the fold's
 * «Așteaptă»), as a quiet word rather than a chip a line tall: green for what left, amber for a refusal, red for a
 * failure, grey for what waits or reached nobody. The word says the outcome; the colour only repeats it.
 */
const OUTCOME_INK: Record<EmailOutcome, string> = {
  waiting: "text.secondary",
  sent: "success.main",
  delivered: "success.main",
  rejected: "warning.dark",
  failed: "error.main",
  captured: "text.secondary",
};

/** Each outcome in the fold's own words (`Admin.emails.history.last`): the closed line's states, and its two bare ones. */
function outcomeWords(outcome: EmailOutcome, t: T): string {
  switch (outcome) {
    case "waiting":
      return t("emails.history.last.waiting");
    case "sent":
      return t("emails.history.last.sent");
    case "delivered":
      return t("emails.history.last.delivered");
    case "rejected":
      return t("emails.history.last.refused");
    case "failed":
      return t("emails.history.last.failed");
    case "captured":
      return t("emails.history.last.captured");
  }
}

/**
 * A row's «Emailuri» cell on the «Voluntari» and registrations lists (§960; the owner, 2026-11-17: «Vreau sa vad mai
 * clar ce mailuri a primit fiecare om»): the person's three newest emails, one to a line — «{the email's name} ·
 * {when} · {what became of it}» — and under them, when there are more, «și încă N emailuri», the link to the person's
 * own «Emailuri», where every email stands with its tries and who caused it (§915). A person with no email says
 * «niciun email», in grey: an answer, not an absence.
 *
 * The name is the catalogue's (`emailTypeName`: «Punctul tău de voluntar», never a type's token); the moment is when
 * the email left or, while it has not, when it was queued, in the lists' own short form on the club's clock; the
 * outcome is the fold's own judgement (`domain/email-outcome.ts`) in the fold's own words, coloured as its chip is.
 *
 * A Server Component with nothing to hydrate: plain text, and one plain anchor a thumb reaches — 44 pixels tall
 * above its words (`INLINE_TAP_TARGET`), over the three lines that are always above it when it is drawn. Drawn only
 * for the Administrator and the Superadministrator: the pages add the column for them alone, and the reader refuses
 * anybody else (BR-REQ-060-01).
 */
export default function EmailSummaryCell({ summary, href, personName, locale, t }: Props) {
  if (!summary) return null;
  if (summary.total === 0 || summary.lines.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="email-summary-none">
        {t("emails.history.summaryNone")}
      </Typography>
    );
  }
  const typeName = emailTypeName(t);
  const more = summary.total - summary.lines.length;
  const moreWords = more > 0 ? t(`emails.summary.more.${countForm(more, locale)}`, { count: more }) : null;
  return (
    <Box sx={CELL_SX} data-testid="email-summary" data-total={summary.total}>
      {summary.lines.map((line) => (
        <Typography key={line.id} variant="body2" component="div" data-testid="email-summary-line" data-type={line.messageType} data-outcome={line.outcome}>
          {typeName(line.messageType)}
          <Box component="span" sx={{ color: "text.secondary" }}>
            {` · ${formatDay(line.at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "continues" })} · `}
          </Box>
          <Box component="span" sx={{ color: OUTCOME_INK[line.outcome], fontWeight: 500 }} data-testid="email-summary-outcome">
            {outcomeWords(line.outcome, t)}
          </Box>
        </Typography>
      ))}
      {moreWords && (
        <Typography variant="body2" component="div">
          {/* The accessible name begins with the words the link shows (WCAG 2.5.3) and ends with whose emails they are. */}
          <MuiLink href={href} aria-label={`${moreWords}: ${personName}`} sx={INLINE_TAP_TARGET} data-testid="email-summary-more">
            {moreWords}
          </MuiLink>
        </Typography>
      )}
    </Box>
  );
}
