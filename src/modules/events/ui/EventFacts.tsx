import CakeIcon from "@mui/icons-material/Cake";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import PaymentsIcon from "@mui/icons-material/Payments";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import { formatDay, formatTime } from "@/i18n/dates";
import { ageRuleVariant, yearsPhrase } from "@/modules/registrations/domain/age";
import SocialIcon from "@/shared/ui/SocialIcon";
import { partnerCardSurface } from "@/theme/surfaces";
import { coHostDescription, coHostLinkHost, coHostLinkLabel, coHostLinksForPage, primaryCoHostLink, readCoHosts } from "../domain/co-hosts";
import { costPaidToExternalOrganizer, costUrlHost } from "../domain/cost";
import { distanceInKm, hasAgeRule, isStravaLink, takesRegistrations } from "../domain/event-type";
import { openRegistrationClosing, registrationState, upcomingRegistrationOpening } from "../domain/registration-window";
import { hasRouteDescription } from "../domain/route-section";
import type { PublicEvent } from "../repository";
import { GROUP_GAP, LINE_GAP } from "./card-layout";
import CoHostLinkGlyph from "./co-host-glyphs";
import { COST_GLYPH, DIFFICULTY_GLYPH, GLYPHS, type Glyph } from "./glyphs";
import { orderRoutePills, routePillParts, type Pill } from "./route-pills";
import RoutePills from "./RoutePills";
import { DENSITY } from "@/theme/density";

/**
 * The leading glyph of every row on the event page's facts (§356): one size, one colour, one
 * alignment, whichever question the row answers. The owner, 2026-09-24: "address with address
 * icons not consistent". One object, so a row cannot drift from the others; the unit test reads
 * the class Emotion gives it and finds the same one on every row.
 */
const ROW_ICON_SX = { fontSize: 20, color: "text.secondary", verticalAlign: "middle", mr: 1, flexShrink: 0 } as const;

/**
 * The clock in front of the time, inside the "când" line (§366; the owner, 2026-09-24, of a
 * listing card: "for the time I would like a clock icon as well"): "[calendar] Duminică, 27 sept. 2026 ·
 * [clock] 10:00". The row glyph's size, colour and alignment — one family with the calendar and the
 * pin — and half its gap, because it sits inside a line of words rather than at its head. On the
 * page and the cards alike; the hero draws the same clock in its own glyphs' size
 * (`HERO_GLYPH_SX`), because there the family it sits among is eighteen pixels, not twenty.
 */
const CLOCK_SX = { ...ROW_ICON_SX, mr: 0.5 } as const;

/**
 * The listing's featured hero's glyphs: eighteen pixels, sat three pixels under the baseline — the
 * size and seat its labels' glyphs have always had — and its clock's too (§366), so on the
 * hero the clock is the size of the calendar and the pin beside it, not the event page's larger
 * row glyph among smaller ones.
 */
const HERO_GLYPH_SX = { fontSize: 18, color: "text.secondary", verticalAlign: "-3px", mr: 0.5 } as const;

/**
 * A series card's «Următoarea:» / «Next:» lead, on the date's own line (§366, amended §375 — a
 * review, 2026-09-24, of the row hiding the lead below 600 pixels: "every phone loses the lead,
 * not only the 320-px ones; the owner's row keeps the lead where it fits"). When the row is
 * short of room, the lead gives way, never the time.
 *
 * The breakpoint is the widest case, measured in headless Chromium on the built listing (Roboto,
 * 14 pixels, the date **and** the time bold — re-measured 2026-09-25 against the bold time,
 * §375 amended once more): every day of a year, the date as the card prints it on a phone (the
 * year dropped), the lead, the separator, the clock and the time. Widest in Romanian:
 * "Următoarea: Duminică, 27 sept. · [clock] 18:30", 275 pixels (was 274 with a regular time —
 * Roboto's digits are not quite the same width bold, "18:30" gains about 1.2 pixels); in
 * English: "Next: Wednesday, 30 Sept · [clock] 18:30", 241 (was 240). What the page and the card
 * take around the row — the gutters, the card's padding, the row's own calendar glyph — is 94
 * pixels at every phone width (a 320-pixel viewport leaves the row 226, a 360-pixel one 266). So
 * the lead fits every weekday and every month from 369 pixels up; the breakpoint stays 376,
 * seven pixels over now rather than eight, so a font rendered a hair wider elsewhere (Linux
 * against Windows, a system's own hinting) still does not push the time off the row. One number
 * for both languages: the Romanian lead is the wider.
 *
 * Below it the lead is clipped visually (a one-pixel box, never `display: none`), so a screen
 * reader still reads it at every width. The date does something else with its year: it swaps two
 * renderings with `display` (`date`, below), each whole where it shows.
 */
const WHEN_LEAD_HIDDEN_BELOW_376 = {
  "@media (max-width: 375.95px)": {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
} as const;

/**
 * The gap between a race card's «when» pieces, and before each separator, on the card row only
 * (§375 amended, §381): four pixels where every other row keeps six. A race's row wraps by
 * design (`flow`, below), the date on the first line and the two named times on the second —
 * and with those times' digits bold (`whenPieces`' `boldTime`), the second line measured, in
 * headless Chromium on the built listing at 320 pixels in Romanian on the widest weekday
 * ("Duminică, 27 sept." alone on the first line), 226.83 pixels for
 * "[clock] întâlnire la 08:00 · start la 09:00" against the 226 the card leaves the row: it
 * wrapped once more, to three lines, and a runner read the start time on a line of its own.
 * Two pixels fewer each side of the separator give back four: re-measured 2026-09-25, the line is
 * now 222.83 pixels at 320 in Romanian (215.14 in English), two lines in all; from 360 up the
 * date and the gathering time share the first line and the start time takes the second, in both
 * languages, at 360, 390 and 412. The series row and `WHEN_LEAD_HIDDEN_BELOW_376` are untouched —
 * they never wrap, and their breakpoint was measured with the six-pixel gap.
 */
const RACE_ROW_GAP = 0.5;

/**
 * The facts of an event, grouped by the question they answer.
 *
 * Nine labelled rows — date, gathering time, race start, meeting point, distance, climb,
 * difficulty, cost, registration — were a table a reader had to scan top to bottom to answer
 * "when and where do I show up". The owner's word on it (2026-09-18): "these details should be
 * better organised; the UX must be simple and easy." So the same facts are grouped by the
 * question they answer, and the labels are the questions: *când*, *unde*, *traseu*. Still a
 * `<dl>`, so a screen reader hears the question before the answer; separators are hidden from it.
 *
 * Three forms of the same facts:
 * - **the listing card** (`variant="compact"`): no labels — a line for when and one for where, each
 *   with the page's row glyph in front of it, the place as its map link, then the route and the
 *   cost as the page's pills, then the state of registration (§366);
 * - **the listing's featured hero** (the default): the `<dl>`, each row one line of short
 *   pieces separated by a middle dot — a summary above the fold, with a button to reach;
 * - **the event page and its preview** (`stacked`): the `<dl>` grouped again and restyled
 *   (§356) — "când" one line, the place with its address under it, the route as one row of
 *   pills, the cost its own row with its own pill, and every row's glyph the same.
 *
 * Registration is not a fact of the event but a state of the moment, and the button beneath
 * these lines says it (`RegistrationCta`) — except for an event with no registration at all,
 * which has no button and deserves the one sentence "no registration needed". The compact
 * variant on a listing card has no button either, so there the state is a line of its own.
 */
export default async function EventFacts({
  event,
  now,
  variant = "full",
  links = true,
  stacked = false,
  whenLead,
}: {
  event: PublicEvent;
  now: Date;
  variant?: "full" | "compact";
  /**
   * The card's words in front of the date, on the date's own line: a series card's "Următoarea:"
   * (§113, §366), so "Următoarea: Luni, 28 sept. 2026 · 18:30" is one line rather than a label on a
   * line of its own above the facts. The compact form only.
   */
  whenLead?: string;
  /**
   * The event page's own facts (§168, restyled by §356), which the page and the staff preview
   * ask for and nothing else does.
   *
   * §168 put each piece on its own bulleted line; the owner, 2026-09-24, of that list: "This
   * info needs to be better grouped … distance, difficulty, elevation should be on the same
   * line, better styled", and of the bullets under "Traseu": "these need to be pills". So the
   * page groups by question and draws each group in the shape its facts have: one line of text
   * for when, a name and an address for where, a row of pills for the route and the cost.
   *
   * The hero and the cards keep their one-line forms: they are summaries above the fold, where
   * three short pieces on one line is the whole point.
   */
  stacked?: boolean;
  /**
   * Whether the facts may carry links of their own: the meeting point as the map link (the
   * owner: "this address should be a link if I set that in the console"), the route, Strava.
   * Every caller now wants them — no card is one whole link any more (§366), so the one-off card's
   * place is its map link as the series card's always was ("I do not see the google maps link for
   * this event, although I've put the maps URL"). False stays for a surface that is itself a link.
   */
  links?: boolean;
}) {
  const t = await getTranslations("Event");
  const format = await getFormatter();
  const locale = (await getLocale()) as "ro" | "en";
  const compact = variant === "compact";

  const distance = distanceInKm(event.distanceMeters);
  const state = registrationState(event, now);

  // The event's own timezone, not the server's or the reader's. A run in Brașov starts at its
  // local time regardless of where the page is opened.
  // The date starts its line, so it takes a capital (§349): "Sâmbătă, 21 nov. 2026".
  const time = (at: Date) => formatTime(at, { locale, timeZone: event.timezone });
  const dateLong = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long" });
  /**
   * The card's "when" line must fit on one line at 320 and 360 pixels (§366, amended §375 — the
   * owner, 2026-09-24, of the row whose clock and time had wrapped to a second line: "This should
   * be on a single line on a phone"). Measured (§366): with the year, the line never fits a
   * phone's width once the calendar glyph, the clock and the time share it. When the date falls
   * within the coming twelve months a phone drops the year — the weekday and the day-month stay
   * (§349) — through `formatDay`'s own `year: false`, the smallest change that fits: never a
   * second date format, only the one option this helper already carries. `sm` and up, a date
   * further out and a date already past keep the year; nothing is lost where there is room to
   * read it.
   *
   * A card that keeps its year on a phone — no `dateShort` — is the other case the row must not
   * clip (a review, 2026-09-24): "Duminică, 27 sept. 2026 · [clock] 18:30" is 227 pixels against
   * the 226 a 320-pixel card leaves the row, and a series card's lead in front of a past date
   * ("Următoarea: Duminică, 27 sept. 2026 …", 310) runs past a 360-pixel card's 266. Such a row
   * wraps between whole pieces (`wrap` below, `flow`'s `card.wrap`), the way a race's two named
   * times do. Flex wrapping breaks the line only when the row does not fit, so a year-carrying
   * card that fits — a desktop's, a short weekday's — stays one line.
   */
  const dateWithinYear = compact && event.startsAt.getTime() - now.getTime() >= 0 && event.startsAt.getTime() - now.getTime() < 365 * 24 * 60 * 60 * 1000;
  const dateShort = dateWithinYear ? formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", year: false }) : null;
  const date: ReactNode = dateShort ? (
    <>
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        {dateLong}
      </Box>
      <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
        {dateShort}
      </Box>
    </>
  ) : (
    dateLong
  );

  // A 44px target, like every other link on a phone (BR-REQ-041-01 criterion 6). `noopener`
  // and `noreferrer` stop the opened page reaching back through `window.opener` and stop it
  // learning which page sent the visitor (`DECISIONS.md` §61 on the Strava mark: the mark
  // decorates, the words are the link, and never Strava's script).
  //
  // `tight` (the event page, §356) keeps the 44 pixels and gives back the twenty the line did not
  // need, as a negative margin above and below: the box a thumb hits is as tall as ever, but the
  // line it sits on is as tall as its text, so the place's name sits right above its address and a
  // payment link beside its pill. Only for a link whose neighbours above and below are words —
  // two tight links wrapped one under the other would share their targets, so a row of links
  // (the route's) keeps its full height. The twenty are padding as well as margin (§366): a place
  // long enough to wrap onto two lines of a card is taller than 44 already, and a margin alone
  // would pull the lines around it into its words; padding given back as margin never does.
  // `"above"` gives back only the ten above: for a link with something nearer than ten pixels
  // under it — which comes later in the page, paints over the link and takes a press there — so
  // the ten below stay in the line and nothing sits on them (the card's place, §366).
  //
  // `border-box`, said here and not inherited, because inside a `<details>` it is not: the browser
  // slots a fold's content into the fold's own shadow tree, where MUI's `box-sizing: inherit`
  // does not reach, so everything under it is `content-box` — and the listing's cards stand in
  // one whenever there is a lead event ("other events", §78). There the 44 was the words' box and
  // the twenty were added around it: a 64-pixel link on a line 44 tall rather than its words' 24,
  // the words twelve pixels under the pin beside them (found by `listing-cards.spec.ts` on a
  // series with a map link, §366). With it the box is 44 and the line 24, or 34 with the ten
  // above given back only, wherever the facts are drawn.
  const outLink = (href: string, label: string, network?: "strava" | "facebook", tight: boolean | "above" = false) => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        boxSizing: "border-box",
        minHeight: 44,
        ...(tight === true ? { py: "10px", my: "-10px" } : tight === "above" ? { py: "10px", mt: "-10px" } : {}),
      }}
    >
      {network && <SocialIcon network={network} size={18} />}
      {label}
    </Link>
  );

  // A word with its glyph in front, for the closed sets (§112); the word is what is read.
  const withGlyph = (Icon: Glyph, word: ReactNode) => (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
      {word}
    </Box>
  );

  /* When: the date, then the times — a race has two, each named; anything else has one, bare,
     right after the date on the same line, where the middle dot binds the two. §169 named the
     lone time ("începe la 09:00") only because the page had put it on a bullet of its own; the
     page's "când" is one line again (§356), so the name went with the bullet. The times are led
     by a clock (§366), once — before the first, so a race's two read as one group — in the size
     of the glyphs around it: the row glyph's on the page and the cards, the hero's own there.

     `boldTime` (§375 amended — the owner, 2026-09-25, of the listing card's row: "The time can
     be bolded here as well") gives the bare time the date's own weight, `<strong>` like `day`
     above, on the compact card row only — the card's own caller passes it, the page's and the
     hero's do not. A race's two named times ("gather at 08:00", "start at 09:00") carry a word
     before the number, so bolding the plain-time key would bold that word too; `gatheringAtBold`
     / `raceStartAtBold` wrap only `{time}` in `<strong>`, so the launch race's card matches the
     weekly-run cards without the word going bold with it. `ical.ts`'s calendar description
     keeps the plain keys — no markup belongs in an `.ics` `DESCRIPTION` line.

     The bold digits cost a race's card width (§381): its second line, the two named times, grew
     to 226.83 pixels at 320 in Romanian on the widest weekday against the row's 226, and wrapped
     to a third line. The card's race row takes a four-pixel gap instead of six for it
     (`RACE_ROW_GAP`, above, with the measurement before and after); the lead's breakpoint and
     the series row keep theirs. */
  const whenPieces = (clockSx: typeof CLOCK_SX | typeof HERO_GLYPH_SX, boldTime = false): ReactNode[] => {
    const clock = <ScheduleIcon aria-hidden="true" sx={clockSx} />;
    const day = <strong key="date">{date}</strong>;
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
    if (event.raceStartsAt) {
      return [
        day,
        <>
          {clock}
          {boldTime
            ? t.rich("gatheringAtBold", { time: time(event.startsAt), strong })
            : t("gatheringAt", { time: time(event.startsAt) })}
        </>,
        boldTime
          ? t.rich("raceStartAtBold", { time: time(event.raceStartsAt), strong })
          : t("raceStartAt", { time: time(event.raceStartsAt) }),
      ];
    }
    return [
      day,
      <>
        {clock}
        {boldTime ? <strong>{time(event.startsAt)}</strong> : time(event.startsAt)}
      </>,
    ];
  };

  // The organizations the event is held with (§168, §344): the page draws each in full
  // (`partnerFacts`, below), the hero says them in one sentence (`coHostSentence`, built in its
  // branch), and the listing card says neither (§366).
  const coHosts = readCoHosts(event);

  /**
   * One partner, in full, for the page's own "Împreună cu" (§344; the owner: "this can have
   * multiple links, so it should be a card, it's like: partner link, partner event, etc"): its
   * name, then every link it carries as its own compact row — the kind's glyph, the club's own
   * label or the kind's word, and the host in small text underneath, the same reading
   * `EventLinks` gives "Linkuri și fișiere" (§332). A partner with no links is just its name.
   *
   * Between the name and the links, what the partnership is (§352; the owner, for the Brașov
   * Running Festival: "a short description of the partnership") — in the reader's language and
   * only when the club wrote it in both (`coHostDescription`): never the Romanian sentence on the
   * English page, and never a partnership described on one page and silent on the other. Where to
   * register with the partner comes first among its links and, with no label of the club's, says
   * so, naming the partner ("Înscriere la Brașov Running Festival") — the one call to action on
   * the card, written as a link in the weight of a heading, never a second button competing with
   * the club's own registration beneath these facts (`RegistrationCta`).
   *
   * Plain `<span>`s throughout, never a `<ul>` or a `<p>`: it was written to sit inside an inline
   * element, and a block has no business nested in one. `links` gates it exactly as it gates
   * every other link on this component; the listing card never calls it at all (§366).
   */
  const partnerFacts = (host: (typeof coHosts)[number]) => {
    const description = coHostDescription(host, locale);
    const pageLinks = coHostLinksForPage(host);
    if (pageLinks.length === 0 && !description) return <>{host.name}</>;
    return (
      <Box component="span" sx={{ display: "inline-flex", flexDirection: "column", rowGap: 0.5, verticalAlign: "top" }}>
        <Box component="span">{host.name}</Box>
        {description && (
          <Typography component="span" variant="body2" color="text.secondary" data-testid="co-host-description" sx={{ overflowWrap: "anywhere" }}>
            {description}
          </Typography>
        )}
        {pageLinks.length > 0 && (
          <Box component="span" sx={{ display: "flex", flexDirection: "column", rowGap: 0.5 }}>
            {pageLinks.map((link, index) => {
              const linkDomain = coHostLinkHost(link.url);
              const registration = link.kind === "REGISTRATION";
              const label =
                coHostLinkLabel(link, locale) ?? (registration ? t("coHostLinks.registerWith", { partner: host.name }) : t(`coHostLinks.kinds.${link.kind}`));
              return (
                <Link
                  key={index}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44 }}
                >
                  <CoHostLinkGlyph kind={link.kind} size={18} />
                  <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <Box component="span" sx={{ overflowWrap: "anywhere", fontWeight: registration ? 600 : undefined }}>
                      {label}
                    </Box>
                    {linkDomain && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere", lineHeight: 1.3 }}>
                        {linkDomain}
                      </Typography>
                    )}
                  </Box>
                </Link>
              );
            })}
          </Box>
        )}
      </Box>
    );
  };

  const pieces = (items: ReactNode[]) => (
    <Box component="span" sx={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <Box component="span" aria-hidden="true" sx={{ color: "text.disabled" }}>
              ·
            </Box>
          )}
          <span>{item}</span>
        </Fragment>
      ))}
    </Box>
  );

  // A glyph beside each of the hero's questions (the owner, 2026-09-18: "more icons in the app"),
  // decorative: the label is the word, the glyph is what the eye finds first.
  const glyph = (Icon: Glyph) => <Icon aria-hidden="true" sx={HERO_GLYPH_SX} />;

  // A group run says nothing about registration at all (§111; the owner: "group runs don't
  // have registrations!") — not even "none needed": the question does not arise.
  const mentionsRegistration = takesRegistrations(event.type);

  /*
    One line of short pieces: "Sâmbătă, 26 sept. 2026 · 08:00". The middle dot is hidden from a
    screen reader and carried at the end of the piece before it.

    The page's own row (`stacked`, no `card`) still wraps — a race's two named times may need a
    second line there, and each piece is its own flex item so the break falls between pieces, never
    inside one.

    The card's form (§366, amended §375 — the owner, 2026-09-24, of the row whose clock and time had
    wrapped to a second line: "This should be on a single line on a phone") is `nowrap` on the row,
    every piece kept whole — except where `card.wrap` says the row may need a second line, and there
    it breaks between whole pieces exactly as the page does. Two cases set it: a race's two named
    times — at 320 pixels "[calendar] Sâmbătă … · [clock] întâlnire la 09:00 · start la 10:00" is
    about 390 pixels against the card's 226, and `nowrap` would have the card's own
    `overflow: hidden` clip the start time silently, the one time a runner must not miss — and a
    date that keeps its year on a phone (`dateShort` absent: a past date, or one more than a year
    out; measured above). Flex wrapping breaks only a row that does not fit.

    A series card's own lead ("Următoarea:") is the other width the amendment measured: with the
    year already dropped (`date`, above) the lead does not fit next to the widest date, the clock
    and the time below 368 pixels. A review, 2026-09-24, amended §375 once more: MUI's `sm` (600
    pixels) hid the lead on every phone, not only the ones too narrow for it; a second review
    found the first measured breakpoint (345, from one Monday) too narrow for a Sunday.
    `WHEN_LEAD_HIDDEN_BELOW_376`, above, carries the measurement of every weekday and month. The
    lead gives way, never the time: below the breakpoint it is clipped visually, so a screen
    reader still reads it; the date's year is swapped with `display` instead, two renderings of
    which one shows.
  */
  const flow = (items: ReactNode[], card?: { lead?: string; wrap?: boolean; tight?: boolean }) => (
    <Box sx={{ display: "flex", flexWrap: card && !card.wrap ? "nowrap" : "wrap", alignItems: "baseline", columnGap: card?.tight ? RACE_ROW_GAP : 0.75, minWidth: 0 }}>
      {card?.lead && (
        <Box component="span" sx={{ color: "text.secondary", whiteSpace: "nowrap", flexShrink: 0, ...WHEN_LEAD_HIDDEN_BELOW_376 }}>
          {card.lead}
        </Box>
      )}
      {items.map((item, index) => (
        <span key={index} style={card ? { whiteSpace: "nowrap", flexShrink: 0 } : undefined}>
          {item}
          {index < items.length - 1 && (
            <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", ml: card?.tight ? RACE_ROW_GAP : 0.75 }}>
              ·
            </Box>
          )}
        </span>
      ))}
    </Box>
  );

  /*
    The route's numbers as pills — surface, difficulty, distance, elevation, in that order (§366,
    amended §375 — the owner, 2026-09-24, of "8 km · 250 m D+ · Mediu · Trail": "The order of this
    should be: terrain type, difficulty, distance, elevation") — each with its glyph (§112), a pill
    only for what the club stated. `orderRoutePills` decides the order once, for both the event
    page (§356) and the listing card (§366), so neither can read them in a different order; a pill
    absent on an event stays absent, never a gap where it would have been.

    The surface is built here but not included by default: the event page (below) adds it to the
    ordered set only when another route pill or link is already drawn, so a route with only a
    surface (the overline already says it, BR-REQ-010-01) makes no "Traseu" row of its own; the
    card (§366) always includes it, since the card's chips no longer repeat the surface.
  */
  // `routePillParts` (`route-pills.ts`) is the one function that builds the five pills from the
  // event's own columns — `buildRoutePills` (the compact card, below, and the backoffice's own
  // list) and this stacked row both call it, so neither builds its own copy that could drift.
  const routePillPieces = routePillParts(event, t, format);
  const { difficulty: difficultyPill, distance: distancePill, elevation: elevationPill, headlamp: headlampPill, surface: surfacePill } = routePillPieces;
  let routePills = orderRoutePills({ difficulty: difficultyPill, distance: distancePill, elevation: elevationPill, headlamp: headlampPill });

  if (compact) {
    /*
      The listing card (§366; the owner, 2026-09-24, of the listing: "There is too much whitespace
      on these cards, it needs to be better spaced", and of the one-off card's facts beside the
      event page's pills: "I like these pills on the full page details! this is currently pretty
      ugly!"). The event page's own shapes, smaller:

      - a line for when and a line for where, each led by the page's row glyph (`ROW_ICON_SX`,
        §356) in a flex row, so the glyph stays on the first line of its words and a long place
        wraps under itself — the old line was an inline glyph followed by an inline-flex block of
        pieces, and a block too wide for what was left of the line dropped whole under the glyph
        and left the pin alone on a line;
      - the place is its map link on every card now that no card is one whole link;
      - the route and the cost as the page's pills, one wrapping row, no middle dots;
      - the state of registration last, where BR-REQ-011-01 criterion 18 reads it.

      No labels: the glyphs are the questions on a card. No partner either: "Împreună cu …"
      between the place and the kilometres was one of the things the owner pointed at, and the
      partner's mark on a card belongs to its chips, not to its facts.
    */
    /*
      The pills, in the one order (`orderRoutePills`, above): surface, difficulty, distance,
      elevation — said here once, so the chips at the top of the card no longer carry the surface
      (§366: the same word twice on one card was one of the things the owner saw) — then the cost
      as the closed set's short word, "Gratuit", "Cu taxă", "Donație" (§343: an amount and where to
      pay are the page's). No pill for what the club has not stated: a null cost is unstated, not
      free (AGENTS.md §1.2).
    */
    // Built from the same `routePillParts`/`orderRoutePills` pair `buildRoutePills` (`route-pills.ts`,
    // §388) uses — the event page's compact card and the backoffice's own list still read the route
    // in one order — but not through `buildRoutePills` itself: on an `EXTERNAL`-registration paid
    // event, the cost pill needs the screen-reader-only suffix below, which the shared helper's own
    // cost pill does not carry.
    const cardPills: Pill[] = orderRoutePills({
      surface: surfacePill,
      difficulty: difficultyPill,
      distance: distancePill,
      elevation: elevationPill,
      headlamp: headlampPill,
    });
    if (event.costType) {
      // The word stays the closed set's own — "Cu taxă" — but on an `EXTERNAL`-registration paid
      // event a screen reader is told the fee goes to the organizer, never to the club (§389).
      cardPills.push({
        glyph: `cost:${event.costType}`,
        label: t(`costValues.${event.costType}`),
        srSuffix: costPaidToExternalOrganizer(event) ? t("costPaidExternalSrSuffix") : undefined,
      });
    }

    /*
      Where: the place — the map link when the club pasted one, tight like the page's (§356) so
      the line is as tall as its words — or the sentence while it is to be announced (§328), whose
      query has already withheld the name, the address and the map.

      Tight both ways only when the pills follow it, a group's gap (twelve pixels) under the line,
      more than the ten the link reaches below its words. Anything else after it is nearer — the
      state of registration a line's gap (eight) under it, or, when the place is the card's last
      fact, the door four pixels under the facts and a series card's fold right on them — and
      would take the bottom of the link, since what comes later paints over it (§366). There it
      gives back only the ten above, and keeps the ten below inside the facts, where nothing sits.
    */
    const reach = cardPills.length > 0 ? true : "above";
    const place = event.locationToBeAnnounced
      ? t("locationToBeAnnounced")
      : event.locationName
        ? links && event.mapUrl
          ? outLink(event.mapUrl, event.locationName, undefined, reach)
          : event.locationName
        : links && event.mapUrl
          ? outLink(event.mapUrl, t("openMap"), undefined, reach)
          : null;

    // The state of registration — and, while the window is ahead, the date it opens rather than
    // "not yet" (§146), read through the one helper the feed reads it through, never a formula of
    // this file's own. And while it is open, until when (§308) — the same helper family, so the
    // card's date is the instant the button goes away.
    let registration: string | null = null;
    if (mentionsRegistration) {
      const opensAt = upcomingRegistrationOpening(event, now);
      const closesAt = openRegistrationClosing(event, now);
      // Inside "Înscrierile se deschid pe {date}": the weekday keeps its lower case (§349).
      const shortDate = (date: Date) =>
        formatDay(date, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
      registration = opensAt
        ? t("cta.opensOnShort", { date: shortDate(opensAt) })
        : closesAt
          ? t("cta.openUntilShort", { date: shortDate(closesAt) })
          : t(`registrationState.${state}`);
    }

    // One line of the card: its glyph, then its words beside it — the glyph on the first line.
    const cardLine = (key: string, Icon: Glyph, value: ReactNode, secondary = false) => (
      <Typography
        component="div"
        variant="body2"
        color={secondary ? "text.secondary" : "text.primary"}
        data-fact={key}
        sx={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}
      >
        <Icon aria-hidden="true" sx={ROW_ICON_SX} />
        <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{value}</Box>
      </Typography>
    );

    return (
      <Box data-testid="card-facts" sx={{ display: "grid", rowGap: LINE_GAP, minWidth: 0 }}>
        {/* "Duminică, 27 sept. 2026 · [clock] 10:00" — on a series card "Următoarea: …" in front (§113);
            a race's gathering and start time, or a date that keeps its year on a phone (no
            `dateShort`: past, or more than a year out), may still wrap between whole pieces rather
            than be clipped (§366, amended §375). */}
        {cardLine("when", CalendarMonthIcon, flow(whenPieces(CLOCK_SX, true), { lead: whenLead, wrap: !!event.raceStartsAt || (compact && !dateShort), tight: !!event.raceStartsAt }))}
        {place && cardLine("where", PlaceIcon, place)}
        {/* A group of its own, so a group's gap above it rather than a line's (§366). */}
        {cardPills.length > 0 && (
          <Box data-fact="pills" sx={{ mt: GROUP_GAP - LINE_GAP }}>
            <RoutePills pills={cardPills} />
          </Box>
        )}
        {registration && cardLine("registration", HowToRegIcon, registration, true)}
      </Box>
    );
  }

  if (!stacked) {
    /*
      The listing's featured hero: one line per question, the pieces separated by middle dots,
      and its partners as one sentence (`coHostSentence`, below) — a summary above the fold with
      a button to reach, so neither a column of every partner's links nor the page's pills (§169,
      §356).

      Its pieces are built here, in its own branch, because nothing else draws them (§366): the
      card and the page draw the place, the route and the cost in shapes of their own, and neither
      says the partners as a sentence — built for every card, they were three links and a sentence
      made and thrown away.
    */

    /* Where: the meeting point — itself the map link when the organizer pasted one and a link
       may sit here; the same destination is never offered twice on one line. While the place is
       to be announced (§328) the sentence that says so, as the page and the cards say it; the
       query has already withheld the name, the address and the map. */
    const where: ReactNode[] = [];
    if (event.locationToBeAnnounced) {
      where.push(t("locationToBeAnnounced"));
    } else if (event.locationName) {
      where.push(links && event.mapUrl ? outLink(event.mapUrl, event.locationName) : event.locationName);
    } else if (links && event.mapUrl) {
      where.push(outLink(event.mapUrl, t("openMap")));
    }

    /* The route in numbers, in the reader's own language for the two enums (migration `0018`);
       cost only when the club has stated one — null means unstated, not free (AGENTS.md §1.2).
       This is the hero's line; the event page (§356) and the listing card (§366) draw pills.

       Same order as `orderRoutePills` (§366, amended §375 — the owner, 2026-09-24, of "8 km · 250 m
       D+ · Mediu · Trail": "The order of this should be: terrain type, difficulty, distance,
       elevation"), minus the surface: the hero has no surface pill of its own, the overline chip
       beside the event's type already says it, so difficulty leads here, before distance and
       elevation. Difficulty carries its own glyph (§112: bars for how hard); distance and elevation
       do not, on the hero as before. */
    const route: ReactNode[] = [];
    if (event.difficulty) route.push(withGlyph(DIFFICULTY_GLYPH[event.difficulty], t(`difficultyValues.${event.difficulty}`)));
    if (distance !== null) {
      // format.number applies the locale's separators: "14,5" in Romanian, "14.5" in English.
      route.push(t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }));
    }
    if (event.elevationGainMeters) route.push(t("elevationM", { m: format.number(event.elevationGainMeters) }));
    // The headlamp (§382), with its glyph like the pill it is on the card and the page, before the cost.
    if (event.headlampRequired) route.push(withGlyph(GLYPHS.headlamp, t("headlamp")));
    // The coin for the cost, below, is the closed set's other glyph (§112).
    /*
      The cost (§343): the card keeps the closed set's short word — "Cu taxă", "Donație", in its
      pill (§366). The hero says more, the way the meeting point becomes its own map link: a paid
      event's amount, with "plata pe {host}" as a second, separate link when the club gave one; a
      donation's whole phrase is the link to give at, with the suggested amount after it when the
      club stated one. Never a raw URL, only the host a runner recognises (`costUrlHost`), the same
      rule "Linkuri și fișiere" follows (§332).
    */
    if (event.costType === "PAID" && costPaidToExternalOrganizer(event)) {
      // An `EXTERNAL`-registration, `PAID` event is entered — and paid — at the organizer's own
      // form, not the club's (`DECISIONS.md` §389): the hero says so plainly, the same wording
      // the page's cost row uses, and never links `costUrl` — the club's own address is not where
      // this fee goes. The club's own discount, if any, follows on its own piece.
      route.push(withGlyph(COST_GLYPH.PAID, event.costAmount ? t("costPaidExternalAmount", { amount: event.costAmount }) : t("costPaidExternal")));
      if (event.discountNote) route.push(withGlyph(GLYPHS.discount, event.discountNote));
    } else if (event.costType === "PAID") {
      route.push(withGlyph(COST_GLYPH.PAID, event.costAmount ? t("costPaidAmount", { amount: event.costAmount }) : t("costValues.PAID")));
      const host = event.costUrl ? costUrlHost(event.costUrl) : null;
      if (event.costUrl && host) {
        route.push(links ? outLink(event.costUrl, t("costPaidWhere", { host })) : t("costPaidWhere", { host }));
      }
    } else if (event.costType === "DONATION") {
      const host = event.costUrl ? costUrlHost(event.costUrl) : null;
      route.push(
        withGlyph(
          COST_GLYPH.DONATION,
          event.costUrl && host
            ? links
              ? outLink(event.costUrl, t("costDonation", { host }))
              : t("costDonation", { host })
            : t("costValues.DONATION"),
        ),
      );
      if (event.costAmount) route.push(t("costDonationSuggested", { amount: event.costAmount }));
    } else if (event.costType) {
      route.push(withGlyph(COST_GLYPH[event.costType], t(`costValues.${event.costType}`)));
    }
    if (links && event.routeUrl) route.push(outLink(event.routeUrl, t("openRoute"), isStravaLink(event.routeUrl) ? "strava" : undefined));
    if (links && event.stravaEventUrl) route.push(outLink(event.stravaEventUrl, t("openStravaEvent"), "strava"));
    // The Facebook event (§144): where the club's people say "going".
    if (links && event.facebookEventUrl) route.push(outLink(event.facebookEventUrl, t("openFacebookEvent"), "facebook"));

    /**
     * The organizations the event is held with (§168), as one sentence: "Împreună cu A, B și C",
     * joined the way the reader's language joins a list — `format.list`, never a hand-rolled
     * comma and an "and". A partner may carry any number of links now (§344), and a sentence has
     * room for one, so each name is its own link to the partner's own site — its first link if it
     * named no site — except where the facts may carry no links at all. The listing's featured hero
     * keeps this sentence exactly (§169); the event page's facts draw each partner in full
     * (`partnerFacts`); and the listing card no longer says it among its facts (§366 — the owner
     * saw "Împreună cu Brașov Running Festival" between the place and the kilometres): the
     * partner's mark on a card belongs to its chips.
     */
    const coHostNames = coHosts.map((host) => host.name);
    const coHostPrimaryLinks = coHosts.map((host) => primaryCoHostLink(host));
    const coHostSentence = () => {
      if (!links || coHostPrimaryLinks.every((link) => link === null)) return format.list(coHostNames);
      return (
        <>
          {format.list(
            coHosts.map((host, index) => {
              const primary = coHostPrimaryLinks[index];
              return <Fragment key={index}>{primary ? outLink(primary.url, host.name) : host.name}</Fragment>;
            }),
          )}
        </>
      );
    };

    // The clock in the hero's own glyph size, like the calendar and the pin beside it (§366).
    const lines: Array<{ label: string; icon: Glyph; value: ReactNode[] }> = [
      { label: t("when"), icon: CalendarMonthIcon, value: whenPieces(HERO_GLYPH_SX) },
    ];
    if (where.length > 0) lines.push({ label: t("where"), icon: PlaceIcon, value: where });
    // Held with other organizations (§121, §168).
    if (coHosts.length > 0) lines.push({ label: t("coHost"), icon: GLYPHS.partner, value: [coHostSentence()] });
    if (route.length > 0) lines.push({ label: t("route"), icon: RouteIcon, value: route });
    if (state === "NOT_APPLICABLE" && mentionsRegistration) {
      lines.push({ label: t("registration"), icon: HowToRegIcon, value: [t("registrationState.NOT_APPLICABLE")] });
    }
    return (
      <Box
        component="dl"
        sx={{
          my: 0,
          display: "grid",
          // The label column sizes to the longest label and stops there; on a phone the pair
          // still shares one line, which is what saves the height.
          gridTemplateColumns: "auto 1fr",
          columnGap: 2,
          rowGap: { xs: DENSITY.gapXs, sm: 1 },
          alignItems: "baseline",
        }}
      >
        {lines.map((line) => (
          <Fragment key={line.label}>
            <Typography component="dt" variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              {glyph(line.icon)}
              {line.label}
            </Typography>
            <Typography component="dd" variant="body1" sx={{ m: 0 }}>
              {pieces(line.value)}
            </Typography>
          </Fragment>
        ))}
      </Box>
    );
  }

  /* ---- The event page, and the staff preview that draws exactly what it will (§356). ---- */

  const rows: Array<{ key: string; label: string; icon: Glyph; value: ReactNode }> = [
    { key: "when", label: t("when"), icon: CalendarMonthIcon, value: flow(whenPieces(CLOCK_SX)) },
  ];

  /*
    Where: the place's name — the map link when the organizer pasted one — and its address on the
    line under it, in the smaller grey type of a second line. The address used to stand on its own
    further down the page, under "Adresă", with no glyph and a second link to the same map (the
    owner: "address with address icons not consistent"); now it is where the question is, and the
    map is offered once. While the place is to be announced (§328), the sentence alone: the query
    has withheld the name, the address and the map, and this reads the flag before any of them.
  */
  const placeName = event.locationName
    ? links && event.mapUrl
      ? outLink(event.mapUrl, event.locationName, undefined, true)
      : event.locationName
    : links && event.mapUrl
      ? outLink(event.mapUrl, t("openMap"), undefined, true)
      : null;
  const address = event.locationAddress?.trim() || null;
  if (event.locationToBeAnnounced) {
    rows.push({ key: "where", label: t("where"), icon: PlaceIcon, value: t("locationToBeAnnounced") });
  } else if (placeName || address) {
    rows.push({
      key: "where",
      label: t("where"),
      icon: PlaceIcon,
      value: (
        <Box sx={{ overflowWrap: "anywhere" }}>
          {placeName && <div>{placeName}</div>}
          {address && (
            <Typography component="div" variant="body2" color="text.secondary" data-testid="event-address">
              {address}
            </Typography>
          )}
        </Box>
      ),
    });
  }

  /*
    The route: one row of pills — surface, difficulty, distance, elevation, in the one order
    (`orderRoutePills`, above), each with its glyph (§112), a pill only for what the club stated.
    The surface is the course's (§350) and completes a route row, but never makes one on its own:
    the overline at the top of the page already says it beside the type (BR-REQ-010-01), and a
    "Traseu" holding only that word would be the overline again. Under the pills, the route's links.
    `routePills` without the surface is built above, shared with the card.
  */
  const routeLinks: ReactNode[] = [];
  /*
    With a route description in this language (§387), the route link moves into the page's own
    "Traseul" section (`EventRoute`, under `#route`) with the GPX and the map, and this row points
    there instead — one in-page link, 44 pixels like the rest. The Strava event and the Facebook
    event stay: they are where people say "going", not the route.
  */
  const routeSection = hasRouteDescription(event.routeDescriptionJson);
  if (links && routeSection) {
    routeLinks.push(
      <Link href="#route" data-testid="route-jump" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, boxSizing: "border-box", minHeight: 44 }}>
        <RouteIcon aria-hidden="true" sx={{ fontSize: 18 }} />
        {t("routeJump")}
      </Link>,
    );
  } else if (links && event.routeUrl) {
    routeLinks.push(outLink(event.routeUrl, t("openRoute"), isStravaLink(event.routeUrl) ? "strava" : undefined));
  }
  if (links && event.stravaEventUrl) routeLinks.push(outLink(event.stravaEventUrl, t("openStravaEvent"), "strava"));
  // The Facebook event (§144): where the club's people say "going".
  if (links && event.facebookEventUrl) routeLinks.push(outLink(event.facebookEventUrl, t("openFacebookEvent"), "facebook"));
  if (event.surface && (routePills.length > 0 || routeLinks.length > 0)) {
    routePills = orderRoutePills({
      surface: surfacePill,
      difficulty: difficultyPill,
      distance: distancePill,
      elevation: elevationPill,
      headlamp: headlampPill,
    });
  }
  if (routePills.length > 0 || routeLinks.length > 0) {
    rows.push({
      key: "route",
      label: t("route"),
      icon: RouteIcon,
      value: (
        <>
          {routePills.length > 0 && <RoutePills pills={routePills} />}
          {routeLinks.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2, mt: routePills.length > 0 ? 0.5 : 0 }}>
              {routeLinks.map((link, index) => (
                <Fragment key={index}>{link}</Fragment>
              ))}
            </Box>
          )}
        </>
      ),
    });
  }

  /*
    The cost (§343) is not a fact of the route, so it has its own row: one pill — "Gratuit", the
    club's own amount ("50 lei"; the row's label already says it is a cost), "Cu taxă" when no
    amount was stated, "Donație" — and after it, as words and links rather than pills, where to pay
    ("plata pe revolut.me") or where to give ("Donează pe …", the suggested amount after it). A
    pill is a fact; a link is a link, 44 pixels tall like every other one here. Never a raw URL,
    only the host a runner recognises (`costUrlHost`, §332). Nothing at all when the club has not
    said: null is unstated, not free (AGENTS.md §1.2).
  */
  const costHost = event.costUrl ? costUrlHost(event.costUrl) : null;
  const costExtras: ReactNode[] = [];
  let costPill: Pill | null = null;
  // An `EXTERNAL`-registration, `PAID` event is entered — and paid — at the organizer's own
  // form, not the club's (`DECISIONS.md` §389): the pill says so plainly ("Cu taxă, la
  // organizator") rather than reading like a club fee, and the club's own discount, if any,
  // follows it with the tag glyph (§112).
  const externalPaid = costPaidToExternalOrganizer(event);
  if (event.costType === "FREE") {
    costPill = { glyph: "cost:FREE", label: t("costValues.FREE") };
  } else if (event.costType === "PAID" && externalPaid) {
    costPill = { glyph: "cost:PAID", label: event.costAmount ? t("costPaidExternalAmount", { amount: event.costAmount }) : t("costPaidExternal") };
    if (event.discountNote) {
      costExtras.push(
        <Box key="discount" component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <GLYPHS.discount aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
          {event.discountNote}
        </Box>,
      );
    }
  } else if (event.costType === "PAID") {
    costPill = { glyph: "cost:PAID", label: event.costAmount ? event.costAmount : t("costValues.PAID") };
    if (event.costUrl && costHost) {
      costExtras.push(links ? outLink(event.costUrl, t("costPaidWhere", { host: costHost }), undefined, true) : t("costPaidWhere", { host: costHost }));
    }
  } else if (event.costType === "DONATION") {
    costPill = { glyph: "cost:DONATION", label: t("costValues.DONATION") };
    if (event.costUrl && costHost) {
      costExtras.push(links ? outLink(event.costUrl, t("costDonateOn", { host: costHost }), undefined, true) : t("costDonateOn", { host: costHost }));
    }
    if (event.costAmount) costExtras.push(t("costDonationSuggested", { amount: event.costAmount }));
  }
  if (costPill) {
    rows.push({
      key: "cost",
      label: t("cost"),
      icon: PaymentsIcon,
      value: (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5 }}>
          <RoutePills pills={[costPill]} />
          {costExtras.length > 0 && flow(costExtras)}
        </Box>
      ),
    });
  }

  /*
    Who may enter (§329): the event's own minimum age and who registers a minor, in the sentence
    the form's intro line says — one sentence, read from one place, so the page and the form
    cannot disagree. On the page only: it is a condition of the race a runner reads before
    pressing, and the hero above the fold is a summary with a button to reach. Only where the club
    counts it (`hasAgeRule`); the legal templates point here for the number.
  */
  if (hasAgeRule(event)) {
    const rt = await getTranslations("Registration");
    rows.push({
      key: "age",
      label: t("age"),
      icon: CakeIcon,
      value: rt(`ageRule.${ageRuleVariant(event.minAge)}`, { age: yearsPhrase(event.minAge, locale) }),
    });
  }
  if (state === "NOT_APPLICABLE" && mentionsRegistration) {
    rows.push({ key: "registration", label: t("registration"), icon: HowToRegIcon, value: t("registrationState.NOT_APPLICABLE") });
  }

  /*
    Held with other organizations (§121, §168), each its own card of links (§344, §352) — last,
    after the short facts a runner scans first, because a partner's card is the tallest thing in
    the block; spaced one under another, never bulleted.

    Each partner's own outlined, tinted box (§344 amended — the owner, 2026-09-25, of the shared
    race with the Brașov Running Festival: "The partner card should have a border and a gray
    background so it stands out"), `partnerCardSurface` (`theme/surfaces.ts`) — the card sits on
    the page's own background otherwise, and a border with no fill read as one more row among the
    page's plain facts. The box is a `<div>`, never a MUI `Paper`, because `partnerFacts` returns
    inline content built to sit inside a `<dd>`; the surface shares its border and radius with
    every outlined box on the site already (`CalendarSection`, which does not share its wash),
    and its wash — `action.selected`, stronger than a mere hover tint — with `CalendarEventChip`
    and `RegistrationSteps`, only bordering a block wide enough to keep the marker, the name, the
    description and the links clear of its edge.
  */
  if (coHosts.length > 0) {
    rows.push({
      key: "coHost",
      label: t("coHost"),
      icon: GLYPHS.partner,
      value: (
        <Box sx={{ display: "grid", rowGap: { xs: DENSITY.gapSm, sm: 1.5 }, justifyItems: "start" }}>
          {coHosts.map((host, index) => (
            <Box key={index} data-testid="partner-card" sx={{ ...partnerCardSurface, p: 2, maxWidth: "100%" }}>
              {links ? partnerFacts(host) : host.name}
            </Box>
          ))}
        </Box>
      ),
    });
  }

  return (
    <Box
      component="dl"
      data-testid="event-facts"
      sx={{
        my: 0,
        display: "grid",
        /*
          On a phone the question sits on its own line with its glyph and the answer under it,
          indented to the label's first letter: at 320 pixels a label column costs the answer a
          quarter of the width — "Împreună cu" alone is a hundred pixels — and the answers are
          what needs it now, a row of pills and a date that fits on one line. From `sm` up the
          label column is back, as wide as its longest label, the answer baseline-aligned with it.

          The phone's spacing (§380): four pixels between a question and its answer (`rowGap` 0.5,
          already the tight end — less and the answer reads as the label's second line), six under
          an answer before the next question (`DENSITY.gapXs` on the `dd`, was eight), and the
          answer indented twenty-eight (`pl` 3.5: the twenty-pixel glyph and its eight-pixel gap),
          which is alignment with the label's first letter, not whitespace.
        */
        gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "max-content minmax(0, 1fr)" },
        columnGap: 3,
        rowGap: { xs: 0.5, sm: 1.5 },
        alignItems: "baseline",
      }}
    >
      {rows.map((row) => (
        <Fragment key={row.key}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            <row.icon aria-hidden="true" sx={ROW_ICON_SX} />
            {row.label}
          </Typography>
          <Typography component="dd" variant="body1" sx={{ m: 0, minWidth: 0, pl: { xs: 3.5, sm: 0 }, mb: { xs: DENSITY.gapXs, sm: 0 } }}>
            {row.value}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}
