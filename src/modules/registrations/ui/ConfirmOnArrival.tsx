"use client";

import { useEffect, useRef } from "react";
import SubmitButton from "@/shared/ui/SubmitButton";

/**
 * Presses Confirm the moment the page opens, so the link in the email confirms the address by
 * itself (`DECISIONS.md` §238; the owner: "when I click from the mail I wanna auto-confirm the
 * email").
 *
 * ## Why the route cannot simply do it
 *
 * "Email action links: token hashed at rest, single use, **GET never mutates**" is one of the
 * rules `CLAUDE.md` lists as unbreakable (`AGENTS.md` §12.8, BR-REQ-036-02), and the reason is
 * not tidiness — it is this club's own inboxes. **Microsoft 365 Safe Links fetches every URL in
 * a message before the recipient ever sees it**, and the two work addresses tested this week
 * are both Microsoft tenants. A confirming GET would be spent by Defender's scanner, and the
 * human would click a minute later and be told the link had already been used. Every other
 * prefetcher and mail antivirus does the same thing.
 *
 * So the GET still reads and changes nothing. This island submits the form the page already
 * had: a POST, from a real browser, after JavaScript has run. A scanner issues the GET and
 * stops there, so it cannot reach the POST — and a person cannot tell the result from a link
 * that confirmed itself.
 *
 * ## What happens when it does not run
 *
 * The button is the same `SubmitButton` the page had before, and it is what renders before
 * hydration and the only thing at all with JavaScript off. Nobody is worse off than they were;
 * the automatic press is an enhancement on top of a page that still works without it
 * (`AGENTS.md` §1.5).
 *
 * The press is guarded against firing twice. React mounts effects twice in development, and a
 * second POST is harmless — the token is spent, and §202 answers a spent link with where the
 * registration actually is rather than an error — but it is a wasted round trip and a confusing
 * line in the log.
 */
export default function ConfirmOnArrival({
  label,
  pendingLabel,
}: {
  /** Already translated: the island holds no catalogue (`AGENTS.md` §14.5). */
  label: string;
  /** What the button says while the POST is in flight — here, immediately. */
  pendingLabel: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const form = anchor.current?.closest("form");
    if (!form) return;
    fired.current = true;
    // `requestSubmit`, never `submit`: it fires the submit event, which is what React's form
    // action is listening for, and it runs the form's own validation on the way.
    form.requestSubmit();
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      <SubmitButton label={label} pendingLabel={pendingLabel} />
    </>
  );
}
