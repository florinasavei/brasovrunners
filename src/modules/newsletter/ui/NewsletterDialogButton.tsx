"use client";

import { useEffect } from "react";

/**
 * The contact page's one newsletter island (§NNN): it draws nothing. It gives the server-drawn
 * button — a plain link to `?newsletter=open` — its script, once the script is here: a press then
 * opens the server-drawn `<dialog>` with `showModal()`, a real modal with the browser's own focus
 * trap, Escape and backdrop. And it squares the dialog with each answer the page arrives with:
 *
 * - `modal` — a refusal to fix, or `?newsletter=open` pressed before the script arrived: the
 *   server drew the dialog open, and it becomes a modal;
 * - `closed` — "check your inbox": the form's work is done, and a dialog the script opened (which
 *   the server's markup knows nothing of) is closed over the answer;
 * - `none` — the page as it was.
 *
 * `stamp` changes with every render of the page (its render time), so a second answer that reads
 * like the first — two subscriptions in a row — still squares the dialog again.
 *
 * Why the button is not this island's own element: a press that lands before the page has
 * hydrated must still do something. A link drawn by the server simply navigates to the page with
 * the dialog open; a button drawn by the island would be a dead control for that second. The two
 * talk through ids, plain strings, never an element (§370).
 */
export default function NewsletterDialogButton({
  triggerId,
  dialogId,
  arrival,
  stamp,
}: {
  triggerId: string;
  dialogId: string;
  arrival: "modal" | "closed" | "none";
  stamp: string;
}) {
  useEffect(() => {
    const dialog = document.getElementById(dialogId);
    if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== "function") return;
    if (arrival === "modal" && !dialog.matches(":modal")) {
      if (dialog.open) dialog.close();
      dialog.showModal();
    }
    if (arrival === "closed" && dialog.open) dialog.close();
  }, [dialogId, arrival, stamp]);

  useEffect(() => {
    const dialog = document.getElementById(dialogId);
    const trigger = document.getElementById(triggerId);
    if (!trigger || !(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== "function") return;
    const open = (event: MouseEvent) => {
      // A press with a modifier opens the link where the reader asked, as any link does.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLInputElement>("input[type=email]")?.focus();
    };
    trigger.addEventListener("click", open);
    return () => trigger.removeEventListener("click", open);
  }, [dialogId, triggerId]);

  /*
    «Toate noutățile» ticks all (the brief): ticking it ticks every topic, unticking a topic unticks
    it, and ticking the last one ticks it back. Only what the eye sees — the server reads "all"
    alone as everything whatever else is posted (`normalizeTopics`), so without a script the form
    means the same.
  */
  useEffect(() => {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    const boxes = () => [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="topics"]')];
    const onChange = (event: Event) => {
      const changed = event.target;
      if (!(changed instanceof HTMLInputElement) || changed.name !== "topics") return;
      const all = boxes().find((box) => box.value === "ALL");
      const rest = boxes().filter((box) => box.value !== "ALL");
      if (!all) return;
      if (changed === all) {
        for (const box of rest) box.checked = all.checked;
      } else {
        all.checked = rest.every((box) => box.checked);
      }
    };
    dialog.addEventListener("change", onChange);
    return () => dialog.removeEventListener("change", onChange);
  }, [dialogId]);

  return null;
}
