import { asc, eq, inArray, sql } from "drizzle-orm";
import { faqQuestions } from "@/db/schema/faq";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditFaqPage, canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type FaqPageFields, type FaqRow, faqFieldName, faqPageFieldsSchema } from "./fields";
import { DEFAULT_FAQ_PAGE, FAQ_PAGE_SETTING_ENTITY_ID, FAQ_PAGE_SETTING_KEY, type FaqPageSettings, parseFaqPageSettings } from "./page-settings";

/**
 * «Întrebări frecvente»: the page's one save (§525, §28), introduction and cards together or not
 * at all, against the page's version (AGENTS.md §11.5). Asserted here (BR-REQ-060-01): words are
 * `canEditFaqPage`; «Pe site» and deleting a shown question are `canShowFaqItem` (§201) — for
 * anybody else the tick is ignored and a new question starts hidden. One audit row per save names
 * questions by id, never words (§12.12); expires the `pages` cache (§333).
 */

type Actor = Pick<StaffUser, "id" | "role">;

export type FaqPageSaveResult = { version: number; created: string[] };

function parseOrThrow(value: unknown): FaqPageFields {
  const parsed = faqPageFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${faqFieldName(issue.path)}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => faqFieldName(issue.path)))],
    );
  }
  return parsed.data;
}

/** The kept cards in the posted order, with the pressed arrow's swap applied. */
function ordered(rows: readonly FaqRow[], move: { index: number; direction: "up" | "down" } | null): FaqRow[] {
  const kept = rows.filter((row) => !row.remove);
  if (!move) return kept;
  const at = kept.findIndex((row) => row.index === move.index);
  const to = move.direction === "up" ? at - 1 : at + 1;
  if (at === -1 || to < 0 || to >= kept.length) return kept;
  [kept[at], kept[to]] = [kept[to]!, kept[at]!];
  return kept;
}

/** Save the introduction and the cards against the loaded version. */
export async function saveFaqPage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    actor: Actor;
    expectedVersion: number;
    fields: unknown;
    /** An arrow pressed on a card (`parseFaqMove`). */
    move?: { index: number; direction: "up" | "down" } | null;
    now?: Date;
  },
): Promise<FaqPageSaveResult> {
  if (!canEditFaqPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit the FAQ page`);
  }
  const fields = parseOrThrow(input.fields);
  const mayShow = canShowFaqItem(input.actor.role);
  const now = input.now ?? new Date();

  const result = await db.transaction(async (tx) => {
    const [settingRow] = await tx.select().from(platformSettings).where(eq(platformSettings.key, FAQ_PAGE_SETTING_KEY)).limit(1).for("update");
    const before = settingRow ? parseFaqPageSettings(settingRow.value) : DEFAULT_FAQ_PAGE;
    if (before.version !== input.expectedVersion) {
      throw new DomainError(
        "CONFLICT",
        `this page was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${before.version}`,
      );
    }

    const existing = await tx
      .select({ id: faqQuestions.id, visible: faqQuestions.visible })
      .from(faqQuestions)
      .orderBy(asc(faqQuestions.position), asc(faqQuestions.createdAt))
      .for("update");
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const row of fields.rows) {
      if (row.id && !byId.has(row.id)) throw new DomainError("NOT_FOUND", "a question on this screen is no longer on the page");
    }

    const removed = fields.rows.filter((row): row is Extract<FaqRow, { remove: true }> => row.remove);
    if (!mayShow && removed.some((row) => byId.get(row.id)?.visible)) {
      throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a question that is on the site`);
    }
    if (removed.length > 0) {
      await tx.delete(faqQuestions).where(
        inArray(
          faqQuestions.id,
          removed.map((row) => row.id),
        ),
      );
    }

    const kept = ordered(fields.rows, input.move ?? null) as Array<Extract<FaqRow, { remove: false }>>;
    const posted = new Set(fields.rows.flatMap((row) => (row.id ? [row.id] : [])));
    // A question the form did not carry (a crafted post) keeps its words, after the posted ones.
    const untouched = existing.filter((row) => !posted.has(row.id));

    const created: string[] = [];
    const shown: string[] = [];
    const hidden: string[] = [];
    for (const [place, row] of kept.entries()) {
      const position = place + 1;
      if (row.id) {
        const was = byId.get(row.id)!;
        const visible = mayShow ? row.visible : was.visible;
        if (visible !== was.visible) (visible ? shown : hidden).push(row.id);
        await tx
          .update(faqQuestions)
          .set({ ...row.fields, position, visible, updatedByStaffUserId: input.actor.id, version: sql`${faqQuestions.version} + 1`, updatedAt: now })
          .where(eq(faqQuestions.id, row.id));
      } else {
        const visible = mayShow && row.visible;
        const [inserted] = await tx
          .insert(faqQuestions)
          .values({
            ...row.fields,
            position,
            visible,
            createdByStaffUserId: input.actor.id,
            updatedByStaffUserId: input.actor.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: faqQuestions.id });
        created.push(inserted!.id);
        if (visible) shown.push(inserted!.id);
      }
    }
    for (const [place, row] of untouched.entries()) {
      await tx.update(faqQuestions).set({ position: kept.length + place + 1 }).where(eq(faqQuestions.id, row.id));
    }

    const value: FaqPageSettings = {
      ...before,
      version: before.version + 1,
      introRo: fields.intro.ro,
      introEn: fields.intro.en,
      introRoJson: fields.intro.roJson,
      introEnJson: fields.intro.enJson,
    };
    await tx
      .insert(platformSettings)
      .values({ key: FAQ_PAGE_SETTING_KEY, value, updatedAt: now, updatedByStaffUserId: input.actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now, updatedByStaffUserId: input.actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "faq_page.saved",
      entityType: "platform_setting",
      entityId: FAQ_PAGE_SETTING_ENTITY_ID,
      metadata: {
        version: value.version,
        questions: kept.length + untouched.length,
        created,
        deleted: removed.map((row) => row.id),
        shown,
        hidden,
        moved: Boolean(input.move),
      },
      now,
    });
    return { version: value.version, created };
  });
  revalidatePublicContent("pages");
  return result;
}
