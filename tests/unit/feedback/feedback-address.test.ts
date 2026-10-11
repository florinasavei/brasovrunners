import { describe, expect, it } from "vitest";
import { addressSearchWith, readPickerChip } from "@/modules/feedback/domain/event-picker";

/** The chosen event, day and chip in the address (§NNN): BR-REQ-070-04. */
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
  it("keeps the chip's word only for the two kinds", () => {
    expect(addressSearchWith("", { fel: "group" })).toBe("?fel=group");
    expect(readPickerChip("special")).toBe("special");
    expect(readPickerChip("nonsense")).toBe("all");
    expect(readPickerChip(undefined)).toBe("all");
  });
});
