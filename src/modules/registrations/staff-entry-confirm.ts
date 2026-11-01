import type { ConfirmRoad, ConfirmSpec } from "@/shared/feedback/notice";

/**
 * The staff entry's confirmation dialogs (§NNN), two of them, the first whose conditions the posted form
 * meets: with «Direct pe lista de așteptare» ticked (and no fast track, which ignores the tick) the dialog says
 * the address is vouched for and names the one typed in the form (`fillFrom`), as «Dă-i un loc acum» does
 * (§637) — the first safeguard against a dictated typo; otherwise today's dialog, unchanged. Pure, so both
 * answers are tested in Node.
 *
 * `vouchBody` carries `{email}` raw, for the browser to fill at the press.
 */
export function staffEntryConfirm(words: {
  title: string;
  body: string;
  vouchBody: string;
  email: string;
  road: ConfirmRoad;
  confirmLabel: string;
  cancelLabel: string;
}): ConfirmSpec[] {
  const shared = { title: words.title, email: words.email, road: words.road, confirmLabel: words.confirmLabel, cancelLabel: words.cancelLabel };
  return [
    {
      ...shared,
      when: [
        { field: "vouchAddress", equals: "on" },
        { field: "fastTrack", notEquals: "on" },
      ],
      body: words.vouchBody,
      fillFrom: ["email"],
    },
    { ...shared, body: words.body },
  ];
}
