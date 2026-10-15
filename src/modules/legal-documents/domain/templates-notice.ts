import { createHash } from "node:crypto";
import { z } from "zod";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { LEGAL_DOCUMENT_KEYS } from "./keys";

/**
 * «Șabloanele textelor legale s-au schimbat» (§639; the owner, 2026-10-02: «vreau mail de regenerează
 * toate documentele ASAP») — the arithmetic, pure: when the maintenance job looks, what counts as a
 * change of the templates, and what it remembers in `platform_settings` so each change is announced
 * once, on each environment separately.
 *
 * - **A digest, not a notice per change** (§775; the owner, 2026-10-15: «Parcă totuși șabloanele
 *   textelor se schimbă prea des, că tot primesc email, de ce?» — six releases in one night sent six
 *   emails). ONE look at the templates per club day (`LEGAL_TEMPLATES_DIGEST_HOUR`, Europe/Bucharest),
 *   made by the first run at or after 08:00 club time; if it finds a change the last email did not
 *   carry, it sends ONE email naming every text whose template is newer than the text in force. A
 *   change that lands after the day's look — at 10:00, at 22:30 — waits for tomorrow's. The mark is
 *   `checkedAt` in the same row, so it survives a restart and a deploy, and no table or column is new.
 * - **How often.** Once a day, so the step reads one row and nothing else on every other run: reading
 *   every text's overview is a dozen queries and the job may run every fifteen minutes (§479, §549: a
 *   job step must be cheap). The claim is written before the overview is read, so a read that fails
 *   is tried again tomorrow, not at every ping.
 * - **What is newer.** The keys `/admin/legal` marks «Șablon nou» — `readLegalOverview`'s
 *   `templateNewer`, the one predicate (§539); never a second definition here.
 * - **What is new.** A `key:filledHash` pair the last announcement did not carry. A subset of what
 *   was announced — the club approved some of the texts and not yet the rest — is not a change and is
 *   not announced again: `/admin/tasks` stays the standing reminder, the email is the knock.
 */

/**
 * The club hour from which the day's digest may go (§775): the first run at or after it. Before it a
 * night's releases wait, so the one email is read in the morning and not at 03:00.
 */
export const LEGAL_TEMPLATES_DIGEST_HOUR = 8;

/** The same hour as the email writes it, «08:00» — read from the one constant, never typed twice. */
export const LEGAL_TEMPLATES_DIGEST_CLOCK = `${String(LEGAL_TEMPLATES_DIGEST_HOUR).padStart(2, "0")}:00`;

const KEY = z.enum(LEGAL_DOCUMENT_KEYS);
const PAIR = /^[A-Z_]+:[0-9a-f]{64}$/;

export const legalTemplatesNoticeSchema = z
  .object({
    /** When the job last made the day's look at the overview — the digest's mark: one look per club day. */
    checkedAt: z.iso.datetime(),
    /** The last announcement's fingerprint (`templatesFingerprint`), or none yet. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    announcedAt: z.iso.datetime().nullable(),
    /** The texts the last announcement named. */
    keys: z.array(KEY),
    /** …and the template each was announced at, `KEY:filledHash`: what a later change is told apart by. */
    pairs: z.array(z.string().regex(PAIR)),
  });
// Not strict (§775): rows written before the digest carry a `templatesStamp` this code no longer uses,
// and refusing one would read as «never announced» and send the whole list again.

export type LegalTemplatesNotice = z.infer<typeof legalTemplatesNoticeSchema>;

/** Never checked, never announced: what a missing or unreadable row reads as. */
export const NO_LEGAL_TEMPLATES_NOTICE: LegalTemplatesNotice = {
  checkedAt: new Date(0).toISOString(),
  fingerprint: null,
  announcedAt: null,
  keys: [],
  pairs: [],
};

export function readLegalTemplatesNoticeValue(value: unknown): LegalTemplatesNotice {
  const parsed = legalTemplatesNoticeSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...NO_LEGAL_TEMPLATES_NOTICE };
}

/**
 * The instant the club day of `now` opens its digest: 08:00 on the wall clock of `CLUB_TIME_ZONE`
 * that day — 05:00Z in summer time, 06:00Z in winter — so the hour holds across the two changes of
 * the clock (the wall clock, never «plus 24 hours»; the changes happen between 03:00 and 04:00, so
 * 08:00 is never in a gap or an overlap).
 */
export function legalTemplatesDigestOpensAt(now: Date): Date {
  const today = toWallTimeInput(now, CLUB_TIME_ZONE).slice(0, 10);
  const opens = fromWallTimeInput(`${today}T${LEGAL_TEMPLATES_DIGEST_CLOCK}`, CLUB_TIME_ZONE);
  if (!opens) throw new Error(`cannot place ${LEGAL_TEMPLATES_DIGEST_CLOCK} on ${today} in ${CLUB_TIME_ZONE}`);
  return opens;
}

/**
 * Whether it is the digest's turn (§775): `now` is at or after today's 08:00 club time, and the day's
 * look has not been made — ONE look per club day, by the first run at or after 08:00. A change that
 * lands after that look, at 10:00 or at 22:30, waits for tomorrow's: the day's look found what it
 * found, and no second email follows it the same day. A run before 08:00 reads nothing, so a night's
 * releases are all in the one morning email. `checkedAt` is the mark (the claim is written before the
 * overview is read, §479, so a read that fails is not retried until tomorrow); never looked is due
 * from the first morning.
 */
export function legalTemplatesDigestDue(notice: LegalTemplatesNotice, now: Date): boolean {
  const opensAt = legalTemplatesDigestOpensAt(now);
  if (now.getTime() < opensAt.getTime()) return false;
  return Date.parse(notice.checkedAt) < opensAt.getTime();
}

export type NewerTemplate = { key: LegalDocumentKey; filledHash: string };

/** The `KEY:filledHash` pairs of the newer templates, sorted, so the same set reads the same. */
export function templatePairs(newer: readonly NewerTemplate[]): string[] {
  return newer.map((entry) => `${entry.key}:${entry.filledHash}`).sort();
}

/** A stable hash of the sorted pairs: the same templates, the same fingerprint, whatever the order read. */
export function templatesFingerprint(pairs: readonly string[]): string {
  return createHash("sha256").update([...pairs].sort().join("\n")).digest("hex");
}

/**
 * Whether the newer templates are a change the Administrators have not been told of: a pair the
 * last announcement did not carry. Nothing newer is nothing to say; a subset of the announced set
 * is the club part-way through approving what it was told of.
 */
export function isUnannouncedChange(pairs: readonly string[], notice: LegalTemplatesNotice): boolean {
  if (pairs.length === 0) return false;
  const announced = new Set(notice.pairs);
  return pairs.some((pair) => !announced.has(pair));
}

/** The idempotency key of one person's email about one change (§639): once per person per change. */
export function legalTemplatesIdempotencyKey(fingerprint: string, staffUserId: string): string {
  return `legal-templates:${fingerprint}:${staffUserId}`;
}
