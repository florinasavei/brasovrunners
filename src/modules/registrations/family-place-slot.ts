import { createHmac } from "node:crypto";
import { deploymentSecretIssue } from "@/shared/config/deployment-secret";
import { env } from "@/shared/config/env";
import { registrationNameKey } from "./domain/name-key";

/**
 * The fixed key a laptop or a test run keys the slots with when it has neither `AUTH_SECRET` nor
 * `JOB_SECRET` (§543, the review of 2026-09-28, round five). Public on purpose, and only ever read
 * where no deployed data lives: on qa and production neither secret is a refusal
 * (`shared/config/deployment-secret.ts`). Fixed rather than drawn per process, as the form
 * draft's key is, because a slot outlives the process that wrote it: a development server restarted
 * mid-sitting must find the same slots, or the next form or a replayed half takes a second hold.
 */
export const LOCAL_FAMILY_SLOT_SECRET = "local-development-family-place-slot";

/** The key the slots are digested under: the deployment's secret, stable across restarts. */
export function familySlotSecret(source: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string } = env): string {
  const issue = deploymentSecretIssue(source);
  if (issue) throw new Error(issue);
  return `${source.AUTH_SECRET ?? source.JOB_SECRET ?? LOCAL_FAMILY_SLOT_SECRET}:family-place-hold`;
}

/**
 * The slot of a family sitting's held place (§543, `family_place_holds`): one per person the address
 * sends at the event, by the runner's name key (`registrationNameKey`, the rule `sameRunner` and the
 * server's own decisions use) — never one per form, and since the review of 2026-09-28, round five,
 * never one per sitting either. So the server, not the browser's half, decides whether a form adds a
 * person: a form for somebody the address already holds a live family place for — a hold of this
 * sitting or of an earlier one, or a reservation on their registration — adds nothing, whatever the
 * sealed half it arrived with says, a half replayed from after a sitting's deadline included (§39,
 * AGENTS.md §19.4).
 *
 * Keyed under the deployment's secret (`familySlotSecret`), so the row still names no person and no
 * address: the hex digest of the event, the participant's id and the name key is none of them, and
 * cannot be matched to one without the secret.
 */
export function familyPlaceSlot(eventId: string, participantId: string, legalName: string | null | undefined): string {
  const key = registrationNameKey(legalName ?? "");
  return createHmac("sha256", familySlotSecret()).update(`${eventId}\n${participantId}\n${key}`).digest("hex");
}
