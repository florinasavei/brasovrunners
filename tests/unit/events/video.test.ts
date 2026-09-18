import { describe, expect, it } from "vitest";
import { isYoutubeLink, youtubeEmbedUrl, youtubeVideoId } from "@/modules/events/domain/video";

/**
 * BR-REQ-011-01 criterion 9: every shape the YouTube share button produces yields the same
 * eleven-character id, and nothing else does. The embed address is built from the id alone.
 */
describe("BR-REQ-011-01 criterion 9 a YouTube link on an event", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
  ])("reads the id out of %s", (url) => {
    expect(youtubeVideoId(url)).toBe("dQw4w9WgXcQ");
    expect(isYoutubeLink(url)).toBe(true);
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/123456",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC123",
    "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
    "not a url",
    "",
    null,
  ])("refuses %s", (url) => {
    expect(youtubeVideoId(url)).toBeNull();
    expect(isYoutubeLink(url)).toBe(false);
  });

  it("builds the embed from the id alone, on the no-cookie host", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  });
});
