import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canPublishToolsPage } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Unelte» as a standard page (§NNN; the owner, 2026-11-09: «vreau ca pagina de "Unelte" să fie controlabilă ca și restul
 * paginilor, să pot să îi dau OFF» — «și asta e doar o unealtă … vin mai multe unelte pe viitor»): one `platform_settings` row,
 * like «Întrebări frecvente» (§525), holding the page's DRAFT/PUBLISHED state and which of the platform's tools are off it.
 * The tools themselves are the platform's code (`TOOLS`, each a card of its own); the club only says whether the page is on the
 * site and which tools it shows. No row — or an unreadable one — reads as PUBLISHED with every tool shown: the page has been on
 * the site since §922, and the switch only ever takes it off.
 */
export const TOOLS_PAGE_SETTING_KEY = "toolsPage";
/** `audit_logs.entity_id` for this setting, fixed and never reused (§164); beside «Întrebări frecvente»'s …e0fa. */
export const TOOLS_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0fb";

/** The platform's tools, in the page's order. A new tool is a key here, its card on the page and its name in `Tools`. */
export const TOOLS = ["pace"] as const;
export type ToolKey = (typeof TOOLS)[number];

export type ToolsPageStatus = "DRAFT" | "PUBLISHED";
export type ToolsPageSettings = { status: ToolsPageStatus; hiddenTools: ToolKey[] };

export const DEFAULT_TOOLS_PAGE: ToolsPageSettings = { status: "PUBLISHED", hiddenTools: [] };

function isToolKey(value: string): value is ToolKey {
  return (TOOLS as readonly string[]).includes(value);
}

const storedSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED"]),
  // A tool the platform no longer has is dropped on read; the order is the platform's.
  hiddenTools: z
    .array(z.string())
    .optional()
    .default([])
    .transform((keys) => TOOLS.filter((tool) => keys.includes(tool))),
});

type Actor = Pick<StaffUser, "id" | "role">;

/** An unreadable row reads as the default. */
export function parseToolsPageSettings(value: unknown): ToolsPageSettings {
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TOOLS_PAGE;
}

export async function readToolsPageSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<ToolsPageSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, TOOLS_PAGE_SETTING_KEY)).limit(1);
  return row ? parseToolsPageSettings(row.value) : DEFAULT_TOOLS_PAGE;
}

/** The tools the page shows, in the platform's order. */
export function shownTools(settings: ToolsPageSettings): ToolKey[] {
  return TOOLS.filter((tool) => !settings.hiddenTools.includes(tool));
}

/** Whether «Unelte» is on the site: published, with a tool on it — «Întrebări frecvente»'s rule (§525). */
export function toolsPageOnSite(settings: ToolsPageSettings): boolean {
  return settings.status === "PUBLISHED" && shownTools(settings).length > 0;
}

/** One write of the row under its lock, audited, the public pages told after the commit. A change that changes nothing writes nothing. */
async function writeToolsPage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  now: Date,
  change: (before: ToolsPageSettings) => { value: ToolsPageSettings; action: "tools_page.published" | "tools_page.unpublished" | "tools_page.tools_changed" } | null,
): Promise<ToolsPageSettings> {
  let wrote = false;
  const next = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(platformSettings).where(eq(platformSettings.key, TOOLS_PAGE_SETTING_KEY)).limit(1).for("update");
    const before = row ? parseToolsPageSettings(row.value) : DEFAULT_TOOLS_PAGE;
    const changed = change(before);
    if (!changed) return before;
    const { value, action } = changed;
    await tx
      .insert(platformSettings)
      .values({ key: TOOLS_PAGE_SETTING_KEY, value, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action,
      entityType: "platform_setting",
      entityId: TOOLS_PAGE_SETTING_ENTITY_ID,
      metadata:
        action === "tools_page.tools_changed" ? { from: before.hiddenTools, to: value.hiddenTools } : { from: before.status, to: value.status },
      now,
    });
    wrote = true;
    return value;
  });
  // The page, its menu entry and the sitemap read the row from the public cache under `pages` (§333).
  if (wrote) revalidatePublicContent("pages");
  return next;
}

/** «Publică pagina» / «Retrage de pe site»: the Administrator's, as «Întrebări frecvente»'s (§201). */
export async function setToolsPagePublished<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; published: boolean; now?: Date },
): Promise<ToolsPageSettings> {
  if (!canPublishToolsPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish the tools page`);
  }
  const status: ToolsPageStatus = input.published ? "PUBLISHED" : "DRAFT";
  return writeToolsPage(db, input.actor, input.now ?? new Date(), (before) =>
    before.status === status ? null : { value: { ...before, status }, action: input.published ? "tools_page.published" : "tools_page.unpublished" },
  );
}

/** «Pe site» per tool, saved at once: the tools ticked are shown, every other the platform has is off the page. */
export async function saveShownTools<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; shown: readonly string[]; now?: Date },
): Promise<ToolsPageSettings> {
  if (!canPublishToolsPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not choose the tools page's tools`);
  }
  const shown = input.shown.filter(isToolKey);
  const hiddenTools = TOOLS.filter((tool) => !shown.includes(tool));
  return writeToolsPage(db, input.actor, input.now ?? new Date(), (before) =>
    before.hiddenTools.length === hiddenTools.length && before.hiddenTools.every((tool) => hiddenTools.includes(tool))
      ? null
      : { value: { ...before, hiddenTools }, action: "tools_page.tools_changed" },
  );
}
