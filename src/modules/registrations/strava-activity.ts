import { eq } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { DomainError } from "@/shared/errors/domain-error";
import { anotherAdultOnTheLink, managedRegistration } from "./manage-family";
import { findRegistrationById } from "./repository";
import { eventTypeOf } from "./results-consent";
import { stravaActivityUrl } from "./social-links";

/**
 * «Activitatea ta pe Strava» (§NNN; the owner, 2026-11-22: «cât de greu ar fi să-i las să-și pună link către activitate strava din
 * aplicație?» — and «da» to the shape: a box on the runner's own registration page, the link beside their name in the results).
 *
 * The shape of `results-consent.ts`: the `MANAGE_REGISTRATION` token is read, never spent, POST only, and the token says which
 * registration; a posted id is only ever another person the same link already manages (`managedRegistration`, §547). Another adult
 * on the address may have their link taken off from this link, never written: it is theirs (§421, `anotherAdultOnTheLink`).
 *
 * **What is accepted.** One activity on strava.com, normalised to `https://www.strava.com/activities/<id>` (`stravaActivityUrl`) —
 * never the app's `strava.app.link`, a redirector a public page never prints (§500). An empty box takes the link off. A link is
 * written only on a confirmed registration at a race — a runner whose result the published results may print; taking one off is
 * always accepted.
 *
 * **What the write is.** `strava_activity_url` set or cleared, `updated_at` bumped, and one audit row
 * `registration.strava_activity_changed` with whether it was set or cleared and the door — never the link, which names its athlete
 * (AGENTS.md §12.12). One transaction, the row locked first; the same link twice writes nothing. The published results print the link
 * only beside a name they print (`readPublicEventResults`); their public read is expired after the commit.
 */

/** Which door the change came through; audit metadata, never the link. */
export type StravaActivitySurface = "MANAGE_LINK";

/** The refusal of a typed value that is not a strava.com activity. */
export const STRAVA_ACTIVITY_INVALID = "stravaActivityInvalid";
/** The refusal of a link on a registration that cannot have one: not confirmed, or not at a race. */
export const STRAVA_ACTIVITY_NOT_OFFERED = "stravaActivityNotOffered";

/** Whether a registration may hold a link: a confirmed one, at an event that takes results. */
export function stravaActivityOffered(status: string, eventType: string | null): boolean {
  return status === "CONFIRMED" && eventType !== null && eventTakesResults(eventType);
}

export async function setStravaActivity<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { registrationId: string; url: string | null; via: StravaActivitySurface; now: Date },
): Promise<{ changed: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (input.url !== null && !stravaActivityOffered(current.status, await eventTypeOf(tx, current.eventId))) {
      throw new DomainError("VALIDATION_ERROR", "only a confirmed runner at a race links their activity", [STRAVA_ACTIVITY_NOT_OFFERED]);
    }
    if (current.stravaActivityUrl === input.url) return { changed: false };

    await tx.update(registrations).set({ stravaActivityUrl: input.url, updatedAt: input.now }).where(eq(registrations.id, current.id));
    // The participant's own act: no staff actor, the door, never the link.
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      participantId: current.participantId,
      action: "registration.strava_activity_changed",
      entityType: "registration",
      entityId: current.id,
      metadata: { to: input.url === null ? "cleared" : "set", via: input.via },
      now: input.now,
    });
    return { changed: true };
  });
  // The published results show the link, or stop showing it, for the next visitor (§333) — after the commit.
  if (result.changed) revalidatePublicContent("places");
  return result;
}

/**
 * From the registration's own manage page: `typed` as the box posted it — empty takes the link off. The token is read, never spent.
 * Per person (§547): `registrationId` names another registration of the same address at the same event; anything else is NOT_FOUND.
 */
export async function setStravaActivityFromManageLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  typed: string,
  now: Date,
  registrationId?: string,
): Promise<{ ok: true; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;
  if (!context.token.registrationId) return TOKEN_NOT_FOUND;

  const own = await findRegistrationById(db, context.token.registrationId);
  const target = own ? await managedRegistration(db, own, registrationId) : null;
  if (!target) throw new DomainError("NOT_FOUND", "not a registration this link manages");

  const url = typed.trim() === "" ? null : stravaActivityUrl(typed);
  if (typed.trim() !== "" && url === null) throw new DomainError("VALIDATION_ERROR", "not a strava.com activity", [STRAVA_ACTIVITY_INVALID]);
  // Another adult on the address (§421): this link may take their link off, never write one.
  if (url !== null && own && anotherAdultOnTheLink(own, target, now)) {
    throw new DomainError("FORBIDDEN", "another adult on the address links their own activity");
  }

  const result = await setStravaActivity(db, { registrationId: target.id, url, via: "MANAGE_LINK", now });
  return { ok: true as const, ...result };
}
