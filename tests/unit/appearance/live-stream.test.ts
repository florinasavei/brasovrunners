import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_STREAM_SETTING,
  describeLiveStream,
  LIVE_STREAM_URL_MAX,
  liveStreamSchema,
  parseLiveStream,
  youtubeAddress,
} from "@/modules/appearance/domain/live-stream";

/**
 * §NNN — «În direct pe YouTube»: the live-broadcast notice's setting, pure. On or off with the
 * broadcast's YouTube address; on needs an address; the address is https on YouTube's hosts and
 * nothing else, so the bar on every page can never lead a visitor anywhere but the broadcast.
 */
describe("§NNN the live-broadcast notice's setting", () => {
  it("is off with no address by default, and whenever the stored value cannot be read", () => {
    expect(DEFAULT_LIVE_STREAM_SETTING).toEqual({ on: false, url: null });
    expect(parseLiveStream(undefined)).toEqual(DEFAULT_LIVE_STREAM_SETTING);
    expect(parseLiveStream({ on: "yes" })).toEqual(DEFAULT_LIVE_STREAM_SETTING);
    expect(parseLiveStream({ on: true, url: null })).toEqual(DEFAULT_LIVE_STREAM_SETTING);
    expect(parseLiveStream({ on: true, url: "https://example.com/live" })).toEqual(DEFAULT_LIVE_STREAM_SETTING);
    expect(parseLiveStream({ on: false, url: "https://www.youtube.com/@club/live", extra: 1 })).toEqual(DEFAULT_LIVE_STREAM_SETTING);
  });

  it("reads a stored value exactly as it was written", () => {
    expect(parseLiveStream({ on: true, url: "https://www.youtube.com/@club/live" })).toEqual({ on: true, url: "https://www.youtube.com/@club/live" });
    expect(parseLiveStream({ on: false, url: "https://youtu.be/dQw4w9WgXcQ" })).toEqual({ on: false, url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(parseLiveStream({ on: false, url: null })).toEqual({ on: false, url: null });
  });

  it("accepts an https address on YouTube's hosts, trimmed, in every shape the share button or the channel gives", () => {
    expect(youtubeAddress("  https://www.youtube.com/watch?v=dQw4w9WgXcQ ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(youtubeAddress("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share")).toBe("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share");
    expect(youtubeAddress("https://youtube.com/@brasovrunners/live")).toBe("https://youtube.com/@brasovrunners/live");
    expect(youtubeAddress("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://m.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(youtubeAddress("https://youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("refuses anything else: http, another host, not an address, empty, too long", () => {
    expect(youtubeAddress("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeAddress("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBeNull();
    expect(youtubeAddress("https://example.com/youtube.com/live")).toBeNull();
    expect(youtubeAddress("https://youtube.com.example.com/live")).toBeNull();
    expect(youtubeAddress("youtube.com/@club/live")).toBeNull();
    expect(youtubeAddress("javascript:alert(1)")).toBeNull();
    expect(youtubeAddress("")).toBeNull();
    expect(youtubeAddress("   ")).toBeNull();
    expect(youtubeAddress(null)).toBeNull();
    expect(youtubeAddress(`https://www.youtube.com/watch?v=${"x".repeat(LIVE_STREAM_URL_MAX)}`)).toBeNull();
  });

  it("stores on only with an address", () => {
    expect(liveStreamSchema.safeParse({ on: true, url: null }).success).toBe(false);
    expect(liveStreamSchema.safeParse({ on: true, url: "https://youtu.be/dQw4w9WgXcQ" }).success).toBe(true);
    expect(liveStreamSchema.safeParse({ on: false, url: null }).success).toBe(true);
  });

  it("describes itself for the audit row in one line, never as JSON", () => {
    expect(describeLiveStream({ on: false, url: null })).toBe("off");
    expect(describeLiveStream({ on: false, url: "https://youtu.be/dQw4w9WgXcQ" })).toBe("off (https://youtu.be/dQw4w9WgXcQ)");
    expect(describeLiveStream({ on: true, url: "https://youtu.be/dQw4w9WgXcQ" })).toBe("on https://youtu.be/dQw4w9WgXcQ");
  });
});
