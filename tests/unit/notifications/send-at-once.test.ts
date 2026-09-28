import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  DELIVERY_CHOICE_FIELD,
  deliveryChoiceOf,
  leavesNow,
  markedForNow,
  roomToSendNow,
  SENT_NOW_FLAG,
  withSendNowChoice,
} from "@/modules/notifications/domain/send-at-once";
import { choiceAnswer, type ConfirmSpec } from "@/shared/feedback/notice";

/**
 * §NNN (the owner, 2026-09-28: «cand retrimit un mail trebuie sa am optiunea de bypass la cron ca sa
 * pot retrimite instant!») — a resend's dialog has two answers: «Trimite acum, fără să aștepte trecerea
 * programată», the primary one, and «Pune la coadă pentru trecerea programată», the quiet one. Each
 * posts its own value in the form's hidden field; the server reads only «now» as now.
 */
const WORDS = {
  choice: { field: DELIVERY_CHOICE_FIELD, confirmValue: "now", alternativeValue: "queue", alternativeLabel: ro.Admin.confirm.sendNowChoice.queue },
  note: "Emailurile pleacă acum la trecerea programată, în cel mult 2 ore. Alege dacă acesta pleacă acum sau o așteaptă.",
  confirmLabel: ro.Admin.confirm.sendNowChoice.now,
};

const RESEND: ConfirmSpec = { title: "Retrimiți emailul?", body: "Emailul pleacă din nou către Ana.", confirmLabel: "Retrimite", cancelLabel: "Renunță" };

describe("§NNN a resend's two answers", () => {
  it("the primary answer posts «now», the quiet one «queue», in the hidden field", () => {
    const spec = withSendNowChoice(RESEND, WORDS);
    expect(choiceAnswer(spec, "confirm")).toEqual({ field: "delivery", value: "now" });
    expect(choiceAnswer(spec, "alternative")).toEqual({ field: "delivery", value: "queue" });
    // The buttons' words and the body's sentence about the wait.
    expect(spec.confirmLabel).toBe("Trimite acum, fără să aștepte trecerea programată");
    expect(spec.choice?.alternativeLabel).toBe("Pune la coadă pentru trecerea programată");
    expect(spec.body).toBe(`${RESEND.body} ${WORDS.note}`);
  });

  it("under «imediat» there is no choice: the dialog as it was, and an answer posts nothing more", () => {
    const spec = withSendNowChoice(RESEND, null);
    expect(spec).toEqual(RESEND);
    expect(choiceAnswer(spec, "confirm")).toBeNull();
  });

  it("reads only a posted «now» as now: an absent field, «queue» or anything else is the queue", () => {
    expect(deliveryChoiceOf("now")).toBe("now");
    expect(deliveryChoiceOf("queue")).toBe("queue");
    expect(deliveryChoiceOf(null)).toBe("queue");
    expect(deliveryChoiceOf("NOW")).toBe("queue");
  });

  it("marks the payload for the queue panel only for «now»", () => {
    expect(markedForNow({ a: 1 }, "now")).toEqual({ a: 1, [SENT_NOW_FLAG]: true });
    expect(markedForNow({ a: 1 }, "queue")).toEqual({ a: 1 });
  });

  it("«Pleacă acum» only while the marked row waits untried", () => {
    expect(leavesNow({ status: "PENDING", attemptCount: 0, sentNow: true })).toBe(true);
    expect(leavesNow({ status: "PENDING", attemptCount: 1, sentNow: true })).toBe(false);
    expect(leavesNow({ status: "PROCESSING", attemptCount: 1, sentNow: true })).toBe(false);
    expect(leavesNow({ status: "PENDING", attemptCount: 0, sentNow: false })).toBe(false);
  });

  it("a press fits the day's Mailgun allowance or is refused, never deferred in silence (§80)", () => {
    expect(roomToSendNow({ remaining: null, mailgunMessages: 500 })).toBe(true);
    expect(roomToSendNow({ remaining: 1, mailgunMessages: 1 })).toBe(true);
    expect(roomToSendNow({ remaining: 0, mailgunMessages: 1 })).toBe(false);
    expect(roomToSendNow({ remaining: 3, mailgunMessages: 4 })).toBe(false);
    // Gmail's road costs the allowance nothing.
    expect(roomToSendNow({ remaining: 0, mailgunMessages: 0 })).toBe(true);
  });

  it("says it in both languages, plainly and briefly", () => {
    const sentences = [
      ro.Admin.confirm.sendNowChoice.now,
      ro.Admin.confirm.sendNowChoice.queue,
      ro.Admin.confirm.sendNowChoice.note,
      ro.Admin.emails.queue.leaves.leavesNow,
      ro.Admin.emails.deliveryTiming.bypassHelp,
      ro.Admin.errors.SEND_NOW_ALLOWANCE_SPENT,
      ro.Feedback.toast.resentNow,
      en.Admin.confirm.sendNowChoice.now,
      en.Admin.confirm.sendNowChoice.queue,
      en.Admin.confirm.sendNowChoice.note,
      en.Admin.emails.queue.leaves.leavesNow,
      en.Admin.emails.deliveryTiming.bypassHelp,
      en.Admin.errors.SEND_NOW_ALLOWANCE_SPENT,
      en.Feedback.toast.resentNow,
    ];
    for (const sentence of sentences) {
      expect(sentence.length).toBeLessThanOrEqual(200);
      expect(sentence).not.toMatch(/platforma|de obicei/i);
    }
  });
});
