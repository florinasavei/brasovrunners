import { describe, expect, it } from "vitest";
import { eventShareImage, SHARE_SHAPES, type ShareImageEvent, type ShareShape, shareTitleSize } from "@/modules/events/share-image";
import { clampTitle, DEFAULT_SHARE_CARD_DESIGN, type ShareCardDesign } from "@/modules/events/share-card-design";

/**
 * BR-REQ-052-02 criterion 8 (`DECISIONS.md` §90, §NNN) — the card is really drawn: `next/og` turns
 * the layout into a PNG here, with the bundled fonts and the club's logo, in both shapes and in
 * every variant the design object and the event can produce. Satori refuses a layout it cannot
 * draw (an element with children and no `display: flex`, a picture it cannot read) by throwing,
 * so a PNG of the right size is the proof that the layout is one it accepts.
 */

/** Saturday 21 November 2026 at 10:00 in Brașov. */
const EVENT: ShareImageEvent = {
  title: "Trail to Road cu Brașov Running Festival",
  type: "RACE",
  startsAt: new Date("2026-11-21T08:00:00Z"),
  raceStartsAt: null,
  announcedDay: null,
  timezone: "Europe/Bucharest",
  locationName: "Piața Sfatului",
  locationToBeAnnounced: false,
  distanceMeters: 10000,
  distanceEstimated: true,
  elevationGainMeters: 350,
  elevationGainEstimated: false,
  eventStatus: "SCHEDULED",
} as ShareImageEvent;

const LABELS = {
  type: "Concurs",
  cancelled: "Anulat",
  locationToBeAnnounced: "Locația se anunță în curând",
  dateToBeAnnounced: "Data se anunță în curând",
  timeToBeAnnounced: "Ora se anunță în curând",
  t: (key: string, values?: Record<string, string | number>) => (key.startsWith("distance") ? `circa ${values?.km} km` : `${values?.m} m diferență de nivel`),
};

/** An 8 × 8 PNG, inline: a picture for the background with no network. */
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAANElEQVR4nGO42aWtEbUAjuBcBqyiKBJoWhmwigK5DHIVNkAKSMIRhMuAVRQkgVUURQJNKwDaeEVx9dK+xgAAAABJRU5ErkJggg==";

/** The PNG's signature and the width and height its header states (bytes 16–23, big-endian). */
async function drawn(shape: ShareShape, event: ShareImageEvent = EVENT, design: Partial<ShareCardDesign> = {}) {
  const response = await eventShareImage(event, "ro", shape, LABELS, { ...DEFAULT_SHARE_CARD_DESIGN, ...design });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    type: response.headers.get("content-type"),
    signature: bytes.subarray(0, 8).toString("hex"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const PNG_SIGNATURE = "89504e470d0a1a0a";

describe("eventShareImage — the card is drawn, in both shapes", () => {
  it.each(Object.keys(SHARE_SHAPES) as ShareShape[])("draws the %s card at its size with the platform's design", async (shape) => {
    const image = await drawn(shape);
    expect(image.type).toBe("image/png");
    expect(image.signature).toBe(PNG_SIGNATURE);
    expect({ width: image.width, height: image.height }).toEqual(SHARE_SHAPES[shape]);
  });

  it("draws the square at 1080 × 1080 and the wide card at 1200 × 630", async () => {
    expect(await drawn("square")).toMatchObject({ width: 1080, height: 1080 });
    expect(await drawn("og")).toMatchObject({ width: 1200, height: 630 });
  });

  it.each(["square", "og"] as const)("still draws the %s card with every element switched off", async (shape) => {
    const image = await drawn(shape, EVENT, { showLogo: false, showType: false, showPlace: false, showRoute: false, showHost: false });
    expect({ width: image.width, height: image.height }).toEqual(SHARE_SHAPES[shape]);
  });

  it.each(["square", "og"] as const)("draws a cancelled event and an event whose date and place are to be announced (%s)", async (shape) => {
    expect((await drawn(shape, { ...EVENT, eventStatus: "CANCELLED" })).signature).toBe(PNG_SIGNATURE);
    const announced = { ...EVENT, startsAt: null, locationToBeAnnounced: true, locationName: null } as unknown as ShareImageEvent;
    expect((await drawn(shape, announced)).signature).toBe(PNG_SIGNATURE);
    const dayOnly = { ...EVENT, startsAt: null, announcedDay: "2026-11-21" } as unknown as ShareImageEvent;
    expect((await drawn(shape, dayOnly)).signature).toBe(PNG_SIGNATURE);
  });

  it.each(["square", "og"] as const)("draws the %s card over a background picture without Satori refusing the <img>", async (shape) => {
    const image = await drawn(shape, EVENT, { backgroundPictureUrl: PICTURE });
    expect(image.signature).toBe(PNG_SIGNATURE);
    expect({ width: image.width, height: image.height }).toEqual(SHARE_SHAPES[shape]);
  });

  it("draws the ink and paper palettes, a paper card under a picture, and a tagline in the handwriting face", async () => {
    for (const design of [
      { palette: "ink" },
      { palette: "paper" },
      { palette: "paper", backgroundPictureUrl: PICTURE },
      { tagline: "Alergăm împreună", accent: "#00aa55" },
    ] as Partial<ShareCardDesign>[]) {
      expect((await drawn("og", EVENT, design)).signature, JSON.stringify(design)).toBe(PNG_SIGNATURE);
    }
  });

  it("draws the longest title the clamp lets through", async () => {
    const image = await drawn("square", { ...EVENT, title: "Semimaratonul de toamnă al Brașovului ".repeat(5) });
    expect(image).toMatchObject({ width: 1080, height: 1080 });
  });
});

describe("shareTitleSize — the title's size by its length, three lines at most", () => {
  it("draws a short title large and a long one smaller, never growing with the length", () => {
    for (const shape of ["square", "og"] as const) {
      let previous = Infinity;
      for (let length = 1; length <= 111; length += 1) {
        const size = shareTitleSize("x".repeat(length), shape);
        expect(size).toBeLessThanOrEqual(previous);
        previous = size;
      }
    }
    expect(shareTitleSize("Trail to Road cu Brașov Running Festival", "square")).toBe(92);
    expect(shareTitleSize("Trail to Road cu Brașov Running Festival", "og")).toBe(72);
  });

  it("gives an all-capitals title of about sixty characters a size whose three lines fit", () => {
    const caps = "MARATONUL INTERNAȚIONAL AL BRAȘOVULUI PE TÂMPA ȘI ÎN ȘCHEI";
    expect(shareTitleSize(caps, "square")).toBeLessThanOrEqual(64);
  });

  it("keeps the clamped longest title at a size whose three lines fit the card's width", () => {
    const longest = clampTitle("x ".repeat(80));
    expect(shareTitleSize(longest, "square")).toBe(44);
    expect(shareTitleSize(longest, "og")).toBe(50);
  });
});
