"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";

/**
 * The minor's boxes on a group run's signing page, shown when «Semnez pentru un minor» is ticked (§NNN;
 * the owner, 2026-10-14: «o bifă nouă și să semneze minorul + părintele»). The shape of `GuardianForMinor`
 * (§188), with a tick instead of a birth date to read.
 *
 * ## Why a client island, and what happens without JavaScript
 *
 * Nothing on the server knows whether somebody has just ticked the box. So the block is closed in the
 * server's markup, opened when the tick is ticked, and a `<noscript>` rule forces it open: with scripts off
 * it is simply always there, the minor's name beside the parent's, reachable by the one person who has to
 * fill it (`AGENTS.md` §1.5, the form works without JavaScript). The tick itself is the shared
 * `CheckboxField`, rendered by the page; this island only subscribes to its input by id (the way
 * `useBirthDateValue` subscribes to the date box), never owns it.
 *
 * ## Closed means not posted
 *
 * A hidden box would still post what was typed in it before the tick came off — a name in a box nobody
 * can see, refused by the service on the tick (`minorSigningRefusal`, «neither when not»). So, once the
 * page is interactive, a closed block is a disabled `fieldset`, and a disabled control is not posted. Before
 * hydration, and with scripts off, the fieldset is enabled and open: nothing in it is `required` (the
 * server decides, and names the box), or an adult could not send the form that shows every box.
 *
 * `forceOpen` is the server's own verdict: a refusal that named the tick or one of the minor's boxes (or
 * a draft with the tick ticked) renders the block open whatever the tick now holds, so an error never points
 * at something invisible.
 */
export default function MinorSigningFields({ tickId, forceOpen = false, children }: { tickId: string; forceOpen?: boolean; children: ReactNode }) {
  const ticked = useTickedBox(tickId);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const open = forceOpen || ticked;

  return (
    <>
      {/* Set as raw HTML, as `GuardianForMinor` does (§211): a `<noscript>`'s children are text when scripts run. */}
      <noscript dangerouslySetInnerHTML={{ __html: "<style>.group-run-minor-fields { display: block !important }</style>" }} />
      <Box className="group-run-minor-fields" sx={{ display: open ? "block" : "none" }} data-testid="group-run-minor-fields">
        <Box component="fieldset" disabled={hydrated && !open} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </>
  );
}

/** Whether the tick with this id is ticked now: false on the server and before the box exists, as `useBirthDateValue` answers "". */
function useTickedBox(tickId: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const input = document.getElementById(tickId);
      if (!(input instanceof HTMLInputElement)) return () => {};
      input.addEventListener("change", onStoreChange);
      return () => input.removeEventListener("change", onStoreChange);
    },
    [tickId],
  );
  return useSyncExternalStore(
    subscribe,
    () => {
      const input = document.getElementById(tickId);
      return input instanceof HTMLInputElement && input.checked;
    },
    () => false,
  );
}
