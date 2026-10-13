import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { Database } from "@/db/types";
import { z } from "zod";
import type { ContactSuspicion } from "./domain/suspicion";
import { readContactRecipients } from "./recipients";

/**
 * «Nu-mi trimite mesajele care par spam» (`DECISIONS.md` §310 as amended): what happens to a
 * message the existing check marks «[posibil spam]» when the Administrator has ticked the box.
 *
 * It is not delivered. What is kept is a *count*: one timestamp and the form's name per held
 * message, for thirty days — never the text, the name, the address or a reason. They live in one
 * `platform_settings` JSON row, so there is no table and no migration, and they age out when the
 * next one is recorded or read.
 */

export const HELD_BACK_SETTING_KEY = "contactHeldBack";
export const HELD_BACK_DAYS = 30;
/** A ceiling on the row: a flood of automated posts must not grow it without end. */
const HELD_BACK_MAX = 1000;

/** Which form held it back, for the card's count. */
export type HeldBackForm = "contact" | "howItWent" | "suggestion" | "complaint";

const heldBackSchema = z.object({
  entries: z.array(z.object({ at: z.string(), form: z.string() })).default([]),
});

/** The pure decision: hold back only a message the existing check marks, and only with the tick on. */
export function shouldHoldBack(suspicion: Pick<ContactSuspicion, "suspicious">, tickOn: boolean): boolean {
  return tickOn && suspicion.suspicious;
}

function recent(entries: readonly { at: string; form: string }[], now: Date): { at: string; form: string }[] {
  const since = now.getTime() - HELD_BACK_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(entry.at) >= since);
}

/** Whether the tick is on. A database that does not answer reads as off: the message is delivered, marked, as ever. */
export async function holdBackIsOn<T extends Record<string, unknown>>(db: Database<T>): Promise<boolean> {
  try {
    return (await readContactRecipients(db)).holdBackSuspected;
  } catch {
    return false;
  }
}

async function readEntries<T extends Record<string, unknown>>(db: Database<T>): Promise<{ at: string; form: string }[]> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, HELD_BACK_SETTING_KEY)).limit(1);
  const parsed = heldBackSchema.safeParse(row?.value);
  return parsed.success ? parsed.data.entries : [];
}

/** Messages held back in the last thirty days. */
export async function countHeldBack<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  return recent(await readEntries(db), now).length;
}

/**
 * Count one held-back message: a timestamp and the form, nothing else. Never throws — a count
 * that cannot be written must not turn into a refusal for the sender.
 */
export async function recordHeldBack<T extends Record<string, unknown>>(db: Database<T>, form: HeldBackForm, now: Date): Promise<void> {
  try {
    const entries = [...recent(await readEntries(db), now), { at: now.toISOString(), form }].slice(-HELD_BACK_MAX);
    await db
      .insert(platformSettings)
      .values({ key: HELD_BACK_SETTING_KEY, value: { entries }, updatedAt: now })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: { entries }, updatedAt: now } });
  } catch (error) {
    console.error("[contact] could not count a held-back message", error instanceof Error ? error.name : "error");
  }
}
