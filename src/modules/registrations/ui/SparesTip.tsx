import { getTranslations } from "next-intl/server";
import { canEnterAtDesk, canManageRegistrations, canReadRegistrations, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import InfoTip from "@/shared/ui/InfoTip";

/** The catalogue's lines the tip may say, one fact each. */
type SparesTipKey =
  | "desk.sparesTip.what"
  | "desk.sparesTip.desk"
  | "desk.sparesTip.callOrganizer"
  | "desk.sparesTip.walkIn"
  | "desk.sparesTip.blankBib"
  | "desk.sparesTip.blankBibReplace"
  | "desk.sparesTip.invitation"
  | "desk.sparesTip.given";

/**
 * The «i» beside the desk's «Numere de rezervă libere (N): …» (§1025; the owner, 2026-11-20: «scrie aici și ceva tooltip cum se dau
 * aceste numere de rezervă libere»): what the spares are and how one is given, a line a fact, each true of the code — and in the
 * words of the reader's role, so a desk role is never told to press what it cannot press:
 *
 * - what, for everyone: numbers printed ahead with an empty name line, for people who come on the day; no automatic draw ever gives
 *   one (§444, `domain/spare-bibs.ts`);
 * - the desk's own presses, for everyone: on a row with no number, «Confirmă pe hârtie» and «Salvează nr.» hold the lowest free
 *   spare in their box (`DeskRow`, `handsSpareAtConfirm`);
 * - somebody not on the list: the organizers' «Adaugă pe cineva», its «Numărul dat acum» on the lowest free spare
 *   (`StaffHandedBibField`, `canEnterAtDesk`) — or, for every other desk role, call an organizer;
 * - for whoever opens the registration's page (`canReadRegistrations`): «Dă-i un BIB gol» (§989) to a confirmed runner with no
 *   number — and for the Administrators (`canManageRegistrations`) in place of a number too, which is retired — and an invitation
 *   sent with «La confirmare primește un BIB gol» (§992), the lowest free one at the confirmation;
 * - for everyone: a number given leaves the list and is never given again (§173), and an Administrator prints them from the
 *   event's editor (`reserveSpareBibs`, `canManageRegistrations`).
 *
 * The lines stay apart with a newline, which `InfoTip` draws as lines (§257). No behaviour: the presses are what they were.
 */
export function sparesTipText(t: (key: SparesTipKey) => string, subject: StaffSubject): string {
  const lines = [t("desk.sparesTip.what"), t("desk.sparesTip.desk")];
  lines.push(canEnterAtDesk(subject) ? t("desk.sparesTip.walkIn") : t("desk.sparesTip.callOrganizer"));
  if (canReadRegistrations(subject)) {
    lines.push(canManageRegistrations(subject) ? t("desk.sparesTip.blankBibReplace") : t("desk.sparesTip.blankBib"));
    lines.push(t("desk.sparesTip.invitation"));
  }
  lines.push(t("desk.sparesTip.given"));
  return lines.join("\n");
}

export default async function SparesTip({ role }: { role: StaffSubject }) {
  const t = await getTranslations("Admin");
  return <InfoTip text={sparesTipText(t, role)} />;
}
