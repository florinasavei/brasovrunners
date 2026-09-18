/**
 * A YouTube link on an event (BR-REQ-011-01 criterion 9): last year's film, embedded.
 *
 * The organizer pastes whatever the share button gave them — `watch?v=`, `youtu.be/`,
 * `shorts/`, `embed/`, with or without a playlist or a timestamp — and the page needs the one
 * thing all of those carry, the eleven-character video id. Nothing but the id is ever put
 * into the embed address, so a pasted link cannot smuggle a parameter into the iframe.
 *
 * The embed itself uses the `-nocookie` host: no cookie is set until the visitor presses
 * play, which is what lets the page carry a third party without the privacy notice having to
 * describe a tracker that fires on load (`DECISIONS.md` §69). Hostnames of third parties are
 * fine under `src/` — AGENTS.md §8 forbids the club's own.
 */

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  let candidate: string | null = null;
  if (parsed.hostname === "youtu.be") {
    candidate = parsed.pathname.split("/")[1] ?? null;
  } else if (parsed.pathname === "/watch") {
    candidate = parsed.searchParams.get("v");
  } else {
    const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(parsed.pathname);
    candidate = match?.[1] ?? null;
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export function isYoutubeLink(url: string | null | undefined): boolean {
  return youtubeVideoId(url) !== null;
}

/** The address the iframe loads: the id, and nothing the organizer typed. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
}
