import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { isJobCause } from "@/modules/notifications/domain/press-causes";
import type { EmailHistory, EmailHistoryRow } from "@/modules/notifications/email-history";
import { departureWords } from "@/modules/notifications/ui/departure-words";
import { ClubFold, DepartedChip, emailTypeName, type T } from "@/modules/notifications/ui/EmailJournal";
import Panel from "@/shared/ui/Panel";
import { ROW_SX } from "@/shared/ui/row-fold";
import StatusChip from "@/shared/ui/StatusChip";

type Props = {
  locale: Locale;
  history: EmailHistory;
  now: Date;
  /**
   * `person` — «Emailuri», the fold of its own (a volunteer's page); `tries` — «Încercări și cine le-a trimis», the fold
   * inside the registration's «Emailuri» card (§671), which already carries that name.
   */
  title: "person" | "tries";
  /** 3 for a card on the page, 4 for a fold inside one. */
  level: 3 | 4;
  id?: string;
  "data-testid"?: string;
};

const isWaiting = (row: Pick<EmailHistoryRow, "status">) => row.status === "PENDING" || row.status === "PROCESSING";

/**
 * A person's «Emailuri» (§NNN), read by `email-history.ts#readEmailHistory` — the Administrator's and the
 * Superadministrator's alone; a page draws it only for them, and the reader refuses anybody else.
 *
 * A closed fold whose line says how many and the latest — «4 emailuri · ultimul: „Confirmare înscriere” — a plecat la
 * 10:15» — and, inside, every email newest first, stacked so a row fits 320 pixels, never a table: its name, when it was
 * queued and by what (the journal's press words: the press and the colleague, «automat» for a job, «de pe site» for the
 * person's own form or link — only where that is known, «nu s-a notat cine l-a trimis» for a row queued before the outbox
 * recorded presses), the journal's state chip or the queue's departure words while it waits, «Retrimis
 * manual», the tries and the next one, what the provider said after it left, a FAILED row's sanitized reason, and the
 * club's copies folded under it. The journal's own pieces (`EmailJournal.tsx`), so the two screens say one thing.
 */
export default async function EmailHistoryPanel({ locale, history, now, title, level, id, "data-testid": testId }: Props) {
  const t = await getTranslations("Admin");
  const typeName = emailTypeName(t);
  return (
    <Panel
      glyph="email"
      level={level}
      collapsible
      title={t(title === "person" ? "emails.history.title" : "emails.history.titleTries")}
      aside={emailHistorySummary(history, t, locale, now)}
      id={id}
      data-testid={testId ?? "email-history"}
    >
      {history.rows.length === 0 && history.club.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("emails.history.none")}
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }} data-testid="email-history-rows">
          {history.rows.map((row) => (
            <HistoryRow key={row.id} row={row} t={t} typeName={typeName} locale={locale} now={now} />
          ))}
        </Box>
      )}
      {history.club.length > 0 && <ClubFold rows={history.club} t={t} typeName={typeName} locale={locale} now={now} />}
      {history.more > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-testid="email-history-more">
          {t("emails.today.more", { count: history.more })}
        </Typography>
      )}
    </Panel>
  );
}

/** The fold's closed line: «4 emailuri · ultimul: „Confirmare înscriere” — a plecat la 10:15», or «niciun email». */
export function emailHistorySummary(history: EmailHistory, t: T, locale: Locale, now: Date): string {
  const latest = history.rows[0];
  if (history.ownTotal === 0 || !latest) return t("emails.history.summaryNone");
  return t("emails.history.summary", {
    count: t(`emails.today.lines.${countForm(history.ownTotal, locale)}`, { count: history.ownTotal }),
    type: emailTypeName(t)(latest.messageType),
    state: latestState(latest, t, locale, now),
  });
}

/** The latest email's state in the summary's lower case: left at, waits, failed, refused, reached nobody. */
function latestState(row: EmailHistoryRow, t: T, locale: Locale, now: Date): string {
  if (isWaiting(row)) return t("emails.history.last.waiting");
  if (row.status === "FAILED") return t("emails.history.last.failed");
  if (row.status === "BOUNCED" || row.status === "COMPLAINED") return t("emails.history.last.refused");
  if (row.recipientCount === 0) return t("emails.history.last.captured");
  const words = emailLeavesWords(row.sentAt ?? row.createdAt, now, locale);
  return t(words.key === "leavesToday" ? "emails.history.last.sentToday" : "emails.history.last.sentOn", { at: words.at });
}

/**
 * «10:02 · Anulează înscrierea · de Ana Pop», «… · automat: întreținerea înscrierilor», «… · de pe site (persoana însăși)»
 * — the site only for a row known to be the person's own (`fromSite`), never for one queued before presses were
 * recorded, which says «… · nu s-a notat cine l-a trimis» (§NNN).
 */
function causeWords(row: EmailHistoryRow, t: T, locale: Locale, now: Date): string {
  const at = emailLeavesWords(row.createdAt, now, locale).at;
  if (row.cause) {
    const cause = t(`emails.causes.${row.cause}`);
    if (isJobCause(row.cause)) return t("emails.today.press.job", { at, cause });
    return row.by ? t("emails.today.press.by", { at, cause, by: row.by }) : t("emails.today.press.cause", { at, cause });
  }
  if (row.by) return t("emails.today.press.byOnly", { at, by: row.by });
  return t(row.fromSite ? "emails.history.site" : "emails.history.unrecorded", { at });
}

/** «3 încercări · următoarea: 10:30», «încă nu s-a încercat» while it waits untried; nothing for an untried row that never waited. */
function triesWords(row: EmailHistoryRow, t: T, locale: Locale, now: Date): string | null {
  if (row.attemptCount === 0) return isWaiting(row) ? t("emails.history.triesNone") : null;
  const tries = t(`emails.history.tries.${countForm(row.attemptCount, locale)}`, { count: row.attemptCount });
  return row.nextTryAt ? `${tries} · ${t("emails.history.nextTry", { at: emailLeavesWords(row.nextTryAt, now, locale).at })}` : tries;
}

/** What the provider said after it left, in the registration's «Emailuri» words (§671): delivered, refused and why, spam. */
function providerFacts(row: EmailHistoryRow, t: T, locale: Locale): string | null {
  const date = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", year: false, withTime: true, position: "continues" });
  if (row.status === "SENT" && row.deliveredAt) return t("registrations.emails.state.delivered", { date: date(row.deliveredAt) });
  const at = row.rejectedAt ?? row.sentAt ?? row.createdAt;
  if (row.status === "COMPLAINED") return t("registrations.emails.state.spam", { date: date(at) });
  if (row.status === "BOUNCED") return t("registrations.emails.state.refused", { date: date(at), label: t(`registrations.rejected.label.${row.rejectionCause ?? "other"}`) });
  return null;
}

type RowProps = { row: EmailHistoryRow; t: T; typeName: (type: EmailHistoryRow["messageType"]) => string; locale: Locale; now: Date };

/** One email, stacked: its name, its moment and cause, its state, its tries, what came after, its club copies. */
function HistoryRow({ row, t, typeName, locale, now }: RowProps) {
  const waiting = isWaiting(row);
  const leaves = waiting && row.departure ? departureWords(row.departure, { now, locale, mayEdit: true, t: (key, values) => t(key, values) }) : null;
  const tries = triesWords(row, t, locale, now);
  const facts = providerFacts(row, t, locale);
  return (
    // A row of the list, a hairline between rows (`row-fold.ts`, §842), as «Emailuri azi» draws its presses.
    <Box
      component="li"
      sx={{ ...ROW_SX, py: 1.25 }}
      data-testid="email-history-row"
      data-type={row.messageType}
      data-status={row.status}
      data-cause={row.cause ?? (row.by ? "staff" : row.fromSite ? "site" : "unrecorded")}
      {...(row.pressId ? { "data-press": row.pressId } : {})}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
        {t("emails.today.type", { type: typeName(row.messageType) })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }} data-testid="email-history-cause">
        {causeWords(row, t, locale, now)}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5, alignItems: "center" }}>
        {waiting ? <StatusChip glyph="planned" label={t("emails.today.status.waiting")} testId="email-journal-status" /> : <DepartedChip line={row} t={t} locale={locale} now={now} />}
        {row.manualResend && <StatusChip glyph="series" variant="outlined" label={t("emails.queue.manual")} testId="email-history-resend" />}
      </Stack>
      {leaves && (
        <Typography variant="caption" component="p" color={leaves.late ? "error" : "text.primary"} sx={{ fontWeight: 500, mt: 0.5 }} data-testid="email-history-leaves">
          {leaves.text}
        </Typography>
      )}
      {tries && (
        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5 }} data-testid="email-history-tries">
          {tries}
        </Typography>
      )}
      {facts && (
        <Typography variant="caption" component="p" color={row.status === "SENT" ? "text.secondary" : "error"} sx={{ mt: 0.5, wordBreak: "break-word" }} data-testid="email-history-facts">
          {facts}
        </Typography>
      )}
      {row.lastError && (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }} data-testid="email-history-error">
          {t("emails.queue.lastError", { error: row.lastError })}
        </Typography>
      )}
      {row.copies.length > 0 && <ClubFold rows={row.copies} t={t} typeName={typeName} locale={locale} now={now} />}
    </Box>
  );
}
