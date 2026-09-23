import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import SocialIcon from "@/shared/ui/SocialIcon";
import { readCoHosts } from "../domain/co-hosts";
import { distanceInKm, isStravaLink, takesRegistrations } from "../domain/event-type";
import { openRegistrationClosing, registrationState, upcomingRegistrationOpening } from "../domain/registration-window";
import type { PublicEvent } from "../repository";
import { COST_GLYPH, DIFFICULTY_GLYPH, type Glyph } from "./glyphs";

/**
 * The facts of an event, in three lines: when, where, and the route in numbers.
 *
 * Nine labelled rows — date, gathering time, race start, meeting point, distance, climb,
 * difficulty, cost, registration — were a table a reader had to scan top to bottom to answer
 * "when and where do I show up". The owner's word on it (2026-09-18): "these details should be
 * better organised; the UX must be simple and easy." So the same facts are grouped by the
 * question they answer, each line a row of short pieces separated by a middle dot, and the
 * labels are the questions: *când*, *unde*, *traseu*. Still a `<dl>`, so a screen reader hears
 * the question before the answer; the separators are hidden from it.
 *
 * Registration is not a fact of the event but a state of the moment, and the button beneath
 * these lines says it (`RegistrationCta`) — except for an event with no registration at all,
 * which has no button and deserves the one sentence "no registration needed". The compact
 * variant on a listing card has no button either, so there the state is the last piece.
 */
export default async function EventFacts({
  event,
  now,
  variant = "full",
  links = true,
  stacked = false,
}: {
  event: PublicEvent;
  now: Date;
  variant?: "full" | "compact";
  /**
   * One fact per line, with a bullet, instead of a row of pieces separated by middle dots
   * (`DECISIONS.md` §168; the owner, of "Când — sâmbătă, 21 noiembrie 2026 · întâlnire la
   * 09:00 · start la 10:00" on a phone: "I want bullet points one under another").
   *
   * The event page asks for it and nothing else does: the page is where a runner reads the
   * facts one at a time, and it has the height to spare. The hero and the cards are summaries
   * above the fold, where three short pieces on one line is the whole point — a stacked hero
   * would push the button that the hero exists for below the screen.
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
  const compact = variant === "compact";

  const distance = distanceInKm(event.distanceMeters);
  const state = registrationState(event, now);

  // The event's own timezone, not the server's or the reader's. A run in Brașov starts at its
  // local time regardless of where the page is opened.
  const time = (at: Date) =>
    format.dateTime(at, { timeZone: event.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const date = format.dateTime(event.startsAt, {
    timeZone: event.timezone,
    weekday: "long",
    day: "numeric",
    month: compact ? "short" : "long",
    year: "numeric",
  });

  // A 44px target, like every other link on a phone (BR-REQ-041-01 criterion 6). `noopener`
  // and `noreferrer` stop the opened page reaching back through `window.opener` and stop it
  // learning which page sent the visitor (`DECISIONS.md` §61 on the Strava mark: the mark
  // decorates, the words are the link, and never Strava's script).
  const outLink = (href: string, label: string, network?: "strava" | "facebook") => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44 }}
    >
      {network && <SocialIcon network={network} size={18} />}
      {label}
    </Link>
  );

  // A word with its glyph in front, for the closed sets (§112); the word is what is read.
  const withGlyph = (Icon: Glyph, word: string) => (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
      {word}
    </Box>
  );

  /* When: the date, then the times — a race has two, each named; anything else has one.
     Stacked (§169), that one time gets a name too: on its own bullet under "Când" a bare
     "09:00" reads as a second, unnamed fact, where on one line the date stands right before
     it and the middle dot binds them. The one-line form is left exactly as it was — a card
     has no room for a word it does not need. */
  const when: ReactNode[] = [<strong key="date">{date}</strong>];
  if (event.raceStartsAt) {
    when.push(t("gatheringAt", { time: time(event.startsAt) }), t("raceStartAt", { time: time(event.raceStartsAt) }));
  } else {
    when.push(stacked ? t("startAt", { time: time(event.startsAt) }) : time(event.startsAt));
  }

  /* Where: the meeting point — itself the map link when the organizer pasted one and a link
     may sit here; the same destination is never offered twice on one line. */
  const where: ReactNode[] = [];
  if (event.locationName) {
    where.push(links && event.mapUrl ? outLink(event.mapUrl, event.locationName) : event.locationName);
  } else if (links && event.mapUrl) {
    where.push(outLink(event.mapUrl, t("openMap")));
  }

  /* The route in numbers, in the reader's own language for the two enums (migration `0018`);
     cost only when the club has stated one — null means unstated, not free (AGENTS.md §1.2). */
  const route: ReactNode[] = [];
  if (distance !== null) {
    // format.number applies the locale's separators: "14,5" in Romanian, "14.5" in English.
    route.push(t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }));
  }
  if (event.elevationGainMeters) route.push(t("elevationM", { m: format.number(event.elevationGainMeters) }));
  // The two closed sets carry their glyphs (§112): bars for how hard, a coin for the cost.
  if (event.difficulty) route.push(withGlyph(DIFFICULTY_GLYPH[event.difficulty], t(`difficultyValues.${event.difficulty}`)));
  if (event.costType) route.push(withGlyph(COST_GLYPH[event.costType], t(`costValues.${event.costType}`)));
  if (!compact && links && event.routeUrl) route.push(outLink(event.routeUrl, t("openRoute"), isStravaLink(event.routeUrl) ? "strava" : undefined));
  if (!compact && links && event.stravaEventUrl) route.push(outLink(event.stravaEventUrl, t("openStravaEvent"), "strava"));
  // The Facebook event (§144): where the club's people say "going".
  if (!compact && links && event.facebookEventUrl) route.push(outLink(event.facebookEventUrl, t("openFacebookEvent"), "facebook"));

  /**
   * The organizations the event is held with (§168), as one sentence: "Împreună cu A, B și C",
   * joined the way the reader's language joins a list — `format.list`, never a hand-rolled
   * comma and an "and". Each partner that has a page is its own link inside that sentence,
   * which is why the joined elements are built rather than a joined string, except where the
   * facts may carry no links at all (a card that is itself one link).
   */
  const coHosts = readCoHosts(event);
  const coHostNames = coHosts.map((host) => host.name);
  const coHostSentence = () => {
    if (!links || coHosts.every((host) => host.url === null)) return format.list(coHostNames);
    return (
      <>
        {format.list(
          coHosts.map((host, index) => (
            <Fragment key={index}>{host.url ? outLink(host.url, host.name) : host.name}</Fragment>
          )),
        )}
      </>
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

  /**
   * The same pieces, one under another (§168): a real list, so a screen reader hears "list,
   * three items" instead of one run-on line, with the middle dot replaced by a bullet that is
   * hidden from it. A row with a single piece is not a list of one — it is just the fact.
   *
   * `role="list"` and `role="listitem"` are stated although `<ul>` and `<li>` already mean
   * them (§169). WebKit drops the implicit roles from a list whose computed `list-style-type`
   * is `none` and which has no marker of its own, and `display: flex` on the item drops
   * `display: list-item` with it — so on iOS Safari, the phone this pass was made for,
   * VoiceOver would have announced three unrelated lines and the comment above would have
   * been false on the one platform it was written for. Re-stating the role is the documented
   * way back.
   *
   * Nothing about the words changes, and nothing about the tap targets: a link among the
   * pieces carries its own 44 pixels (`outLink`), and the rows are spaced rather than padded
   * so a line of plain text does not grow into a button-sized block.
   */
  const stack = (items: ReactNode[]) =>
    items.length < 2 ? (
      pieces(items)
    ) : (
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", rowGap: 0.5 }}>
        {items.map((item, index) => (
          <Box component="li" role="listitem" key={index} sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Box component="span" aria-hidden="true" sx={{ color: "text.disabled", flexShrink: 0 }}>
              •
            </Box>
            <span>{item}</span>
          </Box>
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

  if (compact) {
    // Two plain lines on a card: no labels, the state of registration as the last piece —
    // and, while the window is ahead, the date it opens rather than "not yet" (§146) — read
    // through the one helper the feed reads it through, never a formula of this file's own.
    // And while it is open, until when (§308) — the same helper family, so the card's date is
    // the instant the button goes away.
    const opensAt = upcomingRegistrationOpening(event, now);
    const closesAt = openRegistrationClosing(event, now);
    const shortDate = (date: Date) =>
      format.dateTime(date, { timeZone: event.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const registrationPiece = opensAt
      ? t("cta.opensOnShort", { date: shortDate(opensAt) })
      : closesAt
        ? t("cta.openUntilShort", { date: shortDate(closesAt) })
        : t(`registrationState.${state}`);
    const second = [
      ...where,
      // Held with somebody (§168): the card says so in the same words the page does, and
      // through the same sentence — so where the card may carry links at all (a series card,
      // which is not itself one link and whose meeting point is already a link), each partner
      // is its own link here too, and where it may not (`EventCard`) the sentence is words
      // (§169). One `coHostSentence` for both, never a second join of this file's own.
      ...(coHosts.length > 0
        ? [
            <Fragment key="co-hosts">
              {t("coHost")} {coHostSentence()}
            </Fragment>,
          ]
        : []),
      ...route,
      ...(mentionsRegistration ? [registrationPiece] : []),
    ];
    return (
      <Box>
        <Typography variant="body2">
          {glyph(CalendarMonthIcon)}
          {pieces(when)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {glyph(PlaceIcon)}
          {pieces(second)}
        </Typography>
      </Box>
    );
  }

  const lines: Array<{ label: string; icon: Glyph; value: ReactNode[] }> = [
    { label: t("when"), icon: CalendarMonthIcon, value: when },
  ];
  if (where.length > 0) lines.push({ label: t("where"), icon: PlaceIcon, value: where });
  // Held with other organizations (§121, §168): "A, B și C", each a link to its own page.
  // One piece, not one per partner: the list is a sentence, and a bullet before each name
  // would read as three separate facts rather than as who the event is held with.
  if (coHosts.length > 0) {
    lines.push({ label: t("coHost"), icon: HandshakeIcon, value: [coHostSentence()] });
  }
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
            {stacked ? stack(line.value) : pieces(line.value)}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}
