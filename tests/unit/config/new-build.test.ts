import { describe, expect, it } from "vitest";
import {
  isOtherBuild,
  readReloadStamp,
  readServedBuild,
  RELOAD_COOLDOWN_MS,
  shouldRaiseNotice,
} from "@/shared/ui/new-build";

/**
 * "A newer build is deployed" — the two rules that decide whether somebody is interrupted
 * (`src/shared/ui/new-build.ts`).
 *
 * A cross-cutting mechanism rather than a `BR-REQ-*`, so it is named after the thing it covers
 * (CLAUDE.md § Working conventions). The polling is deliberately **not** tested: a timer, a
 * `visibilitychange` listener and `fetch` are the browser's behaviour, not this project's, and
 * a test that mocked all three would assert its own mocks. What is tested is everything that
 * can put a notice on a reader's screen — which is the part that can be wrong in a way somebody
 * would feel.
 *
 * The stakes are the reason the rules are pure at all. This platform collects a twenty-field
 * form, a signature drawn with a finger, and a declaration somebody is reading; a notice on
 * garbage, or a notice the same deploy is allowed to raise twice, is a nudge towards throwing
 * that work away.
 */

const RUNNING = "a1b2c3d4e5f6";
const DEPLOYED = "0f9e8d7c6b5a";

describe("reading what the deployed build says it is", () => {
  it("accepts the answer /api/build actually serves", () => {
    expect(readServedBuild(200, JSON.stringify({ build: DEPLOYED }))).toBe(DEPLOYED);
  });

  it("trims an answer that arrived with whitespace around it", () => {
    expect(readServedBuild(200, `{"build":"  ${DEPLOYED}  "}`)).toBe(DEPLOYED);
  });

  /**
   * The empty identity is a real case, not a defensive one: `build-info.ts` documents a build
   * with no git checkout, and on a host that is not Vercel there is no deployment id either, so
   * `next.config.ts` mints nothing. The route then honestly answers `{"build":""}`, and that
   * must read as "I cannot tell" rather than as a change.
   */
  it.each([
    ['{"build":""}', "an empty identity"],
    ['{"build":"   "}', "an identity of nothing but spaces"],
  ])("refuses %s (%s)", (body) => {
    expect(readServedBuild(200, body)).toBeNull();
  });

  /**
   * Garbage, in every shape a network really produces. None of these may raise a notice, and
   * they are separate cases because each one arrives by a different route: a captive portal
   * answers 200 with a login page, a platform mid-deploy answers HTML, a proxy answers its own
   * JSON, and a route that was renamed answers 404.
   */
  it.each([
    ["<!DOCTYPE html><html><body>Gateway timeout</body></html>", "an HTML error page with a 200"],
    ["", "an empty body"],
    ["not json at all", "plain text"],
    ["null", "JSON null"],
    ["[]", "a JSON array"],
    ['"a1b2c3d4e5f6"', "a bare JSON string"],
    ["{}", "JSON with no build field"],
    ['{"build":7}', "a numeric build"],
    ['{"build":null}', "a null build"],
    ['{"build":{"id":"a1b2c3"}}', "a nested build"],
    ['{"build":"a1b2 c3d4"}', "an identity with a space in it"],
    ['{"build":"<script>x</script>"}', "an identity that is markup"],
  ])("refuses %s (%s)", (body) => {
    expect(readServedBuild(200, body)).toBeNull();
  });

  it("refuses an over-long identity rather than storing and comparing it", () => {
    expect(readServedBuild(200, JSON.stringify({ build: "a".repeat(65) }))).toBeNull();
  });

  it("refuses a body too large to be this answer, without parsing it", () => {
    // A maintenance page is megabytes; the real answer is about thirty bytes.
    expect(readServedBuild(200, `{"build":"${"a".repeat(5000)}"}`)).toBeNull();
  });

  /**
   * A 304 is the one that would be easy to get wrong: `cache: no-store` makes it unlikely, but
   * a proxy is free to answer one, and it carries no body at all. Every non-200 is "no answer".
   */
  it.each([204, 304, 401, 404, 429, 500, 502, 503])("treats %i as no answer", (status) => {
    expect(readServedBuild(status, JSON.stringify({ build: DEPLOYED }))).toBeNull();
    expect(readServedBuild(status, null)).toBeNull();
  });
});

describe("comparing the deployed build with the running one", () => {
  it("sees a different deployment", () => {
    expect(isOtherBuild(RUNNING, DEPLOYED)).toBe(true);
  });

  it("sees nothing when the deployment is the one this tab is running", () => {
    expect(isOtherBuild(RUNNING, RUNNING)).toBe(false);
  });

  /**
   * The empty identity, from both sides. An identity that cannot change cannot detect a
   * change, and a tab that does not know what it is running must never guess.
   */
  it("is silent when either side has no identity", () => {
    expect(isOtherBuild("", DEPLOYED)).toBe(false);
    expect(isOtherBuild(RUNNING, "")).toBe(false);
    expect(isOtherBuild(RUNNING, null)).toBe(false);
    expect(isOtherBuild("", null)).toBe(false);
  });

  /**
   * Different, not newer — and a rollback is why. The club ships something broken and puts the
   * previous release back; that deployment is an older commit and the most important reload of
   * the evening. Ordering two identities is impossible anyway (they are hashes), but this test
   * exists to record that it would be the wrong thing to do even if it were possible.
   */
  it("treats a deployment that went backwards as a deployment", () => {
    const older = "000000000001";
    const newer = "ffffffffffff";
    expect(isOtherBuild(newer, older)).toBe(true);
  });
});

describe("whether the notice is raised", () => {
  const base = { running: RUNNING, served: DEPLOYED, dismissed: null, reloadedAt: null, now: 1_700_000_000_000 };

  it("raises on a deployment this tab has not been told about", () => {
    expect(shouldRaiseNotice(base)).toBe(true);
  });

  it("stays down when the deployment is this tab's own", () => {
    expect(shouldRaiseNotice({ ...base, served: RUNNING })).toBe(false);
  });

  it("stays down when there is nothing to compare", () => {
    expect(shouldRaiseNotice({ ...base, running: "" })).toBe(false);
    expect(shouldRaiseNotice({ ...base, served: null })).toBe(false);
  });

  it("stays down for a deployment this tab has already dismissed", () => {
    expect(shouldRaiseNotice({ ...base, dismissed: DEPLOYED })).toBe(false);
  });

  /**
   * The point of keying the dismissal by identity rather than by a flag: a reader who waved
   * away Tuesday's deploy has not agreed to run Tuesday's code all week.
   */
  it("raises again for a newer deployment after a dismissal", () => {
    const evenNewer = "112233445566";
    expect(shouldRaiseNotice({ ...base, served: evenNewer, dismissed: DEPLOYED })).toBe(true);
  });

  it("ignores a dismissal of a build that is neither side of this comparison", () => {
    expect(shouldRaiseNotice({ ...base, dismissed: "999999999999" })).toBe(true);
  });

  /**
   * One reload a minute per tab. The notice never reloads by itself, so this guards against a
   * loop a *deployment* could cause: a reload that lands on the same old document leaves the
   * answer still different, the notice would come straight back, and somebody who trusts it
   * would press the button again.
   */
  it("stays down for a minute after this tab reloaded on it", () => {
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now - 1 })).toBe(false);
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now })).toBe(false);
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now - (RELOAD_COOLDOWN_MS - 1) })).toBe(false);
  });

  it("asks again once the minute is up", () => {
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now - RELOAD_COOLDOWN_MS })).toBe(true);
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now - 10 * RELOAD_COOLDOWN_MS })).toBe(true);
  });

  /**
   * A stamp in the future is a clock that moved, or a value somebody typed into
   * `sessionStorage`. It must not buy silence until the end of time.
   */
  it("ignores a reload stamp from the future", () => {
    expect(shouldRaiseNotice({ ...base, reloadedAt: base.now + 60_000 })).toBe(true);
  });

  it("ignores a reload stamp that is not a number", () => {
    expect(shouldRaiseNotice({ ...base, reloadedAt: Number.NaN })).toBe(true);
    expect(shouldRaiseNotice({ ...base, reloadedAt: Number.POSITIVE_INFINITY })).toBe(true);
  });
});

describe("reading the remembered reload stamp", () => {
  it("reads what the island wrote", () => {
    expect(readReloadStamp("1700000000000")).toBe(1_700_000_000_000);
  });

  /**
   * `sessionStorage` holds strings and a person can edit them. `Number("")` is 0, which would
   * read as 1970 and silence nothing; `Number("abc")` is `NaN`, which compares false in every
   * direction. Both become "there is no stamp" here so the rule above stays about builds.
   */
  it.each([null, undefined, "", "   ", "abc", "NaN", "Infinity", "-1", "0"])(
    "treats %o as no stamp",
    (raw) => {
      expect(readReloadStamp(raw)).toBeNull();
    },
  );
});
