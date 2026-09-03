import { randomUUID } from "node:crypto";
import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * The capture adapter: local, test, and the captured half of QA (AGENTS.md §7.1, §16.4).
 *
 * It accepts a message, keeps it in memory, and transmits nothing. That is the entire
 * behaviour, and it is what makes the whole registration pipeline buildable before the club
 * has a domain — `WEEKEND.md` § The email progression.
 *
 * Captured messages are the only place an end-to-end test can find an action link (§20.4).
 * They are in memory and never written to disk: a captured message contains a live token and
 * a participant's address, and a file of those is a file that outlives the process, gets
 * committed by accident, and ends up in a bug report.
 */
export type CaptureAdapter = EmailAdapter & {
  /** Everything captured since the last `clear()`, oldest first. */
  readonly messages: readonly CapturedEmail[];
  /** The most recent message sent to an address, or undefined. */
  lastTo(recipient: string): CapturedEmail | undefined;
  clear(): void;
};

export type CapturedEmail = OutgoingEmail & { providerMessageId: string; capturedAt: Date };

export function createCaptureAdapter(now: () => Date = () => new Date()): CaptureAdapter {
  const captured: CapturedEmail[] = [];

  return {
    name: "capture",

    async send(message: OutgoingEmail): Promise<SendResult> {
      const providerMessageId = `capture:${randomUUID()}`;
      captured.push({ ...message, providerMessageId, capturedAt: now() });
      return { outcome: "sent", providerMessageId };
    },

    get messages() {
      return captured;
    },

    lastTo(recipient: string) {
      // Case-insensitive because a captured message is looked up by whatever the test typed,
      // and the delivery address keeps the participant's capitalisation.
      const wanted = recipient.toLowerCase();
      return captured.filter((m) => m.to.toLowerCase() === wanted).at(-1);
    },

    clear() {
      captured.length = 0;
    },
  };
}
