/**
 * When a backoffice fold opens by itself (`DECISIONS.md` §336; the owner, 2026-09-23, on
 * `/admin/emails`: "I would like the accordions to be closed by default").
 *
 * A fold starts closed. It opens on arrival only when it holds something the reader must see
 * before they would think to look — and the call site names which, so "why is this open?" is
 * answered by reading one line rather than a boolean expression:
 *
 * - **refused** — the page came back with a refusal from this fold's own form, through a
 *   redirect (`?error=`). A refusal returned as a kept form's state (§315) is not a page
 *   parameter: with JavaScript on the fold the person opened to press stays open, because
 *   nothing re-renders it, and `ActionForm` opens the folds around its summary before it
 *   focuses it; with JavaScript off `BOXED_DISCLOSURE_SX` shows a closed fold's body while a
 *   refusal is inside it.
 * - **saved** — this fold's own save just landed (`?saved=`) and the fold shows its result: the
 *   plan in force, the list of addresses in force, the queue after "send now".
 * - **attention** — something inside asks for action: bibs not yet printed or a printed one to
 *   pull out of the pile (§311), messages waiting in the outbox, an allowance spent.
 * - **inUse** — the reader set something in it that is shaping the page right now: a filter
 *   narrowing the list, the language the previews are shown in.
 *
 * A fold targeted by the address's `#fragment` opens too; that one is the browser's to know,
 * not the server's, so it is `OpenFoldFromHash` in the backoffice shell, over `openFoldsAround`
 * below.
 */
export type FoldOpenWhen = {
  refused?: boolean;
  saved?: boolean;
  attention?: boolean;
  inUse?: boolean;
};

/** Whether a fold opens on arrival: closed unless one of the reasons above holds. */
export function opensByItself(when: FoldOpenWhen | undefined): boolean {
  if (!when) return false;
  return Boolean(when.refused || when.saved || when.attention || when.inUse);
}

/**
 * The part of an element this needs — a real `HTMLElement` in the browser, a plain object in a
 * test. `open` is only read and written on a `<details>`.
 */
export type FoldNode = { tagName: string; open?: boolean; parentElement: FoldNode | null };

/**
 * Opens every `<details>` from `node` up — the node itself when it is one, and every fold it
 * sits inside — and says how many it opened.
 *
 * The browser does this on its own for a fragment that names an element *inside* a closed fold
 * (the HTML standard's "ancestor details revealing algorithm"), but not for a fragment that
 * names the fold itself, which is what a panel's id is; and a client-side navigation never runs
 * that algorithm at all. Inner folds are opened too, so `#email-EVENT_REMINDER` shows the
 * message inside the closed card that holds it.
 */
export function openFoldsAround(node: FoldNode | null): number {
  let opened = 0;
  for (let current = node; current; current = current.parentElement) {
    if (current.tagName.toUpperCase() === "DETAILS" && !current.open) {
      current.open = true;
      opened += 1;
    }
  }
  return opened;
}

/**
 * The event a box dispatches — bubbling — to have the language tab that holds it brought forward
 * (§NNN). `ActionForm` sends it from a box the browser refused and from the box a refusal's link
 * names; `LocaleTabPanels` answers it for the strip the box sits in. A tab is a fold of another
 * kind, and the asker never knows which strip, if any, holds the box.
 */
export const REVEAL_EVENT = "br:reveal";

/** The id a `#fragment` names, decoded; `null` for an empty or malformed one. */
export function fragmentId(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
