import { describe, expect, it } from "vitest";
import { invitationsNeedAttention, inviteTarget } from "@/modules/registrations/domain/invitations";

const none = { sent: 0, accepted: 0, expired: 0, withdrawn: 0 };

describe("§740 BR-REQ-037-07 «Invitații» opens by itself while an invitation needs the Administrator's eye", () => {
  it("opens for a sent invitation, whether or not the event is upcoming", () => {
    expect(invitationsNeedAttention({ ...none, sent: 1 }, true)).toBe(true);
    expect(invitationsNeedAttention({ ...none, sent: 2 }, false)).toBe(true);
  });
  it("opens for an expired one only while the event is still to come", () => {
    expect(invitationsNeedAttention({ ...none, expired: 1 }, true)).toBe(true);
    expect(invitationsNeedAttention({ ...none, expired: 1 }, false)).toBe(false);
  });
  it("stays closed for none, and for accepted and withdrawn ones", () => {
    expect(invitationsNeedAttention(none, true)).toBe(false);
    expect(invitationsNeedAttention({ ...none, accepted: 3, withdrawn: 2 }, true)).toBe(false);
  });
});

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
