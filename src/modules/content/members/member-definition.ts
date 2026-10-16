import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditMembersPage } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isWrittenText, refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * «Cine e membru al grupului» (§788; the owner, 2026-10-16: the question mark with the explanation
 * «am fost la cel puțin 3 alergări în ultimele 6 luni», and «asta ar trebui configurabil în
 * back-office ce înseamnă să fii membru»): the club's own sentence saying what being a member of
 * the group means — the words behind the «?» after the tick «Sunt membru al grupului {club}» on
 * the registration form (§189) and on the volunteers' form (§765).
 *
 * One `platform_settings` row, the table being a key-value store (no migration, §100), written by
 * whoever edits the members' pages (`canEditMembersPage`, §524) on «Pagini» → «Membri», audited,
 * read by the two public forms through the public cache (§333). A claim, never a check: what the
 * tick means for the statistics (§787) and for the member accounts («Echipa») is untouched.
 *
 * Both languages or neither (§352). Neither is the usual state, and then the forms say the
 * platform's own words (`Registration.clubMemberDefinition`); a row with one language only — which
 * no save writes — reads as neither, so a page never shows one language's words in the other.
 */

export const MEMBER_DEFINITION_SETTING_KEY = "memberDefinition";
/** `audit_logs.entity_id` for this setting, fixed and never reused (§164): one per key, clear of the run of `…e0NN`. */
export const MEMBER_DEFINITION_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0f3";

/** One sentence, in each language: a tooltip, not a paragraph. */
export const MEMBER_DEFINITION_MAX = 200;

/** The club's words in each language, or null in both while it wrote nothing. */
export type MemberDefinition = { ro: string | null; en: string | null };

export const DEFAULT_MEMBER_DEFINITION: MemberDefinition = { ro: null, en: null };

/** A box's words as one line: every run of whitespace, line breaks included, one space. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const storedSchema = z.object({
  ro: z.string().nullable().optional(),
  en: z.string().nullable().optional(),
});

/** A stored value as the forms read it: both sentences, or neither. Anything unreadable is neither. */
export function parseMemberDefinition(value: unknown): MemberDefinition {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_MEMBER_DEFINITION;
  const ro = oneLine(parsed.data.ro ?? "");
  const en = oneLine(parsed.data.en ?? "");
  if (ro === "" || en === "" || ro.length > MEMBER_DEFINITION_MAX || en.length > MEMBER_DEFINITION_MAX) return DEFAULT_MEMBER_DEFINITION;
  return { ro, en };
}

/** The club's sentence in this language, or null where it wrote none: the caller says the platform's words then. */
export function memberDefinitionFor(locale: Locale | string, definition: MemberDefinition): string | null {
  return (locale === "en" ? definition.en : definition.ro) ?? null;
}

export type MemberDefinitionState = MemberDefinition & { updatedAt: Date | null };

/** The sentences in force: none with no row, or with a value this code cannot read. */
export async function readMemberDefinition<T extends Record<string, unknown>>(db: Database<T>): Promise<MemberDefinitionState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, MEMBER_DEFINITION_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_MEMBER_DEFINITION, updatedAt: null };
  return { ...parseMemberDefinition(row.value), updatedAt: row.updatedAt };
}

/** The two boxes as posted: absent reads as empty, whitespace is one space, longer than the ceiling is refused by name. */
const postedSchema = z
  .object({
    ro: z.string().optional().default("").transform(oneLine),
    en: z.string().optional().default("").transform(oneLine),
  })
  .superRefine((fields, ctx) => {
    for (const language of ["ro", "en"] as const) {
      if (fields[language].length > MEMBER_DEFINITION_MAX) {
        ctx.addIssue({
          code: "custom",
          path: [language === "ro" ? "memberDefinitionRo" : "memberDefinitionEn"],
          message: `longer than ${MEMBER_DEFINITION_MAX}`,
        });
      }
    }
    refuseOneLanguage(
      ctx,
      fields,
      { ro: ["memberDefinitionRo"], en: ["memberDefinitionEn"] },
      "the definition of a member",
    );
  });

/**
 * Saves the sentences, or clears them when both boxes are empty (`canEditMembersPage`, asserted here
 * as well as in the action). Both languages or neither: one written and the other empty is refused
 * on the empty box (§352). The audit row says whether the club has its own words, never the words.
 */
export async function saveMemberDefinition<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Pick<StaffUser, "id" | "role">; fields: Record<string, unknown>; now?: Date },
): Promise<MemberDefinitionState> {
  const { actor } = input;
  if (!canEditMembersPage(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not edit the definition of a member`);
  }
  const text = (name: string) => (typeof input.fields[name] === "string" ? (input.fields[name] as string) : "");
  const parsed = postedSchema.safeParse({ ro: text("memberDefinitionRo"), en: text("memberDefinitionEn") });
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))],
    );
  }
  const written = isWrittenText(parsed.data.ro) && isWrittenText(parsed.data.en);
  const next: MemberDefinition = written ? { ro: parsed.data.ro, en: parsed.data.en } : DEFAULT_MEMBER_DEFINITION;
  const now = input.now ?? new Date();

  const before = await readMemberDefinition(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: MEMBER_DEFINITION_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "member_definition.saved",
      entityType: "platform_setting",
      entityId: MEMBER_DEFINITION_SETTING_ENTITY_ID,
      // Whether the club has its own words before and after, never the words (§12.12).
      metadata: { from: { written: before.ro !== null }, to: { written } },
      now,
    });
  });
  // The two forms read the sentence from the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}
