import { getTranslations } from "next-intl/server";
import InfoTip from "@/shared/ui/InfoTip";

/**
 * The «i» that says what the desk's paper confirmation is for, what it does and what the person
 * receives (§NNN; the owner, 2026-10-02: «Pune tooltip și info în back-office pt asta»). Four short
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
 * One component for the two places the words live — the registration's «Ziua cursei» box, beside its
 * title, and the desk, once beside the line that says what the row buttons do — so the two never
 * drift. The lines stay apart with a newline, which `InfoTip` draws as lines (§257). No behaviour:
 * the button, its dialog and the verb are what they were.
 */
export default async function PaperConfirmationTip() {
  const t = await getTranslations("Admin");
  const text = [t("desk.paperWhen"), t("desk.paperPlace"), t("desk.paperEmail"), t("desk.paperNot")].join("\n");
  return <InfoTip text={text} />;
}
