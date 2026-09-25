import { afterEach, describe, expect, it, vi } from "vitest";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";
import { BROWSER_SEND_BYTES } from "@/modules/media/limits";

/**
 * BR-REQ-054-01, BR-REQ-050-03 criterion 22 (`DECISIONS.md` §NNN) — what the browser sends for
 * each choice. Found by re-review: «Înaltă» was capped at 3000 pixels here whatever the server
 * kept, so it could not be sharper than «Normală».
 *
 * The browser's two tools are stood in for: `createImageBitmap` answers the picture's size, and
 * a canvas records the size it was drawn at and encodes to a blob of a size the case chooses.
 */
const MB = 1024 * 1024;

function stubBrowser(picture: { width: number; height: number }, encodedBytes: (width: number) => number) {
  const drawn: number[] = [];
  vi.stubGlobal("createImageBitmap", async () => ({ ...picture, close: () => undefined }));
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => drawn.push(Math.max(canvas.width, canvas.height)) }),
        toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array(encodedBytes(Math.max(canvas.width, canvas.height)))])),
      };
      return canvas;
    },
  });
  return drawn;
}

const fileOf = (bytes: number) => new File([new Uint8Array(bytes)], "IMG_0001.jpg", { type: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("§NNN the browser half of the choice", () => {
  it("sends a phone's 4032-pixel photograph as it is at «Înaltă», and shrinks it to 3000 at «Normală»", async () => {
    const photo = fileOf(2.4 * MB);
    const drawnHigh = stubBrowser({ width: 4032, height: 3024 }, () => 1 * MB);
    expect(await shrinkImageInBrowser(photo, "high")).toBe(photo);
    expect(drawnHigh).toEqual([]);

    const drawnNormal = stubBrowser({ width: 4032, height: 3024 }, () => 1 * MB);
    expect(await shrinkImageInBrowser(photo, "normal")).not.toBe(photo);
    expect(drawnNormal).toEqual([3000]);
    // No choice at all is «Normală»: what an older caller gets.
    stubBrowser({ width: 4032, height: 3024 }, () => 1 * MB);
    expect(await shrinkImageInBrowser(photo)).not.toBe(photo);
  });

  it("draws a file too large to send at 4000 for «Înaltă», not at «Normală»'s 3000", async () => {
    const drawn = stubBrowser({ width: 6000, height: 4000 }, () => 2 * MB);
    const sent = await shrinkImageInBrowser(fileOf(9 * MB), "high");
    expect(drawn).toEqual([4000]);
    expect(sent.size).toBe(2 * MB);
  });

  it("keeps every upload under the platform's request limit, not only the server's 6 MB", async () => {
    // Five megabytes at 2000 pixels: the server would take it, the platform in front of it would not.
    const drawn = stubBrowser({ width: 2000, height: 1500 }, (edge) => (edge >= 2000 ? 5 * MB : 3 * MB));
    const sent = await shrinkImageInBrowser(fileOf(5 * MB), "normal");
    expect(sent.size).toBeLessThanOrEqual(BROWSER_SEND_BYTES);
    expect(drawn).toEqual([2000, 1600]);
  });
});
