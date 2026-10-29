// A database error as a person can act on it (§868): every level of its `.cause` chain with its code, then what to do
// for the causes we have met. Drizzle wraps the driver's error, so its own message is only «Failed query: …» — on
// 2026-10-28 that hid Neon's «53000 Your account or project has exceeded the quota» behind the first query of
// every migration run, and the cause was found in Neon's console instead.

/** The levels of `error.cause`, outermost first, each `«code» message`, without repeats. */
export function causesOf(error) {
  const levels = [];
  for (let cause = error, depth = 0; cause && depth < 6; cause = cause.cause, depth++) {
    const message = typeof cause === "object" ? String(cause.message ?? "").trim() : String(cause);
    const code = typeof cause === "object" && cause.code ? String(cause.code) : "";
    const line = [code, message].filter(Boolean).join(" ");
    if (line && !levels.includes(line)) levels.push(line);
    if (typeof cause !== "object") break;
  }
  return levels;
}

/** What to do, for the causes met so far; null when none of them is recognised. */
export function remedyOf(error) {
  const text = causesOf(error).join("\n");
  if (/\b53000\b|exceeded the (compute time )?quota/i.test(text)) {
    return "Neon suspended this project for its monthly compute quota. Raise the quota (SETUP.md §40); a raised quota does not lift the suspension by itself — set it to 0, start the compute, set it back (docs/RUNBOOKS.md § Neon suspended a project). Then re-run this migration.";
  }
  if (/\b28P01\b|password authentication failed/i.test(text)) return "The password in DATABASE_URL is wrong for this database: copy the connection string again from Neon.";
  if (/\b(ENOTFOUND|EAI_AGAIN)\b/.test(text)) return "The database's host name does not resolve: check the host in DATABASE_URL.";
  if (/\b(ECONNREFUSED|ETIMEDOUT|ECONNRESET)\b|timeout/i.test(text)) return "The database did not answer: check Neon's status and that DATABASE_URL points at the right project.";
  return null;
}

/** The lines to print for a failed database step. */
export function describeError(error) {
  const levels = causesOf(error);
  const remedy = remedyOf(error);
  return [...levels.map((line, index) => (index === 0 ? line : `  caused by: ${line}`)), ...(remedy ? [`  what to do: ${remedy}`] : [])].join("\n");
}
