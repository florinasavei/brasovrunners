/**
 * «Completează cu textul de reminder» (the decision «Cere reconfirmarea»), the composer's press without the browser: which
 * boxes it writes, with what, and when it must ask first. The island hands it the form's boxes and `writePlainBox`, so the
 * rule is tested in Node and the browser test sees it act.
 */

/** The four boxes the press writes, in the order the form shows them. */
export const REMINDER_BOXES = ["subjectRo", "subjectEn", "bodyRo", "bodyEn"] as const;
export type ReminderBox = (typeof REMINDER_BOXES)[number];
export type ReminderTexts = Readonly<Record<ReminderBox, string>>;

/** Whether the press would replace words already typed — then it asks first (§384); empty or blank boxes it fills at once. */
export function reminderOverwrites(words: Readonly<Record<ReminderBox, string>>): boolean {
  return REMINDER_BOXES.some((name) => words[name].trim() !== "");
}

/**
 * Write the ready text into each box the form holds, as if typed (`write` is `writePlainBox` in the browser), and say how
 * many it wrote. A box the form does not hold is skipped, never invented.
 */
export function fillReminderBoxes<Box>(find: (name: ReminderBox) => Box | null | undefined, texts: ReminderTexts, write: (box: Box, text: string) => void): number {
  let written = 0;
  for (const name of REMINDER_BOXES) {
    const box = find(name);
    if (!box) continue;
    write(box, texts[name]);
    written += 1;
  }
  return written;
}
