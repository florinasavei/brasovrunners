import { randomUUID } from "node:crypto";
import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * The capture adapter: local, test and captured QA mail (AGENTS.md §7.1, §16.4). Keeps messages in
 * memory and transmits nothing; e2e tests read action links here (§20.4). Never written to disk:
 * a message holds a live token and an address.
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
      // The delivery address keeps the participant's capitalisation.
      const wanted = recipient.toLowerCase();
      return captured.filter((m) => m.to.toLowerCase() === wanted).at(-1);
    },

    clear() {
      captured.length = 0;
    },
  };
}
