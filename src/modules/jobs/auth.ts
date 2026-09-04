import { timingSafeEqual } from "node:crypto";
import { env } from "@/shared/config/env";

/**
 * The job endpoints' own identity check (AGENTS.md §16.2): a scoped secret, not a staff
 * session — a scheduler has no staff role and must not be handed one just to call an internal
 * endpoint. Constant-time comparison for the same reason token hashes are compared that way
 * elsewhere: a secret this narrow is exactly the kind of value a timing side-channel could leak
 * one byte at a time.
 */
export function isAuthorizedJobRequest(request: Request): boolean {
  if (!env.JOB_SECRET) return false;

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided) return false;

  const expected = Buffer.from(env.JOB_SECRET);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
