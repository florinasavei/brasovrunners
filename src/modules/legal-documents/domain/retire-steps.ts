import { countForm, type CountForm } from "@/i18n/count-form";

/**
 * «Șterge» on a version somebody relied on, in two steps (§567; the owner, 2026-09-29: «cu dublă
 * confirmare»): first the consequences and the reason, then the version's number typed by hand.
 * Pure — the step, the event, the next step — so the screen's two steps are tested without a
 * browser, and the server checks both answers again regardless (BR-REQ-060-01).
 */

/** The reason's bounds, in characters, trimmed: the server refuses outside them, naming the box. */
export const RETIRE_REASON_MIN = 3;
export const RETIRE_REASON_MAX = 200;

export type RetireStep = "reason" | "number";

export type RetireStepEvent =
  /** «Continuă», with what the reason box holds: step two only once the reason is acceptable. */
  | { type: "continue"; reason: string }
  /** «Înapoi», from step two. */
  | { type: "back" }
  /** A refusal came back: the step whose box it named, so the person lands where the fix is. */
  | { type: "refused"; fields: readonly string[] };

export function reasonAcceptable(reason: string): boolean {
  const length = reason.trim().length;
  return length >= RETIRE_REASON_MIN && length <= RETIRE_REASON_MAX;
}

export function nextRetireStep(step: RetireStep, event: RetireStepEvent): RetireStep {
  switch (event.type) {
    case "continue":
      return step === "reason" && reasonAcceptable(event.reason) ? "number" : step;
    case "back":
      return "reason";
    case "refused":
      // A refusal about the reason goes back to it; any other (a mistyped number, a rule about
      // the version) stays on the number, the box that is emptied and asked again.
      return event.fields.includes("reason") ? "reason" : "number";
  }
}

/** The three counted nouns of a version's reliance, in the words `Admin.legal.counted.*` hold. */
export const RELIANCE_NOUNS = ["signatures", "events", "acknowledgements"] as const;
export type RelianceNoun = (typeof RELIANCE_NOUNS)[number];

/**
 * The message key, under `Admin`, of one count in words — «1 semnătură», «2 semnături», «20 de
 * semnături», «0 semnături» — by the site's rule for counted nouns without ICU plurals
 * (`countForm`, §341). The screenshot of 2026-09-29 read «1 semnături»; this is the fix.
 */
export function relianceKey(noun: RelianceNoun, count: number, locale: string): `legal.counted.${RelianceNoun}.${CountForm}` {
  return `legal.counted.${noun}.${countForm(count, locale)}`;
}

/**
 * All three counts in words, for a sentence that takes them as `{signatures}`, `{events}` and
 * `{acknowledgements}`. `say` is the page's translator (`getTranslations("Admin")`), passed in so
 * this stays free of next-intl.
 */
export function reliancePhrases(
  say: (key: string, values: { count: number }) => string,
  counts: Readonly<Record<RelianceNoun, number>>,
  locale: string,
): Record<RelianceNoun, string> {
  return {
    signatures: say(relianceKey("signatures", counts.signatures, locale), { count: counts.signatures }),
    events: say(relianceKey("events", counts.events, locale), { count: counts.events }),
    acknowledgements: say(relianceKey("acknowledgements", counts.acknowledgements, locale), { count: counts.acknowledgements }),
  };
}
