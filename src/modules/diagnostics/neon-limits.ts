import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import type { Env } from "@/shared/config/env";
import { DomainError, type DomainErrorCode } from "@/shared/errors/domain-error";
import { checkNeonLimits, describeNeonLimits, type NeonLimitsReading, parseNeonLimitsRequest } from "./domain/neon-limits";
import { type NeonDeps, type NeonFailure, readNeonLimits, writeNeonLimits } from "./neon";

/**
 * The database's brakes, changed by an Administrator from `/admin/tasks` → Costuri (§NNN): the
 * compute's size ceiling and the period's CU-hour limit, both held by Neon rather than by this
 * application — so there is no settings row here, only Neon's answer before, the change, Neon's
 * answer after, and the audit row between them.
 *
 * The same gate as the Neon plan beside it (`canManageRegistrations`, §280's follow-up),
 * asserted here, where the change is made, whatever the page showed. The rules the form states —
 * one of six ceilings, a new or changed limit above what is spent plus a margin, a ticked
 * confirmation for a new, changed or removed limit on production — are checked against a fresh read,
 * never against the figures the page rendered a minute ago; the limit Neon holds, posted back
 * untouched, is kept to the second and meets neither rule.
 */

/** One fixed id per setting for the audit row; `…e001`–`…e006` are taken (§100, §164, §244, §247, §254, §306). */
export const NEON_LIMITS_ENTITY_ID = "00000000-0000-4000-8000-00000000e007";

/**
 * The refusals this service adds to `Admin.errors`, each a sentence the form shows: the two rules
 * the form states, and the ways Neon can fail to take the change.
 */
export const NEON_LIMITS_REFUSAL_CODES = [
  "NEON_QUOTA_BELOW_USAGE",
  "NEON_QUOTA_UNCONFIRMED",
  "NEON_QUOTA_REMOVAL_UNCONFIRMED",
  "NEON_UNCONFIGURED",
  "NEON_KEY_FORBIDDEN",
  "NEON_BUSY",
  "NEON_REFUSED",
  "NEON_UNREACHABLE",
] as const;
export type NeonLimitsRefusalCode = (typeof NEON_LIMITS_REFUSAL_CODES)[number];

/**
 * A domain error that carries the sentence to show. Still a `DomainError`, so `refused()` treats
 * it as an expected answer and the form keeps every box (§315); the action swaps the generic code
 * for `reason`, the way the legal delete tells its refusals apart.
 */
export class NeonLimitsRefusal extends DomainError {
  readonly reason: NeonLimitsRefusalCode;

  constructor(code: DomainErrorCode, reason: NeonLimitsRefusalCode, message: string, fields: readonly string[] = []) {
    super(code, message, fields);
    this.reason = reason;
  }
}

export function refusalOfFailure(failure: NeonFailure): NeonLimitsRefusalCode {
  switch (failure.kind) {
    case "unconfigured":
      return "NEON_UNCONFIGURED";
    case "forbidden":
      return "NEON_KEY_FORBIDDEN";
    case "busy":
      return "NEON_BUSY";
    case "refused":
      return "NEON_REFUSED";
    default:
      return "NEON_UNREACHABLE";
  }
}

function failed(failure: NeonFailure, when: "read" | "write"): NeonLimitsRefusal {
  const status = "status" in failure ? ` ${failure.status}` : "";
  return new NeonLimitsRefusal(
    failure.kind === "forbidden" ? "FORBIDDEN" : "CONFLICT",
    refusalOfFailure(failure),
    `neon ${when} failed: ${failure.kind}${status}`,
  );
}

/** What the audit row keeps of a reading: the two brakes, as Neon states them. */
function brakes(reading: NeonLimitsReading): { maxCu: number | null; quotaCuHours: number | null } {
  return { maxCu: describeNeonLimits(reading).maxCu, quotaCuHours: reading.quotaCuHours };
}

export type NeonLimitsOutcome = {
  /** False when Neon already had exactly these values and nothing was sent. */
  changed: boolean;
  before: NeonLimitsReading;
  /** Neon's answer after the change, or null when it did not answer the read-back. */
  after: NeonLimitsReading | null;
};

export async function updateNeonLimits<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  deps: NeonDeps & { env: Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID" | "APP_ENV">; now: Date },
): Promise<NeonLimitsOutcome> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the Neon limits`);
  }
  const parsed = parseNeonLimitsRequest(rawInput);
  if (!parsed.ok) {
    throw new DomainError("VALIDATION_ERROR", `neon limits: ${parsed.fields.join(", ")}`, parsed.fields);
  }
  const request = parsed.request;

  const read = await readNeonLimits(deps.env, deps);
  if (!read.ok) throw failed(read.failure, "read");
  const before = read.snapshot.limits;

  const rule = checkNeonLimits(request, {
    usedCuHours: before.usedCuHours,
    quotaCuHours: before.quotaCuHours,
    plan: before.reportedPlan,
    appEnv: deps.env.APP_ENV,
  });
  if (rule) {
    throw rule.code === "VALIDATION_ERROR"
      ? new DomainError("VALIDATION_ERROR", `neon limits: ${rule.field} above the plan's ceiling`, [rule.field])
      : new NeonLimitsRefusal("VALIDATION_ERROR", rule.code, `neon limits: ${rule.code}`, [rule.field]);
  }

  const written = await writeNeonLimits(deps.env, read.snapshot, { maxCu: request.maxCu, quotaCuHours: request.quotaCuHours }, deps);
  if (written.wrote.length === 0) {
    if (!written.ok) throw failed(written.failure, "write");
    return { changed: false, before, after: before };
  }

  // Something was applied, whole or in part: what Neon says now is what the row records and what
  // the card shows — never the request, which Neon may have rounded, capped or half refused.
  const reread = await readNeonLimits(deps.env, deps);
  const after = reread.ok ? reread.snapshot.limits : null;
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "neon_limits.changed",
    entityType: "platform_setting",
    entityId: NEON_LIMITS_ENTITY_ID,
    metadata: {
      from: brakes(before),
      to: after ? brakes(after) : null,
      requested: { maxCu: request.maxCu, quotaCuHours: request.quotaCuHours },
      environment: deps.env.APP_ENV,
      complete: written.ok,
    },
    now: deps.now,
  });
  if (!written.ok) throw failed(written.failure, "write");
  return { changed: true, before, after };
}
