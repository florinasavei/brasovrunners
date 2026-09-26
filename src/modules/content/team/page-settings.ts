import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditTeamPage, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { DomainError } from "@/shared/errors/domain-error";
import { normalizeTeamText } from "./fields";

/**
 * «Echipa» as a page (§459): whether it is on the site at all, and the club's own introduction.
 *
 * One `platform_settings` row (§100's shape), because the page is one thing and not a table of
 * things: `status` is DRAFT until an Administrator publishes it — both languages at once, as an
 * event and a standing page go live (§28) — and the introduction is the club's text, Romanian
 * **and** English or neither (§352). With none, the page reads the platform's sentence from the
 * catalogue. The cards keep their own «Pe site» switch as a second gate: a person is shown only on
 * a published page, and only once an Administrator has shown their card.
 *
 * A row this code cannot read is a DRAFT page with no introduction — the safe answer: nothing is
 * shown that nobody decided to show.
 */

export const TEAM_PAGE_SETTING_KEY = "teamPage";
/** `audit_logs.entity_id` for this setting, one fixed id per key, never reused (§164's rule). */
export const TEAM_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00c";

export const TEAM_INTRO_MAX = 600;

export type TeamPageStatus = "DRAFT" | "PUBLISHED";

export type TeamPageSettings = {
  status: TeamPageStatus;
  introRo: string | null;
  introEn: string | null;
};

export const DEFAULT_TEAM_PAGE: TeamPageSettings = { status: "DRAFT", introRo: null, introEn: null };

const storedSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED"]),
  introRo: z.string().nullable(),
  introEn: z.string().nullable(),
});

const optionalIntro = z
  .string()
  .default("")
  .transform(normalizeTeamText)
  .pipe(z.string().max(TEAM_INTRO_MAX))
  .transform((value) => (value === "" ? null : value));

const introSchema = z
  .object({ introRo: optionalIntro, introEn: optionalIntro })
  .superRefine((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.introRo, en: fields.introEn }, { ro: ["introRo"], en: ["introEn"] }, "the introduction");
  });

type Actor = Pick<StaffUser, "id" | "role">;

export async function readTeamPageSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<TeamPageSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, TEAM_PAGE_SETTING_KEY)).limit(1);
  if (!row) return DEFAULT_TEAM_PAGE;
  const parsed = storedSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_TEAM_PAGE;
}

/** The introduction in this language, or null unless both sides are written (§352, §354). */
export function teamIntroFor(locale: string, settings: TeamPageSettings): string | null {
  const written = (value: string | null) => (value ?? "").trim() !== "";
  if (!written(settings.introRo) || !written(settings.introEn)) return null;
  return locale === "en" ? settings.introEn : settings.introRo;
}

async function writeSettings<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  next: TeamPageSettings,
  audit: { action: AuditAction; metadata: Record<string, unknown> },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: TEAM_PAGE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: audit.action,
      entityType: "platform_setting",
      entityId: TEAM_PAGE_SETTING_ENTITY_ID,
      metadata: audit.metadata,
      now,
    });
  });
  // The page, the header's entry and the sitemap read the page's state from the public cache under
  // `pages` (§333), as they read the cards.
  revalidatePublicContent("pages");
}

/** The club's introduction, both languages or neither — the Redactor's and the Administrator's. */
export async function saveTeamPageIntro<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<TeamPageSettings> {
  if (!canEditTeamPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit the team page`);
  }
  const parsed = introSchema.safeParse(input.fields);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  const before = await readTeamPageSettings(db);
  const next = { ...before, ...parsed.data };
  await writeSettings(
    db,
    input.actor,
    next,
    // The shape of the change, never the words (§12.12).
    { action: "team_page.intro_saved", metadata: { written: next.introRo !== null } },
    input.now ?? new Date(),
  );
  return next;
}

/**
 * Put the page on the site in both languages, or take it off — the Administrator's, the threshold
 * of every other crossing into public view (§201).
 */
export async function setTeamPagePublished<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; published: boolean; now?: Date },
): Promise<TeamPageSettings> {
  if (!canShowTeamMember(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish the team page`);
  }
  const before = await readTeamPageSettings(db);
  const next: TeamPageSettings = { ...before, status: input.published ? "PUBLISHED" : "DRAFT" };
  await writeSettings(
    db,
    input.actor,
    next,
    { action: input.published ? "team_page.published" : "team_page.unpublished", metadata: { from: before.status, to: next.status } },
    input.now ?? new Date(),
  );
  return next;
}
