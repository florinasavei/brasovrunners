import { describe, expect, it } from "vitest";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";

/**
 * BR-REQ-039-01 criterion 5 (`DECISIONS.md` §143) — the public participant list is opted
 * *into*: the box says "I want to appear on the participant list", and no tick keeps the
 * name off. The row keeps its `listOptOut` column; the form reads the other way round.
 */
describe("BR-REQ-039-01 criterion 5 the participant list is opted into", () => {
  it("keeps the name off the list unless the box is ticked", () => {
    expect(readRegistrationForm(new FormData(), "ro").listOptOut).toBe(true);

    const ticked = new FormData();
    ticked.set("listOptIn", "on");
    expect(readRegistrationForm(ticked, "ro").listOptOut).toBe(false);

    // The old name of the box is not read: an unknown field is no consent.
    const old = new FormData();
    old.set("listOptOut", "on");
    expect(readRegistrationForm(old, "ro").listOptOut).toBe(true);
  });
});
