import { createHmac, timingSafeEqual } from "node:crypto";
import { deploymentSecretIssue } from "@/shared/config/deployment-secret";
import { env } from "@/shared/config/env";

/** The key a laptop or a test run uses with neither `AUTH_SECRET` nor `JOB_SECRET`; on qa and production that is a refusal (`deployment-secret.ts`). */
const LOCAL_WITHDRAWN_SECRET = "local-development-rsvp-withdrawn";

function secretOf(source: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string }): string {
  const issue = deploymentSecretIssue(source);
  if (issue) throw new Error(issue);
  return `${source.AUTH_SECRET ?? source.JOB_SECRET ?? LOCAL_WITHDRAWN_SECRET}:rsvp-withdrawn`;
}

/** What the proof's slug carries when the deleted row was the «Vii?» email's unanswered question (§NNN): the page then says «nu te numărăm», and only a press made it. */
export const WITHDRAWN_ASKED_SUFFIX = ":nu";

/**
 * The proof that «Nu mai vin» was pressed on a link: a keyed digest of the spent link and the event's slug, carried by the redirect
 * that says «Gata, ți-am șters răspunsul». The row and its links are gone by then, so the page cannot ask the database; without the
 * proof the page would say the answer was deleted for any `?retras=` somebody typed into the club's address. Nothing here is a
 * secret of the person's: the digest reveals neither the link nor the key.
 */
export function withdrawnProof(token: string, slug: string, source: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string } = env): string {
  return createHmac("sha256", secretOf(source)).update(`${token}\n${slug}`).digest("hex").slice(0, 32);
}

/** Whether `proof` is the digest `withdrawnProof` makes for the link and slug (constant time). */
export function isWithdrawnProof(proof: string | undefined, token: string, slug: string, source: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string } = env): boolean {
  if (!proof) return false;
  const expected = Buffer.from(withdrawnProof(token, slug, source));
  const given = Buffer.from(proof);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
