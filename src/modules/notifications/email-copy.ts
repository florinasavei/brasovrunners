import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canEditTexts } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_EMAIL_COPY,
  type EmailCopy,
  type EmailCopyEntry,
  emailCopyKey,
  emailCopySchema,
} from "./domain/email-copy";
import { EmailCopySampleValueError } from "./domain/email-sample";
import { replaceSampleValues, sampleValuesIn } from "./email-copy-fields";

/**
 * Where the club's own wording is kept (`DECISIONS.md` §247).
 *
 * One `platform_settings` row, as the Mailgun plan (§100), the contact recipients (§164) and
 * the club's copies (§244) are. What is different is who may write it: **a Redactor and above**
 * (`canEditTexts`), because §103 is explicit that the Redactor writes the words and the
 * Organizer organizes. Nothing here can change where a link goes or who receives a message —
 * those stay with the Administrator's own panels on the same page.
 */

export const EMAIL_COPY_SETTING_KEY = "emailCopy";
/** One fixed id per setting for the audit row: `…e001` plan, `…e002` contacts, `…e003` copies. */
export const EMAIL_COPY_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e004";

export type EmailCopyState = { copy: EmailCopy; updatedAt: Date | null };

export async function readEmailCopy<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<EmailCopyState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, EMAIL_COPY_SETTING_KEY))
    .limit(1);
  if (!row) return { copy: DEFAULT_EMAIL_COPY, updatedAt: null };
  /*
    Unreadable stored words fall back to the platform's own, which is the safe direction: a
    message still goes out, saying what this application shipped, rather than a send failing
    because somebody's setting cannot be parsed. The panel shows the platform's text then, and
    saving once replaces the unreadable row.
  */
  const parsed = emailCopySchema.safeParse(row.value);
  return { copy: parsed.success ? parsed.data : DEFAULT_EMAIL_COPY, updatedAt: row.updatedAt };
}

/**
 * The same read on the send path, memoized for half a minute.
 *
 * `renderOutboxMessage` runs once per row, and a batch is twenty rows: reading the setting in
 * each would be twenty identical round trips for words that change a few times a year. Half a
 * minute is far shorter than the interval between the club pressing Save and the next batch,
 * and the preview on `/admin/emails` never uses this — it reads straight through, so what the
 * editor shows after a save is always what was just saved.
 */
const CACHE_MS = 30_000;
let cached: { at: number; copy: EmailCopy } | null = null;

export async function readEmailCopyForSending<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<EmailCopy> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.copy;
  const { copy } = await readEmailCopy(db);
  cached = { at: now.getTime(), copy };
  return copy;
}

/** Dropped whenever the words change, so a save is visible on the next send rather than in 30s. */
export function forgetCachedEmailCopy(): void {
  cached = null;
}

/** One entry through the setting's schema — the placeholders, the lengths — or the refusal naming its boxes. */
function parsedEntry(key: string, value: unknown): EmailCopyEntry {
  const parsed = emailCopySchema.safeParse({ [key]: value });
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[1] ?? "subject")),
    );
  }
  return parsed.data[key];
}

/**
 * Write one message's words, or drop them back to the platform's text.
 *
 * One entry at a time, deliberately: the panel edits one message in one language, and a whole
 * map posted at once would make the audit row unreadable and a concurrent edit destructive.
 * `null` removes the override — "revino la textul platformei" — and is what a cleared form does.
 *
 * **No sample value is saved (§359).** A subject or paragraph still holding a value of the page's
 * sample — "Crosul de toamnă", "Ana Popescu", "EXAMPL", the sample's date — is refused, naming the
 * box and the value, because every participant would receive it as written. Checked here and not in
 * the setting's schema: the schema also reads what is already stored, and a stored text with a
 * sample value in it must still send (it is warned about on the page instead) rather than make the
 * whole setting unreadable.
 *
 * `replaceSampleValues` is "Înlocuiește cu câmpurile": the same save, with every sample value in
 * the posted words rewritten to its field first (`email-copy-fields.ts`). The same gate, the same
 * refusal for whatever the rewrite could not reach, the same audit row — naming the values replaced.
 */
export async function updateEmailCopy<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { messageType: EmailMessageType; locale: EmailLocale; entry: unknown | null; replaceSampleValues?: boolean },
  now: Date,
): Promise<EmailCopyState> {
  if (!canEditTexts(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not write the emails' words`);
  }

  // The organizer's message is written per send (§364): a stored wording for it would never be
  // read, and a panel that saved one would be saying something untrue about what goes out.
  if (input.messageType === "ORGANIZER_MESSAGE") {
    throw new DomainError("VALIDATION_ERROR", "the organizer's message is written per send, on the event's page, not here");
  }

  const key = emailCopyKey(input.messageType, input.locale);
  const before = await readEmailCopy(db);
  let entry: EmailCopyEntry | null = null;
  let replaced: string[] | null = null;

  if (input.entry !== null) {
    entry = parsedEntry(key, input.entry);
    if (input.replaceSampleValues) {
      replaced = [...new Set(sampleValuesIn(entry, input.messageType, input.locale).map((hit) => hit.value))];
      entry = parsedEntry(key, replaceSampleValues(entry, input.messageType, input.locale));
    }
    const hits = sampleValuesIn(entry, input.messageType, input.locale);
    if (hits.length > 0) throw new EmailCopySampleValueError(hits);
  }

  const next: EmailCopy = { ...before.copy };
  if (entry) next[key] = entry;
  else delete next[key];

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: EMAIL_COPY_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "email_copy.changed",
      entityType: "platform_setting",
      entityId: EMAIL_COPY_SETTING_ENTITY_ID,
      // The one message that changed, from and to — not the whole map, which would make every
      // row in the trail unreadable and hide which words actually moved. "Înlocuiește cu
      // câmpurile" says so, and which sample values it replaced (§359).
      metadata: { key, from: before.copy[key] ?? null, to: entry, ...(replaced ? { replacedSampleValues: replaced } : {}) },
      now,
    });
  });

  forgetCachedEmailCopy();
  return { copy: next, updatedAt: now };
}
