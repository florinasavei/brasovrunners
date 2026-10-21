"use client";

import { useEffect, useState } from "react";
import { type AwayWords, awayPreciseWords } from "@/modules/events/domain/away-words";
import { awayPrecise } from "@/modules/events/domain/next-event-away";

/** How often the line is said again: a minute, the finest step it names. */
const TICK_MS = 60_000;

/**
 * The calendar card's countdown to the hour (§843; the owner, 2026-10-21: «tell me also the hours until the event, not just the
 * day»). The page is cached until the club's midnight (§549, §834), so the server can only say the day («Peste 4 zile»); that is
 * what this island draws first — the same words, so hydration matches and a visitor without scripts reads them — and then, on the
 * visitor's own clock, the hours: «Peste 4 zile și 3 ore», «Mâine, peste 14 ore», «Azi, peste 40 de minute», «Acum», said again
 * every minute and stopped when the card leaves the page. `live` off (the design page's fixed sample) keeps the server's words.
 *
 * No read, no request: the start instant and the words come as props, and `awayPrecise` is the domain's pure function.
 */
export default function AwayLine({ initial, startsAt, timeZone, locale, words, live = true }: { initial: string; startsAt: string; timeZone: string; locale: string; words: AwayWords; live?: boolean }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (!live) return;
    const start = new Date(startsAt);
    const say = () => setText(awayPreciseWords(awayPrecise(start, new Date(), timeZone), words, locale));
    say();
    const timer = window.setInterval(say, TICK_MS);
    return () => window.clearInterval(timer);
  }, [live, startsAt, timeZone, locale, words]);
  return <span data-testid="calendar-next-away-words">{text}</span>;
}
