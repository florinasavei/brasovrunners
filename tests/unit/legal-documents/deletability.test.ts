import { describe, expect, it } from "vitest";
import {
  type DeletionFacts,
  deletionObstacle,
  dependantObstacle,
  inForceWindow,
  type VersionTimeline,
} from "@/modules/legal-documents/domain/deletability";

/**
 * BR-REQ-053-02, `DECISIONS.md` §203, §290 and §316 — whether an approved legal version may be
 * deleted, as pure functions the service, the delete screen and the list all ask.
 *
 * §203 refused every terms version that had *ever* been in force, because a registration records
 * no terms version and the three dependant counts are vacuous for that key. The owner met that as
 * a list offering "Șterge definitiv" beside "Nefolosit încă" and a page refusing it, three times
 * ("Still can't delete these docs..."). The evidence was there all along: a terms version is
 * accepted at the instant a registration is submitted, or its declaration signed, while it is the
 * text in force. So the rule is now a window — when was it in force — and a count of the
 * registrations that did either inside it.
 *
 * These pin the window, and the order in which the reasons are given.
 */

const at = (iso: string) => new Date(iso);

let sequence = 0;
function version(
  number: number,
  effectiveAt: string,
  options: { withdrawnAt?: string; isApproved?: boolean; key?: VersionTimeline["key"] } = {},
): VersionTimeline {
  sequence += 1;
  return {
    id: `v-${sequence}`,
    key: options.key ?? "TERMS",
    version: number,
    isApproved: options.isApproved ?? true,
    effectiveAt: at(effectiveAt),
    withdrawnAt: options.withdrawnAt ? at(options.withdrawnAt) : null,
  };
}

/*
  The history on the owner's screen, 2026-09-23: Termeni de concurs v1 in force from 4 September
  and withdrawn on the 20th, v2 in force from the 20th and withdrawn on the 21st, v3 in force
  since the 21st.
*/
const NOW = at("2026-09-23T12:00:00.000Z");
const v1 = version(1, "2026-09-04T08:00:00.000Z", { withdrawnAt: "2026-09-20T12:00:00.000Z" });
const v2 = version(2, "2026-09-20T10:00:00.000Z", { withdrawnAt: "2026-09-21T12:00:00.000Z" });
const v3 = version(3, "2026-09-21T09:00:00.000Z");
const history = [v3, v2, v1];

describe("§316 when a version was the text in force", () => {
  it("the first version: from its date until its successor took effect, not until its own withdrawal", () => {
    // v1 was withdrawn at noon on the 20th, but v2 had taken over at ten: from then on a
    // registration accepted v2, whatever v1's row said.
    expect(inForceWindow(v1, history, NOW)).toEqual({
      from: at("2026-09-04T08:00:00.000Z"),
      until: at("2026-09-20T10:00:00.000Z"),
    });
  });

  it("a middle version: from its date until the next one took effect", () => {
    expect(inForceWindow(v2, history, NOW)).toEqual({
      from: at("2026-09-20T10:00:00.000Z"),
      until: at("2026-09-21T09:00:00.000Z"),
    });
  });

  it("the current version: from its date, still open", () => {
    expect(inForceWindow(v3, history, NOW)).toEqual({
      from: at("2026-09-21T09:00:00.000Z"),
      until: null,
    });
  });

  it("is in force from the very instant it takes effect", () => {
    // Inclusive on purpose: somebody registering in that second accepted it.
    expect(inForceWindow(v3, history, at("2026-09-21T09:00:00.000Z"))).toEqual({
      from: at("2026-09-21T09:00:00.000Z"),
      until: null,
    });
    // And the successor's first instant is no longer the predecessor's.
    expect(inForceWindow(v2, history, NOW)?.until).toEqual(v3.effectiveAt);
  });

  it("a version approved ahead of its date and superseded before it took effect: never in force", () => {
    // Next season's terms dated for October, then a correction approved and effective on the
    // 25th. On 1 October both have arrived and the higher number wins, so version 2 was never the
    // text in force — even though its date has passed. §203's rule, keyed on the date alone,
    // refused exactly this row.
    const first = version(1, "2026-09-01T00:00:00.000Z");
    const ahead = version(2, "2026-10-01T00:00:00.000Z");
    const correction = version(3, "2026-09-25T00:00:00.000Z");
    const rows = [first, ahead, correction];

    expect(inForceWindow(ahead, rows, at("2026-10-05T00:00:00.000Z"))).toBeNull();
    expect(inForceWindow(first, rows, at("2026-10-05T00:00:00.000Z"))).toEqual({
      from: at("2026-09-01T00:00:00.000Z"),
      until: at("2026-09-25T00:00:00.000Z"),
    });
  });

  it("a version whose date has not arrived yet: not in force, nothing accepted", () => {
    const ahead = version(2, "2026-10-01T00:00:00.000Z");
    expect(inForceWindow(ahead, [v1, ahead], NOW)).toBeNull();
  });

  it("a version withdrawn before its date: never in force", () => {
    const ahead = version(2, "2026-10-01T00:00:00.000Z", { withdrawnAt: "2026-09-22T00:00:00.000Z" });
    expect(inForceWindow(ahead, [v1, ahead], at("2026-10-05T00:00:00.000Z"))).toBeNull();
  });

  it("a draft: never in force", () => {
    const draft = version(4, "2026-09-22T00:00:00.000Z", { isApproved: false });
    expect(inForceWindow(draft, [...history, draft], NOW)).toBeNull();
  });

  it("two versions approved in the same instant: the lower one was never in force", () => {
    const first = version(1, "2026-09-06T12:00:00.000Z");
    const second = version(2, "2026-09-06T12:00:00.000Z");
    expect(inForceWindow(first, [first, second], NOW)).toBeNull();
    expect(inForceWindow(second, [first, second], NOW)).toEqual({ from: second.effectiveAt, until: null });
  });

  it("a draft or a withdrawn-before-its-date successor does not shorten the window", () => {
    const first = version(1, "2026-09-01T00:00:00.000Z");
    const draft = version(2, "2026-09-05T00:00:00.000Z", { isApproved: false });
    const abandoned = version(3, "2026-09-10T00:00:00.000Z", { withdrawnAt: "2026-09-08T00:00:00.000Z" });
    expect(inForceWindow(first, [first, draft, abandoned], NOW)).toEqual({ from: first.effectiveAt, until: null });
  });

  it("the other documents' versions do not shorten it either", () => {
    const notice = version(9, "2026-09-10T00:00:00.000Z", { key: "PRIVACY_NOTICE" });
    expect(inForceWindow(v3, [...history, notice], NOW)).toEqual({ from: v3.effectiveAt, until: null });
  });

  it("an odd, seeded history with a gap is counted across the gap, which errs towards refusing", () => {
    // Version 2 withdrawn while it was in force is something the backoffice refuses, so only a
    // seed or a hand-written row can produce it. Version 1 is then in force twice; the window is
    // the whole span, and more registrations fall inside it rather than fewer.
    const first = version(1, "2026-09-01T00:00:00.000Z");
    const odd = version(2, "2026-09-05T00:00:00.000Z", { withdrawnAt: "2026-09-08T00:00:00.000Z" });
    const third = version(3, "2026-09-10T00:00:00.000Z");
    expect(inForceWindow(first, [first, odd, third], NOW)).toEqual({
      from: at("2026-09-01T00:00:00.000Z"),
      until: at("2026-09-10T00:00:00.000Z"),
    });
  });
});

const unused: DeletionFacts = {
  isApproved: true,
  acceptanceCount: 0,
  eventCount: 0,
  privacyAcknowledgementCount: 0,
  inForce: false,
  terms: null,
};
const window = { from: at("2026-09-04T08:00:00.000Z"), until: at("2026-09-20T10:00:00.000Z") };

describe("§316 the reasons a version may not be deleted, in the order they are given", () => {
  it("nothing stands on an unused, superseded version of the notice or the declaration", () => {
    expect(deletionObstacle(unused)).toBeNull();
  });

  it("a terms version nobody registered or signed under may go", () => {
    // The owner's two rows. §203 refused them for having been in force at all.
    expect(deletionObstacle({ ...unused, terms: { window, registrations: 0 } })).toBeNull();
  });

  it("a terms version with a registration in its window is refused, with the count and the window", () => {
    expect(deletionObstacle({ ...unused, terms: { window, registrations: 3 } })).toEqual({
      kind: "termsAccepted",
      registrations: 3,
      window,
    });
  });

  it("a draft is answered first, by naming its own verb", () => {
    expect(
      deletionObstacle({ ...unused, isApproved: false, acceptanceCount: 2, inForce: true }),
    ).toEqual({ kind: "draft" });
  });

  it("the counts come before the version in force, and both before the terms window", () => {
    expect(
      deletionObstacle({
        ...unused,
        privacyAcknowledgementCount: 4,
        inForce: true,
        terms: { window, registrations: 1 },
      }),
    ).toEqual({ kind: "referenced", signatures: 0, events: 0, acknowledgements: 4 });

    // In force is told before the window: withdrawing is the step that actually moves, and a
    // version in force cannot even be withdrawn until its successor is approved.
    expect(
      deletionObstacle({ ...unused, inForce: true, terms: { window: { ...window, until: null }, registrations: 7 } }),
    ).toEqual({ kind: "inForce" });
  });

  it("withdrawal's question ignores the terms window, which is deletion's alone", () => {
    // Withdrawal keeps the words, so a blind count loses nothing there; only deletion destroys
    // them (§203). A terms version somebody accepted can still be withdrawn.
    expect(dependantObstacle({ ...unused, terms: { window, registrations: 5 } } as DeletionFacts)).toBeNull();
    expect(dependantObstacle({ ...unused, eventCount: 1 })).toEqual({
      kind: "referenced",
      signatures: 0,
      events: 1,
      acknowledgements: 0,
    });
    expect(dependantObstacle({ ...unused, inForce: true })).toEqual({ kind: "inForce" });
  });
});
