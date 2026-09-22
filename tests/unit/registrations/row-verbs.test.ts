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
   * §10.2 reserves cancelling and giving places to the Administrator, and the services refuse
   * regardless (BR-REQ-060-01).
   *
   * This used to add "a lower role reading this list — which it cannot, the page 404s". Since
   * §289 it can: the Organizer reads the list. So these verbs are now withheld by this function
   * alone rather than by the screen never being reached, which is why the Organizer has a test
   * of its own below.
   */
  it("withholds the destructive verbs from a role that may not manage registrations", () => {
    for (const status of ALL) {
      const verbs = rowVerbsFor(status, "CONTRIBUTOR", { checkedIn: false });
      expect(verbs, status).not.toContain("cancel");
      expect(verbs, status).not.toContain("givePlace");
      expect(verbs, status).not.toContain("confirmOnPaper");
      expect(verbs, status).not.toContain("erase");
    }
  });

  /**
   * BR-REQ-037-06, §180 — erasure from the list.
   *
   * The owner, three times: "vreau sa pot sterge si participantii". The list had no erase at
   * all, so clearing eighty test rows meant eighty trips into eighty detail pages.
   *
   * The first test below is the §179 defect, restated for the list. Erasure used to live inside
   * the cancel section of the registration's own page, which is drawn only while a row can still
   * be cancelled — so a CANCELLED or EXPIRED registration could never be erased, and that is
   * precisely the row somebody asks to have removed. Erase must therefore be offered in *every*
   * state, which makes it the one verb here that is not gated on the state machine.
   */
  it("offers erase in every state a registration can be in, cancelled and expired included", () => {
    for (const status of ALL) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false }), status).toContain("erase");
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: true }), status).toContain("erase");
    }
    // Named, so the §179 defect cannot come back quietly under a passing loop.
    for (const status of ["CANCELLED", "EXPIRED"] as const) {
      expect(rowVerbsFor(status, "ADMIN", { checkedIn: false })).toContain("erase");
    }
  });

  /**
   * Last, always. The menu draws a rule above the final item and tints it, which is how a list
   * row carries the separation the registration's own page makes with a bordered `<details>`
   * below cancel. If erase were to drift into the middle of the run it would sit a line away
   * from "anulează" with nothing between them.
   */
  it("puts erase last, below every other verb", () => {
    for (const status of ALL) {
      for (const checkedIn of [false, true]) {
        const verbs = rowVerbsFor(status, "ADMIN", { checkedIn });
        expect(verbs.at(-1), `${status}/${checkedIn}`).toBe("erase");
      }
    }
  });

  /**
   * Erase and cancel are deliberately asymmetric, and this is the statement of it: cancelling a
   * cancelled registration is meaningless, erasing one is the commonest case there is. So there
   * are states that offer erase and not cancel, and none that offer cancel without erase.
   */
  it("offers erase wherever cancel is offered, and in states where cancel is not", () => {
    const eraseOnly = ALL.filter((status) => {
      const verbs = rowVerbsFor(status, "ADMIN", { checkedIn: false });
      return verbs.includes("erase") && !verbs.includes("cancel");
    });
    expect(eraseOnly.length).toBeGreaterThan(0);

    for (const status of ALL) {
      const verbs = rowVerbsFor(status, "ADMIN", { checkedIn: false });
      if (verbs.includes("cancel")) expect(verbs, status).toContain("erase");
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

/**
 * `DECISIONS.md` §289 — the Organizer reads the list and changes nothing on it.
 *
 * The regression this guards is specific. `resend` used to be pushed with no role check at all,
 * on a comment that said the list was Administrator-only "so anybody reading this row already
 * passed that gate". The day the Organizer was given the list that sentence stopped being true
 * and nothing failed: they would simply have been offered a button whose service answers
 * FORBIDDEN — "I can press it and nothing happens", which is the complaint §289 came from.
 */
describe("§289 the Organizer's row", () => {
  it("offers reading and the desk, and nothing that changes a registration", () => {
    for (const status of ALL) {
      for (const checkedIn of [false, true]) {
        const verbs = rowVerbsFor(status, "MODERATOR", {
          checkedIn,
          // A settled, printable number, so the printing mark would be offered if it were
          // allowed to be — otherwise this loop proves nothing about that verb.
          bib: { settled: true, printed: false },
        });

        expect(verbs, `${status}/${checkedIn}`).toContain("open");
        for (const verb of ["resend", "cancel", "erase", "givePlace", "confirmOnPaper", "markBibPrinted", "unmarkBibPrinted"] as const) {
          expect(verbs, `${status}/${checkedIn} must not offer ${verb}`).not.toContain(verb);
        }
      }
    }
  });

  it("keeps the desk's own verbs, because every staff role works the desk (§15.11)", () => {
    expect(rowVerbsFor("CONFIRMED", "MODERATOR", { checkedIn: false })).toContain("checkIn");
    expect(rowVerbsFor("CONFIRMED", "MODERATOR", { checkedIn: true })).toContain("undoCheckIn");
  });

  it("offers the Administrator strictly more than the Organizer, never less", () => {
    for (const status of ALL) {
      const organizer = rowVerbsFor(status, "MODERATOR", { checkedIn: false, bib: { settled: true, printed: false } });
      const administrator = rowVerbsFor(status, "ADMIN", { checkedIn: false, bib: { settled: true, printed: false } });
      for (const verb of organizer) expect(administrator, `${status}/${verb}`).toContain(verb);
    }
  });
});

/**
 * §264 — the printing mark, which is the one verb on this row that depends on the bib rather
 * than on the status.
 */
describe("§264 the bib's printing mark", () => {
  it("is offered only where there is something to print", () => {
    // No settled number: nothing exists on paper, whatever the status says.
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false })).not.toContain("markBibPrinted");
    expect(
      rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false, bib: { settled: false, printed: false } }),
    ).not.toContain("markBibPrinted");
    // A provisional number is exactly this case (§214): the club sees it, nobody prints it.
    expect(
      rowVerbsFor("PENDING_EMAIL_CONFIRMATION", "ADMIN", { checkedIn: false, bib: { settled: false, printed: false } }),
    ).not.toContain("markBibPrinted");
  });

  it("offers the mark or its undoing, never both", () => {
    const unprinted = rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false, bib: { settled: true, printed: false } });
    expect(unprinted).toContain("markBibPrinted");
    expect(unprinted).not.toContain("unmarkBibPrinted");

    const printed = rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false, bib: { settled: true, printed: true } });
    expect(printed).toContain("unmarkBibPrinted");
    expect(printed).not.toContain("markBibPrinted");
  });

  it("belongs to whoever may manage registrations, like the sheet itself", () => {
    const bib = { settled: true, printed: false } as const;
    expect(rowVerbsFor("CONFIRMED", "CONTRIBUTOR", { checkedIn: false, bib })).not.toContain("markBibPrinted");
    expect(rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false, bib })).toContain("markBibPrinted");
  });

  it("stays before erase, which is always last (§180)", () => {
    const verbs = rowVerbsFor("CONFIRMED", "ADMIN", { checkedIn: false, bib: { settled: true, printed: false } });
    expect(verbs.indexOf("markBibPrinted")).toBeLessThan(verbs.indexOf("erase"));
  });
});
