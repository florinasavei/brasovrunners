import { describe, expect, it } from "vitest";
import {
  CLUB_MESSAGES_PER_COMPLETED_REGISTRATION,
  COPIED_PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION,
  MESSAGES_PER_COMPLETED_REGISTRATION,
  messagesPerCompletedRegistration,
  PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION,
} from "@/modules/notifications/volume";

/**
 * BR-REQ-033-02 criterion 13 (`DECISIONS.md` §245) and its extension of 2026-09-22 — what one
 * completed registration costs on the Mailgun allowance, as the one pure function behind the
 * forecast on `/admin/emails` and `/admin/tasks`.
 *
 * The number that `docs/PLATFORM.md` states in prose (six, so 100 a day is 16 registrations) is
 * the floor; the archive copy of the declaration adds one, and every address the club names for
 * a hidden copy of the participant's messages adds one *per participant message* — the cost that
 * turns a cheap setting into an expensive one, and the reason the panel that sets it says so.
 */
describe("BR-REQ-033-02 criterion 13 what one completed registration costs on the allowance", () => {
  it("is six with nothing switched on: five to the runner and one to the club", () => {
    expect(PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION).toBe(5);
    expect(CLUB_MESSAGES_PER_COMPLETED_REGISTRATION).toBe(1);
    expect(MESSAGES_PER_COMPLETED_REGISTRATION).toBe(6);
    expect(messagesPerCompletedRegistration({ archiveConfigured: false, participantBccCount: 0 })).toBe(6);
  });

  it("adds one for the club's archive copy of the declaration (§99, §244)", () => {
    expect(messagesPerCompletedRegistration({ archiveConfigured: true, participantBccCount: 0 })).toBe(7);
  });

  it("adds one per hidden-copy address for every copied message the runner receives, and none for the club's", () => {
    // The address-confirmation link goes to an address nobody has confirmed and is never copied
    // (§NNN): four of the runner's five are.
    expect(COPIED_PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION).toBe(4);
    // One address: the runner's five, four copies, plus the club's own notice, which is not
    // copied again.
    expect(messagesPerCompletedRegistration({ archiveConfigured: false, participantBccCount: 1 })).toBe(10);
    // Two addresses, and the archive on: 5 + 4 × 2 + 1 + 1.
    expect(messagesPerCompletedRegistration({ archiveConfigured: true, participantBccCount: 2 })).toBe(15);
  });

  it("never lowers the floor on a count that makes no sense", () => {
    expect(messagesPerCompletedRegistration({ archiveConfigured: false, participantBccCount: -3 })).toBe(6);
    expect(messagesPerCompletedRegistration({ archiveConfigured: false, participantBccCount: 1.9 })).toBe(10);
  });
});
