import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { LOGO } from "@/theme/brand";
import { brandFonts, handwritingFont } from "@/theme/pdf/fonts";
import { env } from "@/shared/config/env";
import { formatDay, formatTime } from "@/i18n/dates";
import { distanceWords } from "./domain/distance";
import { elevationWords } from "./domain/elevation";
import { announcedDayInstant } from "./domain/dated";
import type { PublicEventPage } from "./repository";
import { clampTitle, DEFAULT_SHARE_CARD_DESIGN, readShareCardDesign, type ShareCardDesign, shareCardColours } from "./share-card-design";
import { placeOnOneLine, SHARE_CHIP_GAP, SHARE_LAYOUT, SHARE_LINE, SHARE_RULE, shareTitleSize, titleRoom } from "./share-card-layout";

/**
 * The picture an event becomes when its link is pasted into Facebook, WhatsApp or a message —
 * and the square one for an Instagram post, since Instagram takes no link (`DECISIONS.md` §90).
 *
 * Drawn on the server from the event's own facts: no photograph is needed, because a card that
 * says when and where is what a runner wants from a share, and an event has no cover picture.
 * Since §NNN it is a brand card rather than a plain one — the club's lockup, the blue with depth
 * and the kit's orange in it, the time as the headline, the route as chips, a paper band with
 * the site's host — and every colour and every optional element comes from one design object
 * (`share-card-design.ts`) whose defaults are the platform's, so the club can be given the
 * choice later without touching this drawing.
 *
 * `next/og` renders JSX to PNG through Satori, and its limits shaped the layout: flexbox only,
 * every element with children `display: flex`, no line clamp the title can rely on (it is cut by
 * its length, `clampTitle`, and sized by the room the rest of the card leaves it,
 * `share-card-layout.ts`), pictures and fonts handed over as data rather than fetched.
 */
export const SHARE_SHAPES = {
  /** Open Graph: what Facebook, WhatsApp, LinkedIn and X show under a link. */
  og: { width: SHARE_LAYOUT.og.width, height: SHARE_LAYOUT.og.height },
  /** Instagram's feed: a square, downloaded and posted by hand. */
  square: { width: SHARE_LAYOUT.square.width, height: SHARE_LAYOUT.square.height },
} as const;

export type ShareShape = keyof typeof SHARE_SHAPES;

export type ShareImageEvent = Pick<
  PublicEventPage,
  | "title"
  | "type"
  | "startsAt"
  | "raceStartsAt"
  | "announcedDay"
  | "timezone"
  | "locationName"
  | "locationToBeAnnounced"
  | "distanceMeters"
  | "elevationGainMeters"
  | "eventStatus"
> &
  Partial<Pick<PublicEventPage, "elevationGainEstimated" | "distanceEstimated">>;

/** The lockup's proportion and the mountains' (`LOGO` in `theme/brand.ts`). */
const LOCKUP_RATIO = LOGO.lockup.width / LOGO.lockup.height;
const MARK_RATIO = LOGO.mark.width / LOGO.mark.height;

/**
 * The club's artwork as data URLs, each read once per process. Every path is written out whole in
 * a `path.join(process.cwd(), …)` of literals, because that is what the build traces into the
 * function (`theme/pdf/fonts.ts` reads its fonts the same way); a path assembled from a variable
 * would ship a function without its file. A file that cannot be read draws the card without it
 * rather than no card.
 */
const artwork = new Map<string, Promise<string | null>>();
function asDataUrl(key: string, read: () => Promise<Buffer>, mime: string): Promise<string | null> {
  let pending = artwork.get(key);
  if (!pending) {
    pending = read().then(
      (buffer) => `data:${mime};base64,${buffer.toString("base64")}`,
      () => {
        // A failed read is not remembered: one transient error at a cold start would otherwise draw
        // every card of the instance without the club's logo (§NNN). The next card reads again.
        artwork.delete(key);
        return null;
      },
    );
    artwork.set(key, pending);
  }
  return pending;
}
/*
  The lockup: the bibs' white raster on a dark card (`src/theme/pdf/logo-white.png`); on paper the
  blue vector, because the blue raster beside it is drawn on an opaque white that shows as a box
  on the paper's off-white. Both 2.42:1, with the club's name in the artwork — so it is not
  written again beside it.
*/
function lockup(colour: "white" | "blue"): Promise<string | null> {
  return colour === "white"
    ? asDataUrl("lockup-white", () => readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo-white.png")), "image/png")
    : asDataUrl("lockup-blue", () => readFile(path.join(process.cwd(), "public", "brand", "logo.svg")), "image/svg+xml");
}
/** The mountains alone, for the band: blue on the paper band, white on the blue one. */
function mountains(colour: "white" | "blue"): Promise<string | null> {
  return colour === "white"
    ? asDataUrl("mark-white", () => readFile(path.join(process.cwd(), "public", "brand", "logo-mark-white.svg")), "image/svg+xml")
    : asDataUrl("mark-blue", () => readFile(path.join(process.cwd(), "public", "brand", "logo-mark.svg")), "image/svg+xml");
}

/** What a background picture may weigh, and how long the card waits for it. */
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;
const PICTURE_DEADLINE_MS = 5000;

/**
 * The design's picture as data Satori draws without a request of its own, or null for the plain
 * card: anything that is not a picture, too large, too slow or unreachable draws the card without
 * one rather than no card. Only an `https:` address is fetched — the design has been through
 * `readShareCardDesign`, which refuses every other, and this refuses them again.
 */
async function backgroundPicture(url: string | null): Promise<string | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    // A redirect is refused: it could lead from https to anything (§NNN).
    const response = await fetch(url, { signal: AbortSignal.timeout(PICTURE_DEADLINE_MS), redirect: "error" });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    // The ceiling is checked on the announced length first, then while reading, so a large body is never buffered whole.
    if (Number(response.headers.get("content-length") ?? 0) > PICTURE_MAX_BYTES) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.body || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PICTURE_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
  } catch {
    return null;
  }
}

/** A map pin, 24 × 24, drawn here rather than imported: Satori takes inline SVG, not a component. */
function PinGlyph({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        fill={colour}
        fillRule="evenodd"
        d="M12 1.8a7.2 7.2 0 0 0-7.2 7.2c0 5.3 7.2 13.2 7.2 13.2s7.2-7.9 7.2-13.2A7.2 7.2 0 0 0 12 1.8zm0 10a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z"
      />
    </svg>
  );
}

/** A route between two points, for the distance. */
function RouteGlyph({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M5.5 18.5C5.5 12 18.5 12.5 18.5 5.5" fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="3 3.2" />
      <circle cx="5.5" cy="18.5" r="3" fill={colour} />
      <circle cx="18.5" cy="5.5" r="3" fill={colour} />
    </svg>
  );
}

/** Two peaks, for the climb. */
function MountainGlyph({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M1.5 20.5 9 7.5l4.2 7.1 2.6-4.3 6.7 10.2z" fill={colour} />
    </svg>
  );
}

export async function eventShareImage(
  event: ShareImageEvent,
  locale: "ro" | "en",
  shape: ShareShape,
  labels: {
    type: string;
    cancelled: string;
    /** "Locația se anunță în curând" (§328), where the meeting point would be. */
    locationToBeAnnounced: string;
    /** "Data se anunță în curând" (§533), where the date and the time would be. */
    dateToBeAnnounced: string;
    /** "Ora se anunță în curând" (§533), after the day, when only the time is held back. */
    timeToBeAnnounced: string;
    /**
     * The `Event` catalogue, for the distance's and the climb's long forms through `distanceWords`
     * (§598) and `elevationWords` (§585) — «circa 10 km (aproximativ)», «circa 350 m diferență de
     * nivel (estimativ)» for an estimate.
     */
    t: (key: string, values?: Record<string, string | number>) => string;
  },
  /** The club's choices for the card (§NNN); the platform's until something stores them. */
  given: ShareCardDesign = DEFAULT_SHARE_CARD_DESIGN,
): Promise<ImageResponse> {
  // Whatever the caller hands over is read as a design first, so a stored one never skips its rules
  // (an `https:` picture only, a hex accent, a one-line tagline) on its way to the drawing (§NNN).
  const design = readShareCardDesign(given);
  const size = SHARE_LAYOUT[shape];
  const { width, height } = size;
  const intl = locale === "ro" ? "ro-RO" : "en-GB";
  const cancelled = event.eventStatus === "CANCELLED";

  // A picture outlives the page it was made from — it is saved, posted, forwarded — so a place
  // not yet announced is said as such, and the query has withheld the typed one (§328).
  // A typed place is cut at a word, sixty characters at most, so it stays on one line (§NNN).
  const place = design.showPlace
    ? event.locationToBeAnnounced
      ? labels.locationToBeAnnounced
      : event.locationName
        ? placeOnOneLine(event.locationName, shape)
        : null
    : null;
  /*
    The date and the time (§349, §533). Dated: the long day «Sâmbătă, 21 nov. 2026» and the time
    as the headline beside it. While the time is held back, one line «day · Ora se anunță în
    curând»; while the date is, the one sentence instead — neither is a headline.
  */
  const day =
    event.startsAt === null
      ? null
      : formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long" });
  const time = event.startsAt === null ? null : formatTime(event.raceStartsAt ?? event.startsAt, { locale, timeZone: event.timezone });
  const heldBack =
    event.startsAt !== null
      ? null
      : event.announcedDay
        ? `${formatDay(announcedDayInstant(event.announcedDay), { locale, timeZone: "UTC", style: "long" })} · ${labels.timeToBeAnnounced}`
        : labels.dateToBeAnnounced;
  /*
    The long forms, as the picture always said them (§585, §598): «circa 10 km», «350 m diferență
    de nivel». Not the pill's «≈ 10 km»: the bundled Roboto has no «≈», and a glyph the fonts lack
    sends Satori to download a font from Google in the middle of drawing.
  */
  const route = design.showRoute
    ? [
        { glyph: "route" as const, words: distanceWords(event, labels.t, (km) => new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(km))?.long },
        { glyph: "climb" as const, words: elevationWords(event, labels.t, (value) => new Intl.NumberFormat(intl).format(value))?.long },
      ].filter((chip): chip is { glyph: "route" | "climb"; words: string } => Boolean(chip.words))
    : [];
  // The host, derived — never written (`AGENTS.md` §8).
  const host = design.showHost ? new URL(env.APP_BASE_URL).host : null;
  const pillWords = cancelled ? labels.cancelled : design.showType ? labels.type : null;
  const title = clampTitle(event.title);
  const tagline = design.tagline.trim() || null;

  const picture = await backgroundPicture(design.backgroundPictureUrl);
  const colours = shareCardColours(design, picture !== null);
  const [fonts, logo, mark] = await Promise.all([
    tagline ? Promise.all([brandFonts(), handwritingFont()]).then(([roboto, caveat]) => (caveat ? [...roboto, caveat] : roboto)) : brandFonts(),
    design.showLogo ? lockup(colours.logo) : Promise.resolve(null),
    design.showLogo ? mountains(colours.mark) : Promise.resolve(null),
  ]);
  const showBand = host !== null || mark !== null;
  // The title takes what the rest of the card leaves it, at three lines at most (§NNN).
  const titleSize = shareTitleSize(
    title,
    shape,
    titleRoom(shape, { logo: logo !== null, pill: pillWords, tagline, heldBack, place, chips: route.map((chip) => chip.words), band: showBand }),
  );
  // The light and the accent's circle, as fractions of the card's width (§NNN).
  const glow = Math.round(width * 1.2);
  const circle = Math.round(width * 0.55);

  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          backgroundColor: colours.base,
          color: colours.text,
          fontFamily: "Roboto, sans-serif",
        }}
      >
        {/* The ground, then a picture under its veil, then the light and the accent's circle. */}
        {colours.gradient && (
          <div style={{ position: "absolute", left: 0, top: 0, width, height, display: "flex", backgroundImage: colours.gradient }} />
        )}
        {picture && (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws an <img>, not next/image
          <img src={picture} alt="" width={width} height={height} style={{ position: "absolute", left: 0, top: 0, width, height, objectFit: "cover" }} />
        )}
        {colours.overlay && (
          <div style={{ position: "absolute", left: 0, top: 0, width, height, display: "flex", backgroundImage: colours.overlay }} />
        )}
        <div
          style={{
            position: "absolute",
            left: width - glow / 2,
            top: -glow / 2,
            width: glow,
            height: glow,
            display: "flex",
            backgroundImage: `radial-gradient(circle, ${colours.glow} 0%, ${colours.glowFade} 50%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: width - circle * 0.62,
            top: height - circle * 0.5 - (showBand ? size.band : 0),
            width: circle,
            height: circle,
            borderRadius: circle,
            display: "flex",
            backgroundColor: colours.circle,
          }}
        />

        {/*
          The facts sit at the foot of the card and the logo and the pill at its head: the head grows
          into the space between, so a card with neither keeps its facts where they were rather than
          floating to the top (an element switched off leaves no gap, §NNN). The title's size leaves
          room for all of it (`titleRoom`); should anything still run long, this column clips it
          rather than push the band off the card's foot.
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            overflow: "hidden",
            padding: `${size.padTop}px ${size.pad}px`,
          }}
        >
          {(logo || pillWords) && (
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 0, paddingBottom: size.gap }}>
              {/* The pill is centred on the logo's height, not on the space the head grows into. */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: size.gap }}>
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Satori draws an <img>, not next/image
                  <img src={logo} alt="" width={Math.round(size.logo * LOCKUP_RATIO)} height={size.logo} style={{ flexShrink: 0 }} />
                ) : (
                  <div style={{ display: "flex" }} />
                )}
                {pillWords && (
                  <div
                    style={{
                      display: "flex",
                      padding: `${size.pillPadY}px ${size.pillPadX}px`,
                      borderRadius: 999,
                      // A cancelled event is the one solid accent pill; a type is a quiet tint (§NNN).
                      backgroundColor: cancelled ? colours.cancelledPill : colours.pill,
                      border: `1.5px solid ${cancelled ? colours.cancelledPill : colours.pillBorder}`,
                      color: cancelled ? colours.cancelledPillText : colours.pillText,
                      fontSize: size.pill,
                      fontWeight: 700,
                      lineHeight: SHARE_LINE.text,
                      textTransform: "uppercase",
                      letterSpacing: 2,
                    }}
                  >
                    {pillWords}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, gap: size.gap }}>
            <div style={{ display: "flex", flexDirection: "column", gap: size.titleGap }}>
              <div
                style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: SHARE_LINE.title, textWrap: "balance", wordBreak: "break-word" }}
              >
                {title}
              </div>
              {/* The rule, and the tagline in the club's hand: under it on the square, beside it on the wide card. */}
              <div
                style={{
                  display: "flex",
                  flexDirection: shape === "square" ? "column" : "row",
                  alignItems: shape === "square" ? "flex-start" : "center",
                  gap: size.taglineGap,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexShrink: 0,
                    width: SHARE_RULE.width,
                    height: SHARE_RULE.height,
                    borderRadius: SHARE_RULE.height / 2,
                    backgroundColor: colours.accent,
                  }}
                />
                {tagline && (
                  <div
                    style={{ display: "flex", fontFamily: "Caveat, Roboto", fontSize: size.tagline, lineHeight: SHARE_LINE.tagline, color: colours.accent }}
                  >
                    {tagline}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: size.factsGap }}>
              {heldBack !== null ? (
                <div style={{ display: "flex", fontSize: size.date, lineHeight: SHARE_LINE.text }}>{heldBack}</div>
              ) : (
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                  <div style={{ display: "flex", fontSize: size.date, lineHeight: SHARE_LINE.text }}>{day}</div>
                  {/* A middle dot in the accent, as a letter so it sits on the line's own baseline. */}
                  <div style={{ display: "flex", fontSize: size.time, fontWeight: 700, lineHeight: 1, color: colours.accent }}>·</div>
                  <div style={{ display: "flex", fontSize: size.time, fontWeight: 700, lineHeight: 1 }}>{time}</div>
                </div>
              )}
              {place && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: size.place, lineHeight: SHARE_LINE.text }}>
                  <PinGlyph size={size.glyph} colour={colours.accent} />
                  {/* One line, whatever the place: cut at a word already, and an ellipsis should it still overflow. */}
                  <div style={{ display: "flex", flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {place}
                  </div>
                </div>
              )}
              {route.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: SHARE_CHIP_GAP, marginTop: size.chipsTop }}>
                  {route.map((chip) => (
                    <div
                      key={chip.glyph}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: `${size.chipPadY}px ${size.chipPadRight}px ${size.chipPadY}px ${size.chipPadLeft}px`,
                        borderRadius: 999,
                        backgroundColor: colours.chip,
                        border: `1.5px solid ${colours.chipBorder}`,
                        fontSize: size.chip,
                        lineHeight: SHARE_LINE.text,
                      }}
                    >
                      {chip.glyph === "route" ? (
                        <RouteGlyph size={size.glyph} colour={colours.text} />
                      ) : (
                        <MountainGlyph size={size.glyph} colour={colours.text} />
                      )}
                      <div style={{ display: "flex" }}>{chip.words}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {showBand && (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "space-between",
              height: size.band,
              padding: `0 ${size.pad}px`,
              backgroundColor: colours.band,
              color: colours.bandText,
            }}
          >
            <div style={{ display: "flex", fontSize: size.host, fontWeight: 700 }}>{host ?? ""}</div>
            {mark && (
              // eslint-disable-next-line @next/next/no-img-element -- Satori draws an <img>, not next/image
              <img src={mark} alt="" width={Math.round(size.mark * MARK_RATIO)} height={size.mark} />
            )}
          </div>
        )}
      </div>
    ),
    { width, height, fonts },
  );
}
