import type { ConfirmMail } from "@/shared/feedback/confirm-words";
import type { ConfirmAlso, ConfirmSpec } from "@/shared/feedback/notice";

/**
 * The staff entry's confirmation dialogs (§875), the first whose conditions the posted form meets: the fast track
 * («Persoana este la masă»), which confirms on the paper at the desk and ignores the vouch tick; with «Direct pe lista de
 * așteptare» ticked, the dialog that says the address is vouched for and names the one typed in the form (`fillFrom`), as
 * «Dă-i un loc acum» does (§637) — the first safeguard against a dictated typo; otherwise the ordinary one.
 *
 * Each names the person typed in the boxes and the email its entry sends (the design «telling the owner about every email
 * a staff press sends», slice 3), worded by the one builder with `{firstName} {lastName}` for the browser to fill at the
 * press: the confirmation with the club's archive and notices on the fast track, the waiting list's email or the
 * declaration for a vouched entry, the address's link — or, for an address that confirmed itself before, the step its
 * restarted row lands on — for the ordinary one. `vouchBody` carries `{email}` raw, for the browser to fill too. Pure, so
 * every answer is tested in Node.
 *
 * `elite` (§NNN): with «Elită» ticked, every dialog says so in one quieter line under the email — the mark is internal and
 * the person is told nothing — and unticked says nothing of it. Absent (a role the tick is not drawn for), no line.
 */
export function staffEntryConfirm(words: {
  title: string;
  body: string;
  vouchBody: string;
  mail: { ordinary: ConfirmMail; vouched: ConfirmMail; fastTrack: ConfirmMail };
  confirmLabel: string;
  cancelLabel: string;
  elite?: string;
}): ConfirmSpec[] {
  const shared = { title: words.title, confirmLabel: words.confirmLabel, cancelLabel: words.cancelLabel };
  const person = ["firstName", "lastName"];
  const eliteLine: ConfirmAlso[] = words.elite ? [{ text: words.elite, when: [{ field: "elite", equals: "on" }] }] : [];
  // The mail's own quieter lines first (the club's copies), then the mark's, only while «Elită» is ticked.
  const withElite = (mail: ConfirmMail): ConfirmMail => {
    const also = [...(mail.also ?? []), ...eliteLine];
    return also.length > 0 ? { ...mail, also } : mail;
  };
  return [
    { ...shared, ...withElite(words.mail.fastTrack), when: [{ field: "fastTrack", equals: "on" }], body: words.body, fillFrom: person },
    {
      ...shared,
      ...withElite(words.mail.vouched),
      when: [
        { field: "vouchAddress", equals: "on" },
        { field: "fastTrack", notEquals: "on" },
      ],
      body: words.vouchBody,
      fillFrom: ["email", ...person],
    },
    { ...shared, ...withElite(words.mail.ordinary), body: words.body, fillFrom: person },
  ];
}
