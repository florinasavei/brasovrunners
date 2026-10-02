import { eq } from "drizzle-orm";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { platformSettings } from "@/db/schema/platform-settings";
import type { Database } from "@/db/types";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { env } from "@/shared/config/env";
import { LEGAL_DOCUMENT_KEYS } from "./domain/keys";
import {
  isUnannouncedChange,
  legalTemplatesCheckDue,
  legalTemplatesIdempotencyKey,
  type LegalTemplatesNotice,
  readLegalTemplatesNoticeValue,
  templatePairs,
  templatesFingerprint,
} from "./domain/templates-notice";
import { computeContentHash } from "./domain/content-hash";
import { readLegalOverview, templateTranslations } from "./service";
import { type ClubFacts, clubFactsFromEnv } from "./templates/club-facts";

/**
 * The Administrators are emailed when a release moves a legal template (§NNN; the owner, 2026-10-02:
 * «vreau mail de regenerează toate documentele ASAP»). Until now each move sat in `/admin/tasks` and
 * on `/admin/legal`'s «Șablon nou» chip, and nobody was told: CLAUDE.md's «Still owed» item 16 is the
 * list of approvals the club kept missing for weeks. This is the knock on the door; `/admin/tasks`
 * stays the standing reminder (`diagnostics/owner-tasks.ts` — this is its counterpart, not its
 * replacement).
 *
 * A step of the maintenance job (`registrations/maintenance.ts`), so no new schedule and no process
 * of its own: it runs when the job runs, and reads the overview at most once an hour per environment
 * (`domain/templates-notice.ts`). Each environment has its own row and its own staff: QA announces
 * QA's templates to QA's Administrators, production production's.
 *
 * **It asks; it never does.** `readLegalOverview` is read-only, and nothing here drafts, approves or
 * writes a legal text (AGENTS.md §10.8, §29): the email tells a person to regenerate, read and approve.
 *
 * **A change approved within the hour is never announced**: by the next check nothing is newer than
 * the text in force, so there is nothing to say — which is the point.
 */

export const LEGAL_TEMPLATES_NOTICE_SETTING_KEY = "legalTemplatesNotice";

export async function readLegalTemplatesNotice<T extends Record<string, unknown>>(db: Database<T>): Promise<LegalTemplatesNotice> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, LEGAL_TEMPLATES_NOTICE_SETTING_KEY))
    .limit(1);
  return readLegalTemplatesNoticeValue(row?.value);
}

async function writeLegalTemplatesNotice<T extends Record<string, unknown>>(
  db: Database<T>,
  value: LegalTemplatesNotice,
  now: Date,
): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key: LEGAL_TEMPLATES_NOTICE_SETTING_KEY, value, updatedAt: now, updatedByStaffUserId: null })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now, updatedByStaffUserId: null } });
}

/**
 * The club's facts as `/admin/legal` fills the templates with them (§132, §442): the environment's,
 * and the contact address the club chose to show. Read only by a run that checks, so the throttled
 * runs read nothing but the row.
 */
export async function legalFactsInForce<T extends Record<string, unknown>>(db: Database<T>): Promise<ClubFacts> {
  return clubFactsFromEnv(env, await shownContactAddresses(db));
}

/**
 * The templates' own words as this release ships them — every text's template with no fact written
 * in, hashed: computed from the code alone, no query, so every run can afford it. A release that moves
 * a template changes it; the club's facts do not (the hourly check reads those).
 */
export function legalTemplatesStamp(): string {
  return templatesFingerprint(LEGAL_DOCUMENT_KEYS.map((key) => `${key}:${computeContentHash(templateTranslations(key, {}))}`));
}

export type LegalTemplatesNoticeRun = {
  /** Whether this run read the overview (false: inside the hour since the last read). */
  checked: boolean;
  /** Emails queued this run: one per Administrator and Superadministrator, on a change, else none. */
  queued: number;
  /** The texts whose template is newer than the text in force, as this run found them. */
  keys: LegalDocumentKey[];
};

export async function announceLegalTemplateChanges<T extends Record<string, unknown>>(
  db: Database<T>,
  loadFacts: () => Promise<ClubFacts>,
  now: Date,
): Promise<LegalTemplatesNoticeRun> {
  const notice = await readLegalTemplatesNotice(db);
  const templatesStamp = legalTemplatesStamp();
  if (!legalTemplatesCheckDue(notice, now, templatesStamp)) return { checked: false, queued: 0, keys: [] };

  /*
    The hour is claimed before the overview is read, so a template that cannot be read or a fact that
    fails is tried again an hour later rather than at every ping in between (§479); everything else
    the row remembers is kept until an announcement replaces it.
  */
  await writeLegalTemplatesNotice(db, { ...notice, checkedAt: now.toISOString(), templatesStamp }, now);

  const overview = await readLegalOverview(db, await loadFacts(), now);
  const newer = LEGAL_DOCUMENT_KEYS.filter((key) => overview[key].templateNewer).map((key) => ({
    key,
    filledHash: overview[key].filledHash,
  }));
  const keys = newer.map((entry) => entry.key);
  const pairs = templatePairs(newer);
  if (!isUnannouncedChange(pairs, notice)) return { checked: true, queued: 0, keys };

  const fingerprint = templatesFingerprint(pairs);
  // Whoever may approve a legal text (§450): the Administrators and the Superadministrator. Staff
  // only — never a participant, never a subscriber — each in the language of their own row.
  const recipients = (await listStaffUsers(db)).filter((member) => canWriteLegalTexts(member.role) && member.email.trim() !== "");

  let queued = 0;
  await db.transaction(async (tx) => {
    for (const member of recipients) {
      const row = await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "LEGAL_TEMPLATES_CHANGED",
        locale: member.preferredLocale,
        recipientEmail: member.email,
        payload: { displayName: member.displayName, keys },
        // Once per person per change, whatever becomes of the row below.
        idempotencyKey: legalTemplatesIdempotencyKey(fingerprint, member.id),
        now,
      });
      if (row) queued += 1;
    }
    await writeLegalTemplatesNotice(
      tx,
      { checkedAt: now.toISOString(), templatesStamp, fingerprint, announcedAt: now.toISOString(), keys, pairs },
      now,
    );
  });
  return { checked: true, queued, keys };
}
