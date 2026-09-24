import { cache } from "react";
import { getDb } from "@/db/client";
import { readDeadlines } from "./deadlines";
import type { Deadlines } from "./domain/deadlines";

/**
 * The club's deadlines for one backoffice render (§NNN), read once however many Server Components
 * on the page ask — the editor's registration card, the series box, the queue panel — through
 * React's per-request `cache`, and straight from the database: a backoffice page is where
 * somebody may have just changed them, and it must say the numbers now in force.
 *
 * Backoffice only. A public page reads them from the data cache (`public-cache/reads.ts`,
 * `cachedDeadlines`), so a visitor never wakes the database (§333).
 */
export const deadlinesForThisRequest = cache(async (): Promise<Deadlines> => (await readDeadlines(getDb())).deadlines);
