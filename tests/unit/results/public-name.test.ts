import { describe, expect, it } from "vitest";
import { anonymousResultLabel, type PublicNameInput, publicResultName } from "@/modules/results/domain/public-name";

/**
 * §NNN, BR-REQ-039-01 — whose name a published result carries: the public list's rule (§143, §396, §743) extended to the results, and §421's
 * notice line. A name only for a registered runner who ticked «Vreau să apar pe lista de participanți & rezultate», whose registration is
 * confirmed, is not a special guest the event hides, and was made under a notice that described the results; everyone else — unticked,
 * typed by hand without the staff's record of an agreement, erased, cancelled, hidden, registered before the notice — is «Participant #bib»; a
 * runner typed by hand is named once the staff recorded that the person agreed (§NNN, amending the results decision).
 */
const named: PublicNameInput = {
  registered: true,
  ticked: true,
  displayName: "Ana Popescu",
  confirmed: true,
  hidden: false,
  noticeVersion: 2,
  firstResultsNoticeVersion: 2,
  typedNameAgreed: false,
  typedDisplayName: null,
};
/** A runner the club typed by hand, with the staff's record that the person agreed to appear by name (§NNN): no registration, so none of the registration's answers. */
const typedAgreed: PublicNameInput = { registered: false, ticked: false, displayName: null, confirmed: false, hidden: false, noticeVersion: null, firstResultsNoticeVersion: 2, typedNameAgreed: true, typedDisplayName: "Ion Vasile" };

describe("§NNN publicResultName", () => {
  it("shows the registration's display name of a confirmed, ticked, shown runner who registered under a notice that described the results", () => {
    expect(publicResultName(named)).toBe("Ana Popescu");
    expect(publicResultName({ ...named, displayName: "  Ana  " })).toBe("Ana");
    // A later notice counts as much as the first that named the results.
    expect(publicResultName({ ...named, noticeVersion: 5 })).toBe("Ana Popescu");
  });

  it("shows nothing for a registered runner who did not tick", () => {
    expect(publicResultName({ ...named, ticked: false })).toBeNull();
  });

  it("shows nothing for a runner the club typed by hand when nobody recorded that they agreed, whatever the registration's answers say", () => {
    expect(publicResultName({ ...named, registered: false })).toBeNull();
    expect(publicResultName({ ...named, registered: false, ticked: false })).toBeNull();
    expect(publicResultName({ ...typedAgreed, typedNameAgreed: false })).toBeNull();
  });

  it("names a runner typed by hand once the staff recorded that they agreed, under a notice that described the results", () => {
    expect(publicResultName(typedAgreed)).toBe("Ion Vasile");
    expect(publicResultName({ ...typedAgreed, typedDisplayName: "  Ion Vasile  " })).toBe("Ion Vasile");
    // Any notice from the first that described the results on counts; the typed row has no version of its own.
    expect(publicResultName({ ...typedAgreed, firstResultsNoticeVersion: 1 })).toBe("Ion Vasile");
  });

  it("shows nothing for a typed runner who agreed while no approved notice describes the results, or with no name left to show", () => {
    expect(publicResultName({ ...typedAgreed, firstResultsNoticeVersion: null })).toBeNull();
    for (const typedDisplayName of [null, undefined, "", "   "]) expect(publicResultName({ ...typedAgreed, typedDisplayName }), String(typedDisplayName)).toBeNull();
  });

  it("ignores the staff mark on a registered runner: their name follows their own tick, never the typed columns", () => {
    expect(publicResultName({ ...named, ticked: false, typedNameAgreed: true, typedDisplayName: "Altcineva" })).toBeNull();
    expect(publicResultName({ ...named, typedNameAgreed: true, typedDisplayName: "Altcineva" })).toBe("Ana Popescu");
    // A cancelled, hidden or older-notice registration is not named by a mark either.
    expect(publicResultName({ ...named, confirmed: false, typedNameAgreed: true })).toBeNull();
    expect(publicResultName({ ...named, noticeVersion: 1, typedNameAgreed: true })).toBeNull();
  });

  it("shows nothing for a registration with no name left to show", () => {
    for (const displayName of [null, undefined, "", "   "]) expect(publicResultName({ ...named, displayName }), String(displayName)).toBeNull();
  });

  it("shows nothing for a registration that is not confirmed — cancelled, expired — though its result is in the club's list", () => {
    expect(publicResultName({ ...named, confirmed: false })).toBeNull();
  });

  it("shows nothing for a special guest the event hides (§743), ticked or not", () => {
    expect(publicResultName({ ...named, hidden: true })).toBeNull();
  });

  it("shows nothing for a registration made under a notice older than the first that described the results (§421's line), whatever it ticked", () => {
    expect(publicResultName({ ...named, noticeVersion: 1 })).toBeNull();
    expect(publicResultName({ ...named, noticeVersion: 1, firstResultsNoticeVersion: 2 })).toBeNull();
    // At the line itself it is named.
    expect(publicResultName({ ...named, noticeVersion: 2, firstResultsNoticeVersion: 2 })).toBe("Ana Popescu");
  });

  it("shows nothing at all while no approved notice describes the results, or the registration recorded none", () => {
    expect(publicResultName({ ...named, firstResultsNoticeVersion: null })).toBeNull();
    expect(publicResultName({ ...named, noticeVersion: null })).toBeNull();
  });
});

describe("§NNN anonymousResultLabel", () => {
  it("says «Participant #bib» in both languages, from the catalogue the page reads", () => {
    expect(anonymousResultLabel("ro", 123)).toBe("Participant #123");
    expect(anonymousResultLabel("en", 7)).toBe("Participant #7");
  });
});
