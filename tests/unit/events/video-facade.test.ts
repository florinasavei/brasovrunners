import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §403 — the facade's promise before the click, and the shape of the address it
 * mounts after. `VideoFacade` is a Server Component now (found by re-review): the disclosure —
 * poster, play control, iframe — is a native `<details>`/`<summary>`, so `renderToStaticMarkup`
 * is exactly the HTML a browser with no JavaScript at all receives and can already open. The
 * iframe's real `youtube-nocookie.com` address is in that markup from the first paint — a
 * closed `<details>`'s contents get `content-visibility: hidden` in every evergreen browser, so
 * nothing is *fetched* until the visitor opens it, which is the property that matters (§69/§110)
 * and the reason `i.ytimg.com` — the address a poster would come from if this site did not keep
 * its own copy — is still asserted absent below. `VideoVolumeBar`, the one genuine client
 * island, is exercised here only for what does not need a real click event (its aria markup at
 * rest); the interactive half — the bar reacting to a real `toggle`/`message` event, mute
 * flipping `aria-pressed` — is exercised in a real browser by the e2e suite.
 */
const currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
  };
});

const { default: VideoFacade } = await import("@/shared/ui/VideoFacade");
const { default: VideoVolumeBar } = await import("@/shared/ui/VideoVolumeBar");
const { default: EventVideo } = await import("@/modules/events/ui/EventVideo");
const { youtubeEmbedUrl } = await import("@/modules/events/domain/video");
const { default: RichTextVideo } = await import("@/modules/content/rich-text/ui/RichTextVideo");

const LABELS = { play: "Redă filmul", mute: "Fără sunet", unmute: "Cu sunet", volume: "Volum" };

describe("§403 VideoFacade — a native disclosure, server-rendered", () => {
  it("carries no image-host address for the poster, whether or not one is stored — the iframe's own address is real from the first paint, deferred by the closed <details>", () => {
    for (const posterUrl of [null, "https://media.example.test/yt-dQw4w9WgXcQ/web.webp"]) {
      const html = renderToStaticMarkup(
        createElement(VideoFacade, {
          embedSrc: youtubeEmbedUrl("dQw4w9WgXcQ", "https://app.example.test"),
          posterUrl,
          title: "Filmul evenimentului",
          labels: LABELS,
        }),
      );
      expect(html).not.toContain("i.ytimg.com");
      expect(html).toContain("<details");
      expect(html).toContain("<summary");
      expect(html).toContain("youtube-nocookie.com");
      expect(html).toContain('aria-label="Redă filmul"');
      // No no-JS anchor any more (found by re-review): the disclosure itself needs no script.
      expect(html).not.toContain("youtube.com/watch");
    }
  });

  it("shows the club's own stored poster as a real <img>, with the title as its alt (found by re-review: an empty alt left it with no text alternative)", () => {
    const posterUrl = "https://media.example.test/yt-dQw4w9WgXcQ/web.webp";
    const html = renderToStaticMarkup(
      createElement(VideoFacade, {
        embedSrc: youtubeEmbedUrl("dQw4w9WgXcQ", "https://app.example.test"),
        posterUrl,
        title: "Filmul evenimentului",
        labels: LABELS,
      }),
    );
    expect(html).toContain(`src="${posterUrl}"`);
    expect(html).toContain('alt="Filmul evenimentului"');
  });

  it("never carries a negative tabIndex on the iframe (found by re-review: that took YouTube's own controls out of Tab order for a keyboard user)", () => {
    const html = renderToStaticMarkup(
      createElement(VideoFacade, {
        embedSrc: youtubeEmbedUrl("dQw4w9WgXcQ", "https://app.example.test"),
        posterUrl: null,
        title: "Filmul evenimentului",
        labels: LABELS,
      }),
    );
    const iframeTag = /<iframe\b[^>]*>/.exec(html)?.[0];
    expect(iframeTag).toBeDefined();
    expect(iframeTag).not.toContain("tabindex");
  });

  it("the iframe's allow list is exactly autoplay, encrypted-media and picture-in-picture (found by re-review)", () => {
    const html = renderToStaticMarkup(
      createElement(VideoFacade, {
        embedSrc: youtubeEmbedUrl("dQw4w9WgXcQ", "https://app.example.test"),
        posterUrl: null,
        title: "Filmul evenimentului",
        labels: LABELS,
      }),
    );
    expect(html).toContain('allow="autoplay; encrypted-media; picture-in-picture"');
  });

  it("EventVideo builds the embed on the no-cookie host, with the js api enabled", async () => {
    const element = await EventVideo({
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      posterUrl: "https://media.example.test/yt-dQw4w9WgXcQ/web.webp",
    });
    const html = renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
    expect(html).not.toContain("i.ytimg.com");
    expect(html).toContain("<details");
    expect(html).toContain("media.example.test");
  });

  it("EventVideo answers null for a link that is not a YouTube link, and for none at all", async () => {
    expect(await EventVideo({ videoUrl: null, posterUrl: null })).toBeNull();
    expect(await EventVideo({ videoUrl: "https://vimeo.com/1", posterUrl: null })).toBeNull();
  });
});

describe("§403 the embed address after the click", () => {
  it("is built from the id and the deployment's origin alone, on the no-cookie host, with the js api enabled", () => {
    const src = youtubeEmbedUrl("dQw4w9WgXcQ", "https://app.example.test");
    expect(src.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(true);
    expect(src).toContain("enablejsapi=1");
    expect(src).toContain("origin=https%3A%2F%2Fapp.example.test");
    expect(src).toContain("rel=0");
  });
});

describe("§403 VideoVolumeBar — its aria markup at rest (found by re-review: this had no unit test)", () => {
  it("starts unmuted: the mute button's own label, aria-pressed false, and the slider's own label", () => {
    const html = renderToStaticMarkup(
      createElement(VideoVolumeBar, { frameId: "video-frame-1", labels: { mute: "Fără sunet", unmute: "Cu sunet", volume: "Volum" } }),
    );
    expect(html).toContain('aria-label="Fără sunet"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Volum"');
    expect(html).not.toContain('aria-label="Cu sunet"');
  });

  it("is hidden (not absent) until its disclosure opens — present in the markup so hydration and hotkeys never depend on a remount", () => {
    const html = renderToStaticMarkup(createElement(VideoVolumeBar, { frameId: "video-frame-2", labels: { mute: "Fără sunet", unmute: "Cu sunet", volume: "Volum" } }));
    expect(html).toContain('aria-pressed');
  });
});

/**
 * BR-REQ-050-03 criterion 22 (`DECISIONS.md` §NNN, found by re-review) — a club poster is an
 * upload like any picture, stored with its ladder, and the facade draws it from that ladder: a
 * phone takes a rung rather than the master. YouTube's own thumbnail (`yt-<id>`) and a poster
 * stored before the ladder keep their one `src`.
 */
describe("§NNN the poster's widths", () => {
  const LADDER_POSTER = "/api/media/local/3f2a1b4c-0000-8abc-8def-000000000001/web.webp";
  const render = async (props: Parameters<typeof RichTextVideo>[0]) =>
    renderToStaticMarkup((await RichTextVideo(props)) as Parameters<typeof renderToStaticMarkup>[0]);

  it("offers a club poster's rungs and says how wide the film is drawn", async () => {
    const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", poster: LADDER_POSTER, posterWidth: 3200, posterHeight: 1800 });
    expect(html).toContain("/960w.webp 960w");
    expect(html).toContain("/2400w.webp 2400w");
    expect(html).toContain(`${LADDER_POSTER} 3200w`);
    // The event page's column by default; a 16∶9 poster covers the 16∶9 box at its own width.
    expect(html).toContain('sizes="(min-width: 1536px) 1488px, (min-width: 600px) calc(100vw - 48px), calc(100vw - 32px)"');
  });

  it("takes the film's share of the column and a standing page's measure", async () => {
    const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", poster: LADDER_POSTER, posterWidth: 1920, posterHeight: 1080, widthPercent: 50, pictures: "prose" });
    expect(html).toContain('sizes="(min-width: 1008px) 480px, (min-width: 600px) calc(50vw - 24px), calc(100vw - 32px)"');
  });

  it("keeps YouTube's own thumbnail and a poster without a size as one file", async () => {
    for (const props of [
      { poster: "/api/media/local/yt-dQw4w9WgXcQ/web.webp", posterWidth: 480, posterHeight: 360 },
      { poster: LADDER_POSTER, posterWidth: null, posterHeight: null },
      { poster: null },
    ]) {
      const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", ...props });
      expect(html).not.toContain("srcSet");
      expect(html).not.toContain("srcset");
      expect(html).not.toContain("sizes=");
    }
  });
});
