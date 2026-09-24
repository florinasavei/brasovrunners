"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useBirthDateSaysMinor } from "./use-birth-date-minor";

/**
 * The parent or guardian's name, shown when the birth date says the runner is a minor
 * (`DECISIONS.md` §188; the owner: "aș vrea ca asta cu «Participantul are sub 18 ani» să apară
 * doar când data nașterii indică faptul că e minor").
 *
 * §185 had made it a tick, because the fold it replaced read as a demand. The tick was the right
 * shape and the wrong question: the form already asks for the birth date, and the birth date is
 * the answer. Asking twice invites the two answers to disagree — and the server would then refuse
 * an unticked minor with an error about a field nobody had been shown.
 *
 * ## Why this is a client island, and what happens without JavaScript
 *
 * Nothing on the server can know what somebody is typing into the date box. So: closed in the
 * server's markup, opened when the birth date gives under eighteen, and — the part that matters —
 * a `<noscript>` rule that forces it open. With JavaScript off the field is simply always there,
 * which is how it behaved before any of this, rather than being unreachable for the one person
 * who has to fill it (`AGENTS.md` §1.5: the form works without JavaScript).
 *
 * `forceOpen` is the server's own verdict: when a submission came back naming `guardianName`, the
 * block renders open whatever the date box currently holds, so an error never points at something
 * invisible.
 *
 * The date is read by `useBirthDateSaysMinor`, which says why it subscribes to the input rather
 * than owning it; the socials block uses the same reading the other way round (`HiddenForMinor`).
 */
export default function GuardianForMinor({
  birthDateId,
  forceOpen = false,
  children,
}: {
  birthDateId: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  // On the server there is no input and nothing typed, so the block renders closed — and the
  // `<noscript>` rule below is what keeps it reachable when that markup is all there will be.
  const minor = useBirthDateSaysMinor(birthDateId);
  const open = forceOpen || minor;

  return (
    <>
      {/*
        The `<noscript>` rule, set as raw HTML rather than as children (§211).

        With scripting **enabled** — which is every case React hydrates in — the browser parses
        the inside of a `<noscript>` element as **text**, not as elements. React renders children
        there as real nodes, so the server's HTML and the client's tree disagree about what is
        inside it, and React answers a mismatch by discarding the DOM and rebuilding the subtree.
        On this form that threw away whatever had already been typed: the e2e suite caught it as
        an empty "Prenume" with every later field intact, because the first thing typed was the
        only thing typed before hydration finished.

        `dangerouslySetInnerHTML` is how a `<noscript>` is written so both sides agree it holds
        text. The rule itself is unchanged: with JavaScript off the guardian's name is simply
        always visible.
      */}
      <noscript
        dangerouslySetInnerHTML={{ __html: "<style>.guardian-for-minor { display: block !important }</style>" }}
      />
      <Box className="guardian-for-minor" sx={{ display: open ? "block" : "none" }}>
        {children}
      </Box>
    </>
  );
}
