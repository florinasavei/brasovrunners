import { ImageResponse } from "next/og";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";
import { env } from "@/shared/config/env";
import { formatDay, formatTime } from "@/i18n/dates";
import { distanceInKm } from "./domain/event-type";
import type { PublicEvent } from "./repository";

/**
 * The picture an event becomes when its link is pasted into Facebook, WhatsApp or a message —
 * and the square one for an Instagram post, since Instagram takes no link (`DECISIONS.md` §90).
 *
 * Drawn on the server from the event's own facts, in the brand's blue with the kit orange as
 * the rule: the title, the date and time, the meeting point, the distance. No photograph is
 * needed, because a card that says when and where is what a runner wants from a share, and
 * because an event has no cover picture to put there. `next/og` renders JSX to PNG through
 * Satori: flexbox only, one font family (its bundled Noto Sans, which has the diacritics),
 * and every element with children set to `display: flex`.
 */
export const SHARE_SHAPES = {
  /** Open Graph: what Facebook, WhatsApp, LinkedIn and X show under a link. */
  og: { width: 1200, height: 630 },
  /** Instagram's feed: a square, downloaded and posted by hand. */
  square: { width: 1080, height: 1080 },
} as const;

export type ShareShape = keyof typeof SHARE_SHAPES;

export type ShareImageEvent = Pick<
  PublicEvent,
  | "title"
  | "type"
  | "startsAt"
  | "raceStartsAt"
  | "timezone"
  | "locationName"
  | "locationToBeAnnounced"
  | "distanceMeters"
  | "elevationGainMeters"
  | "eventStatus"
>;

export async function eventShareImage(
  event: ShareImageEvent,
  locale: "ro" | "en",
  shape: ShareShape,
  labels: {
    type: string;
    cancelled: string;
    /** "Locația se anunță în curând" (§328), where the meeting point would be. */
    locationToBeAnnounced: string;
    distanceKm: (km: string) => string;
    elevationM: (m: string) => string;
  },
): Promise<ImageResponse> {
  // A picture outlives the page it was made from — it is saved, posted, forwarded — so a place
  // not yet announced is said as such, and the query has withheld the typed one (§328).
  const place = event.locationToBeAnnounced ? labels.locationToBeAnnounced : event.locationName;
  const { width, height } = SHARE_SHAPES[shape];
  const square = shape === "square";
  const intl = locale === "ro" ? "ro-RO" : "en-GB";
  // "Duminică, 11 oct. 2026": the long form, starting its line (§NNN), in the picture's language.
  const date = formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long" });
  const time = formatTime(event.raceStartsAt ?? event.startsAt, { locale, timeZone: event.timezone });
  const km = distanceInKm(event.distanceMeters);
  const route = [
    km !== null ? labels.distanceKm(new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(km)) : null,
    event.elevationGainMeters ? labels.elevationM(new Intl.NumberFormat(intl).format(event.elevationGainMeters)) : null,
  ].filter(Boolean);
  // The host, derived — never written (`AGENTS.md` §8).
  const host = new URL(env.APP_BASE_URL).host;
  const titleSize = event.title.length > 60 ? (square ? 60 : 56) : square ? 76 : 72;

  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: square ? 72 : 64,
          background: `linear-gradient(135deg, ${COLOR.blueInk} 0%, ${COLOR.blue} 100%)`,
          color: COLOR.surface,
          fontFamily: "Roboto, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 14, height: 44, background: COLOR.orange, borderRadius: 4 }} />
            <div style={{ fontSize: square ? 36 : 32, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase" }}>
              Brașov Runners
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              background: event.eventStatus === "CANCELLED" ? COLOR.orange : "rgba(255,255,255,0.18)",
              color: event.eventStatus === "CANCELLED" ? COLOR.ink : COLOR.surface,
              fontSize: square ? 30 : 26,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            {event.eventStatus === "CANCELLED" ? labels.cancelled : labels.type}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: square ? 28 : 20 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.1, textWrap: "balance" }}>{event.title}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: square ? 38 : 34, opacity: 0.95 }}>
            <div style={{ display: "flex" }}>
              {date} · {time}
            </div>
            {place && <div style={{ display: "flex" }}>{place}</div>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: square ? 30 : 26, opacity: 0.9 }}>
          <div style={{ display: "flex", gap: 24 }}>
            {route.map((piece, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 24 }}>
                {index > 0 && <div style={{ width: 8, height: 8, borderRadius: 4, background: COLOR.orange }} />}
                {piece}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontWeight: 600 }}>{host}</div>
        </div>
      </div>
    ),
    { width, height, fonts: await brandFonts() },
  );
}
