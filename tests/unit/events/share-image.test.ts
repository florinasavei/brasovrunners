import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventShareImage, SHARE_SHAPES, type ShareImageEvent, type ShareShape } from "@/modules/events/share-image";
import { DEFAULT_SHARE_CARD_DESIGN, type ShareCardDesign } from "@/modules/events/share-card-design";
import { SHARE_LAYOUT } from "@/modules/events/share-card-layout";
import { COLOR } from "@/theme/brand";

/**
 * BR-REQ-052-02 criterion 8 (`DECISIONS.md` §90, §609) — the card is really drawn: `next/og` turns
 * the layout into a PNG here, with the bundled fonts and the club's logo, in both shapes and in
 * every variant the design object and the event can produce. Satori refuses a layout it cannot
 * draw (an element with children and no `display: flex`, a picture it cannot read) by throwing,
 * so a PNG of the right size is the proof that the layout is one it accepts — and the PNG's own
 * pixels, read back through `sharp`, prove that the band at its foot is whole however long the
 * facts above it run, and that the white words over a photograph read.
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

/**
 * Two 8 × 8 PNGs — a dark one of blues and an orange, and a near-white one — served at `https:`
 * addresses by a stub of `fetch`: the renderer fetches `https:` only and takes no `data:` address,
 * so the tests take the road a stored picture would. Anything else goes to the real `fetch`.
 */
const DARK = "https://pictures.test/dark.png";
const LIGHT = "https://pictures.test/near-white.png";
const LARGE = "https://pictures.test/too-large.png";
const PICTURES: Record<string, string> = {
  [DARK]:
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAANElEQVR4nGO42aWtEbUAjuBcBqyiKBJoWhmwigK5DHIVNkAKSMIRhMuAVRQkgVUURQJNKwDaeEVx9dK+xgAAAABJRU5ErkJggg==",
  [LIGHT]:
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQI12P49OHNrx9fMEkGrKJAkmFQ6gAAUHG2gVW666YAAAAASUVORK5CYII=",
};
const realFetch = globalThis.fetch;
const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    if (url === LARGE) {
      // Announces five megabytes: refused on the header, before a byte of the body is read.
      return new Response(new Uint8Array(16), { headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) } });
    }
    if (url in PICTURES) {
      const bytes = Buffer.from(PICTURES[url], "base64");
      return new Response(bytes, { headers: { "content-type": "image/png", "content-length": String(bytes.length) } });
    }
    return realFetch(input, init);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function png(shape: ShareShape, event: ShareImageEvent = EVENT, design: Partial<ShareCardDesign> = {}) {
  const response = await eventShareImage(event, "ro", shape, LABELS, { ...DEFAULT_SHARE_CARD_DESIGN, ...design });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

/** The PNG's signature and the width and height its header states (bytes 16–23, big-endian). */
async function drawn(shape: ShareShape, event: ShareImageEvent = EVENT, design: Partial<ShareCardDesign> = {}) {
  const { response, bytes } = await png(shape, event, design);
  return {
    type: response.headers.get("content-type"),
    signature: bytes.subarray(0, 8).toString("hex"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

type Rgb = readonly [number, number, number];

/** The PNG's pixels, to read the colour at a point. */
async function pixels(bytes: Buffer) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    height: info.height,
    at: (x: number, y: number): Rgb => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    },
  };
}

/** How many rows at the card's foot, counted up from the last, have the paper band's colour at their left edge. */
async function bandRows(bytes: Buffer): Promise<number> {
  const image = await pixels(bytes);
  const paper = [1, 3, 5].map((at) => Number.parseInt(COLOR.paper.slice(at, at + 2), 16));
  let rows = 0;
  for (let y = image.height - 1; y >= 0; y -= 1) {
    if (image.at(4, y).some((channel, index) => Math.abs(channel - paper[index]) > 2)) break;
    rows += 1;
  }
  return rows;
}

/**
 * The first row, from the top, where the white lockup shows: the head is pushed upwards — out of
 * its place, under the clip — only when the facts and the title run taller than the card holds.
 */
async function logoTop(bytes: Buffer, shape: ShareShape): Promise<number> {
  const image = await pixels(bytes);
  const size = SHARE_LAYOUT[shape];
  for (let y = 0; y < size.padTop + size.logo; y += 1) {
    for (let x = size.pad; x < size.pad + size.logo * 2.4; x += 1) if (image.at(x, y).every((channel) => channel > 235)) return y;
  }
  return -1;
}

/** WCAG's contrast between a colour and white. */
function contrastWithWhite(colour: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
  return 1.05 / (luminance + 0.05);
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
    const image = await drawn(shape, EVENT, { backgroundPictureUrl: DARK });
    expect(fetched).toEqual([DARK]);
    expect(image.signature).toBe(PNG_SIGNATURE);
    expect({ width: image.width, height: image.height }).toEqual(SHARE_SHAPES[shape]);
  });

  it("draws the ink and paper palettes, a paper card under a picture, and a tagline in the handwriting face", async () => {
    for (const design of [
      { palette: "ink" },
      { palette: "paper" },
      { palette: "paper", backgroundPictureUrl: DARK },
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

describe("eventShareImage — every fact stays on the card, the band whole at its foot (§609)", () => {
  /** 116 characters, 110 once clamped, and a place of 93: the review's overflow on the wide card. */
  const LONG_TITLE =
    "Crosul de toamnă al Brașovului pe Tâmpa și pe aleile de sub Tâmpa cu start și sosire în Piața Sfatului ediția a doua";
  const LONG_PLACE = "Parcarea de lângă baza pârtiei Bradu din Poiana Brașov, la intrarea dinspre Drumul Poienii 21";
  const TAGLINE = "Alergăm împreună pe Tâmpa, prin Șchei și pe aleile din parc";

  const cases: Array<[string, Partial<ShareImageEvent>, Partial<ShareCardDesign>]> = [
    ["the platform's card", {}, {}],
    ["a 110-character title and a 93-character place", { title: LONG_TITLE, locationName: LONG_PLACE }, {}],
    ["a long title with a sixty-character tagline", { title: LONG_TITLE }, { tagline: TAGLINE }],
    ["a long title, a long place and a tagline", { title: LONG_TITLE, locationName: LONG_PLACE }, { tagline: TAGLINE }],
    ["an all-capitals long title and place", { title: LONG_TITLE.toUpperCase(), locationName: LONG_PLACE.toUpperCase() }, {}],
    ["a cancelled event over a near-white picture", { eventStatus: "CANCELLED" }, { backgroundPictureUrl: LIGHT }],
  ];

  it.each((["og", "square"] as const).flatMap((shape) => cases.map(([name, event, design]) => [shape, name, event, design] as const)))(
    "%s, %s: the paper band fills exactly its last rows, and the logo stays where the plain card has it",
    async (shape, _name, event, design) => {
      const { bytes } = await png(shape, { ...EVENT, ...event } as ShareImageEvent, design);
      expect(await bandRows(bytes)).toBe(SHARE_LAYOUT[shape].band);
      // The drawing clips an overflow rather than move the band; the head moving up is how one would show.
      expect(await logoTop(bytes, shape)).toBe(await logoTop((await png(shape)).bytes, shape));
    },
  );
});

describe("eventShareImage — the picture is fetched over https, never taken as data (§609)", () => {
  it("refuses a data: address handed over in the design, drawing the plain card without a request", async () => {
    const plain = (await png("og")).bytes;
    const refused = (await png("og", EVENT, { backgroundPictureUrl: `data:image/png;base64,${PICTURES[DARK]}` })).bytes;
    expect(fetched).toEqual([]);
    expect(refused.equals(plain)).toBe(true);
  });

  it("refuses a picture whose announced length is over four megabytes, drawing the plain card", async () => {
    const plain = (await png("og")).bytes;
    const refused = (await png("og", EVENT, { backgroundPictureUrl: LARGE })).bytes;
    expect(fetched).toEqual([LARGE]);
    expect(refused.equals(plain)).toBe(true);
  });

  it.each(["square", "og"] as const)("keeps the white logo and pill readable over a near-white photograph (%s): 4.5:1 behind them", async (shape) => {
    const { bytes } = await png(shape, EVENT, { backgroundPictureUrl: LIGHT });
    expect(fetched).toEqual([LIGHT]);
    const image = await pixels(bytes);
    const size = SHARE_LAYOUT[shape];
    // Left of the wordmark, between the logo and the pill, and in the corner the pill sits in.
    for (const [x, y] of [
      [size.pad - 12, size.padTop + size.logo - 12],
      [Math.round(size.width / 2), size.padTop + Math.round(size.logo / 2)],
      [size.width - 8, size.padTop],
    ]) {
      expect(contrastWithWhite(image.at(x, y)), `${shape} ${x},${y}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
