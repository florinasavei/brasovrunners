import { describe, expect, it } from "vitest";
import { FEEDBACK_QUERY } from "@/modules/feedback/domain/branches";
import {
  addressSearchWith,
  chipSlug,
  CLIENT_ADDRESS_KEYS,
  initialChipFor,
  type PickerOption,
  readPickerChip,
  switchSearch,
} from "@/modules/feedback/domain/event-picker";

/** The chosen event, day and chip in the address (§716): BR-REQ-070-04. */
describe("addressSearchWith", () => {
  it("puts the event in beside the branch", () => {
    expect(addressSearchWith("?tip=cum-a-fost", { eveniment: "cursa-x" })).toBe("?tip=cum-a-fost&eveniment=cursa-x");
  });
  it("replaces a word and removes one set to empty or null", () => {
    expect(addressSearchWith("?tip=a&eveniment=x&data=2026-10-01", { eveniment: "y", data: "" })).toBe("?tip=a&eveniment=y");
    expect(addressSearchWith("?eveniment=x", { eveniment: null })).toBe("");
  });
  it("drops a refusal's words and the sent mark", () => {
    expect(addressSearchWith("?tip=a&error=required&fields=event,date&since=1&sent=a", { data: "2026-10-02" })).toBe("?tip=a&data=2026-10-02");
  });
});

describe("the words the browser may write", () => {
  it("are exactly the event, the day and the chip, in Romanian, and the server reads the same", () => {
    expect([...CLIENT_ADDRESS_KEYS].sort()).toEqual(["data", "eveniment", "filtru"]);
    expect(FEEDBACK_QUERY).toEqual({ branch: "tip", event: "eveniment", date: "data", chip: "filtru" });
  });
  it("refuses to write anything else: no message, rating, identity, name, contact or audience", () => {
    const forbidden = { message: "x", rating: "5", identity: "named", name: "Ana", contact: "a@b.ro", email: "a@b.ro", audience: "club", catre: "clubul", tip: "sugestie", reasons: "time" };
    expect(addressSearchWith("?tip=cum-a-fost", forbidden)).toBe("?tip=cum-a-fost");
    expect(addressSearchWith("", { ...forbidden, eveniment: "cursa-x" })).toBe("?eveniment=cursa-x");
  });
});

describe("the chip in the address", () => {
  it("is Romanian: speciale and grup, and «toate» is no word", () => {
    expect(addressSearchWith("", { filtru: "grup" })).toBe("?filtru=grup");
    expect(chipSlug("special")).toBe("speciale");
    expect(chipSlug("group")).toBe("grup");
    expect(chipSlug("all")).toBeNull();
    expect(readPickerChip("speciale")).toBe("special");
    expect(readPickerChip("grup")).toBe("group");
    expect(readPickerChip(["grup", "x"])).toBe("group");
    expect(readPickerChip("group")).toBe("all");
    expect(readPickerChip("nonsense")).toBe("all");
    expect(readPickerChip(undefined)).toBe("all");
  });
});

describe("initialChipFor: the chip yields to an event it would hide", () => {
  const options: PickerOption[] = [
    { value: "", label: "Altceva", kind: "other", day: null, when: null },
    { value: "cursa", label: "Cursa", kind: "race", day: "2026-10-04", when: null },
    { value: "alergare", label: "Alergare", kind: "group", day: "2026-10-05", when: null },
    { value: "drumetie", label: "Drumeție", kind: "other", day: "2026-10-06", when: null },
  ];
  it("keeps the chip the event is under, and an event the list does not hold or «Altceva»", () => {
    expect(initialChipFor(options, "alergare", "group")).toBe("group");
    expect(initialChipFor(options, "cursa", "special")).toBe("special");
    expect(initialChipFor(options, "drumetie", "special")).toBe("special");
    expect(initialChipFor(options, "", "group")).toBe("group");
    expect(initialChipFor(options, "nu-exista", "group")).toBe("group");
    expect(initialChipFor(options, "cursa", "all")).toBe("all");
  });
  it("yields to «toate» when the event is not under it", () => {
    expect(initialChipFor(options, "cursa", "group")).toBe("all");
    expect(initialChipFor(options, "drumetie", "group")).toBe("all");
    expect(initialChipFor(options, "alergare", "special")).toBe("all");
  });
  it("opens on «toate», whatever the address asks, when the chips are not drawn — the events are of one kind", () => {
    const [general, race, group, hike] = options;
    // Only group runs, only special events, none at all: the chips are not drawn, so nothing could press them back.
    for (const list of [[general, group], [general, race, hike], [general], []]) {
      for (const requested of ["special", "group", "all"] as const) {
        for (const selected of ["", "alergare", "cursa", "nu-exista"]) {
          expect(initialChipFor(list, selected, requested), `${list.length} rows, ${selected || "Altceva"}, ${requested}`).toBe("all");
        }
      }
    }
    // The same chip on a list that draws them stands.
    expect(initialChipFor([general, race, group], "alergare", "group")).toBe("group");
  });
});

describe("switchSearch: «Schimbă tipul mesajului» keeps the choice and never the branch", () => {
  it("carries the event, the day and the chip", () => {
    expect(switchSearch("?tip=cum-a-fost&eveniment=cursa&data=2026-10-04&filtru=grup&error=x")).toBe("?eveniment=cursa&data=2026-10-04&filtru=grup");
    expect(switchSearch("?tip=cum-a-fost")).toBe("");
  });
});
