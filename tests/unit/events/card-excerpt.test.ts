import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_EXCERPT_SX, CARD_EXCERPT_WORDS_SX, PAGE_EXCERPT_SX } from "@/modules/events/ui/EventExcerpt";

/**
 * BR-REQ-041-01 criterion 1 and `DECISIONS.md` §73 — a picture written into a short
 * description is shown on the listing card too, and a card is still a card at 320 pixels.
 *
 * The cards rendered `excerpt`, the plain-text shadow the service derives from the document,
 * so an organizer who put a picture in the summary saw it on the event page and on the hero
 * and never on the card that sends people there (the owner: "pictures should be shown in the
 * short description as well"). Rendering the document itself brings the editor's picture
 * choices along, and two of them mean nothing in a card: the column share and the side are
 * decisions about an event page's text column, and a card has one narrow column of its own.
 *
 * The height is not one of them (§260). The card capped every picture at 180 pixels and cut the
 * rest from the centre — the owner: "practic pe card au o înălțime fixă, ceea ce e cam greșit" —
 * so a picture on a card now has its own shape, the same shape it has in the editor and on the
 * page, and the crop box (§241) is where a portrait photograph becomes a band on purpose.
 */
describe("BR-REQ-041-01 the short description on a listing card", () => {
  it("gives a picture the whole card, whatever share of the column was chosen", () => {
    // The figure's own rule is `{ xs: "100%", sm: "<widthPercent>%" }`. This one is a
    // descendant selector — one type selector more specific — so it wins at every width
    // without `!important`, and the 33-percent picture of an event page fills the card.
    expect(CARD_EXCERPT_SX["& figure"].width).toBe("100%");
  });

  it("puts a floated picture back in the flow, whatever side was chosen", () => {
    // The alignment (2026-09-20) is a decision about a text column wide enough to have a side.
    // A card is one narrow column, so a float there is two words a line beside a photograph,
    // and a float at the end of the excerpt would reach into the date and the place beneath it.
    // Same mechanism as the width: one type selector more specific than the figure's own
    // media query.
    expect(CARD_EXCERPT_SX["& figure"].float).toBe("none");
    expect(CARD_EXCERPT_SX["& figure"].marginLeft).toBe("auto");
    expect(CARD_EXCERPT_SX["& figure"].marginRight).toBe("auto");
    expect(CARD_EXCERPT_SX["& figcaption"].textAlign).toBe("center");
  });

  it("gives the picture its own shape — no crop the organizer did not draw (§260, §275)", () => {
    /*
      `height: auto` is the explicit form of "whatever this picture's proportions say", written
      down so nothing above it can re-impose a band.

      §275 adds a ceiling, and the difference from the 180-pixel band §260 removed is the whole
      point: a band *cut* every picture to one shape, and this *scales* a tall one down whole.
      `width: auto` beside it is what keeps the proportions while the height is capped, and
      nothing here crops — which is what the assertions below still check.
    */
    const img = CARD_EXCERPT_SX["& figure > img"];
    expect(img.height).toBe("auto");
    expect(img.width).toBe("auto");
    expect(img.maxWidth).toBe("100%");
    expect(img.maxHeight).toBe(420);
    expect(img).not.toHaveProperty("objectFit");
  });

  it("leaves a cropped picture's window alone, so the rectangle drawn is the rectangle shown", () => {
    // §241: a cropped picture is an <img> magnified inside a `.rt-crop` window whose height is
    // the crop's own aspect ratio. Capping the window trimmed the bottom off that rectangle;
    // capping the photograph inside it would show a slice of the wrong part. Neither happens
    // now — and the child selector is still what keeps any future figure rule out of the
    // window's inside.
    expect(CARD_EXCERPT_SX).not.toHaveProperty("& figure > .rt-crop");
    expect(Object.keys(CARD_EXCERPT_SX).filter((key) => key.startsWith("& figure ") && !key.includes(">"))).toEqual([]);
  });

  it("measures nothing across the card, and nothing in viewport units", () => {
    /*
      The 320-pixel rule is kept by construction: nothing here states a width in pixels, so a
      picture cannot be wider than the card it is in, and `vw` — which on a page with a
      scrollbar is wider than the page — appears nowhere.

      The one measurement is the height ceiling §275 added, and it is the safe direction: a
      number that makes a picture *shorter* cannot make a phone scroll sideways.
    */
    const values = JSON.stringify([CARD_EXCERPT_SX, CARD_EXCERPT_WORDS_SX]);
    expect(values).not.toMatch(/vw"/);
    expect(values).not.toMatch(/"(width|minWidth|maxWidth|minHeight)":\s*\d/);
  });

  it("keeps the card's words the size the card's words were", () => {
    // body2. The change is about the picture; a listing whose type grew would be a second,
    // unasked-for change.
    expect(CARD_EXCERPT_SX["& p"].fontSize).toBe("0.875rem");
  });

  it("reads three lines of the summary at most, and wraps anything too long for a phone (§366)", () => {
    /*
      The owner, 2026-09-24, of the listing: "There is too much whitespace on these cards". A
      summary as long as its author made it set one card's height against its neighbour's; the
      card now clamps it — the -webkit-box form every engine implements, counted across the
      summary's paragraphs — and the event page carries the rest. Since §NNN the clamp is the
      words' own box, and the pictures stand outside it (`card-excerpt-pictures.test.ts`).
    */
    expect(CARD_EXCERPT_WORDS_SX.display).toBe("-webkit-box");
    expect(CARD_EXCERPT_WORDS_SX.WebkitBoxOrient).toBe("vertical");
    expect(CARD_EXCERPT_WORDS_SX.WebkitLineClamp).toBe(3);
    expect(CARD_EXCERPT_WORDS_SX.overflow).toBe("hidden");
    expect(CARD_EXCERPT_WORDS_SX.overflowWrap).toBe("anywhere");
  });

  it("wraps a long unbroken word on the outer box too, not only the words' clamp (§412)", () => {
    // The words' box carries its own `overflowWrap` for the clamp; a figure's caption sits
    // outside that box, so the net is the outer box's own rule — a long address typed into a
    // caption still wraps inside a 320-pixel card instead of overflowing it.
    expect(CARD_EXCERPT_SX.overflowWrap).toBe("anywhere");
  });

  it("leaves the event page and the hero exactly as they were", () => {
    // No figure rule at all: on a page, the width the organizer chose is the point.
    expect(Object.keys(PAGE_EXCERPT_SX)).toEqual(["color", "mb", "& p:last-of-type"]);
  });

  it("carries the summary on every card, under the hero as well (§251)", () => {
    // §242 kept the list under the featured event dense — title, date and place — so the lead
    // was not followed by a scroll (§78). The owner asked for the opposite once a picture could
    // be cropped to the shape a card shows (§241): "on the event card I wanna be able to see
    // pictures in the preview". So there is no longer a card that drops it, and the editor's
    // help text must not claim there is.
    // The single-date card left `events/page.tsx` for a module of its own beside the series card (§366).
    const cards = readFileSync(path.join(process.cwd(), "src", "modules", "events", "ui", "EventCard.tsx"), "utf8");
    expect(cards).not.toContain("underHero");
    expect(cards).toContain('<EventExcerpt place="card"');
    const series = readFileSync(path.join(process.cwd(), "src", "modules", "events", "ui", "SeriesCard.tsx"), "utf8");
    expect(series).not.toContain("underHero");
    const ro = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "ro.json"), "utf8"));
    const en = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf8"));
    expect(ro.Admin.editor.excerptHelp).not.toContain("compacte");
    expect(en.Admin.editor.excerptHelp).not.toContain("dense");
  });

  it("is what both cards render the excerpt through", () => {
    // The regression is not in the styles, it is in a card rendering `excerpt` as a string
    // again — which drops the picture silently, in both languages, on the busiest page.
    const cards = [
      path.join(process.cwd(), "src", "modules", "events", "ui", "EventCard.tsx"),
      path.join(process.cwd(), "src", "modules", "events", "ui", "SeriesCard.tsx"),
    ];
    for (const card of cards) {
      const text = readFileSync(card, "utf8");
      expect(text, `${path.basename(card)} renders the rich excerpt`).toContain(
        'EventExcerpt place="card"',
      );
      expect(text, `${path.basename(card)} hands it the document`).toMatch(/excerptJson=\{/);
    }
  });
});
