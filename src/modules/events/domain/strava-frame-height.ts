/**
 * The height Strava's route card reports about itself (§742; amends §738).
 *
 * Strava's `embed.js` builds the iframe, puts a namespace in its address fragment (`#ns=<uuid>`) and
 * listens for `[ns, "BROADCAST_IFRAME_HEIGHT", <pixels>]` posted by the frame to the page, which it
 * writes as the frame's `style.height`; the frame sends it on its own, with no handshake from the
 * page (read from the script on 2026-10-12). The page never loads that script (§61, §718): the
 * address is built on the server with a namespace of our own (`stravaEmbedSrc`), and this reads the
 * same message — nothing else.
 */

/** The only origin whose height message is believed. */
export const STRAVA_EMBED_ORIGIN = "https://strava-embeds.com";
/** The message's name, as the script's listener names it. */
export const STRAVA_HEIGHT_MESSAGE = "BROADCAST_IFRAME_HEIGHT";
/** A sane range: a card shorter or taller than this is not one, whatever the frame says. */
export const STRAVA_HEIGHT_MIN = 240;
export const STRAVA_HEIGHT_MAX = 1400;

/** The part of a `MessageEvent` this reads, so a test needs no browser. */
export type StravaHeightMessage = { origin: string; data: unknown; source?: unknown };

/**
 * The frame's height in pixels, whole and clamped, or null when the message is not Strava's height
 * for this frame: another origin (the page's own included), another namespace, another name, a
 * payload that is not a finite number, or — when `frame` is given — a sender that is not that frame.
 */
export function stravaFrameHeight(event: StravaHeightMessage, namespace: string, frame?: unknown): number | null {
  if (event.origin !== STRAVA_EMBED_ORIGIN) return null;
  if (frame !== undefined && event.source !== frame) return null;
  const data = event.data;
  if (!Array.isArray(data) || data.length < 3) return null;
  if (data[0] !== namespace || data[1] !== STRAVA_HEIGHT_MESSAGE) return null;
  const height = data[2];
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  return Math.round(Math.min(STRAVA_HEIGHT_MAX, Math.max(STRAVA_HEIGHT_MIN, height)));
}
