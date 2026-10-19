import type { Database } from "@/db/types";
import { rsvpAskTimingOf, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { noticeDescribesRsvpAsk, noticeDescribesRsvpAskAnswerers } from "@/modules/legal-documents/repository";
import { readRsvpAskAudienceSetting } from "./ask-audience";
import { reachedAudience, type RsvpAskAudience } from "./domain/ask-audience";

/**
 * What the event editor's tick for the «Vii?» email says it does (§823): «Termene»' two numbers and, of «Emailuri»' choice, the audience the
 * email REALLY reaches today — `null` while the privacy notice in force keeps it from going (`reachedAudience`).
 */
export type RsvpAskSettings = { daysBefore: number; hour: number; audience: RsvpAskAudience | null };

/** The settings the two editor pages hand `RegistrationBox`: the club's deadlines, its audience, and what the notice in force allows. */
export async function readRsvpAskSettings<T extends Record<string, unknown>>(db: Database<T>, deadlines: Pick<Deadlines, "rsvpAskDaysBefore" | "rsvpAskHour">, now: Date): Promise<RsvpAskSettings> {
  const [{ audience }, describesAsk, describesAnswerers] = await Promise.all([readRsvpAskAudienceSetting(db), noticeDescribesRsvpAsk(db, now), noticeDescribesRsvpAskAnswerers(db, now)]);
  return { ...rsvpAskTimingOf(deadlines), audience: reachedAudience(audience, describesAsk, describesAnswerers) };
}
