import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { cachedStartListCounts, cachedStartListPage } from "@/modules/public-cache/reads";
import { START_LIST_PAGE_SIZE, startListPage } from "@/modules/registrations/domain/start-list-page";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import type { PublicEvent } from "../repository";
import { confirmedPhrase } from "./counted-phrases";

/**
 * Who is coming (BR-REQ-039-01, BR-REQ-039-02; `DECISIONS.md` §32, §85, §186, §250, §346): every
 * confirmed, real participant of an event whose organizer switched the list on — by name for
 * those who ticked "Vreau să apar pe lista de participanți", and as "Participant (nume ascuns)"
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
 * let widen. No number, no address, no state.
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
 */
export default async function StartList({
  event,
  page: requestedPage,
}: {
  event: PublicEvent;
  /** `?lista=` from the query string, unchecked: `startListPage` clamps it. */
  page?: string;
}) {
  if (event.participantListVisibility !== "NAMES") return null;

  const t = await getTranslations("Event");
  const locale = await getLocale();
  // Two counts first, so one page of fifty never fetches four hundred rows (§250). Both, and the
  // page, from the public cache (§333): a confirmation, a cancellation, an erasure or somebody
  // leaving the list expires them, so a name is never shown after its owner withdrew it. The
  // hidden rows (§346) are drawn from the anonymous count alone — the cache holds a number for
  // them, never a row, a position or an initial.
  const { named, anonymous } = await cachedStartListCounts(event.id);
  const view = startListPage(named, anonymous, requestedPage, START_LIST_PAGE_SIZE);
  const participants =
    view.namedLimit > 0 ? await cachedStartListPage(event.id, view.namedOffset, view.namedLimit) : [];

  /** A relative query, so the link stays on this event whatever its address is (§8). */
  const pageHref = (page: number) => `?lista=${page}#start-list-title`;

  return (
    <Box
      component="details"
      aria-labelledby="start-list-title"
      data-testid="start-list"
      // Open when the reader asked for a page: arriving at a closed box from a page link is
      // the one thing a paginated disclosure must not do.
      open={view.page > 1 || undefined}
      sx={{
        mt: { xs: DENSITY.sectionGapLg, sm: 4 },
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        px: 2,
        "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
        ...DISCLOSURE_OPEN_ARROW,
      }}
    >
      <Typography component="summary" id="start-list-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("startList.titleCount", { count: view.total })}
      </Typography>

      {view.total === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pb: 2 }}>
          {t("startList.empty")}
        </Typography>
      ) : (
        <>
          {/* How many are confirmed, and how many of them are named (§346). */}
          <Typography variant="body2" data-testid="start-list-summary" sx={{ fontWeight: 600, pb: 1 }}>
            {confirmedPhrase(t, locale, { confirmed: view.total, named })}
          </Typography>

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
                "& td:first-of-type, & th:first-of-type": { width: "3rem", color: "text.secondary" },
              }}
            >
              <Box component="caption" sx={{ captionSide: "top", textAlign: "left", py: 1, fontSize: "0.875rem", color: "text.secondary" }}>
                {t("startList.caption")}
              </Box>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" scope="col">
                    {t("startList.columnPosition")}
                  </Box>
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
                    <Box component="td">{view.firstPosition + index}</Box>
                    <Box component="td">{participant.displayName}</Box>
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
                    <Box component="td" />
                    <Box component="td" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                      {t("startList.anonymous")}
                    </Box>
                    <Box component="td" />
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

          {/* Said on the page rather than only in the privacy notice: somebody reading their own
              name here should be able to see, without leaving, that it was their choice and how
              to change it. */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, pb: 2 }}>
            {t("startList.note")}
          </Typography>
        </>
      )}
    </Box>
  );
}
