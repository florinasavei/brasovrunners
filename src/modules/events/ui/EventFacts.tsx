import CakeIcon from "@mui/icons-material/Cake";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import PaymentsIcon from "@mui/icons-material/Payments";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import { formatDay, formatTime } from "@/i18n/dates";
import { ageRuleVariant, yearsPhrase } from "@/modules/registrations/domain/age";
import SocialIcon from "@/shared/ui/SocialIcon";
import { coHostDescription, coHostLinkHost, coHostLinkLabel, coHostLinksForPage, primaryCoHostLink, readCoHosts } from "../domain/co-hosts";
import { costUrlHost } from "../domain/cost";
import { distanceInKm, hasAgeRule, isStravaLink, takesRegistrations } from "../domain/event-type";
import { openRegistrationClosing, registrationState, upcomingRegistrationOpening } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { GROUP_GAP, LINE_GAP } from "./card-layout";
import CoHostLinkGlyph from "./co-host-glyphs";
import GlyphChip from "./GlyphChip";
import { COST_GLYPH, DIFFICULTY_GLYPH, type Glyph, type GlyphName } from "./glyphs";

/**
 * The leading glyph of every row on the event page's facts (§356): one size, one colour, one
 * alignment, whichever question the row answers. The owner, 2026-09-24: "address with address
 * icons not consistent". One object, so a row cannot drift from the others; the unit test reads
 * the class Emotion gives it and finds the same one on every row.
 */
const ROW_ICON_SX = { fontSize: 20, color: "text.secondary", verticalAlign: "middle", mr: 1 } as const;

/**
 * A pill on the event page (§356) — the listing card's outlined chip (`EventKindChips`), so the
 * page and the cards read alike. Its label wraps rather than ending in an ellipsis: MUI cuts a
 * chip's label to one line, and a club's own amount ("50 lei la înscriere, 70 lei în ziua
 * cursei", sixty characters at most) is a fact that must be read whole on a 320-pixel phone.
 * A plain object in module scope, because it crosses to the client component (`GlyphChip`).
 */
const PILL_SX = { height: "auto", minHeight: 24, maxWidth: "100%", "& .MuiChip-label": { whiteSpace: "normal", overflowWrap: "anywhere", py: 0.25 } } as const;

/** A pill's content: its glyph by name, for `GlyphChip` to make on its own side of the boundary (§112), and its words. */
type Pill = { glyph: GlyphName; label: string };

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
 *   with the page's row glyph in front of it, then the route and the cost as the page's pills
 *   (§NNN);
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
   * (§113, §NNN), so "Următoarea: Luni, 28 sept. 2026 · 18:30" is one line rather than a label on a
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
   * False inside a card that is itself one link (`EventCard`), where a nested link is invalid.
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
  const date = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long" });

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
  // (the route's) keeps its full height.
  const outLink = (href: string, label: string, network?: "strava" | "facebook", tight = false) => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, ...(tight ? { my: "-10px" } : {}) }}
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
     page's "când" is one line again (§356), so the name went with the bullet. */
  const when: ReactNode[] = [<strong key="date">{date}</strong>];
  if (event.raceStartsAt) {
    when.push(t("gatheringAt", { time: time(event.startsAt) }), t("raceStartAt", { time: time(event.raceStartsAt) }));
  } else {
    when.push(time(event.startsAt));
  }

  /* Where: the meeting point — itself the map link when the organizer pasted one and a link
     may sit here; the same destination is never offered twice on one line. While the place is
     to be announced (§328) the sentence that says so, on the page, the cards and the hero alike;
     the query has already withheld the name, the address and the map. */
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
     This is the hero's line; the event page (§356) and the listing card (§NNN) draw pills. */
  const route: ReactNode[] = [];
  if (distance !== null) {
    // format.number applies the locale's separators: "14,5" in Romanian, "14.5" in English.
    route.push(t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }));
  }
  if (event.elevationGainMeters) route.push(t("elevationM", { m: format.number(event.elevationGainMeters) }));
  // The two closed sets carry their glyphs (§112): bars for how hard, a coin for the cost.
  if (event.difficulty) route.push(withGlyph(DIFFICULTY_GLYPH[event.difficulty], t(`difficultyValues.${event.difficulty}`)));
  /*
    The cost (§343): the card keeps the closed set's short word — "Cu taxă", "Donație", in its
    pill below (§NNN). The hero says more, the way the meeting point
    becomes its own map link: a paid event's amount, with "plata pe {host}" as a second,
    separate link when the club gave one; a donation's whole phrase is the link to give at,
    with the suggested amount after it when the club stated one. Never a raw URL, only the host
    a runner recognises (`costUrlHost`), the same rule "Linkuri și fișiere" follows (§332).
  */
  if (event.costType === "PAID") {
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
   * named no site — except where the facts may carry no links at all (a card that is itself one
   * link). The compact card and the listing's featured hero keep this sentence exactly (§169);
   * only the event page's facts do not, below.
   */
  const coHosts = readCoHosts(event);
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
   * so with the partner's name ("Înscriere la Brașov Running Festival") — the one call to action on
   * the card, written as a link in the weight of a heading, never a second button competing with
   * the club's own registration beneath these facts (`RegistrationCta`).
   *
   * Plain `<span>`s throughout, never a `<ul>` or a `<p>`: it was written to sit inside an inline
   * element, and a block has no business nested in one. `links` gates it exactly as it gates
   * every other link on this component — false inside a card that is itself one link
   * (`EventCard`), where this is never called at all.
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

  // A glyph beside each question (the owner, 2026-09-18: "more icons in the app"), decorative:
  // the label is the word, the glyph is what the eye finds first on a card.
  const glyph = (Icon: Glyph) => (
    <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary", verticalAlign: "-3px", mr: 0.5 }} />
  );

  // A group run says nothing about registration at all (§111; the owner: "group runs don't
  // have registrations!") — not even "none needed": the question does not arise.
  const mentionsRegistration = takesRegistrations(event.type);

  /*
    One wrapping line of short pieces: "Sâmbătă, 26 sept. 2026 · 08:00". The middle dot is hidden
    from a screen reader and carried at the end of the piece before it, so a line that has to wrap
    — a race's two named times on a phone — never starts with a separator; each piece is its own
    flex item, so the line breaks between pieces before it breaks inside one.

    The card's form (§NNN) adds a `lead` — a series card's "Următoarea:" — which is a piece with no
    dot after it, and keeps every piece whole: on a 320-pixel phone "Următoarea: Miercuri, 30 sept.
    2026 · 18:30" is wider than the card, and the one break it may take is after the word, so the
    date and its time go to the next line together rather than "2026 ·" ending up on a line alone.
  */
  const flow = (items: ReactNode[], card?: { lead?: string }) => (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 0.75 }}>
      {card?.lead && (
        <Box component="span" sx={{ color: "text.secondary" }}>
          {card.lead}
        </Box>
      )}
      {items.map((item, index) => (
        <span key={index} style={card ? { whiteSpace: "nowrap" } : undefined}>
          {item}
          {index < items.length - 1 && (
            <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", ml: 0.75 }}>
              ·
            </Box>
          )}
        </span>
      ))}
    </Box>
  );

  // A row of pills (§356): the card's outlined chip, its glyph by name, no bullets between them.
  const pillRow = (items: Pill[]) => (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {items.map((item) => (
        <GlyphChip key={item.glyph} glyph={item.glyph} label={item.label} variant="outlined" sx={PILL_SX} />
      ))}
    </Box>
  );

  /*
    The route's numbers as pills — the distance, the climb, how hard — in that order, each with its
    glyph (§112), a pill only for what the club stated. The event page (§356) and the listing card
    (§NNN) both start from these; each adds the surface and the cost its own way below.
  */
  const routePills: Pill[] = [];
  if (distance !== null) {
    routePills.push({ glyph: "distance", label: t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }) });
  }
  if (event.elevationGainMeters) routePills.push({ glyph: "elevation", label: t("elevationShort", { m: format.number(event.elevationGainMeters) }) });
  if (event.difficulty) routePills.push({ glyph: `difficulty:${event.difficulty}`, label: t(`difficultyValues.${event.difficulty}`) });

  if (compact) {
    /*
      The listing card (§NNN; the owner, 2026-09-24, of the listing: "There is too much whitespace
      on these cards, it needs to be better spaced"). The event page's own shapes, smaller: a line
      for when and a line for where, each led by the page's row glyph (`ROW_ICON_SX`, §356) in a
      flex row, so the glyph stays on the first line of its words and a long place wraps under
      itself — the old line was an inline glyph followed by an inline-flex block of pieces, and a
      block too wide for what was left of the line dropped whole under the glyph and left the pin
      alone on a line. Then the route and the cost as the page's pills. No labels: the glyphs are
      the questions on a card.
    */
    const lines: Array<{ key: string; icon: Glyph; value: ReactNode; secondary?: boolean }> = [
      /*
        "Următoarea: Luni, 28 sept. 2026 · 18:30" on a series card, one line wherever it fits. A
        date and its one bare time are one piece — "Sâmbătă, 26 sept. 2026 · 08:00", some two
        hundred pixels at the widest weekday and month in either language — so a phone breaks the
        line after "Următoarea:" and never leaves "18:30" on a line of its own. A race's two named
        times stay pieces of their own: together they are wider than a 320-pixel card.
      */
      {
        key: "when",
        icon: CalendarMonthIcon,
        value: flow(
          event.raceStartsAt
            ? when
            : [
                <Fragment key="date-time">
                  {when[0]}
                  <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", mx: 0.75 }}>
                    ·
                  </Box>
                  {when[1]}
                </Fragment>,
              ],
          { lead: whenLead },
        ),
      },
    ];
    // Where: the place — the map link where the card may carry one (a series card), tight like the
    // page's (§356) so the line is as tall as its words — or the sentence while it is to be
    // announced (§328), whose query has already withheld the name, the address and the map.
    const place = event.locationToBeAnnounced
      ? t("locationToBeAnnounced")
      : event.locationName
        ? links && event.mapUrl
          ? outLink(event.mapUrl, event.locationName, undefined, true)
          : event.locationName
        : links && event.mapUrl
          ? outLink(event.mapUrl, t("openMap"), undefined, true)
          : null;
    if (place) lines.push({ key: "where", icon: PlaceIcon, value: place });
    // Held with somebody (§168): the card says so in the same words the page does, and through
    // the same sentence — so where the card may carry links at all (a series card, which is not
    // itself one link), each partner is its own link here too, and where it may not (`EventCard`)
    // the sentence is words (§169). One `coHostSentence` for both, never a second join.
    if (coHosts.length > 0) {
      lines.push({
        key: "coHost",
        icon: HandshakeIcon,
        secondary: true,
        value: (
          <>
            {t("coHost")} {coHostSentence()}
          </>
        ),
      });
    }
    if (mentionsRegistration) {
      // The state of registration — and, while the window is ahead, the date it opens rather than
      // "not yet" (§146), read through the one helper the feed reads it through, never a formula
      // of this file's own. And while it is open, until when (§308) — the same helper family, so
      // the card's date is the instant the button goes away.
      const opensAt = upcomingRegistrationOpening(event, now);
      const closesAt = openRegistrationClosing(event, now);
      // Inside "Înscrierile se deschid pe {date}": the weekday keeps its lower case (§349).
      const shortDate = (date: Date) =>
        formatDay(date, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });
      lines.push({
        key: "registration",
        icon: HowToRegIcon,
        secondary: true,
        value: opensAt
          ? t("cta.opensOnShort", { date: shortDate(opensAt) })
          : closesAt
            ? t("cta.openUntilShort", { date: shortDate(closesAt) })
            : t(`registrationState.${state}`),
      });
    }

    /*
      The pills: the page's route pills, then the surface — said here once, so the chips at the
      top of the card no longer carry it (§NNN: the same word twice on one card was one of the
      things the owner saw) — then the cost as the closed set's short word, "Gratuit", "Cu taxă",
      "Donație" (§343: an amount and where to pay are the page's). No pill for what the club has
      not stated: a null cost is unstated, not free (AGENTS.md §1.2).
    */
    const cardPills: Pill[] = [...routePills];
    if (event.surface) cardPills.push({ glyph: `surface:${event.surface}`, label: t(`surface.${event.surface}`) });
    if (event.costType) cardPills.push({ glyph: `cost:${event.costType}`, label: t(`costValues.${event.costType}`) });

    return (
      <Box data-testid="card-facts" sx={{ display: "grid", rowGap: LINE_GAP, minWidth: 0 }}>
        {lines.map((line) => (
          <Typography
            key={line.key}
            component="div"
            variant="body2"
            color={line.secondary ? "text.secondary" : "text.primary"}
            data-fact={line.key}
            sx={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}
          >
            <line.icon aria-hidden="true" sx={ROW_ICON_SX} />
            <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{line.value}</Box>
          </Typography>
        ))}
        {/* A group of its own, so a group's gap above it rather than a line's (§NNN). */}
        {cardPills.length > 0 && (
          <Box data-fact="pills" sx={{ mt: GROUP_GAP - LINE_GAP }}>
            {pillRow(cardPills)}
          </Box>
        )}
      </Box>
    );
  }

  if (!stacked) {
    /*
      The listing's featured hero: one line per question, the pieces separated by middle dots,
      and its partners as the cards' one sentence (`coHostSentence`, above) — a summary above
      the fold with a button to reach, so neither a column of every partner's links nor the
      page's pills (§169, §356).
    */
    const lines: Array<{ label: string; icon: Glyph; value: ReactNode[] }> = [{ label: t("when"), icon: CalendarMonthIcon, value: when }];
    if (where.length > 0) lines.push({ label: t("where"), icon: PlaceIcon, value: where });
    // Held with other organizations (§121, §168).
    if (coHosts.length > 0) lines.push({ label: t("coHost"), icon: HandshakeIcon, value: [coHostSentence()] });
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
          rowGap: 1,
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
    { key: "when", label: t("when"), icon: CalendarMonthIcon, value: flow(when) },
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
    The route: one row of pills — the distance, the climb, how hard, what it is run on — in that
    order, each with its glyph (§112), a pill only for what the club stated. The surface is the
    course's (§350) and completes a route row, but never makes one on its own: the overline at the
    top of the page already says it beside the type (BR-REQ-010-01), and a "Traseu" holding only
    that word would be the overline again. Under the pills, the route's links. The first three pills
    are `routePills`, built above for the card as well.
  */
  const routeLinks: ReactNode[] = [];
  if (links && event.routeUrl) routeLinks.push(outLink(event.routeUrl, t("openRoute"), isStravaLink(event.routeUrl) ? "strava" : undefined));
  if (links && event.stravaEventUrl) routeLinks.push(outLink(event.stravaEventUrl, t("openStravaEvent"), "strava"));
  // The Facebook event (§144): where the club's people say "going".
  if (links && event.facebookEventUrl) routeLinks.push(outLink(event.facebookEventUrl, t("openFacebookEvent"), "facebook"));
  if (event.surface && (routePills.length > 0 || routeLinks.length > 0)) {
    routePills.push({ glyph: `surface:${event.surface}`, label: t(`surface.${event.surface}`) });
  }
  if (routePills.length > 0 || routeLinks.length > 0) {
    rows.push({
      key: "route",
      label: t("route"),
      icon: RouteIcon,
      value: (
        <>
          {routePills.length > 0 && pillRow(routePills)}
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
  if (event.costType === "FREE") {
    costPill = { glyph: "cost:FREE", label: t("costValues.FREE") };
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
          {pillRow([costPill])}
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
  */
  if (coHosts.length > 0) {
    rows.push({
      key: "coHost",
      label: t("coHost"),
      icon: HandshakeIcon,
      value: (
        <Box sx={{ display: "grid", rowGap: 1.5, justifyItems: "start" }}>
          {coHosts.map((host, index) => (
            <div key={index}>{links ? partnerFacts(host) : host.name}</div>
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
          <Typography component="dd" variant="body1" sx={{ m: 0, minWidth: 0, pl: { xs: 3.5, sm: 0 }, mb: { xs: 1, sm: 0 } }}>
            {row.value}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}
