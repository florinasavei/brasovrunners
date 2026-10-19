import { getLocale, getTranslations } from "next-intl/server";
import { publicListClosesAt, publicListStillOpen, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { cachedDeadlines, cachedStartListCounts } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { hiddenListCounting, hiddenListShownPublicly } from "@/modules/registrations/domain/hidden-list";
import type { PublicEvent } from "../repository";
import { startListHeadline } from "./counted-phrases";
import { readRegistrationDoor, type RegistrationDoor } from "./registration-door";

/**
 * The part of the public start list that names its number (§632, §647) — the counts, the door's places line and the title's headline —
 * read **once, by one function, for both callers**: `StartList` (the fold's title and the line under it) and the event page's facts, whose
 * line «N vin · vezi cine» says the very number the fold's title has (§NNN; the owner, 2026-10-19: «„Cine vine" trebuie să fie mai vizibil»).
 *
 * No query of its own: every read below is the public cache's, asked once per request however many parts of the page need it (§489,
 * `request-memo.ts`), and `readRegistrationDoor` is the entry `RegistrationCta` has just read. So the facts asking first costs the list
 * nothing, and the two can never disagree about a number — they are one computation, not two copies.
 *
 * Null: the event publishes no list (`participantListVisibility`), or its period is over (§421). The list closes by itself — asked now, at
 * the request: the cached rows expire on writes, and a date passing is not one — so a static event page is made again when the list
 * closes (§549), here and not in the component, so whichever caller asks first holds the page.
 */
export type StartListHead = {
  /** The page's translator under `Event` and its language, loaded once the list is known to be open (a closed list loads neither). */
  t: Awaited<ReturnType<typeof getTranslations>>;
  locale: string;
  /** The moment the list was judged open at, and the club's deadlines it was judged by (the legend's sentences read them too). */
  now: Date;
  deadlines: Deadlines;
  /** «Arată invitații speciali pe lista publică» (§743). */
  hiddenShown: boolean;
  named: number;
  anonymous: number;
  outsideNamed: number;
  hidden: { confirmed: number; held: number };
  /** «Arată public numărătoarea» (§647): whether the list says its numbers at all. */
  countPublic: boolean;
  /** «Numără și lista ascunsă» (§647). */
  countHidden: boolean;
  /** The places line's own read (§632): the in-progress holds a capped event's title adds. */
  door: RegistrationDoor;
  /** The title's number and the line under it (§632). */
  headline: ReturnType<typeof startListHeadline>;
};

export async function readStartListHead(event: PublicEvent): Promise<StartListHead | null> {
  if (event.participantListVisibility !== "NAMES") return null;
  const now = new Date();
  const deadlines = await cachedDeadlines();
  // A static event page is made again when the list closes (§549), or the CDN would keep the names.
  await holdPageUntil([publicListClosesAt(event, deadlines)], now);
  if (!publicListStillOpen(event, now, deadlines)) return null;

  const t = await getTranslations("Event");
  const locale = await getLocale();
  // Two counts first, so one page of fifty never fetches four hundred rows (§250), from the public cache (§333).
  const hiddenShown = hiddenListShownPublicly(event);
  const { named, anonymous, outsideNamed, hidden } = await cachedStartListCounts(event.id, hiddenShown);
  const { countPublic, countHidden } = hiddenListCounting(event);
  /*
    The title's number and the line under it (§632): the confirmed, plus — on a capped event — those the places line says are completing
    their registration. The places come from the door's own cached read (`readRegistrationDoor`: the entry the page's `RegistrationCta`
    reads, for an open internal event only), so this costs no query of its own; a door that read nothing (uncapped, closed, unreadable)
    leaves the confirmed alone. Accepted knowingly: when that read fails, the request memo forgets the failed promise, so this call asks
    the database once more and logs a second «[registration-door] could not read the availability» after the card's.
  */
  const door = await readRegistrationDoor(event, now);
  /*
    «Lista ascunsă» (§643): a runner the club put on the hidden list keeps their row in the table when they ticked — the list is a
    disclosure they chose, and nothing marks them there — and leaves the title's and the summary line's numbers, which count the places, as
    the places line does. Unless the event counts the hidden list (§647): then those numbers are everybody on it with a place, ticked or
    not — its confirmed among «confirmați», its holds among «în curs de confirmare» — while the places line above, and the rows, stay as
    they are. `named + anonymous` is every confirmed runner, named or not (`startListPage`'s `confirmed`).
  */
  const confirmed = named + anonymous;
  const headline = startListHeadline(
    t,
    locale,
    countHidden
      ? { confirmed: Math.max(confirmed - outsideNamed, 0) + hidden.confirmed, named }
      : { confirmed: Math.max(confirmed - outsideNamed, 0), named: Math.max(named - outsideNamed, 0) },
    door.kind === "KNOWN" ? door.fill : null,
    countHidden ? hidden.held : 0,
  );
  return { t, locale, now, deadlines, hiddenShown, named, anonymous, outsideNamed, hidden, countPublic, countHidden, door, headline };
}

/**
 * The number the public list's own title says («Cine vine (N)»), for the event page's facts line — or null when the list is not drawn, its
 * numbers are kept private («Arată public numărătoarea» off) or the database is away (§281). The same `readStartListHead` the list
 * reads, never a count of its own.
 */
export async function readStartListCount(event: PublicEvent): Promise<number | null> {
  return readOrWhileAway(async () => {
    const head = await readStartListHead(event);
    return head !== null && head.countPublic ? head.headline.count : null;
  }, null);
}
