import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { BIB_IMAGE } from "@/modules/registrations/bib-geometry";
import { bibImageFooterLines, renderBibImage } from "@/modules/registrations/bib-image";

/**
 * §94, §180 — the picture the preview route answers with, and the club's only look at a bib
 * before it goes to a printer.
 *
 * It is `renderBibImage` that is exercised rather than the route: the route is four lines of
 * authorization over this, and drawing the card is what breaks. A missing raster, a style
 * `next/og` will not take, a font that never loaded — each of those throws here, and each of
 * them is a 500 on the screen the club presses "see the bibs" from.
 */
const draw = (over: Partial<Parameters<typeof renderBibImage>[0]> = {}) =>
  renderBibImage({
    bibNumber: 17,
    registeredName: "Alergător Ștefan",
    eventTitle: "Crosul aniversar Brașov Runners",
    eventDate: "11 octombrie 2026",
    bandColour: "#1b7f3b",
    partners: ["Primăria Brașov"],
    replyTo: "contact@example.test",
    ...over,
  });

const png = async (over?: Partial<Parameters<typeof renderBibImage>[0]>) =>
  Buffer.from(await (await draw(over)).arrayBuffer());

describe("§94 the bib preview", () => {
  it("draws a PNG of the card's own size", async () => {
    const image = await draw();
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    const bytes = await png();
    // The PNG signature, then IHDR's width and height as big-endian 32-bit integers.
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(BIB_IMAGE.width);
    expect(bytes.readUInt32BE(20)).toBe(BIB_IMAGE.height);
  });

  it("draws the card whatever the event left unset, and whatever the number is", async () => {
    // No colour, no partners, no reply-to: a club that has filled in nothing still gets a bib.
    expect((await png({ bandColour: null, partners: [], replyTo: null })).byteLength).toBeGreaterThan(1000);
    // Five digits, which is the widest the band allows for.
    expect((await png({ bibNumber: 99_999 })).byteLength).toBeGreaterThan(1000);
  });

  it("draws a footer the club composed, on two lines when it needs them (§317)", async () => {
    const long = {
      partners: ["Primăria Municipiului Brașov", "Salvamont Brașov", "Asociația Sportivă Carpați", "Decathlon Brașov", "Clubul Sportiv Olimpia"],
      siteUrl: "https://www.example.test",
      design: {
        ...DEFAULT_BIB_DESIGN,
        showWebsite: true,
        footerText: "Cronometraj: StartTime România · Urgențe organizator: 0722 000 000",
      },
    };
    expect(bibImageFooterLines({ ...long, eventTitle: "x", eventDate: "y", replyTo: "contact@example.test" }, false)).toHaveLength(2);
    const drawn = await png(long);
    expect(drawn.byteLength).toBeGreaterThan(1000);
    if (process.env.BIB_IMAGE_SAMPLE_FOOTER) writeFileSync(process.env.BIB_IMAGE_SAMPLE_FOOTER, drawn);
    // And with every footer switch off, a card with no small print at all.
    expect((await png({ design: { ...DEFAULT_BIB_DESIGN, showEmail: false, showPartners: false } })).byteLength).toBeGreaterThan(1000);
  });

  // §NNN — a desk spare, as the sheet prints it: the number and an empty line for the name.
  it("draws a spare with an empty name line instead of a name", async () => {
    const spare = await png({ registeredName: null });
    expect(spare.readUInt32BE(16)).toBe(BIB_IMAGE.width);
    expect(spare.equals(await png())).toBe(false);
    // The mark under the line is drawn too: the picture differs from the bare line's.
    expect((await png({ registeredName: null, blankMark: "on-the-spot entry" })).equals(spare)).toBe(false);
    if (process.env.BIB_IMAGE_SAMPLE_SPARE) writeFileSync(process.env.BIB_IMAGE_SAMPLE_SPARE, spare);
  });

  it("writes a sample to disk for a person to look at, when asked", async () => {
    const target = process.env.BIB_IMAGE_SAMPLE;
    if (!target) return;
    writeFileSync(target, await png());
  });
});
