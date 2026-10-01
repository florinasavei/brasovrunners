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
import { clampTitle, DEFAULT_SHARE_CARD_DESIGN, type ShareCardDesign, shareCardColours } from "./share-card-design";

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
 * its length, `clampTitle`), pictures and fonts handed over as data rather than fetched.
 */
export const SHARE_SHAPES = {
  /** Open Graph: what Facebook, WhatsApp, LinkedIn and X show under a link. */
  og: { width: 1200, height: 630 },
  /** Instagram's feed: a square, downloaded and posted by hand. */
  square: { width: 1080, height: 1080 },
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

/**
 * Every size of the layout, per shape — one layout, two sets of numbers. The square has room for
 * the facts under each other; the wide card is 630 pixels tall, so its facts are tighter.
 */
const SIZES = {
  square: { pad: 72, padTop: 72, logo: 100, pill: 30, gap: 30, date: 40, time: 60, place: 36, chip: 32, glyph: 34, band: 104, host: 34, mark: 44, tagline: 48 },
  og: { pad: 56, padTop: 46, logo: 68, pill: 24, gap: 18, date: 32, time: 46, place: 30, chip: 26, glyph: 28, band: 80, host: 28, mark: 36, tagline: 38 },
} as const;

/**
 * The title's size by its length, measured rather than guessed (§NNN). Satori draws every line it
 * is given, so the size is chosen before it draws: the largest step at which the title, at half an
 * em a character (Roboto 700 runs about 0.45 em in Romanian and English, spaces included, so half
 * an em leaves room for the words that wrap early), fills no more of the box than its lines allow,
 * with a margin for `textWrap: balance`. The square has room for three lines at any size; the wide
 * card's 630 pixels keep a title to two lines from 56 px up and three below.
 */
const TITLE = {
  square: { steps: [92, 80, 72, 64, 56, 50, 44], width: 1080 - 2 * 72, box: 300 },
  og: { steps: [72, 64, 56, 50, 46, 42], width: 1200 - 2 * 56, box: 160 },
} as const;

export function shareTitleSize(title: string, shape: ShareShape): number {
  const { steps, width, box } = TITLE[shape];
  const length = Array.from(title).length;
  const fits = (size: number) => length * 0.5 * size <= Math.min(3, Math.floor(box / (size * 1.05))) * width * 0.88;
  return steps.find(fits) ?? steps[steps.length - 1];
}

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
      () => null,
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
 * one rather than no card. A `data:image/` address — a test's fixture — is handed over as it is.
 */
async function backgroundPicture(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url)) return url;
  if (!url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PICTURE_DEADLINE_MS) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > PICTURE_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
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
  design: ShareCardDesign = DEFAULT_SHARE_CARD_DESIGN,
): Promise<ImageResponse> {
  const { width, height } = SHARE_SHAPES[shape];
  const size = SIZES[shape];
  const intl = locale === "ro" ? "ro-RO" : "en-GB";
  const cancelled = event.eventStatus === "CANCELLED";

  // A picture outlives the page it was made from — it is saved, posted, forwarded — so a place
  // not yet announced is said as such, and the query has withheld the typed one (§328).
  const place = design.showPlace ? (event.locationToBeAnnounced ? labels.locationToBeAnnounced : event.locationName) : null;
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
  const titleSize = shareTitleSize(title, shape);
  const tagline = design.tagline.trim() || null;

  const picture = await backgroundPicture(design.backgroundPictureUrl);
  const colours = shareCardColours(design, picture !== null);
  const [fonts, logo, mark] = await Promise.all([
    tagline ? Promise.all([brandFonts(), handwritingFont()]).then(([roboto, caveat]) => [...roboto, caveat]) : brandFonts(),
    design.showLogo ? lockup(colours.logo) : Promise.resolve(null),
    design.showLogo ? mountains(colours.mark) : Promise.resolve(null),
  ]);
  const showBand = host !== null || mark !== null;
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
          The facts sit at the foot of the card and the logo and the pill at its head: the head row
          grows into the space between, so a card with neither keeps its facts where they were
          rather than floating to the top (an element switched off leaves no gap, §NNN).
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flexGrow: 1,
            minHeight: 0,
            padding: `${size.padTop}px ${size.pad}px`,
          }}
        >
          {(logo || pillWords) && (
            <div style={{ display: "flex", flexGrow: 1, alignItems: "flex-start", justifyContent: "space-between", paddingBottom: size.gap }}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- Satori draws an <img>, not next/image
                <img src={logo} alt="" width={Math.round(size.logo * LOCKUP_RATIO)} height={size.logo} />
              ) : (
                <div style={{ display: "flex" }} />
              )}
              {pillWords && (
                <div
                  style={{
                    display: "flex",
                    padding: shape === "square" ? "12px 26px" : "9px 20px",
                    borderRadius: 999,
                    backgroundColor: cancelled ? colours.accent : colours.pill,
                    color: colours.pillText,
                    fontSize: size.pill,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                  }}
                >
                  {pillWords}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: size.gap }}>
            <div style={{ display: "flex", flexDirection: "column", gap: shape === "square" ? 26 : 16 }}>
              <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, textWrap: "balance" }}>{title}</div>
              {/* The rule, and the tagline in the club's hand: under it on the square, beside it on the wide card. */}
              <div
                style={{
                  display: "flex",
                  flexDirection: shape === "square" ? "column" : "row",
                  alignItems: shape === "square" ? "flex-start" : "center",
                  gap: shape === "square" ? 22 : 24,
                }}
              >
                <div style={{ display: "flex", flexShrink: 0, width: 120, height: 6, borderRadius: 3, backgroundColor: colours.accent }} />
                {tagline && (
                  <div style={{ display: "flex", fontFamily: "Caveat", fontSize: size.tagline, lineHeight: 1, color: colours.accent }}>{tagline}</div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: shape === "square" ? 18 : 10 }}>
              {heldBack !== null ? (
                <div style={{ display: "flex", fontSize: size.date }}>{heldBack}</div>
              ) : (
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                  <div style={{ display: "flex", fontSize: size.date }}>{day}</div>
                  {/* A middle dot in the accent, as a letter so it sits on the line's own baseline. */}
                  <div style={{ display: "flex", fontSize: size.time, fontWeight: 700, lineHeight: 1, color: colours.accent }}>·</div>
                  <div style={{ display: "flex", fontSize: size.time, fontWeight: 700, lineHeight: 1 }}>{time}</div>
                </div>
              )}
              {place && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: size.place }}>
                  <PinGlyph size={size.glyph} colour={colours.accent} />
                  <div style={{ display: "flex" }}>{place}</div>
                </div>
              )}
              {route.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: shape === "square" ? 8 : 4 }}>
                  {route.map((chip) => (
                    <div
                      key={chip.glyph}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: shape === "square" ? "10px 22px 10px 16px" : "7px 18px 7px 13px",
                        borderRadius: 999,
                        backgroundColor: colours.chip,
                        border: `1.5px solid ${colours.chipBorder}`,
                        fontSize: size.chip,
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
