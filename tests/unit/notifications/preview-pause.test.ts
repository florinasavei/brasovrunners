import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewPause, type PreviewLanguage } from "@/modules/notifications/ui/preview-pause";

/**
 * `DECISIONS.md` §NNN — the composer's preview, asked after a pause in typing and at once when a tab
 * is picked. The review: the pause kept the tab open when the key was pressed, and picking the other
 * tab did not cancel it, so "EN" could end up showing the Romanian copy.
 */
describe("§NNN the preview's pause and the tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function recorder() {
    const asked: PreviewLanguage[] = [];
    return { asked, ask: (language: PreviewLanguage) => asked.push(language) };
  }

  it("asks once typing pauses, for the tab open — and once for a burst of keys", () => {
    const pause = previewPause(500);
    const { asked, ask } = recorder();
    pause.typed(ask);
    vi.advanceTimersByTime(300);
    pause.typed(ask);
    vi.advanceTimersByTime(499);
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(asked).toEqual(["ro"]);
  });

  it("a tab picked while the pause runs asks now for that tab, and the pause never asks for the tab left", () => {
    const pause = previewPause(500);
    const { asked, ask } = recorder();
    pause.typed(ask);
    vi.advanceTimersByTime(200);
    pause.switched("en", ask);
    expect(asked).toEqual(["en"]);
    vi.advanceTimersByTime(1000);
    expect(asked).toEqual(["en"]);
  });

  it("typing after a tab is picked asks for the tab open when the pause ends", () => {
    const pause = previewPause(500);
    const { asked, ask } = recorder();
    pause.switched("en", ask);
    pause.typed(ask);
    vi.advanceTimersByTime(500);
    expect(asked).toEqual(["en", "en"]);
  });

  it("asks nothing once cancelled — the composer going away, or asking afresh itself", () => {
    const pause = previewPause(500, "en");
    const { asked, ask } = recorder();
    pause.typed(ask);
    pause.cancel();
    vi.advanceTimersByTime(1000);
    expect(asked).toEqual([]);
  });
});
