import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { RecipientRole } from "@/modules/notifications/domain/email-audience";
import type { OutboxHistoryRow } from "../admin-repository";
import { causeLabel, causeWhy, shortEmailName } from "./rejected-email-words";

type Say = (key: string, values?: Record<string, string | number>) => string;

/** The roles a registration's page lists apart, behind «și cele către club» (§NNN): the club's own mailboxes and copies. */
const CLUB_ROLES: ReadonlySet<RecipientRole> = new Set(["archive", "notice", "copy", "staff", "public"]);

/** Whether a row of the history is the club's (the archive, the notice, a copy), not the participant's own. */
export function isClubRow(row: Pick<OutboxHistoryRow, "recipientRole">): boolean {
  return CLUB_ROLES.has(row.recipientRole);
}

/** How many of the participant's own emails «Emailuri» shows before «Toate emailurile ({n})» (§NNN). */
export const EMAILS_SHOWN = 5;

export type EmailHistoryWords = {
  /** «Confirmarea cu QR · către participant» — by role, never a club mailbox's address. */
  title: string;
  /** «Livrat sâmb., 3 oct., 10:15» — what happened to it and when, and who asked for a resend by hand. */
  state: string;
  /** A refusal or an email that never left reads in red. */
  refused: boolean;
  /** Under a refused row, in small print: the provider's code and words, why in plain words, what came after. */
  notes: string[];
};

/**
 * One row of the registration's «Emailuri» (§NNN), in two short lines: which email and for whom, by its
 * short name and role words — «către participant», «copia de arhivă a clubului» — and what became of it:
 * «În coadă», «Trimis», «Livrat», «Trimis prin Gmail · fără confirmare de livrare», «Respins — {cause}»,
 * «Marcat ca spam», «Nu a plecat — {reason}»; «Retrimis de {staff}» on a resend by hand. A refused row adds
 * the provider's code and redacted words, why in plain words, and what came after it. «Trimis» is handed
 * to the provider; «Livrat» reached the receiving server (maybe its Spam) — the legend under the list says so.
 */
export function emailHistoryWords(row: OutboxHistoryRow, locale: string): EmailHistoryWords {
  const lang = locale === "en" ? "en" : "ro";
  const say = createTranslator({ locale: lang, messages: lang === "en" ? en : ro, namespace: "Admin" }) as unknown as Say;
  const words = (key: string, values?: Record<string, string | number>) => say(`registrations.emails.${key}`, values);
  const date = (at: Date) => formatDay(at, { locale: lang, timeZone: CLUB_TIME_ZONE, style: "short", year: false, withTime: true, position: "continues" });
  const title = `${shortEmailName(row.messageType, lang)} · ${words(`role.${row.recipientRole}`)}`;

  let state: string;
  let refused = false;
  const notes: string[] = [];
  switch (row.status) {
    case "PENDING":
    case "PROCESSING":
      state = words("state.queued", { date: date(row.createdAt) });
      break;
    case "FAILED":
      state = words("state.notSent", { date: date(row.createdAt), reason: words("notSentReason.failed") });
      refused = true;
      break;
    case "SENT":
      state = row.deliveredAt
        ? words("state.delivered", { date: date(row.deliveredAt) })
        : row.transport === "gmail"
          ? words("state.gmail", { date: date(row.sentAt ?? row.createdAt) })
          : words("state.sent", { date: date(row.sentAt ?? row.createdAt) });
      break;
    case "COMPLAINED":
      state = words("state.spam", { date: date(row.rejectedAt ?? row.sentAt ?? row.createdAt) });
      refused = true;
      break;
    default: {
      // BOUNCED: refused at the address once it left; never left when the provider refused it at the send.
      const cause = row.rejectionCause ?? "other";
      const left = row.sentAt !== null && cause !== "account";
      state = left
        ? words("state.refused", { date: date(row.rejectedAt ?? row.sentAt ?? row.createdAt), label: causeLabel(cause, lang) })
        : words("state.notSent", {
            date: date(row.rejectedAt ?? row.createdAt),
            reason: cause === "account" ? words("notSentReason.account") : causeLabel(cause, lang),
          });
      refused = true;
    }
  }
  if (row.isManualResend) {
    state = `${state} · ${row.requestedByName ? words("resentBy", { staff: row.requestedByName }) : words("resentByNobody")}`;
  }
  if (row.status === "BOUNCED" || row.status === "COMPLAINED") {
    const code = row.providerCode?.trim() || null;
    const detail = row.providerDetail?.trim() || null;
    // The code once: the server's words usually start with it.
    const provider = detail && code && !detail.startsWith(code) ? `${code} ${detail}` : (detail ?? code);
    if (provider) notes.push(say("registrations.rejected.reason", { reason: provider }));
    const cause = row.rejectionCause ?? (row.status === "COMPLAINED" ? "complained" : "other");
    notes.push(causeWhy(cause, row.status === "COMPLAINED" || (row.sentAt !== null && cause !== "account"), lang));
    if (row.resolvedAt) notes.push(words("after.resolved", { date: date(row.resolvedAt) }));
    else if (row.retriedAt) notes.push(words(row.retriedVia === "gmail" ? "after.retriedGmail" : "after.retried", { date: date(row.retriedAt) }));
    else if (row.laterDeliveredAt) notes.push(words("after.laterDelivered", { date: date(row.laterDeliveredAt) }));
  }
  return { title, state, refused, notes };
}
