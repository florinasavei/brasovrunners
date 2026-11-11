import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { countForm } from "@/i18n/count-form";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { type DepartureContext, departureOf } from "@/modules/notifications/domain/departure";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { isJobCause } from "@/modules/notifications/domain/press-causes";
import { isRelayMessage } from "@/modules/notifications/domain/relay";
import {
  type EmailJournal as Journal,
  type JournalClubLine,
  type JournalLine,
  type JournalPersonLink,
  type JournalPress,
  REPEATED_TODAY,
  SAME_EMAIL_REPEATED,
} from "@/modules/notifications/journal";
import { departureWords } from "@/modules/notifications/ui/departure-words";
import type { EmailVolumeToday } from "@/modules/notifications/volume";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import Panel from "@/shared/ui/Panel";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";
import { ROW_SX } from "@/shared/ui/row-fold";
import StatusChip from "@/shared/ui/StatusChip";
import { INLINE_TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  locale: Locale;
  journal: Journal;
  /** The day's Mailgun count, said under the totals as the registrations list's outbox panel says it (`outbox.status.*`). */
  volume: EmailVolumeToday;
  /** The judgement every waiting row is read with — the queue panel's own (`departure-words.ts`). */
  departure: DepartureContext;
  now: Date;
};

/** More lines of one type than this, in one press, fold behind one summary line. */
const LINES_BEFORE_FOLD = 5;

/*
  The folds' pictures (§521: a glyph on every fold header), by name from the cards' table, drawn here on the
  server inside the summary — never handed to a client island as a prop (`action-icons.ts`).
*/
const PeopleIcon = PANEL_GLYPHS.startList;
const ClubMailboxIcon = PANEL_GLYPHS.contacts;

export type T = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** An email's name on the backoffice: a visitor's message by the relay's words, any other by `emails.types`. */
export function emailTypeName(t: T): (type: EmailMessageType) => string {
  return (type) => (isRelayMessage(type) ? t(`emails.relay.type.${type}`) : t(`emails.types.${type}`));
}

/** The person's own page in the backoffice (§915): their registration's, or the volunteer's. */
function personHref(person: JournalPersonLink, locale: Locale): string {
  return person.kind === "registration"
    ? getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: person.id } } })
    : getPathname({ locale, href: { pathname: "/admin/volunteers/[id]", params: { id: person.id } } });
}

/**
 * «Emailuri azi» (the design «telling the owner about every email a staff press sends», slice 1, its section 5): the
 * day's emails with the person's name and address, one row per press — what waits now, then what left today —
 * and, on top, who got the same email more than once. Read by `journal.ts#readEmailJournal`.
 *
 * A Server Component; rows are stacked, never a table, so a line fits 320 pixels (the queue panel's reasoning,
 * §196). The waiting rows say when they leave in the queue's own words, from the same judgement
 * (`domain/departure.ts`), so the two screens never give one row two times. A test registration's row is marked
 * and counted nowhere (§12.6). The club's own mailboxes fold under the message they copy, or under their press.
 */
export default async function EmailJournal({ locale, journal, volume, departure, now }: Props) {
  const t = await getTranslations("Admin");
  const typeName = emailTypeName(t);
  const allowance = t(`outbox.status.${volume.period}`, {
    waiting: volume.waitingMessages,
    sent: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
    allowance: volume.allowance ?? "",
    remaining: volume.remaining ?? "",
    plan: volume.planName,
  });

  return (
    <Stack spacing={3} data-testid="email-journal">
      <Panel glyph="history" title={t("emails.today.title")} intro={t("emails.today.intro")} id="emails-today" data-testid="email-journal-summary">
        <Typography variant="body1" sx={{ fontWeight: 600 }} data-testid="email-journal-counts">
          {t("emails.today.counts", journal.counts)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: journal.repeats.length > 0 ? 1.5 : 0 }}>
          {allowance}
        </Typography>
        {journal.repeats.length > 0 && (
          /* The "am I sending too much" signal (Critic correction 5): the same email to one person twice or more today. */
          <Alert severity="warning" data-testid="email-journal-repeats">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t("emails.today.repeatsTitle")}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {journal.repeats.map((repeat) => (
                <Typography component="li" variant="body2" key={`${repeat.recipientEmail} ${repeat.messageType}`} sx={{ wordBreak: "break-word" }}>
                  {t("emails.today.repeat", {
                    who: repeat.personName ? `${repeat.personName} · ${repeat.recipientEmail}` : repeat.recipientEmail,
                    type: typeName(repeat.messageType),
                    times: t(`emails.today.times.${countForm(repeat.count, locale)}`, { count: repeat.count }),
                  })}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}
      </Panel>

      <Panel glyph="outbox" title={t("emails.today.waitingTitle")} aside={linesWords(journal.waiting, t, locale)} id="emails-today-waiting" data-testid="email-journal-waiting">
        {journal.waiting.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("emails.today.waitingNone")}
          </Typography>
        ) : (
          <PressList presses={journal.waiting} t={t} typeName={typeName} locale={locale} now={now} departure={departure} />
        )}
      </Panel>

      <Panel glyph="email" title={t("emails.today.departedTitle")} aside={linesWords(journal.departed, t, locale)} id="emails-today-departed" data-testid="email-journal-departed">
        {journal.departed.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("emails.today.departedNone")}
          </Typography>
        ) : (
          <PressList presses={journal.departed} t={t} typeName={typeName} locale={locale} now={now} departure={departure} />
        )}
        {journal.more > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-testid="email-journal-more">
            {t("emails.today.more", { count: journal.more })}
          </Typography>
        )}
      </Panel>

      <Typography variant="body2" color="text.secondary" data-testid="email-journal-footnote">
        {t("emails.today.footnote")}
      </Typography>
    </Stack>
  );
}

/** How many emails a section holds — every line, the club's included — in the counted noun's own form. */
function linesWords(presses: readonly JournalPress[], t: T, locale: Locale): string {
  const count = presses.reduce((sum, press) => sum + press.lines.length + press.club.length + press.lines.reduce((copies, line) => copies + line.copies.length, 0), 0);
  return t(`emails.today.lines.${countForm(count, locale)}`, { count });
}

/** «A plecat la 10:15» today, «A plecat joi, 2 oct. 2026, la 10:15» on another day (`emailLeavesWords`, §452). */
function sentWords(at: Date, t: T, locale: Locale, now: Date): string {
  const words = emailLeavesWords(at, now, locale);
  return words.key === "leavesToday" ? t("emails.today.status.sentToday", { at: words.at }) : t("emails.today.status.sentOn", { at: words.at });
}

type ListProps = {
  presses: readonly JournalPress[];
  t: T;
  typeName: (type: EmailMessageType) => string;
  locale: Locale;
  now: Date;
  departure: DepartureContext;
};

/** One row per press: its moment, its cause and who pressed, then its lines. */
function PressList({ presses, t, typeName, locale, now, departure }: ListProps) {
  return (
    <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
      {presses.map((press) => (
        // A row of the list, a hairline between rows (`row-fold.ts`, §842): calm, never a bordered card.
        <Box component="li" key={press.key} sx={{ ...ROW_SX, py: 1.5 }} data-testid="email-journal-press" data-cause={press.cause ?? "site"}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }} data-testid="email-journal-press-head">
            {pressHeading(press, t, locale, now)}
          </Typography>
          <Stack spacing={1}>
            {linesByType(press.lines).map(({ type, lines }) =>
              lines.length > LINES_BEFORE_FOLD ? (
                // Many people, one email (a newsletter, a bulk cancel): one line that says how many, the names behind it.
                <Box component="details" key={type} sx={BOXED_DISCLOSURE_SX} data-testid="email-journal-fold">
                  <Box component="summary">
                    <PeopleIcon fontSize="small" aria-hidden />
                    <Typography component="span" variant="body2">
                      {t("emails.today.toMany", { type: typeName(type), people: t(`emails.today.people.${countForm(lines.length, locale)}`, { count: lines.length }) })}
                    </Typography>
                  </Box>
                  {/* The first name link reaches 24 pixels up (`INLINE_TAP_TARGET`): its bar's margin and this padding keep that free. */}
                  <Stack spacing={1} sx={{ pl: 2, pt: 1.5 }}>
                    {lines.map((line) => (
                      <Line key={line.id} line={line} t={t} typeName={typeName} locale={locale} now={now} departure={departure} />
                    ))}
                  </Stack>
                </Box>
              ) : (
                lines.map((line) => <Line key={line.id} line={line} t={t} typeName={typeName} locale={locale} now={now} departure={departure} />)
              ),
            )}
            {press.club.length > 0 && <ClubFold rows={press.club} t={t} typeName={typeName} locale={locale} now={now} />}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

/** «10:02 · Anulează înscrierea · de Ana Pop», «10:15 · automat: …», «De pe site». */
function pressHeading(press: JournalPress, t: T, locale: Locale, now: Date): string {
  if (press.key === "site") return t("emails.today.press.site");
  const at = emailLeavesWords(press.at, now, locale).at;
  if (!press.cause) return press.by ? t("emails.today.press.byOnly", { at, by: press.by }) : t("emails.today.press.site");
  const cause = t(`emails.causes.${press.cause}`);
  if (isJobCause(press.cause)) return t("emails.today.press.job", { at, cause });
  return press.by ? t("emails.today.press.by", { at, cause, by: press.by }) : t("emails.today.press.cause", { at, cause });
}

/** A press's lines by type, in the order each type first appears. */
function linesByType(lines: readonly JournalLine[]): Array<{ type: EmailMessageType; lines: JournalLine[] }> {
  const groups = new Map<EmailMessageType, JournalLine[]>();
  for (const line of lines) groups.set(line.messageType, [...(groups.get(line.messageType) ?? []), line]);
  return [...groups.entries()].map(([type, grouped]) => ({ type, lines: grouped }));
}

type LineProps = { line: JournalLine; t: T; typeName: (type: EmailMessageType) => string; locale: Locale; now: Date; departure: DepartureContext };

/** «Ana Pop · ana@…» — „Înscriere anulată” — its state, and the copies the club got of it. */
function Line({ line, t, typeName, locale, now, departure }: LineProps) {
  const waiting = line.status === "PENDING" || line.status === "PROCESSING";
  const leaves = waiting ? departureWords(departureOf(line.departure, departure), { now, locale, mayEdit: true, t: (key, values) => t(key, values) }) : null;
  return (
    <Box data-testid="email-journal-line" data-type={line.messageType} data-status={line.status} {...(line.test ? { "data-test-row": "true" } : {})}>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
        {line.personName ? (
          <>
            {line.person ? (
              /* The person's own page (§915): a plain anchor a thumb reaches, 44 tall above its words so the line keeps its height (§480). */
              <MuiLink href={personHref(line.person, locale)} sx={{ ...INLINE_TAP_TARGET, fontWeight: 600 }} data-testid="email-journal-person">
                {line.personName}
              </MuiLink>
            ) : (
              <Box component="span" sx={{ fontWeight: 600 }}>
                {line.personName}
              </Box>
            )}
            {` · ${line.recipientEmail}`}
          </>
        ) : (
          line.recipientEmail
        )}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {line.eventTitle ? t("emails.today.typeAt", { type: typeName(line.messageType), event: line.eventTitle }) : t("emails.today.type", { type: typeName(line.messageType) })}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5, alignItems: "center" }}>
        {!waiting && <DepartedChip line={line} t={t} locale={locale} now={now} />}
        {line.test && <StatusChip glyph="test" label={t("emails.today.test")} testId="email-journal-test" />}
        {line.sameTypeCount >= SAME_EMAIL_REPEATED && (
          <StatusChip glyph="series" color="warning" label={t(`emails.today.times.${countForm(line.sameTypeCount, locale)}`, { count: line.sameTypeCount })} testId="email-journal-same" />
        )}
        {line.dayCount >= REPEATED_TODAY && (
          <StatusChip glyph="experience" variant="outlined" label={t(`emails.today.dayCount.${countForm(line.dayCount, locale)}`, { count: line.dayCount })} testId="email-journal-day-count" />
        )}
      </Stack>
      {leaves && (
        <Typography variant="caption" component="p" color={leaves.late ? "error" : "text.primary"} sx={{ fontWeight: 500, mt: 0.5 }} data-testid="email-journal-leaves">
          {leaves.text}
        </Typography>
      )}
      {line.lastError && (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }}>
          {t("emails.queue.lastError", { error: line.lastError })}
        </Typography>
      )}
      {line.copies.length > 0 && <ClubFold rows={line.copies} t={t} typeName={typeName} locale={locale} now={now} />}
    </Box>
  );
}

/**
 * What became of a row that is no longer waiting: left at an hour, reached nobody (QA), failed, refused. A person's
 * «Emailuri» draws the same chip (`EmailHistory.tsx`, §915).
 */
export function DepartedChip({ line, t, locale, now }: { line: Pick<JournalLine, "status" | "recipientCount" | "sentAt" | "createdAt">; t: T; locale: Locale; now: Date }) {
  if (line.status === "FAILED") return <StatusChip glyph="failed" color="error" label={t("emails.today.status.failed")} testId="email-journal-status" />;
  if (line.status === "BOUNCED" || line.status === "COMPLAINED") return <StatusChip glyph="failed" color="warning" label={t("emails.today.status.refused")} testId="email-journal-status" />;
  if (line.recipientCount === 0) return <StatusChip glyph="hidden" label={t("emails.today.status.captured")} testId="email-journal-status" />;
  // A SENT row always has its `sent_at` (the table's CHECK); the creation stands in only for the type's sake.
  return <StatusChip glyph="done" color="success" label={sentWords(line.sentAt ?? line.createdAt, t, locale, now)} testId="email-journal-status" />;
}

/** «+ 2 pentru căsuțele clubului», closed: the addresses, the type and the state behind it. A person's «Emailuri» folds its club rows the same way. */
export function ClubFold({ rows, t, typeName, locale, now }: { rows: readonly JournalClubLine[]; t: T; typeName: (type: EmailMessageType) => string; locale: Locale; now: Date }) {
  return (
    // Positioned, so its bar keeps its own presses when the next line's name link reaches up over it (`INLINE_TAP_TARGET`, §366).
    <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 0.5, position: "relative" }} data-testid="email-journal-club">
      <Box component="summary">
        <ClubMailboxIcon fontSize="small" aria-hidden />
        <Typography component="span" variant="caption" color="text.secondary">
          {t("emails.today.club", { count: rows.length })}
        </Typography>
      </Box>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {rows.map((row) => (
          <Typography component="li" variant="caption" color="text.secondary" key={row.id} sx={{ wordBreak: "break-word" }}>
            {t("emails.today.clubLine", {
              address: row.recipientEmail,
              type: typeName(row.messageType),
              state:
                row.status === "SENT" && row.sentAt
                  ? sentWords(row.sentAt, t, locale, now)
                  : row.status === "PENDING" || row.status === "PROCESSING"
                    ? t("emails.today.status.waiting")
                    : row.status === "FAILED"
                      ? t("emails.today.status.failed")
                      : t("emails.today.status.refused"),
            })}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
