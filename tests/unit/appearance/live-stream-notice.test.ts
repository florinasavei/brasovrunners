import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — «Suntem în direct» under the header, rendered: with the setting off (or no row) nothing is
 * drawn at all; with it on, one bar with the sentence and the one link to the broadcast's address,
 * a plain anchor — nothing embedded, nothing loaded from YouTube. The data read is stubbed; the
 * Server Component under test renders for real.
 */
const state = vi.hoisted(() => ({ live: { on: false, url: null as string | null } }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedLiveStream: async () => state.live,
}));

async function render(): Promise<string> {
  const { default: LiveStreamNotice } = await import("@/shared/ui/LiveStreamNotice");
  return renderToStaticMarkup(await LiveStreamNotice());
}

describe("§NNN the live-broadcast notice under the header", () => {
  beforeEach(() => {
    state.live = { on: false, url: null };
  });

  it("draws nothing while the setting is off, even with an address kept", async () => {
    expect(await render()).toBe("");
    state.live = { on: false, url: "https://www.youtube.com/@brasovrunners/live" };
    expect(await render()).toBe("");
  });

  it("draws one bar with the sentence and the one link to the broadcast while it is on", async () => {
    state.live = { on: true, url: "https://www.youtube.com/@brasovrunners/live" };
    const html = await render();
    expect(html).toContain('data-testid="live-stream-notice"');
    expect(html).toContain("live.body");
    expect(html).toContain('href="https://www.youtube.com/@brasovrunners/live"');
    expect(html).toContain("live.watch");
    // A plain link: no frame, no script, no request to YouTube on the page's behalf.
    expect(html).not.toMatch(/<iframe|<script/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
