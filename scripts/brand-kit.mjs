/**
 * The «PR Kit»'s logo files (§1015): the club's lockup and its mountains alone, each in the palette's primary, in white
 * and in black, as an SVG with a measured margin and an explicit size — so no viewer clips the lockup's last letter, as
 * a frame drawn tight to the artwork lets Word, Canva and some print shops' tools do. `scripts/brand-assets.mjs`
 * writes them, and a PNG of each, into `public/brand/kit/`; `brand-assets-lock.mjs` locks their sha256 beside the
 * sources'; the backoffice's «PR Kit» hands them out and draws the same paths into its PDFs with pdfkit.
 *
 * **Measured, never guessed.** The drawing's box is read from the path data itself — every segment's end points and
 * every curve's and arc's extremes, under the group's translation — so it is exact to the unit, where a raster's edge
 * is not. The margin is 4 % of the drawing's width on every side.
 *
 * **The mountains are the paths the mark's own frame shows whole**: `club.json`'s `logo.mark.viewBox` is the lockup's
 * frame with the words cut off (§885), so the paths whose measured box lies inside it are the drawing without its
 * words — for this club the first path alone, the runners under it falling a unit outside. A club's own lockup brings
 * its own mark's frame, and the rule picks its own mountains.
 *
 * Plain JavaScript, so the script runs without a compiler and the tests import the very functions it ran
 * (`tests/unit/theme/brand-kit.test.ts`).
 */

/** Where the kit's files are written, repository-relative. */
export const KIT_DIR = "public/brand/kit";
/** Every file's printed width: the size a viewer opens it at, and a 4000-pixel PNG at 508 dots to the inch. */
export const KIT_WIDTH_MM = 200;
/** The margin around the measured drawing, as a share of its width, on all four sides. */
export const KIT_MARGIN = 0.04;
/** The PNG's width in pixels: about 34 cm on paper at 300 dots to the inch. */
export const KIT_PNG_WIDTH = 4000;

/** The two shapes, by the word their files carry. */
export const KIT_SHAPES = [
  { key: "lockup", word: "logo" },
  { key: "mountains", word: "mountains" },
];

/** White and black are the platform's (a white logo on a dark ground, one ink for a stamp); the primary is the club's. */
export function kitColours(palette) {
  return [
    { key: "primary", hex: palette.primary.toLowerCase() },
    { key: "white", hex: "#ffffff" },
    { key: "black", hex: "#000000" },
  ];
}

/** A kit file's name: the club's slug first, so a download says whose logo it is — `<slug>-logo-primary.svg`. */
export function kitFileName(slug, shape, colour, format) {
  const word = KIT_SHAPES.find((candidate) => candidate.key === shape)?.word;
  if (!word) throw new Error(`brand-kit: no shape "${shape}"`);
  return `${slug}-${word}-${colour}${format === "png" ? `-${KIT_PNG_WIDTH}px` : ""}.${format}`;
}

/** Every file the kit holds, in a stable order: two shapes × three colours × SVG and PNG. */
export function kitFiles(slug) {
  return KIT_SHAPES.flatMap(({ key: shape }) =>
    ["primary", "white", "black"].flatMap((colour) => ["svg", "png"].map((format) => ({ shape, colour, format, name: kitFileName(slug, shape, colour, format) }))),
  );
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/**
 * A path's data as commands and numbers. Arc flags are single digits that may stand glued to what follows
 * («a1 1 0 011 1»), so the reader is told when a flag is expected.
 */
function reader(d) {
  let at = 0;
  const skip = () => {
    while (at < d.length && /[\s,]/.test(d[at])) at += 1;
  };
  return {
    done() {
      skip();
      return at >= d.length;
    },
    command() {
      skip();
      return /[a-zA-Z]/.test(d[at] ?? "") ? d[at++] : null;
    },
    number() {
      skip();
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(d);
      if (!match) throw new Error(`brand-kit: a number expected at ${at} of a path`);
      at = NUMBER.lastIndex;
      return Number(match[0]);
    },
    flag() {
      skip();
      const char = d[at];
      if (char !== "0" && char !== "1") throw new Error(`brand-kit: an arc flag expected at ${at} of a path`);
      at += 1;
      return char === "1" ? 1 : 0;
    },
  };
}

/** The parameters in (0, 1) where a cubic Bézier coordinate turns: the roots of its derivative. */
function cubicTurns(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

const cubicAt = (t, p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
const quadAt = (t, p0, p1, p2) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

/** The angle from one vector to another, in radians, signed. */
const angleBetween = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

/**
 * An elliptical arc's extreme points (SVG 1.1 appendix F.6.5: from its end points to its centre), for the box: the
 * angles where x or y turns, kept when the arc sweeps through them.
 */
function arcExtremes(x1, y1, rxIn, ryIn, rotationDegrees, largeArc, sweep, x2, y2) {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [];
  const phi = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const start = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const at = (theta) => [cx + rx * cos * Math.cos(theta) - ry * sin * Math.sin(theta), cy + rx * sin * Math.cos(theta) + ry * cos * Math.sin(theta)];
  const turnX = Math.atan2(-ry * sin, rx * cos);
  const turnY = Math.atan2(ry * cos, rx * sin);
  const candidates = [turnX, turnX + Math.PI, turnY, turnY + Math.PI];
  const swept = (theta) => {
    const turn = 2 * Math.PI;
    // How far along the sweep the angle lies, in the sweep's own direction.
    const along = delta >= 0 ? (((theta - start) % turn) + turn) % turn : (((start - theta) % turn) + turn) % turn;
    return along <= Math.abs(delta);
  };
  return candidates.filter(swept).map(at);
}

/**
 * A path's exact box in its own units: `[x0, y0, x1, y1]`. Every command of SVG path data — moves, lines, the two
 * Béziers and their smooth forms, arcs — absolute or relative.
 */
export function pathBounds(d) {
  const read = reader(d);
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for a smooth curve's reflection: the cubic's second, the quadratic's one.
  let cubicControl = null;
  let quadControl = null;
  let command = null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (px, py) => {
    box[0] = Math.min(box[0], px);
    box[1] = Math.min(box[1], py);
    box[2] = Math.max(box[2], px);
    box[3] = Math.max(box[3], py);
  };
  while (!read.done()) {
    const next = read.command();
    if (next !== null) command = next;
    else if (command === null) throw new Error("brand-kit: a path must start with a command");
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toLowerCase()) {
      case "m": {
        x = ox + read.number();
        y = oy + read.number();
        startX = x;
        startY = y;
        add(x, y);
        // Further pairs after a move are lines.
        command = relative ? "l" : "L";
        cubicControl = quadControl = null;
        break;
      }
      case "l":
        x = ox + read.number();
        y = oy + read.number();
        add(x, y);
        cubicControl = quadControl = null;
        break;
      case "h":
        x = ox + read.number();
        add(x, y);
        cubicControl = quadControl = null;
        break;
      case "v":
        y = oy + read.number();
        add(x, y);
        cubicControl = quadControl = null;
        break;
      case "c":
      case "s": {
        let c1x;
        let c1y;
        if (command.toLowerCase() === "c") {
          c1x = ox + read.number();
          c1y = oy + read.number();
        } else {
          [c1x, c1y] = cubicControl ? [2 * x - cubicControl[0], 2 * y - cubicControl[1]] : [x, y];
        }
        const c2x = ox + read.number();
        const c2y = oy + read.number();
        const ex = ox + read.number();
        const ey = oy + read.number();
        for (const t of [...cubicTurns(x, c1x, c2x, ex), ...cubicTurns(y, c1y, c2y, ey)]) add(cubicAt(t, x, c1x, c2x, ex), cubicAt(t, y, c1y, c2y, ey));
        add(ex, ey);
        cubicControl = [c2x, c2y];
        quadControl = null;
        x = ex;
        y = ey;
        break;
      }
      case "q":
      case "t": {
        let cx;
        let cy;
        if (command.toLowerCase() === "q") {
          cx = ox + read.number();
          cy = oy + read.number();
        } else {
          [cx, cy] = quadControl ? [2 * x - quadControl[0], 2 * y - quadControl[1]] : [x, y];
        }
        const ex = ox + read.number();
        const ey = oy + read.number();
        for (const [p0, p1, p2] of [
          [x, cx, ex],
          [y, cy, ey],
        ]) {
          const denominator = p0 - 2 * p1 + p2;
          if (Math.abs(denominator) > 1e-12) {
            const t = (p0 - p1) / denominator;
            if (t > 0 && t < 1) add(quadAt(t, x, cx, ex), quadAt(t, y, cy, ey));
          }
        }
        add(ex, ey);
        quadControl = [cx, cy];
        cubicControl = null;
        x = ex;
        y = ey;
        break;
      }
      case "a": {
        const rx = read.number();
        const ry = read.number();
        const rotation = read.number();
        const largeArc = read.flag();
        const sweep = read.flag();
        const ex = ox + read.number();
        const ey = oy + read.number();
        for (const [px, py] of arcExtremes(x, y, rx, ry, rotation, largeArc, sweep, ex, ey)) add(px, py);
        add(ex, ey);
        cubicControl = quadControl = null;
        x = ex;
        y = ey;
        break;
      }
      case "z":
        x = startX;
        y = startY;
        cubicControl = quadControl = null;
        break;
      default:
        throw new Error(`brand-kit: unknown path command "${command}"`);
    }
  }
  if (!Number.isFinite(box[0])) throw new Error("brand-kit: a path that draws nothing");
  return box;
}

const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * The lockup's source as the kit reads it: its paths' data and fill rules, under at most one group translation —
 * the shape Inkscape gives this club's file. Anything else (a path or group transform that is not that one
 * translation, a nested group) is refused by name rather than measured wrong.
 */
export function parseLogoSvg(text) {
  const groups = [...text.matchAll(/<g\b[^>]*>/g)].map((match) => match[0]);
  if (groups.length > 1) throw new Error("brand-kit: the lockup must hold its paths in at most one <g>");
  let translate = [0, 0];
  const groupTransform = groups[0] ? attribute(groups[0], "transform") : undefined;
  if (groupTransform !== undefined) {
    const match = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)\s*$/.exec(groupTransform);
    if (!match) throw new Error(`brand-kit: the lockup's group transform must be one translate(…); got "${groupTransform}"`);
    translate = [Number(match[1]), Number(match[2] ?? 0)];
  }
  const paths = [...text.matchAll(/<path\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    if (attribute(tag, "transform") !== undefined) throw new Error("brand-kit: a path of the lockup carries its own transform");
    const d = attribute(tag, "d");
    if (!d) throw new Error("brand-kit: a path of the lockup has no data");
    const rule = attribute(tag, "fill-rule") ?? /fill-rule:\s*(evenodd|nonzero)/.exec(attribute(tag, "style") ?? "")?.[1] ?? "nonzero";
    return { d, fillRule: rule === "evenodd" ? "evenodd" : "nonzero" };
  });
  if (paths.length === 0) throw new Error("brand-kit: the lockup has no paths");
  return { translate, transform: groupTransform ?? null, paths };
}

/** A box `[x0, y0, x1, y1]` holding both. */
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/**
 * The two drawings, measured: each path's box under the group's translation, the lockup the union of them all, the
 * mountains the union of the paths `markViewBox` (`"x y width height"`, the mark's frame) shows whole.
 */
export function measureLogo(source, markViewBox) {
  const [tx, ty] = source.translate;
  const boxes = source.paths.map(({ d }) => {
    const [x0, y0, x1, y1] = pathBounds(d);
    return [x0 + tx, y0 + ty, x1 + tx, y1 + ty];
  });
  const [mx, my, mw, mh] = markViewBox.trim().split(/[\s,]+/).map(Number);
  const inside = boxes.map((box, index) => (box[0] >= mx && box[1] >= my && box[2] <= mx + mw && box[3] <= my + mh ? index : -1)).filter((index) => index >= 0);
  if (inside.length === 0) throw new Error(`brand-kit: no path of the lockup lies inside the mark's frame "${markViewBox}"`);
  const all = boxes.map((_, index) => index);
  return {
    lockup: { paths: all, drawing: all.map((index) => boxes[index]).reduce(union) },
    mountains: { paths: inside, drawing: inside.map((index) => boxes[index]).reduce(union) },
    boxes,
  };
}

/** A number as an attribute writes it: at most three decimals, no trailing zeros. */
const decimal = (value, places = 3) => String(Number(value.toFixed(places)));

/** The frame around a drawing: 4 % of its width on every side, `[x, y, width, height]`. */
export function paddedFrame(drawing) {
  const [x0, y0, x1, y1] = drawing;
  const margin = (x1 - x0) * KIT_MARGIN;
  return [x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin];
}

/**
 * The same SVG sized in pixels, `width` wide, for the PNG: a renderer turns millimetres into pixels by its own rules
 * (sharp 0.35's librsvg applied the density twice to a size in mm), and a size in pixels it draws as written.
 */
export function inPixels(svg, width) {
  const [, , frameWidth, frameHeight] = /viewBox="([^"]+)"/.exec(svg)[1].split(" ").map(Number);
  return svg.replace(/ width="[^"]+" height="[^"]+"/, ` width="${width}" height="${Math.round((width * frameHeight) / frameWidth)}"`);
}

/**
 * One kit SVG: the shape's paths in one colour, the frame 4 % outside the measured drawing, 200 mm wide and as tall as
 * the frame's proportion — written the same way every time, so its hash moves only when the artwork or the colour does.
 */
export function kitSvg(source, measured, shape, hex) {
  const { paths } = measured[shape];
  const frame = paddedFrame(measured[shape].drawing);
  const heightMm = (KIT_WIDTH_MM * frame[3]) / frame[2];
  const body = paths
    .map((index) => {
      const { d, fillRule } = source.paths[index];
      return `    <path${fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""} d="${d}"/>`;
    })
    .join("\n");
  const open = source.transform === null ? `  <g fill="${hex}">` : `  <g transform="${source.transform}" fill="${hex}">`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${KIT_WIDTH_MM}mm" height="${decimal(heightMm, 2)}mm" viewBox="${frame.map((value) => decimal(value)).join(" ")}">`,
    open,
    body,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}
