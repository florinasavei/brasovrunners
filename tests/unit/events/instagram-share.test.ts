import { describe, expect, it, vi } from "vitest";
import {
  canShareFiles,
  fallsBackToDownload,
  INSTAGRAM_IMAGE_TYPE,
  instagramFileName,
  instagramShareData,
  offersInstagramShare,
  type ShareCapableNavigator,
} from "@/modules/events/instagram-share";

/**
 * BR-REQ-052-02 criterion 8 — the Instagram button shares the picture where the phone can take
 * one, and downloads it everywhere else (`DECISIONS.md` §90, §140, and the 2026-09-23 section
 * on the share buttons; the owner: "it needs to be an actual share, not just create a picture").
 *
 * The decisions are pure functions so they can be held here without a device: what counts as
 * a browser that can share a file, what the sheet is handed, and which refusal becomes a
 * download. Whether iOS accepts the share after the fetch is a thing only an iPhone can say.
 */
const yes: ShareCapableNavigator = { share: vi.fn(async () => {}), canShare: () => true };

describe("canShareFiles — whether the browser can hand a picture to the share sheet", () => {
  it("is false without a navigator, without share, or without canShare", () => {
    expect(canShareFiles(undefined)).toBe(false);
    expect(canShareFiles({})).toBe(false);
    expect(canShareFiles({ share: yes.share })).toBe(false);
    expect(canShareFiles({ canShare: () => true })).toBe(false);
  });

  it("is the browser's own answer, asked with a probe file of the type the route serves", () => {
    const canShare = vi.fn((data: ShareData) => Array.isArray(data.files) && data.files.length === 1);
    expect(canShareFiles({ share: yes.share, canShare })).toBe(true);
    const probe = canShare.mock.calls[0]?.[0]?.files?.[0];
    expect(probe).toBeInstanceOf(File);
    expect(probe?.type).toBe(INSTAGRAM_IMAGE_TYPE);
  });

  it("is false when the browser says no to files, even with a share of its own", () => {
    expect(canShareFiles({ share: yes.share, canShare: () => false })).toBe(false);
  });

  it("is false without a File constructor, and when canShare throws on files", () => {
    expect(canShareFiles(yes, null)).toBe(false);
    expect(
      canShareFiles({
        share: yes.share,
        canShare: () => {
          throw new TypeError("files not supported");
        },
      }),
    ).toBe(false);
  });
});

describe("offersInstagramShare — share where a finger is the pointer, download where a mouse is", () => {
  it("shares only on a coarse pointer with a browser that can share files", () => {
    expect(offersInstagramShare(yes, true)).toBe(true);
    // A desktop's sheet has no Instagram in it; a person posting from a desktop uploads a file.
    expect(offersInstagramShare(yes, false)).toBe(false);
    expect(offersInstagramShare({ share: yes.share, canShare: () => false }, true)).toBe(false);
    expect(offersInstagramShare(undefined, true)).toBe(false);
  });
});

describe("instagramShareData — what the sheet is handed", () => {
  const picture = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const facts = { fileName: "tura-pe-tampa-instagram.png", title: "Tură pe Tâmpa", url: "https://example.test/ro/evenimente/tura-pe-tampa" };

  it("is one File named for the event, with the response's type", () => {
    const data = instagramShareData(picture, facts);
    expect(data.files).toHaveLength(1);
    const file = data.files![0]!;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("tura-pe-tampa-instagram.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
  });

  it("falls back to PNG when the response names no type, and keeps another type when it does", () => {
    expect(instagramShareData(new Blob(["x"]), facts).files![0]!.type).toBe(INSTAGRAM_IMAGE_TYPE);
    expect(instagramShareData(new Blob(["x"], { type: "image/jpeg" }), facts).files![0]!.type).toBe("image/jpeg");
  });

  it("carries the title and the event's address as text, for the apps that take words", () => {
    const data = instagramShareData(picture, facts);
    expect(data.title).toBe("Tură pe Tâmpa");
    expect(data.text).toBe("Tură pe Tâmpa https://example.test/ro/evenimente/tura-pe-tampa");
  });

  it("names the file after the slug", () => {
    expect(instagramFileName("tura-pe-tampa")).toBe("tura-pe-tampa-instagram.png");
  });
});

describe("fallsBackToDownload — which refusal becomes a download", () => {
  it("does nothing when the person closed the sheet", () => {
    expect(fallsBackToDownload(new DOMException("closed", "AbortError"))).toBe(false);
    expect(fallsBackToDownload({ name: "AbortError" })).toBe(false);
  });

  it("downloads when iOS says the tap was too old, when the browser refuses the file, and when the picture failed", () => {
    expect(fallsBackToDownload(new DOMException("activation", "NotAllowedError"))).toBe(true);
    expect(fallsBackToDownload(new TypeError("files"))).toBe(true);
    expect(fallsBackToDownload(new Error("share-image 404"))).toBe(true);
    expect(fallsBackToDownload(undefined)).toBe(true);
    expect(fallsBackToDownload("refused")).toBe(true);
  });
});
