import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_EXCERPT_SX, PAGE_EXCERPT_SX } from "@/modules/events/ui/EventExcerpt";

/**
 * BR-REQ-041-01 criterion 1 and `DECISIONS.md` §73 — a picture written into a short
 * description is shown on the listing card too, and a card is still a card at 320 pixels.
 *
 * The cards rendered `excerpt`, the plain-text shadow the service derives from the document,
 * so an organizer who put a picture in the summary saw it on the event page and on the hero
 * and never on the card that sends people there (the owner: "pictures should be shown in the
 * short description as well"). Rendering the document itself brings the editor's two picture
 * choices along, and neither survives a card: the column share is a decision about an event
 * page's text column, and an uncapped portrait photograph is taller than the card it is in.
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
    // A card is one narrow column with a cropped picture at a fixed height, and a float at the
    // end of the excerpt would reach into the date and the place beneath it. Same mechanism as
    // the width: one type selector more specific than the figure's own media query.
    expect(CARD_EXCERPT_SX["& figure"].float).toBe("none");
    expect(CARD_EXCERPT_SX["& figure"].marginLeft).toBe("auto");
    expect(CARD_EXCERPT_SX["& figure"].marginRight).toBe("auto");
    expect(CARD_EXCERPT_SX["& figcaption"].textAlign).toBe("center");
  });

  it("caps the picture's height and crops it, so the facts stay on the first screen", () => {
    expect(CARD_EXCERPT_SX["& figure > img"].maxHeight).toBe(180);
    expect(CARD_EXCERPT_SX["& figure > img"].objectFit).toBe("cover");
  });

  it("caps the window of a cropped picture, and never the photograph inside it", () => {
    // §241: a cropped picture is an <img> inside a window, and the window is what may be
    // capped — `maxHeight` on the photograph would fight the magnification that draws the
    // crop and show a slice of the wrong part. Hence the child selector above: `& figure img`
    // would have reached inside the window.
    expect(CARD_EXCERPT_SX["& figure > .rt-crop"].maxHeight).toBe(180);
    expect(Object.keys(CARD_EXCERPT_SX).filter((key) => key.startsWith("& figure ") && !key.includes(">"))).toEqual([]);
  });

  it("measures nothing horizontally in pixels or in viewport units", () => {
    // The 320-pixel rule is kept by construction rather than by a number that happens to fit:
    // the only width here is the card's own, and `vw` on a page with a scrollbar is wider than
    // the page. `maxHeight` is the one fixed measurement, and it is vertical.
    const values = JSON.stringify(CARD_EXCERPT_SX);
    expect(values).not.toMatch(/vw"/);
    expect(values).not.toMatch(/"(width|minWidth|maxWidth)":\s*\d/);
  });

  it("keeps the card's words the size the card's words were", () => {
    // body2. The change is about the picture; a listing whose type grew would be a second,
    // unasked-for change.
    expect(CARD_EXCERPT_SX["& p"].fontSize).toBe("0.875rem");
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
    const cards = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "events", "page.tsx"), "utf8");
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
      path.join(process.cwd(), "src", "app", "[locale]", "events", "page.tsx"),
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
