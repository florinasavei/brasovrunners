import { describe, expect, it } from "vitest";
import { registrationStatus, type RegistrationStatus } from "@/db/schema/registrations";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { rowVerbsFor } from "@/modules/registrations/domain/row-verbs";
import { canTransition } from "@/modules/registrations/domain/state-machine";

/**
 * BR-REQ-037-05, BR-REQ-060-01 (§178) — which verbs a registration row offers.
 *
 * The owner asked for "statuses as a drop-down". What the row shows is a menu of the verbs that
 * already exist, never a free choice of state: a status select would be a second write path into
 * `registrations` past the allocator (`AGENTS.md` §10.6), past the signed declaration (§10.8) and
 * past §15.11's closed list of what staff may do. These tests are the statement of that.
 */
const ALL = registrationStatus.enumValues as readonly RegistrationStatus[];

describe("BR-REQ-037-05 the verbs a registration row offers", () => {
  it("never offers a verb the state machine would refuse", () => {
    for (const status of ALL) {
      const verbs = rowVerbsFor(status, "ADMIN", { checkedIn: false });
      if (verbs.includes("confirmOnPaper")) {
        expect(canTransition(status, "CONFIRMED"), `${status} → CONFIRMED`).toBe(true);
      }
      if (verbs.includes("cancel")) {
        expect(canTransition(status, "CANCELLED"), `${status} → CANCELLED`).toBe(true);
      }
    }
  });

  /**
   * The one that matters. `PENDING_EMAIL_CONFIRMATION` has no edge to `CONFIRMED` precisely so
   * that nothing is confirmed without a declaration; the row must not offer a way round it.
   */
  it("never offers to confirm somebody who has not reached the declaration", () => {
    expect(rowVerbsFor("PENDING_EMAIL_CONFIRMATION", "ADMIN", { checkedIn: false })).not.toContain(
      "confirmOnPaper",
    );
    for (const status of ["CANCELLED", "EXPIRED"] as const) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false })).not.toContain("confirmOnPaper");
    }
  });

  it("offers a place only to somebody waiting for one", () => {
    expect(rowVerbsFor("WAITLISTED", "ADMIN", { checkedIn: false })).toContain("givePlace");
    for (const status of ALL.filter((s) => s !== "WAITLISTED")) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false }), status).not.toContain("givePlace");
    }
  });

  it("offers check-in only to a confirmed registration, and undo only once they are here", () => {
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false })).toContain("checkIn");
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false })).not.toContain("undoCheckIn");
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: true })).toContain("undoCheckIn");
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: true })).not.toContain("checkIn");
    for (const status of ALL.filter((s) => s !== "CONFIRMED")) {
      const verbs = rowVerbsFor(status, "ADMIN", { checkedIn: false });
      expect(verbs, status).not.toContain("checkIn");
      expect(verbs, status).not.toContain("undoCheckIn");
    }
  });

  /**
   * §10.2 reserves cancelling and giving places to the Administrator. A lower role reading this
   * list — which it cannot, the page 404s — would still be shown nothing it may not do, and the
   * services refuse regardless (BR-REQ-060-01).
   */
  it("withholds the destructive verbs from a role that may not manage registrations", () => {
    for (const status of ALL) {
      const verbs = rowVerbsFor(status, "CONTRIBUTOR", { checkedIn: false });
      expect(verbs, status).not.toContain("cancel");
      expect(verbs, status).not.toContain("givePlace");
      expect(verbs, status).not.toContain("confirmOnPaper");
    }
  });

  it("always offers the way into the registration itself", () => {
    for (const status of ALL) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false }), status).toContain("open");
    }
  });

  /**
   * Resend follows the one derivation the whole product uses (`deriveAllowedResendMessageType`),
   * so the row and the registration's own page can never disagree about whether there is
   * anything to send. Note what that means: a cancelled or expired registration *does* have a
   * message — the state notice telling the person where they stand — and somebody merely on the
   * waiting list has none, because nothing has been sent them to send again.
   */
  it("offers resend exactly where a message exists to resend", () => {
    expect(rowVerbsFor("WAITLISTED", "ADMIN", { checkedIn: false })).not.toContain("resend");
    for (const status of ALL.filter((s) => s !== "WAITLISTED")) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false }), status).toContain("resend");
    }
    // And the mapping itself is the authority, not a list copied here.
    for (const status of ALL) {
      const offered = rowVerbsFor(status, "ADMIN", { checkedIn: false }).includes("resend");
      expect(offered, status).toBe(deriveAllowedResendMessageType(status) !== null);
    }
  });
});
