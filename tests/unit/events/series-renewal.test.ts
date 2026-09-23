import { describe, expect, it } from "vitest";
import { renewalOf } from "@/modules/events/ui/series-sentence";

/**
 * BR-REQ-050-02 — a standing series (§122) says on the backoffice list that it renews itself
 * (§305; the owner: "I need to know here that the event is gonna be auto-renewed").
 *
 * `renewalOf` is handed the `repeat_rule` column of every row in the group. Only the source
 * carries one; the members carry `repeat_of` and a null rule.
 */
describe("§305 renewalOf — is this group a standing series, and until when", () => {
  const weekly = (until: string | null) => ({ cadence: "WEEKLY", weekdays: [], until, publish: false });

  it("finds the rule on the source among members that carry none", () => {
    expect(renewalOf([null, null, weekly(null), null])).toEqual({ until: null });
  });

  it("answers the chosen end date when the rule has one", () => {
    expect(renewalOf([weekly("2026-12-14")])).toEqual({ until: "2026-12-14" });
  });

  it("answers null for a set of dates made once, which really does end", () => {
    expect(renewalOf([null, null, null])).toBeNull();
    expect(renewalOf([])).toBeNull();
  });

  it("ignores a rule that does not read as one", () => {
    // `readRepeatRule` refuses garbage; a corrupt column must not become "renews for ever".
    expect(renewalOf([{ nonsense: true }, "WEEKLY", 42])).toBeNull();
  });
});
