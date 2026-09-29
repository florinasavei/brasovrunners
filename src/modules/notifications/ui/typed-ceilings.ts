import { TYPED_CEILING_PLAN_IDS } from "@/modules/notifications/domain/email-plan";

/**
 * When the plan card shows its typed-ceiling boxes (§551, amending §100): only while the select
 * holds a plan that takes them — «Altceva». The owner, 2026-09-28: «aceste câmpuri de limite
 * lunare care sunt pe «Altceva» ar trebui să apară doar când chiar am selectat Altceva».
 *
 * CSS on the native select's own state rather than a client island: `option:checked` follows the
 * choice the instant it changes, before and without JavaScript, and the saved plan is the
 * selected option when the page arrives — so the no-JavaScript form shows the boxes exactly when
 * the saved plan is «Altceva». Hidden, not removed: what was typed stays in the boxes across a
 * switch away and back, and the service ignores it for a catalogue plan.
 *
 * Written as "hide unless", so a browser without `:has()` drops the whole rule and shows the
 * boxes as before, rather than hiding them for «Altceva» too.
 */
export const TYPED_CEILINGS_ATTRIBUTE = "data-typed-ceilings";

/** The selector, relative to the element that holds the select and the boxes (an Emotion `&`). */
export function typedCeilingsHiddenSelector(): string {
  const chosen = TYPED_CEILING_PLAN_IDS.map((id) => `select[name="plan"] option[value="${id}"]:checked`).join(", ");
  return `&:not(:has(${chosen})) [${TYPED_CEILINGS_ATTRIBUTE}]`;
}
