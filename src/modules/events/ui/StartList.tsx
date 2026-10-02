import GroupsIcon from "@mui/icons-material/Groups";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import {
  cachedDeadlines,
  cachedFirstStatesNoticeVersion,
  cachedListNumbersDisclosed,
  cachedListSocialsDisclosed,
  cachedListStatesDisclosed,
  cachedStartListCounts,
  cachedStartListOthersCounts,
  cachedStartListOthersPage,
  cachedStartListPage,
} from "@/modules/public-cache/reads";
import { hiddenListCounting } from "@/modules/registrations/domain/hidden-list";
import { LIST_STATE_KEYS, type PublicListGroup } from "@/modules/registrations/domain/public-list-states";
import { START_LIST_PAGE_SIZE, startListPage } from "@/modules/registrations/domain/start-list-page";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import type { PublicEvent } from "../repository";
import { othersPhrases, startListHeadline } from "./counted-phrases";
import { readRegistrationDoor } from "./registration-door";
import { listStateLegend } from "./list-state-legend";
import ListStateLabel from "./ListStateLabel";
import StartListSocials from "./StartListSocials";
import { readOrWhileAway } from "@/modules/resilience/optional-read";

/** What the «BIB» column says for a listed runner with no number: the backoffice's own dash (§548). */
const NO_NUMBER = "—";

/**
 * Who is coming (BR-REQ-039-01, BR-REQ-039-02; `DECISIONS.md` §32, §85, §186, §250, §346): every
 * confirmed, real participant of an event whose organizer switched the list on — by name for
 * those who ticked "Vreau să apar pe lista de participanți & rezultate", and as "Participant (nume ascuns)"
 * for everybody else.
 *
 * A native disclosure, closed, with the count in its summary: a page whose bottom third is a
 * list of names reads like a list of names, and the event page is about the event.
 *
 * ## A table, and why it is one (§250)
 *
 * It was two columns of flowing text, which is what a class list looks like and not what an
 * entry list looks like (the owner: "I want the participants table to be a real table! with
 * pagination"). Three columns now — the position in the confirmed order, the name, the club —
 * which is what a runner scans for: *am I on it, and who else from my club is*.
 *
 * **Fifty to a page, and the page is a link.** Four hundred runners is four hundred rows on a
 * phone otherwise, and the page is public — so the paging is server-side and works with no
 * JavaScript at all: each link is this event's own address with `?lista=2`, and the disclosure
 * is rendered open when one is on it, or the reader would arrive at a closed box.
 *
 * What is *not* in the table is the guarantee: the display name and the club, which is what the
 * repository's select list carries and what `tests/privacy/public-surface.test.ts` refuses to
 * let widen. No address, and no number or state but behind the privacy notice's own gates (below).
 *
 * ## The hidden names (§186, §346)
 *
 * A runner who did not tick the box is a row that says "Participant (nume ascuns)" and nothing
 * else — not initials, not a club, not a position. There is nothing to leak because nothing was
 * read: `countAnonymousStartListEntries` selects a number. The rows sit after every named one,
 * because the order the named rows follow is the order people confirmed in, and a hidden row
 * placed *in* that order would say "somebody confirmed between Ana and Ion" — which, to anybody
 * who knows when a friend signed up, is the friend. Grouped at the end they say only how many.
 * The same reason keeps the position column empty on them: the next number after the named
 * rows would read as a place in the confirmed order that nobody holds.
 *
 * The line above the table counts both — "42 de participanți confirmați — 39 cu numele afișat" —
 * from the same two counts the rows are drawn from, so it matches the confirmed count the club
 * sees in the backoffice, test registrations excluded (`AGENTS.md` §12.6).
 *
 * ## The title counts everyone with a place (§632, amending §346)
 *
 * The owner, 2026-10-02: «pune-o și pe cei care trebuie să confirme înregistrarea». On a capped
 * event whose places line says some are «în curs de confirmare», the title adds them — «Cine vine
 * (150)» — and the line says the split: «150 de înscriși — 134 de confirmați (120 cu numele afișat),
 * 16 în curs de confirmare». The figure is the places line's own, from the page's one cached read
 * (`readRegistrationDoor`, the entry `RegistrationCta` has just read: no query of the list's own,
 * §250); with nothing in progress, on an uncapped event (§32: no head count of held places without
 * an «out of») or when the door read no counts, the title and line are the confirmed alone, as before.
 * `startListHeadline` says why the two counts it adds come from two reads. The rows do not change:
 * the pending appear by name only behind §396's gate, and only those who ticked.
 *
 * ## The states, behind the privacy notice (§396)
 *
 * Once the privacy notice in force describes it (`cachedListStatesDisclosed` — the notice names
 * `{{participantListStates}}`), every row says where its registration stands — "Confirmat",
 * "Înscris, în așteptarea confirmării", "Pe lista de așteptare" (`ListStateLabel`) — and the list
 * gains, after every confirmed row, the ticked ones who have not confirmed yet and then the
 * waiting list in queue order, with no position: the owner's "ca oamenii să știe că sunt pe
 * lista de așteptare". Nobody who did not tick appears in those two groups, not even as a count,
 * and a cancelled or expired registration appears nowhere. Without that notice the list is
 * exactly what it was: confirmed names, no words, no other rows — the same component, one
 * boolean.
 *
 * ## The waiting list, by the event's own switch (§628)
 *
 * The owner, 2026-10-01: "Acum mai am nevoie de încă o setare cu «lista de așteptare e publică»". The
 * waiting-list group — its rows, its word, its legend sentence, its count in the line above the
 * table, its clause in the caption and the note — is drawn only for an event whose «Lista de
 * așteptare e publică» is on (`event.waitlistPublic`), on top of the notice's two gates; off, the
 * readers below are asked without it, so no waiting row is even read. The pending group is the
 * notice's alone, as before.
 *
 * ## What the words mean (§556)
 *
 * The owner, 2026-09-29, of a list reading «Confirmat» and «Înscris, în așteptarea confirmării»:
 * «Acum trebuie să explic ce înseamnă „în așteptarea confirmării”». Behind the same gate, a legend
 * under the table says one sentence per state the list shows — only those present — and each
 * word carries the same sentence behind a «?». The pending sentence names this event's own
 * participation window, or the club's hold, and the waiting list's the club's offer window, all
 * from their values (`list-state-legend.ts`): never a number of the page's own.
 *
 * ## Strava and Instagram, behind the notice and the runner's own tick (§500)
 *
 * The owner: "on the who's coming I want to show people's social as well, if they put that, like
 * their Strava and Instagram". Once the privacy notice in force names `{{participantListSocials}}`
 * (`cachedListSocialsDisclosed`), a named row — confirmed, or behind §396's gate pending or
 * waiting — carries the network's mark, linked, beside the name (`StartListSocials`), for the
 * runners who ticked «Arată și Strava și Instagram» on the form. The query returns the two values
 * only for them; a hidden row never has any, because nothing about it is read. Without that notice
 * the list reads no social at all.
 *
 * ## The race number, behind the notice (§613, amending §396)
 *
 * The owner: "in the public participants list, I also want to show the BID as a column, not just
 * the index in the table". Once the privacy notice in force names `{{participantListNumbers}}`
 * (`cachedListNumbersDisclosed`), a «BIB» column sits between the position and the name: a named
 * confirmed runner's race number — the one their confirmation drew (§548), `bib_number`, never the
 * old provisional column (§214: a published number is a number that cannot move) — «—» for a
 * confirmed runner who has none and for the pending and waiting rows (they have none, §548), and
 * nothing at all on a hidden row (§186: nothing about it is read). The column shows only when the
 * page's rows carry at least one number: an event that numbers nobody keeps today's table rather
 * than a column of dashes. Without that notice no number is even selected.
 *
 * ## The hidden list's two ticks (§NNN, amending §632 and §643)
 *
 * The owner, 2026-10-02: «nu vreau să scot pe nimeni de pe listă, ci doar să nu se pună la socoteală;
 * de fapt mai punem bifă pentru „afișarea numărătorii”». Two ticks of the event's
 * (`hiddenListCounting`): «Arată public numărătoarea», on every event whatever «Folosește lista
 * ascunsă» says, off leaves the names alone — no number in the title, no counted line, no position
 * column (a running position is a count); «Numără și lista ascunsă», only while the switch is on,
 * puts everybody on the hidden list with a place into the title and «confirmați» (`countHiddenListWithPlace`: ticked or not, real only;
 * its holds into «în curs de confirmare» only where the places line is known). Neither changes a row:
 * which names appear is the person's tick and the notice's gates alone. The places line never counts
 * the hidden list — it takes no place.
 *
 * ## While the database is away
 *
 * Nothing, rather than the event page's error (§447): the list is never served from a copy — a
 * stale list would show a name its owner withdrew — so an outage, or a red month's cache miss
 * (`ColdMissError`), leaves the section out and the page stands.
 */
export default async function StartList(props: StartListProps) {
  return readOrWhileAway(() => startListOrThrow(props), null);
}

type StartListProps = {
  event: PublicEvent;
  /** `?lista=` from the query string, unchecked: `startListPage` clamps it. */
  page?: string;
};

async function startListOrThrow({ event, page: requestedPage }: StartListProps) {
  if (event.participantListVisibility !== "NAMES") return null;
  /*
    The list closes by itself (§421): the club's number of days after the event ("Termene"), asked
    now, at the request — the cached rows below expire on writes, and a date passing is not one. The
    same component draws every `?lista=` page, so a page link past the date shows nothing either.
  */
  const now = new Date();
  const deadlines = await cachedDeadlines();
  // A static event page is made again when the list closes (§549), or the CDN would keep the names.
  await holdPageUntil([publicListClosesAt(event, deadlines)], now);
  if (!publicListStillOpen(event, now, deadlines)) return null;

  const t = await getTranslations("Event");
  const locale = await getLocale();
  // Two counts first, so one page of fifty never fetches four hundred rows (§250). Both, and the
  // page, from the public cache (§333): a confirmation, a cancellation, an erasure or somebody
  // leaving the list expires them, so a name is never shown after its owner withdrew it. The
  // hidden rows (§346) are drawn from the anonymous count alone — the cache holds a number for
  // them, never a row, a position or an initial.
  const { named, anonymous, outsideNamed, hidden } = await cachedStartListCounts(event.id);
  /*
    «Lista ascunsă» (§NNN): whether the list says its numbers at all («Arată public numărătoarea»), and
    whether they count the hidden list («Numără și lista ascunsă») — the first on every event, the second
    only while the hidden list's switch is on. Numbers only: which rows the table holds never depends on them (§32).
  */
  const { countPublic, countHidden } = hiddenListCounting(event);
  // The gate (§396): the notice in force, in every language, describes the states. Off, nothing
  // below reads a pending or waiting row at all — not even their count.
  const statesOn = await cachedListStatesDisclosed(now);
  // The socials' gate (§500), the same reading: off, no Strava or Instagram is even selected.
  const socialsOn = await cachedListSocialsDisclosed(now);
  // The race number's gate (§613), the same reading: off, no number is even selected.
  const numbersOn = await cachedListNumbersDisclosed(now);
  /*
    …and only for the ticks given under a notice that described them (§421): a registration that
    recorded an older notice agreed to a list of confirmed names, and appears once confirmed, as
    before. With the gate on there is always such a notice; null only if the two reads disagree for
    a moment, and then nobody beyond the confirmed is read.
  */
  const firstStatesNotice = statesOn ? await cachedFirstStatesNoticeVersion() : null;
  /*
    …and the waiting list only where the club made it public for this event (§628, «Lista de așteptare
    e publică»): a third condition on that one group, never a way round the two above. Off, no waiting
    row is read, counted, worded or explained — the list is the confirmed and the ticked pending.
  */
  const waitlistOn = event.waitlistPublic === true;
  const others =
    firstStatesNotice !== null ? await cachedStartListOthersCounts(event.id, firstStatesNotice, waitlistOn) : { pending: 0, waitlisted: 0, outsidePending: 0 };
  const view = startListPage(named, anonymous, requestedPage, START_LIST_PAGE_SIZE, others.pending + others.waitlisted);
  /*
    The title's number and the line under it (§632): the confirmed, plus — on a capped event — those the
    places line says are completing their registration. The places come from the door's own cached read
    (`readRegistrationDoor`: the entry the page's `RegistrationCta` reads, for an open internal event
    only), so this costs no query of its own; a door that read nothing (uncapped, closed, unreadable)
    leaves the confirmed alone, today's title and line. Accepted knowingly: when that read fails, the
    request memo forgets the failed promise, so this call asks the database once more and logs a second
    «[registration-door] could not read the availability» after the card's — the breaker fails fast once
    open, and threading the card's door down to the list would couple two islands for a log line.
  */
  const door = await readRegistrationDoor(event, now);
  /*
    «Lista ascunsă» (§643): a runner the club put on the hidden list keeps their row in the table when
    they ticked — the list is a disclosure they chose, and nothing marks them there — and leaves the
    title's and the summary line's numbers, which count the places, as the places line does. Unless the
    event counts the hidden list (§NNN): then those numbers are everybody on it with a place, ticked or
    not — its confirmed among «confirmați», its holds among «în curs de confirmare» — while the places
    line above, and the rows, stay as they are.
  */
  const headline = startListHeadline(
    t,
    locale,
    countHidden
      ? { confirmed: Math.max(view.confirmed - outsideNamed, 0) + hidden.confirmed, named }
      : { confirmed: Math.max(view.confirmed - outsideNamed, 0), named: Math.max(named - outsideNamed, 0) },
    door.kind === "KNOWN" ? door.fill : null,
    countHidden ? hidden.held : 0,
  );
  // The note that the hidden list is not counted, only where it is not and the numbers are said.
  const outsideShown = countPublic && !countHidden && outsideNamed + (others.outsidePending ?? 0) > 0;
  const [participants, otherRows] = await Promise.all([
    view.namedLimit > 0 ? cachedStartListPage(event.id, view.namedOffset, view.namedLimit, socialsOn, numbersOn) : [],
    firstStatesNotice !== null && view.othersLimit > 0
      ? cachedStartListOthersPage(event.id, firstStatesNotice, waitlistOn, view.othersOffset, view.othersLimit, socialsOn)
      : [],
  ]);
  /** The marks beside a name — only behind the gate, and only what the row carries. */
  const socialsOf = (row: { displayName: string; stravaUrl?: string | null; instagramHandle?: string | null }) =>
    socialsOn ? (
      <StartListSocials
        stravaUrl={row.stravaUrl}
        instagramHandle={row.instagramHandle}
        stravaLabel={t("startList.socials.strava", { name: row.displayName })}
        instagramLabel={t("startList.socials.instagram", { name: row.displayName })}
      />
    ) : null;
  // The pending on the hidden list (§643) are rows below, not part of the counted words — unless the event
  // counts the hidden list (§NNN) — and with the numbers kept private (§NNN) there are no counted words.
  const pendingCounted = countHidden ? others.pending : Math.max(others.pending - (others.outsidePending ?? 0), 0);
  const extra = statesOn && countPublic ? othersPhrases(t, locale, { pending: pendingCounted, waitlisted: others.waitlisted }) : [];
  /*
    What each word means (§556), for the states this list shows — a confirmed row, named or hidden,
    and the pending and waiting rows it reads — from the event's own window and the club's deadlines.
  */
  const legend = statesOn
    ? listStateLegend(t, locale, {
        groups: [
          ...(view.confirmed > 0 ? (["CONFIRMED"] as const) : []),
          ...(others.pending > 0 ? (["PENDING"] as const) : []),
          ...(others.waitlisted > 0 ? (["WAITLISTED"] as const) : []),
        ],
        event,
        deadlines,
        now: new Date(),
      })
    : [];
  const helpOf = (group: PublicListGroup) => legend.find((line) => line.group === group)?.sentence;
  /** The word beside a name — only behind the gate; without it a row carries no state. */
  const stateOf = (group: PublicListGroup) =>
    statesOn ? <ListStateLabel group={group} label={t(`startList.states.${LIST_STATE_KEYS[group]}`)} help={helpOf(group)} /> : null;

  /*
    The «BIB» column (§613): behind the gate, and only when this page's confirmed rows carry a number
    — a column that would read «—» on every row says nothing to a reader, so the table stays as it
    was. `bibNumber` is absent from every row without the gate (the query did not select it).
  */
  const numbersShown = numbersOn && participants.some((participant) => typeof participant.bibNumber === "number");
  /** The number's cell: the number, or «—» for a row that has none. A hidden row has an empty cell instead. */
  const numberCell = (bibNumber: number | null | undefined) =>
    numbersShown ? (
      <Box component="td" data-col="number" data-testid="start-list-number">
        {typeof bibNumber === "number" ? bibNumber : NO_NUMBER}
      </Box>
    ) : null;
  // The caption names the number only when the column is there (§613), and the waiting list only
  // where it is public (§628).
  const caption = statesOn
    ? numbersShown
      ? t(waitlistOn ? "startList.captionStatesNumbers" : "startList.captionStatesNumbersNoWaitlist")
      : t(waitlistOn ? "startList.captionStates" : "startList.captionStatesNoWaitlist")
    : numbersShown
      ? t("startList.captionNumbers")
      : t("startList.caption");

  /** A relative query, so the link stays on this event whatever its address is (§8). */
  const pageHref = (page: number) => `?lista=${page}#start-list-title`;

  return (
    // Google honours `data-nosnippet` only on span, div and section elements (not on the
    // `details` root below), so the wrapper — not the disclosure — carries it: names stay out of
    // search snippets (§421); the page itself stays indexed.
    <Box component="section" data-nosnippet="" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
    <Box
      component="details"
      aria-labelledby="start-list-title"
      data-testid="start-list"
      // Open when the reader asked for a page: arriving at a closed box from a page link is
      // the one thing a paginated disclosure must not do.
      open={view.page > 1 || undefined}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        px: 2,
        "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
        ...DISCLOSURE_OPEN_ARROW,
      }}
    >
      <Typography component="summary" id="start-list-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
        <GroupsIcon aria-hidden sx={FOLD_GLYPH_SX} />
        {/* «Arată public numărătoarea» off (§NNN): the title without its number. */}
        {countPublic ? t("startList.titleCount", { count: headline.count }) : t("startList.title")}
      </Typography>

      {view.total === 0 ? (
        <>
          {/* Nobody confirmed yet, somebody completing their registration (§632): the title counts them,
              so the line says who they are before the sentence that nobody has confirmed. */}
          {countPublic && headline.inProgress > 0 && (
            <Typography variant="body2" data-testid="start-list-summary" sx={{ fontWeight: 600, pb: 0.5 }}>
              {headline.line}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ pb: 2 }}>
            {t("startList.empty")}
          </Typography>
        </>
      ) : (
        <>
          {/* How many are confirmed, and how many of them are named (§346), and on a capped event
              those completing their registration, whom the title counts too (§632) — left out when
              nobody is confirmed or in progress yet and the rows below are all pending or waiting,
              where "0 confirmed — 0 named" would only be noise above them. */}
          {countPublic && (view.confirmed > 0 || headline.inProgress > 0 || extra.length === 0) && (
            <Typography variant="body2" data-testid="start-list-summary" sx={{ fontWeight: 600, pb: extra.length > 0 ? 0.5 : 1 }}>
              {headline.line}
            </Typography>
          )}
          {/* Behind the notice's gate (§396): how many of the rows after the confirmed ones are
              in each group — only those who ticked, since only they are rows. */}
          {extra.length > 0 && (
            <Typography variant="body2" data-testid="start-list-others-summary" sx={{ pb: 1 }}>
              {t("startList.othersLead")} {extra.join(" · ")}
            </Typography>
          )}

          {/*
            A real table, with a caption a screen reader announces and column headers that say
            which figure is which. It scrolls inside its own box rather than widening the page —
            the same arrangement the editorial tables use (§196), for the same 320-pixel reason.
          */}
          <Box sx={{ maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <Box
              component="table"
              sx={{
                width: "100%",
                borderCollapse: "collapse",
                "& th, & td": { textAlign: "left", py: 1, px: 1, borderBottom: 1, borderColor: "divider", verticalAlign: "top" },
                "& th": { fontWeight: 600, fontSize: "0.875rem", color: "text.secondary", whiteSpace: "nowrap" },
                // The position column, only where the numbers are said (§NNN): a running position is a count.
                ...(countPublic ? { "& td:first-of-type, & th:first-of-type": { width: "3rem", color: "text.secondary" } } : {}),
                // The race number (§613): right-aligned figures of one width, as narrow as its widest
                // number, so the name keeps the room it had at 320 pixels.
                "& [data-col='number']": { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", width: "1%" },
              }}
            >
              <Box component="caption" sx={{ captionSide: "top", textAlign: "left", py: 1, fontSize: "0.875rem", color: "text.secondary" }}>
                {caption}
              </Box>
              <Box component="thead">
                <Box component="tr">
                  {countPublic && (
                    <Box component="th" scope="col">
                      {t("startList.columnPosition")}
                    </Box>
                  )}
                  {numbersShown && (
                    // «BIB» on the screen, the whole word for a screen reader and on hover.
                    <Box component="th" scope="col" data-col="number" aria-label={t("startList.columnNumberFull")}>
                      <Box component="abbr" title={t("startList.columnNumberFull")} sx={{ textDecoration: "none" }}>
                        {t("startList.columnNumber")}
                      </Box>
                    </Box>
                  )}
                  <Box component="th" scope="col">
                    {t("startList.columnName")}
                  </Box>
                  <Box component="th" scope="col">
                    {t("startList.columnClub")}
                  </Box>
                </Box>
              </Box>
              <Box component="tbody">
                {participants.map((participant, index) => (
                  // The name is not unique — two people called Ana Popescu may both be running —
                  // so the position in the confirmed order is what identifies the row.
                  <Box component="tr" key={`${view.namedOffset + index}-${participant.displayName}`} data-testid="start-list-named">
                    {countPublic && <Box component="td">{view.firstPosition + index}</Box>}
                    {numberCell(participant.bibNumber)}
                    <Box component="td">
                      {participant.displayName}
                      {socialsOf(participant)}
                      {stateOf("CONFIRMED")}
                    </Box>
                    <Box component="td" sx={{ color: "text.secondary" }}>
                      {participant.clubName ?? ""}
                    </Box>
                  </Box>
                ))}
                {/*
                  The runners who did not ask to be named, counted but never named (§186, §346).

                  One row each rather than a single "and 3 others", because the list is read to
                  find out how many are coming as much as who — and a row that says "Participant
                  (nume ascuns)" is the truth about that person: they are coming, and their name
                  is not printed. Nothing identifies them; the query that counted them selected
                  a number. No position either (see the note above the component): the cells
                  either side of the words are empty on purpose.
                */}
                {Array.from({ length: view.anonymousOnPage }, (_, index) => (
                  <Box component="tr" key={`anonymous-${index}`} data-testid="start-list-anonymous">
                    {countPublic && <Box component="td" />}
                    {/* Nothing about a hidden runner is read (§186), so no number and no «—» either. */}
                    {numbersShown && <Box component="td" data-col="number" />}
                    <Box component="td" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                      {t("startList.anonymous")}
                      {stateOf("CONFIRMED")}
                    </Box>
                    <Box component="td" />
                  </Box>
                ))}
                {/*
                  Behind the notice's gate (§396): the ticked ones who have not confirmed yet, then
                  the waiting list in queue order. No position — a number would read as a place in
                  the confirmed order, or on the waiting list, and the second is the question the
                  owner left open (default: not shown).
                */}
                {otherRows.map((row, index) => (
                  <Box
                    component="tr"
                    key={`other-${view.othersOffset + index}-${row.displayName}`}
                    data-testid="start-list-other"
                    data-group={row.group}
                  >
                    {countPublic && <Box component="td" />}
                    {/* Pending or waiting: no number exists before the confirmation (§548), and none is selected. */}
                    {numberCell(null)}
                    <Box component="td">
                      {row.displayName}
                      {socialsOf(row)}
                      {stateOf(row.group)}
                    </Box>
                    <Box component="td" sx={{ color: "text.secondary" }}>
                      {row.clubName ?? ""}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          {/* The pager: two links and a sentence, and nothing at all on a list that fits one
              page. Plain anchors, so it works with JavaScript off, like the listing's own. */}
          {view.pages > 1 && (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
              {view.page > 1 ? (
                <Box component="a" href={pageHref(view.page - 1)} sx={{ ...TAP_TARGET, display: "inline-flex", alignItems: "center" }}>
                  {t("startList.previous")}
                </Box>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {t("startList.pageOf", { page: view.page, pages: view.pages })}
              </Typography>
              {view.page < view.pages ? (
                <Box component="a" href={pageHref(view.page + 1)} sx={{ ...TAP_TARGET, display: "inline-flex", alignItems: "center" }}>
                  {t("startList.next")}
                </Box>
              ) : null}
            </Stack>
          )}

          {/* The legend (§556): one plain sentence per state the list shows, only behind the gate. */}
          {legend.length > 0 && (
            <Box data-testid="start-list-legend" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 0.75 }}>
                <HelpOutlineIcon fontSize="small" aria-hidden="true" />
                {t("startList.legend.title")}
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {legend.map((line) => (
                  <Typography component="li" variant="body2" key={line.group} data-testid="start-list-legend-line" data-state={line.group}>
                    {line.sentence}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          {/* Said on the page rather than only in the privacy notice: somebody reading their own
              name here should be able to see, without leaving, that it was their choice and how
              to change it. */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, pb: 2 }}>
            {/* Without the numbers (§NNN), the note says nothing about the title's number. */}
            {countPublic
              ? statesOn
                ? t(waitlistOn ? "startList.noteStates" : "startList.noteStatesNoWaitlist")
                : t("startList.note")
              : statesOn
                ? t(waitlistOn ? "startList.noteStatesNamesOnly" : "startList.noteStatesNoWaitlistNamesOnly")
                : t("startList.noteNamesOnly")}
            {socialsOn ? ` ${t("startList.socialsNote")}` : null}
            {/* Only while the table holds somebody seated outside the places (§643): one sentence, no row marked. */}
            {outsideShown ? ` ${t("startList.outsideNote")}` : null}
          </Typography>
        </>
      )}
    </Box>
    </Box>
  );
}
