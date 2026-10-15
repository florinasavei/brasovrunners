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
 * - **A digest, not a notice per change** (§NNN; the owner, 2026-10-15: «Parcă totuși șabloanele
 *   textelor se schimbă prea des, că tot primesc email, de ce?» — six releases in one night sent six
 *   emails). At most one email per club day (`LEGAL_TEMPLATES_DIGEST_HOUR`, Europe/Bucharest): the first
 *   run at or after 08:00 club time that finds a change since the last email sends ONE, naming every
 *   text whose template is newer; a change that lands after that email waits for the next day's. The
 *   mark is `announcedAt` in the same row — «the last digest» — so it survives a restart and a deploy,
 *   and no table or column is new.
 * - **How often.** At most once an hour (`LEGAL_TEMPLATES_CHECK_MINUTES`), whatever the pinger does:
 *   reading every text's overview is a dozen queries, and the job may run every fifteen minutes
 *   (§479, §549: a job step must be cheap). Between two checks the step reads one row and nothing else
 *   — except on the first real run of a release whose templates differ from the ones the last check
 *   read (`templatesStamp`, the templates' own words, no fact and no query): that run checks at once,
 *   so a release is never kept waiting by an hour an earlier release started.
 * - **What is newer.** The keys `/admin/legal` marks «Șablon nou» — `readLegalOverview`'s
 *   `templateNewer`, the one predicate (§539); never a second definition here.
 * - **What is new.** A `key:filledHash` pair the last announcement did not carry. A subset of what
 *   was announced — the club approved some of the texts and not yet the rest — is not a change and is
 *   not announced again: `/admin/tasks` stays the standing reminder, the email is the knock.
 */

/**
 * The club hour from which the day's digest may go (§NNN): the first run at or after it. Before it a
 * night's releases wait, so the one email is read in the morning and not at 03:00.
 */
export const LEGAL_TEMPLATES_DIGEST_HOUR = 8;

/** The same hour as the email writes it, «08:00» — read from the one constant, never typed twice. */
export const LEGAL_TEMPLATES_DIGEST_CLOCK = `${String(LEGAL_TEMPLATES_DIGEST_HOUR).padStart(2, "0")}:00`;

/** The least time between two reads of the overview, per environment (§479). */
export const LEGAL_TEMPLATES_CHECK_MINUTES = 60;

const KEY = z.enum(LEGAL_DOCUMENT_KEYS);
const PAIR = /^[A-Z_]+:[0-9a-f]{64}$/;

export const legalTemplatesNoticeSchema = z
  .object({
    /** When the job last read the overview — what the hour is counted from. */
    checkedAt: z.iso.datetime(),
    /** The templates' own words the last check read (`legalTemplatesStamp`), or none yet. */
    templatesStamp: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    /** The last announcement's fingerprint (`templatesFingerprint`), or none yet. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    announcedAt: z.iso.datetime().nullable(),
    /** The texts the last announcement named. */
    keys: z.array(KEY),
    /** …and the template each was announced at, `KEY:filledHash`: what a later change is told apart by. */
    pairs: z.array(z.string().regex(PAIR)),
  })
  .strict();

export type LegalTemplatesNotice = z.infer<typeof legalTemplatesNoticeSchema>;

/** Never checked, never announced: what a missing or unreadable row reads as. */
export const NO_LEGAL_TEMPLATES_NOTICE: LegalTemplatesNotice = {
  checkedAt: new Date(0).toISOString(),
  templatesStamp: null,
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
 * Whether it is the digest's turn (§NNN): `now` is at or after today's 08:00 club time, and no digest
 * has gone since then — at most one per club day, the first run after 08:00 sending it. A change
 * after the day's digest therefore waits for the next day's; a run before 08:00 reads nothing.
 * `announcedAt` is the mark; never sent is due from the first morning.
 */
export function legalTemplatesDigestDue(notice: LegalTemplatesNotice, now: Date): boolean {
  const opensAt = legalTemplatesDigestOpensAt(now);
  if (now.getTime() < opensAt.getTime()) return false;
  return notice.announcedAt === null || Date.parse(notice.announcedAt) < opensAt.getTime();
}

/**
 * Whether this run reads the overview: the first time, once the hour since the last read has passed,
 * and at once when this release's templates are not the ones the last check read.
 */
export function legalTemplatesCheckDue(notice: LegalTemplatesNotice, now: Date, templatesStamp: string): boolean {
  if (notice.templatesStamp !== templatesStamp) return true;
  return now.getTime() - Date.parse(notice.checkedAt) >= LEGAL_TEMPLATES_CHECK_MINUTES * 60_000;
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
