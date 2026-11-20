import { describe, expect, it } from "vitest";
import { POSTER_FRAME, posterLayout } from "@/modules/pr-kit/domain/poster";
import { A4_MM, type Box, contains, overlaps, QUIET_ZONE_MODULES, quietZone } from "@/modules/pr-kit/domain/sheets";

/**
 * §NNN — «PR Kit» → «Afiș YouTube»: the A4 poster's geometry, as the owner approved it on 2026-11-20.
 *
 * The frame stands 7 mm in from the edge; everything else stands inside it, top to bottom in the approved order, nothing over
 * anything; and the code keeps its **quiet zone of four modules** clear of the card's border and of the tab on its top edge —
 * for a code of the channel address's size (version 3 or 4, 29 or 33 modules) and for every other, the lead in one line, two
 * or three. The code fills as much of the card as its zone allows: about 90 mm for a channel's address.
 */

const LOCKUP = 1162.459 / 2853.918;
/** «YouTube» and «SCANEAZĂ-MĂ» as Roboto Bold measures them at the poster's sizes. */
const WIDTHS = { brandWordWidth: 118.7, tabTextWidth: 48.9 };

function inner(frame: Box): Box {
  const half = POSTER_FRAME.stroke / 2;
  return { x: frame.x + half, y: frame.y + half, width: frame.width - POSTER_FRAME.stroke, height: frame.height - POSTER_FRAME.stroke };
}

describe("§NNN the YouTube poster's geometry", () => {
  it("frames the page 7 mm in from its edge", () => {
    const { frame } = posterLayout({ modules: 33, leadLines: 2, logoAspect: LOCKUP, ...WIDTHS });
    const half = POSTER_FRAME.stroke / 2;
    expect(frame.x - half).toBeCloseTo(7, 9);
    expect(frame.y - half).toBeCloseTo(7, 9);
    expect(A4_MM.width - (frame.x + frame.width + half)).toBeCloseTo(7, 9);
    expect(A4_MM.height - (frame.y + frame.height + half)).toBeCloseTo(7, 9);
  });

  for (const modules of [21, 25, 29, 33, 37, 45, 57]) {
    for (const leadLines of [1, 2, 3]) {
      it(`keeps everything inside the frame, in order and apart — ${modules} modules, the lead in ${leadLines} line(s)`, () => {
        const layout = posterLayout({ modules, leadLines, logoAspect: LOCKUP, ...WIDTHS });
        const room = inner(layout.frame);
        const parts: Array<[string, Box]> = [
          ["logo", layout.logo],
          ["kicker", layout.kicker.box],
          ["button", layout.button],
          ["word", layout.word.box],
          ["lead", layout.lead.box],
          ["card", layout.card],
          ["tab", layout.tab.box],
          ["scan", layout.scan.box],
          ["address", layout.address.box],
          ["tags", layout.tags.box],
        ];
        for (const [name, box] of parts) expect(contains(room, box), name).toBe(true);
        // Top to bottom in the approved order: each row starts below the one before it ends.
        const rows = [layout.logo, layout.kicker.box, layout.button, layout.lead.box, layout.tab.box, layout.scan.box, layout.address.box, layout.tags.box];
        for (let index = 1; index < rows.length; index += 1) expect(rows[index].y, `row ${index}`).toBeGreaterThanOrEqual(rows[index - 1].y + rows[index - 1].height);
        expect(overlaps(layout.button, layout.word.box)).toBe(false);
        expect(contains(layout.button, layout.triangle)).toBe(true);
        // The card below the lead and above the scan line, the tab on its top edge.
        expect(layout.card.y).toBeGreaterThan(layout.lead.box.y + layout.lead.box.height);
        expect(layout.tab.box.y).toBeLessThan(layout.card.y);
        expect(layout.tab.box.y + layout.tab.box.height).toBeGreaterThan(layout.card.y);
      });
    }

    it(`keeps the code's ${QUIET_ZONE_MODULES}-module quiet zone clear of the card's border and its tab — ${modules} modules`, () => {
      const layout = posterLayout({ modules, leadLines: 2, logoAspect: LOCKUP, ...WIDTHS });
      const border = 1.4;
      const inside: Box = { x: layout.card.x + border, y: layout.card.y + border, width: layout.card.width - 2 * border, height: layout.card.height - 2 * border };
      const zone = quietZone(layout.code, modules);
      expect(contains(inside, zone)).toBe(true);
      expect(overlaps(zone, layout.tab.box)).toBe(false);
      // As large as the zone lets it be: the zone meets the card's sides.
      expect(zone.width).toBeCloseTo(inside.width, 6);
      expect(layout.code.width).toBeCloseTo(layout.code.height, 9);
    });
  }

  it("draws a channel address's code about 90 mm wide, as the approved poster's ~94 mm left it its zone", () => {
    expect(posterLayout({ modules: 33, leadLines: 2, logoAspect: LOCKUP, ...WIDTHS }).code.width).toBeCloseTo(90.15, 1);
    expect(posterLayout({ modules: 29, leadLines: 2, logoAspect: LOCKUP, ...WIDTHS }).code.width).toBeGreaterThan(87);
  });

  it("centres the button and the word together, and the tab on the card", () => {
    const layout = posterLayout({ modules: 33, leadLines: 2, logoAspect: LOCKUP, ...WIDTHS });
    const left = layout.button.x;
    const right = layout.word.box.x + layout.word.box.width;
    expect((left + right) / 2).toBeCloseTo(A4_MM.width / 2, 9);
    expect(layout.tab.box.x + layout.tab.box.width / 2).toBeCloseTo(layout.card.x + layout.card.width / 2, 9);
    expect(layout.code.x + layout.code.width / 2).toBeCloseTo(A4_MM.width / 2, 9);
  });
});
