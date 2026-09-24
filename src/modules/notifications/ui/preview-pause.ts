/** Whose copy the composer's preview shows: the Romanian registrant's or the English one's. */
export type PreviewLanguage = "ro" | "en";

export type PreviewPause = {
  /** A key pressed: ask once typing has paused, for the tab open when the pause ends. */
  typed: (ask: (language: PreviewLanguage) => void) => void;
  /** A tab picked: ask now, for that tab, and drop the pause still running — it was for the tab left. */
  switched: (language: PreviewLanguage, ask: (language: PreviewLanguage) => void) => void;
  /** The composer is going away, or asks afresh on its own: nothing still pending may ask. */
  cancel: () => void;
};

/**
 * When "Trimite un mesaj participanților" asks the server for its preview (`DECISIONS.md` §364):
 * after a pause in typing, and at once when a tab is picked.
 *
 * The review of §364: the pause used to remember the tab that was open when the key was pressed,
 * and picking the other tab did not stop it — so typing in a box, then switching from "RO" to "EN"
 * within half a second, showed the English copy and then, when the pause ran out, the Romanian one
 * under the "EN" tab. The tab picked now cancels the pause (its own ask reads the boxes as they are,
 * so nothing typed is lost), and a pause that does run out reads the tab open then, not before.
 *
 * Kept out of the component so the order of events can be tested without a browser.
 */
export function previewPause(pauseMs: number, initial: PreviewLanguage = "ro"): PreviewPause {
  let language = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    typed(ask) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        ask(language);
      }, pauseMs);
    },
    switched(next, ask) {
      language = next;
      cancel();
      ask(next);
    },
    cancel,
  };
}
