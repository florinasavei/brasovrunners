/**
 * Points along an SVG path's outline — enough to measure how far a drawn glyph reaches from its centre (§824). Reads the commands
 * the elevation glyphs use (M L H V C A and their lowercase forms, Z) and walks every curve and arc in small steps, arcs by the
 * standard endpoint-to-centre conversion with no rotation, so an arc's own extreme counts, not only its ends.
 */
export type PathPoint = readonly [number, number];

const STEPS = 48;

function arcPoints(from: PathPoint, rxIn: number, ryIn: number, large: number, sweep: number, to: PathPoint): PathPoint[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  if (rxIn === 0 || ryIn === 0 || (x1 === x2 && y1 === y2)) return [to];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const denominator = rx * rx * dy * dy + ry * ry * dx * dx;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * dy) / ry;
  const cyp = (-factor * ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const start = Math.atan2((dy - cyp) / ry, (dx - cxp) / rx);
  let delta = Math.atan2((-dy - cyp) / ry, (-dx - cxp) / rx) - start;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return Array.from({ length: STEPS }, (_, i): PathPoint => {
    const angle = start + (delta * (i + 1)) / STEPS;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

export function svgPathPoints(path: string): PathPoint[] {
  const tokens = path.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const points: PathPoint[] = [];
  let at: PathPoint = [0, 0];
  let begin: PathPoint = [0, 0];
  let command = "";
  let i = 0;
  const number = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const [ox, oy] = relative ? at : [0, 0];
    if (upper === "Z") {
      at = begin;
      points.push(at);
      continue;
    }
    if (upper === "M" || upper === "L") {
      at = [ox + number(), oy + number()];
      if (upper === "M") begin = at;
      points.push(at);
      // Further pairs after a moveto are linetos.
      if (upper === "M") command = relative ? "l" : "L";
    } else if (upper === "H") {
      at = [ox + number(), at[1]];
      points.push(at);
    } else if (upper === "V") {
      at = [at[0], oy + number()];
      points.push(at);
    } else if (upper === "C") {
      const p1: PathPoint = [ox + number(), oy + number()];
      const p2: PathPoint = [ox + number(), oy + number()];
      const p3: PathPoint = [ox + number(), oy + number()];
      for (let step = 1; step <= STEPS; step++) {
        const t = step / STEPS;
        const u = 1 - t;
        points.push([
          u * u * u * at[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * at[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      at = p3;
    } else if (upper === "A") {
      const rx = number();
      const ry = number();
      number(); // x-axis rotation: the glyphs have none
      const large = number();
      const sweep = number();
      const to: PathPoint = [ox + number(), oy + number()];
      points.push(...arcPoints(at, rx, ry, large, sweep, to));
      at = to;
    } else {
      throw new Error(`svgPathPoints does not read the command «${command}»`);
    }
  }
  return points;
}

/** The farthest any point of the path's outline stands from (0, 0). */
export function maxRadius(path: string): number {
  return Math.max(...svgPathPoints(path).map(([x, y]) => Math.hypot(x, y)));
}
