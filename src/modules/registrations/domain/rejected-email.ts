/**
 * The newest email the provider rejected for a registration (§76, §83, §NNN): which message it was,
 * when it left — or, refused outright, when it was queued (`sent_at` is set at most once and a row the
 * provider refused at the send never has one; no rejection instant is stored) —, whether it bounced or
 * was marked as spam, and the provider's short sanitized reason (§16.1). Null when nothing was
 * rejected; a club copy (§320) is never one.
 */
export type RejectedEmail = {
  messageType: string;
  at: Date;
  status: "BOUNCED" | "COMPLAINED";
  reason: string | null;
};

/**
 * The list's, the page's and the desk's subquery returns one JSON object (`admin-repository.ts`);
 * node-postgres and PGlite hand `json` back parsed, a driver that does not hands back its text. The
 * instant travels as epoch milliseconds, so no driver's timestamp text has to be parsed.
 */
export function rejectedEmailOf(value: unknown): RejectedEmail | null {
  const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as { messageType?: unknown; at?: unknown; status?: unknown; reason?: unknown };
  return {
    messageType: String(row.messageType),
    at: new Date(Number(row.at)),
    status: row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED",
    reason: typeof row.reason === "string" && row.reason.length > 0 ? row.reason : null,
  };
}
