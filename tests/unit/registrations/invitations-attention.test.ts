import { describe, expect, it } from "vitest";
import { inviteTarget } from "@/modules/registrations/domain/invitations";

describe("§740 BR-REQ-037-07 where «Invită pe email» leads", () => {
  it("a list about one event: the panel on the page", () => {
    expect(inviteTarget("e1", [])).toEqual({ kind: "panel" });
    expect(inviteTarget("e1", [{ id: "a" }, { id: "b" }])).toEqual({ kind: "panel" });
  });
  it("all events, one event takes invitations: straight to its panel", () => {
    expect(inviteTarget(null, [{ id: "a" }])).toEqual({ kind: "link", eventId: "a" });
    expect(inviteTarget(undefined, [{ id: "a" }])).toEqual({ kind: "link", eventId: "a" });
  });
  it("all events, several: a menu", () => {
    expect(inviteTarget(null, [{ id: "a" }, { id: "b" }])).toEqual({ kind: "menu" });
  });
  it("all events, none: the filters, where one is chosen", () => {
    expect(inviteTarget(null, [])).toEqual({ kind: "filters" });
  });
});
