/**
 * "A newer build is deployed" — the rules, with no browser in them.
 *
 * Everything in this file is a pure function of its arguments, and everything that decides
 * whether a visitor is interrupted lives here rather than in the island: the comparison, what
 * a broken answer counts as, and when a dismissal or a recent reload keeps the notice down.
 * The island (`NewBuildNotice.tsx`) owns the timer, the fetch and the DOM; this owns the
 * judgement, which is the part worth testing (`tests/unit/config/new-build.test.ts`).
 *
 * ## Why a confirmation and never a reload
 *
 * The owner asked for an automatic refresh and then corrected himself the same minute. He is
 * right. This platform exists to collect a twenty-field registration form, a signature drawn
 * with a finger, and a declaration somebody is part-way through reading — and the club deploys
 * several times an evening while testing. A reload nobody asked for destroys exactly the work
 * the site is for. So nothing here, and nothing that calls it, reloads anything: the only
 * reload in the feature is `location.reload()` behind a button a person pressed.
 */

/** Where the deployed build's identity is served from. Nothing else is on that route. */
export const BUILD_ENDPOINT = "/api/build-id";

/**
 * How often a visible tab asks.
 *
 * Sixty seconds, matching the interval the owner's other project settled on. The cost is not
 * the concern it would be for `/api/health` — that one touches the database, and Neon's free
 * plan is a hundred CU-hours a month per project (`DECISIONS.md` §68), which is why the
 * external monitors are deliberately slow. `/api/build-id` is a build-time constant served as a
 * static asset, so a poll is a CDN hit and not an invocation, and the database is never in the
 * path. What sixty seconds buys is the useful thing: the club is testing, it deploys, and
 * within a minute every open tab offers to catch up.
 */
export const POLL_INTERVAL_MS = 60_000;

/**
 * How long the answer is given before the attempt is abandoned.
 *
 * Three seconds. A hanging request must never wedge the check: without a deadline one stalled
 * connection leaves `inFlight` true for as long as the browser keeps the socket, and the tab
 * silently stops asking for the rest of its life.
 */
export const ANSWER_TIMEOUT_MS = 3_000;

/**
 * After a reload, this tab says nothing for a minute.
 *
 * The notice never reloads on its own, so this is not protection against a loop the code could
 * start — it is protection against one a *deployment* could. If the reload lands on the same
 * old document (a CDN that has not caught up, an alias pointing somewhere unexpected, a
 * deployment that half-succeeded) the answer still differs from the running build, the notice
 * comes straight back, and a person who trusts it presses the button again. Silence per tab
 * turns that into one wasted reload instead of a rhythm.
 *
 * **Five minutes, not one, and the reason is arithmetic (§210, found in review.)** At one minute
 * it could never fire: the first poll of the reloaded document happens at
 * `reloadedAt + POLL_INTERVAL_MS + however long the page took to load`, which is always past a
 * cooldown of exactly `POLL_INTERVAL_MS`. A guard that cannot be reached is not a guard. It has
 * to be comfortably longer than the interval it is meant to suppress, and five minutes is four
 * polls — long enough to cover a CDN catching up, short enough that a real second deployment in
 * the same sitting is still announced.
 */
export const RELOAD_COOLDOWN_MS = 5 * 60_000;

/**
 * Where the two remembered facts live. `sessionStorage`, so they are per tab: a dismissal is a
 * statement about *this* half-filled form, not about every tab on the machine, and a private
 * window that throws on access simply forgets both.
 */
export const BUILD_STORAGE_KEYS = {
  /** The build identity that was dismissed — not a boolean, so a newer one can still ask. */
  dismissed: "br.build.dismissed",
  /** When this tab last reloaded on the notice's button, as epoch milliseconds. */
  reloadedAt: "br.build.reloadedAt",
} as const;

/**
 * Twelve hex characters is what `next.config.ts` mints. The bound is generous rather than
 * exact so a future identity format is not a silent outage, and it exists at all so a
 * misconfigured proxy answering with a novel cannot become an identity.
 */
const MAX_IDENTITY_LENGTH = 64;

/** The longest body worth parsing. An HTML error page is usually much larger; it is rejected either way. */
const MAX_BODY_LENGTH = 4_096;

/**
 * An identity is a short, printable token. Restricted deliberately: the value is compared,
 * stored and eventually read by a person in a bug report, and nothing else should ever reach
 * those places.
 */
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * What the deployed build says it is — or `null`, for every other thing a network can hand back.
 *
 * This is the whole of the "never raise a notice on garbage" rule, and it takes the status and
 * the raw text rather than a parsed object so that every real failure is expressible as a test:
 *
 * - a 304, a 404, a 502, a captive portal's 200-with-HTML, a maintenance page;
 * - a body that is not JSON at all (`<!DOCTYPE html>`);
 * - JSON of the wrong shape (`{}`, `[]`, `null`, `{ "build": 7 }`);
 * - an empty or blank identity, which is what a build with no git checkout and no host
 *   deployment id honestly reports.
 *
 * Every one of them means "no answer", and no answer must look exactly like "no new build".
 * The alternative — treating a failure as a change — would put a notice on the screen of
 * anybody whose train went into a tunnel.
 */
export function readServedBuild(status: number, body: string | null | undefined): string | null {
  if (status !== 200) return null;
  if (typeof body !== "string" || body.length === 0 || body.length > MAX_BODY_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const value = (parsed as { build?: unknown }).build;
  if (typeof value !== "string") return null;

  const identity = value.trim();
  if (!identity || identity.length > MAX_IDENTITY_LENGTH) return null;
  if (!IDENTITY.test(identity)) return null;

  return identity;
}

/**
 * Is the deployed build a different one from the build this tab is running?
 *
 * **Different, not newer** — and that word is the decision, not a shortcut. Two deployment
 * identities cannot be ordered: they are hashes, by design (`next.config.ts`). More to the
 * point, ordering them would be wrong even if it were possible, because the deployment a tab
 * most urgently needs to hear about is a **rollback** — the club shipped something broken and
 * put the previous release back. That is an older commit and the most important reload of the
 * evening.
 *
 * An empty identity on either side is never a difference. The running side is empty on a build
 * with no git checkout and no host deployment id, which `build-info.ts` documents as a real
 * case; the served side is empty for the same reason, or because the answer was garbage. In
 * both cases the honest answer is "I cannot tell", and "I cannot tell" must be silent.
 */
export function isOtherBuild(running: string, served: string | null): boolean {
  if (!running || !served) return false;
  return served !== running;
}

export type NoticeInputs = {
  /** The identity of the build that served this document, as a string prop. */
  running: string;
  /** What `/api/build-id` answered, already through `readServedBuild`. */
  served: string | null;
  /** The identity this tab has already dismissed, or `null` — including when storage threw. */
  dismissed: string | null;
  /** When this tab last reloaded on the button, or `null`. */
  reloadedAt: number | null;
  /** Now, in epoch milliseconds. Passed in so this stays a function of its arguments. */
  now: number;
};

/**
 * Whether to put the notice on the screen.
 *
 * Three rules, in order, and each one is a way of not interrupting somebody:
 *
 * 1. The builds must actually differ, and both must be knowable.
 * 2. **The dismissal is keyed by the identity**, so the same deployment cannot ask twice and a
 *    different one still can. A boolean here would mean "this tab has stopped caring", and a
 *    person who waved away Tuesday's deploy has not agreed to run Tuesday's code all week.
 * 3. A reload on this notice inside the last minute buys silence — see `RELOAD_COOLDOWN_MS`.
 *    Only a cooldown that is *in the past* counts: a clock that jumped backwards (or a value
 *    somebody typed into storage) must not silence the notice until the end of time.
 */
export function shouldRaiseNotice({ running, served, dismissed, reloadedAt, now }: NoticeInputs): boolean {
  if (!isOtherBuild(running, served)) return false;
  if (dismissed !== null && dismissed === served) return false;

  if (reloadedAt !== null && Number.isFinite(reloadedAt)) {
    const since = now - reloadedAt;
    if (since >= 0 && since < RELOAD_COOLDOWN_MS) return false;
  }

  return true;
}

/**
 * The epoch milliseconds a stored reload stamp means, or `null` for anything it does not.
 *
 * `sessionStorage` holds strings and a person can edit them; `Number("")` is 0, which would
 * read as 1970 and silence nothing, while `Number("abc")` is `NaN`, which would compare false
 * in every direction. Both are turned into "there is no stamp" here rather than inside the
 * rule, so the rule stays about builds.
 */
export function readReloadStamp(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
