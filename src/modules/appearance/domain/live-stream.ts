import { z } from "zod";

/**
 * «În direct pe YouTube» (§NNN; the owner, 2026-10-29: «I want on the website a notification that
 * we are live streaming») — a notice on every public page while the club broadcasts.
 *
 * Pure: no database, no environment. The club switches the notice on and gives the broadcast's
 * YouTube address; off, nothing is drawn and the header is byte for byte what it was. Stored as
 * `{ on, url }`: `url` is the address the notice links to, `null` while none was given — the notice
 * is refused on without one, because a «Suntem în direct» that leads nowhere is a dead end.
 *
 * The address is YouTube's and nothing else: `https` on one of YouTube's hosts, any path — a film
 * (`watch?v=`, `youtu.be/`, `live/<id>`) or the channel's own live page (`/@club/live`), which
 * always points at the current broadcast and so never has to be changed before a race. The link
 * is drawn as the visitor's own tab target; nothing of it is embedded (the privacy notice describes
 * YouTube as loaded only when pressed, §69, and a bar on every page must load nothing).
 */

/** YouTube's own hosts, the same set `events/domain/video.ts` accepts for a film. */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export const LIVE_STREAM_URL_MAX = 300;

export type LiveStreamSetting = { on: boolean; url: string | null };

export const DEFAULT_LIVE_STREAM_SETTING: LiveStreamSetting = { on: false, url: null };

/**
 * The typed address, as it is stored: trimmed and kept exactly otherwise, or `null` when it is not
 * an `https` address on a YouTube host. A `http` address, another host, or a line that is not an
 * address at all is refused — the form says so under the box.
 */
export function youtubeAddress(raw: string | null | undefined): string | null {
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (!typed || typed.length > LIVE_STREAM_URL_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(typed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !YOUTUBE_HOSTS.has(parsed.hostname)) return null;
  return parsed.href;
}

/** The stored shape, strictly: on or off, and the address or nothing; on requires an address. */
export const liveStreamSchema = z
  .object({
    on: z.boolean(),
    url: z
      .string()
      .max(LIVE_STREAM_URL_MAX)
      .nullable()
      .refine((url) => url === null || youtubeAddress(url) === url, "not a YouTube address"),
  })
  .strict()
  .refine((setting) => !setting.on || setting.url !== null, "on without an address");

/** A stored value this code can read, or the default: off, no address. */
export function parseLiveStream(value: unknown): LiveStreamSetting {
  const parsed = liveStreamSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LIVE_STREAM_SETTING;
}

/** One line for the audit row: «on <address>» or «off». Never the whole setting as JSON. */
export function describeLiveStream(setting: LiveStreamSetting): string {
  return setting.on ? `on ${setting.url}` : setting.url ? `off (${setting.url})` : "off";
}
