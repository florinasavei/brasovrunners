import { describe, expect, it } from "vitest";
import { anonymousResultLabel, publicResultName } from "@/modules/results/domain/public-name";

/**
 * §NNN, BR-REQ-039-01 — whose name a published result carries: the public list's rule (§143, §396) extended to the results. A name only for a
 * registered runner who ticked «Vreau să apar pe lista de participanți & rezultate»; everyone else — unticked, typed by hand, erased —
 * is «Participant #bib».
 */
describe("§NNN publicResultName", () => {
  it("shows the registration's display name of a registered runner who ticked", () => {
    expect(publicResultName({ registered: true, ticked: true, displayName: "Ana Popescu" })).toBe("Ana Popescu");
    expect(publicResultName({ registered: true, ticked: true, displayName: "  Ana  " })).toBe("Ana");
  });

  it("shows nothing for a registered runner who did not tick", () => {
    expect(publicResultName({ registered: true, ticked: false, displayName: "Ana Popescu" })).toBeNull();
  });

  it("shows nothing for a runner the club typed by hand, whatever its row says: no staff member ticks for a runner", () => {
    expect(publicResultName({ registered: false, ticked: true, displayName: "Ion Vasile" })).toBeNull();
    expect(publicResultName({ registered: false, ticked: false, displayName: "Ion Vasile" })).toBeNull();
  });

  it("shows nothing for a registration with no name left to show", () => {
    for (const displayName of [null, undefined, "", "   "]) expect(publicResultName({ registered: true, ticked: true, displayName }), String(displayName)).toBeNull();
  });
});

describe("§NNN anonymousResultLabel", () => {
  it("says «Participant #bib» in both languages, from the catalogue the page reads", () => {
    expect(anonymousResultLabel("ro", 123)).toBe("Participant #123");
    expect(anonymousResultLabel("en", 7)).toBe("Participant #7");
  });
});
