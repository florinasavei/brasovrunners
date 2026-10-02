import { getTranslations } from "next-intl/server";
import InfoTip from "@/shared/ui/InfoTip";

/**
 * The «i» that says what the desk's paper confirmation is for, what it does and what the person
 * receives (§NNN; the owner, 2026-10-02: «Pune tooltip și info in back-office pt asta»). Four short
 * lines, one per fact, each from the catalogue and each true of the code:
 *
 * - when: at the desk, with the declaration the participant signed on paper in front of staff, on
 *   the staff member's name (`confirmByStaff`, `acceptDeclarationOnPaper`);
 * - the place: through the allocator — a full event or a waiting line sends the person to the
 *   list, a full list refuses the press (§348, §615);
 * - the email: the confirmation with the QR code, the number and the declaration's copy
 *   (`enqueueConfirmation`, §95), and no «sign the declaration» email;
 * - what it is not: no shortcut before the race, without the person there (§15.11).
 *
 * One component and one text for the three places the words live — the registration's «Ziua cursei»
 * box, beside its title; the desk, once beside the line that says what the row buttons do; and the
 * registrations list's row menu, as the tooltip of «Confirmă pe hârtie» (`paperConfirmationText`) —
 * so the three never drift. The lines stay apart with a newline, which `InfoTip` draws as lines (§257). No behaviour:
 * the button, its dialog and the verb are what they were.
 */
export function paperConfirmationText(t: (key: "desk.paperWhen" | "desk.paperPlace" | "desk.paperEmail" | "desk.paperNot") => string): string {
  return [t("desk.paperWhen"), t("desk.paperPlace"), t("desk.paperEmail"), t("desk.paperNot")].join("\n");
}

export default async function PaperConfirmationTip() {
  const t = await getTranslations("Admin");
  return <InfoTip text={paperConfirmationText(t)} />;
}
