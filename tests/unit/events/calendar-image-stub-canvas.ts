/**
 * A `CanvasRenderingContext2D` for «Salvează ca imagine» (§855) that paints nothing and remembers where every
 * text, box and line went, so `calendar-image-overflow.test.ts` can draw the month in Node and ask whether a
 * text left its box or met another.
 *
 * Its `measureText` is a width per character class times the font's size — not Poppins's widths, and it need
 * not be: the layouts fit their words with the same measure, so what the stub records is what they meant to
 * draw. Vertically a text stands 0.72 em over its baseline (Poppins's capitals, the figure the layouts centre
 * with) and, when it has a descender (g, p, ș, a comma…), 0.22 em under it — a bare overshoot otherwise, so a
 * day's number does not «meet» the word under it when no ink does.
 */

/** Touching is not crossing: an edge or another text has to pass more than this far into a text. */
export const TOLERANCE = 0.5;

export type Extent = { left: number; top: number; right: number; bottom: number };
export type TextRecord = Extent & {
  kind: "text";
  text: string;
  font: string;
  /** The font's size in device pixels. */
  size: number;
  baseline: number;
  /** Drawn letter by letter (`fillSpaced`, `fillTracked`), and so open to the next letter. */
  spaced: boolean;
  /** Where the last letter's advance ended, spaces included, for the next letter to join. */
  rawRight: number;
  order: number;
};
export type BoxRecord = Extent & { kind: "box"; how: "roundRect" | "rect" | "fillRect" | "image"; filled: boolean; stroked: boolean; order: number };
export type SegmentRecord = { kind: "segment"; x1: number; y1: number; x2: number; y2: number; order: number };

/** The width of one character in ems. */
function charEm(char: string): number {
  if (char === "…") return 0.9;
  if (/\p{Lu}/u.test(char)) return 0.68;
  if (/\p{Ll}/u.test(char)) return 0.52;
  if (/\p{Nd}/u.test(char)) return 0.6;
  if (char === " " || char === " ") return 0.28;
  if (/\p{M}/u.test(char)) return 0;
  return 0.3;
}

/** `text`'s advance at `size` pixels and `weight`: the per-character table, a heavier face a little wider, no kerning. */
export function textWidth(text: string, size: number, weight = 400): number {
  return [...text].reduce((sum, char) => sum + charEm(char), 0) * size * (1 + (Math.max(400, weight) - 400) / 500 * 0.15);
}

const DESCENDERS = /[gjpqyșțȘȚ,;()[\]{}@]/u;
const ASCENT = 0.72;
const descentOf = (text: string) => (DESCENDERS.test(text) ? 0.22 : 0.04);
const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
const weightOf = (font: string) => (/\bbold\b/i.test(font) ? 700 : Number(/(?:^|\s)([1-9]00)\s/.exec(font)?.[1] ?? 400));

/** A 2D affine transform, as the canvas keeps it: [a, b, c, d, e, f]. */
type Matrix = [number, number, number, number, number, number];
type Point = { x: number; y: number };
type State = {
  m: Matrix;
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineWidth: number;
  globalAlpha: number;
};
type Path = { boxes: BoxRecord[]; segments: { from: Point; to: Point }[]; at: Point | null };

/** The canvas's own `Path2D`, which Node lacks: the drawing fills glyphs and mountains through it, and they are not text. */
class Path2DStub {
  constructor(readonly d?: string) {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= Path2DStub;

export class StubContext {
  readonly texts: TextRecord[] = [];
  readonly boxes: BoxRecord[] = [];
  readonly segments: SegmentRecord[] = [];
  private order = 0;
  private stack: State[] = [];
  private state: State = { m: [1, 0, 0, 1, 0, 0], font: "10px sans-serif", fillStyle: "#000", strokeStyle: "#000", textAlign: "start", textBaseline: "alphabetic", lineWidth: 1, globalAlpha: 1 };
  private path: Path = { boxes: [], segments: [], at: null };

  get font() {
    return this.state.font;
  }
  set font(value: string) {
    this.state.font = value;
  }
  get fillStyle() {
    return this.state.fillStyle;
  }
  set fillStyle(value: unknown) {
    this.state.fillStyle = value;
  }
  get strokeStyle() {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: unknown) {
    this.state.strokeStyle = value;
  }
  get textAlign() {
    return this.state.textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.state.textAlign = value;
  }
  get textBaseline() {
    return this.state.textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.state.textBaseline = value;
  }
  get lineWidth() {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get globalAlpha() {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }

  save() {
    this.stack.push({ ...this.state, m: [...this.state.m] });
  }
  restore() {
    const state = this.stack.pop();
    if (state) this.state = state;
  }
  translate(x: number, y: number) {
    const [a, b, c, d] = this.state.m;
    this.state.m[4] += a * x + c * y;
    this.state.m[5] += b * x + d * y;
  }
  scale(x: number, y: number) {
    const m = this.state.m;
    m[0] *= x;
    m[1] *= x;
    m[2] *= y;
    m[3] *= y;
  }
  rotate(angle: number) {
    const [a, b, c, d, e, f] = this.state.m;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.state.m = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.state.m = [a, b, c, d, e, f];
  }
  resetTransform() {
    this.state.m = [1, 0, 0, 1, 0, 0];
  }
  private point(x: number, y: number): Point {
    const [a, b, c, d, e, f] = this.state.m;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }
  /** A user-space rectangle in device space, as the box around its corners. */
  private extent(x: number, y: number, w: number, h: number): Extent {
    const corners = [this.point(x, y), this.point(x + w, y), this.point(x, y + h), this.point(x + w, y + h)];
    return {
      left: Math.min(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      right: Math.max(...corners.map((p) => p.x)),
      bottom: Math.max(...corners.map((p) => p.y)),
    };
  }

  beginPath() {
    this.path = { boxes: [], segments: [], at: null };
  }
  closePath() {}
  moveTo(x: number, y: number) {
    this.path.at = this.point(x, y);
  }
  lineTo(x: number, y: number) {
    const to = this.point(x, y);
    if (this.path.at) this.path.segments.push({ from: this.path.at, to });
    this.path.at = to;
  }
  private addBox(how: BoxRecord["how"], x: number, y: number, w: number, h: number): BoxRecord {
    const box: BoxRecord = { kind: "box", how, filled: false, stroked: false, order: this.order++, ...this.extent(x, y, w, h) };
    this.boxes.push(box);
    return box;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.boxes.push(this.addBox("rect", x, y, w, h));
  }
  roundRect(x: number, y: number, w: number, h: number) {
    this.path.boxes.push(this.addBox("roundRect", x, y, w, h));
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.addBox("fillRect", x, y, w, h).filled = true;
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.addBox("rect", x, y, w, h).stroked = true;
  }
  clearRect() {}
  /** With a `Path2D` (a glyph, the mountains) nothing is recorded: those are shapes, not text, and have no box. */
  fill(path?: unknown) {
    if (typeof path === "object") return;
    for (const box of this.path.boxes) box.filled = true;
  }
  stroke(path?: unknown) {
    if (typeof path === "object") return;
    for (const box of this.path.boxes) box.stroked = true;
    for (const { from, to } of this.path.segments) this.segments.push({ kind: "segment", x1: from.x, y1: from.y, x2: to.x, y2: to.y, order: this.order++ });
  }
  clip() {}
  /** An image (the logo) is opaque where it lands: its box, filled. */
  drawImage(_image: unknown, ...rest: number[]) {
    const [x, y, w, h] = rest.length >= 8 ? rest.slice(4, 8) : rest.length >= 4 ? rest : [rest[0] ?? 0, rest[1] ?? 0, 0, 0];
    this.addBox("image", x, y, w, h).filled = true;
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
  measureText(text: string) {
    return { width: textWidth(text, sizeOf(this.state.font), weightOf(this.state.font)) } as TextMetrics;
  }
  strokeText(text: string, x: number, y: number) {
    this.fillText(text, x, y);
  }
  fillText(text: string, x: number, y: number) {
    const size = sizeOf(this.state.font);
    const weight = weightOf(this.state.font);
    const width = textWidth(text, size, weight);
    const { textAlign, textBaseline } = this.state;
    const left = textAlign === "center" ? x - width / 2 : textAlign === "right" || textAlign === "end" ? x - width : x;
    const baseline =
      textBaseline === "top" || textBaseline === "hanging" ? y + ASCENT * size : textBaseline === "middle" ? y + (ASCENT * size) / 2 : textBaseline === "bottom" || textBaseline === "ideographic" ? y - descentOf(text) * size : y;
    // The ink: the text without the spaces at its ends.
    const chars = [...text];
    const first = chars.findIndex((char) => char.trim() !== "");
    const last_ = chars.length - [...chars].reverse().findIndex((char) => char.trim() !== "");
    const leading = first < 0 ? 0 : textWidth(chars.slice(0, first).join(""), size, weight);
    const trailing = first < 0 ? 0 : textWidth(chars.slice(last_).join(""), size, weight);
    const ink = first < 0 ? null : this.extent(left + leading, baseline - ASCENT * size, width - leading - trailing, (ASCENT + descentOf(text)) * size);
    const raw = this.extent(left, baseline, width, 0);
    // A word drawn letter by letter is one text: each letter joins the one before it on the same baseline when
    // less than 0.6 em apart, so a tracked «EVENIMENTE» is checked, and reported, as a word.
    const last = this.texts[this.texts.length - 1];
    const single = chars.length === 1;
    if (single && last?.spaced && last.font === this.state.font && Math.abs(last.baseline - raw.top) < TOLERANCE && raw.left >= last.rawRight - TOLERANCE && raw.left - last.rawRight < 0.6 * last.size) {
      last.text += text;
      last.rawRight = raw.right;
      if (ink) {
        last.right = Math.max(last.right, ink.right);
        last.top = Math.min(last.top, ink.top);
        last.bottom = Math.max(last.bottom, ink.bottom);
      }
      return;
    }
    if (!ink) return;
    this.texts.push({ kind: "text", text, font: this.state.font, size: size * Math.abs(this.state.m[0]), baseline: raw.top, spaced: single, rawRight: raw.right, order: this.order++, ...ink });
  }
}

/** A stub context, typed as the canvas's own, and its records. */
export function stubCanvas(): { ctx: CanvasRenderingContext2D; records: StubContext } {
  const records = new StubContext();
  return { ctx: records as unknown as CanvasRenderingContext2D, records };
}

const round = (value: number) => Math.round(value * 10) / 10;
const span = (extent: Extent) => `x ${round(extent.left)}–${round(extent.right)} · y ${round(extent.top)}–${round(extent.bottom)}`;
const labelOf = (item: TextRecord | BoxRecord | SegmentRecord) => {
  if (item.kind === "text") return `«${item.text}» (${/^(.*?\d+(?:\.\d+)?px)/.exec(item.font)?.[1] ?? item.font}, ${span(item)})`;
  if (item.kind === "box") return `the ${item.how} (${span(item)})`;
  return item.x1 === item.x2 ? `the line x ${round(item.x1)} · y ${round(Math.min(item.y1, item.y2))}–${round(Math.max(item.y1, item.y2))}` : `the line y ${round(item.y1)} · x ${round(Math.min(item.x1, item.x2))}–${round(Math.max(item.x1, item.x2))}`;
};

/** Whether the two extents share more than a touch. */
export function intersects(a: Extent, b: Extent): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOLERANCE && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOLERANCE;
}

/** Whether a segment passes through the extent's inside (not along its edge, not past a corner). */
function crosses(text: Extent, x1: number, y1: number, x2: number, y2: number): boolean {
  if (x1 === x2) return x1 > text.left + TOLERANCE && x1 < text.right - TOLERANCE && Math.min(Math.max(y1, y2), text.bottom) - Math.max(Math.min(y1, y2), text.top) > TOLERANCE;
  if (y1 === y2) return y1 > text.top + TOLERANCE && y1 < text.bottom - TOLERANCE && Math.min(Math.max(x1, x2), text.right) - Math.max(Math.min(x1, x2), text.left) > TOLERANCE;
  // A slanted line, which the picture never draws: its box, to be safe.
  return intersects(text, { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) });
}

/** The edges of `box` that pass through `text`: a text lies wholly inside or wholly outside a box, or it overflowed. */
function crossedEdges(text: Extent, box: Extent): string[] {
  const edges: [string, number, number, number, number][] = [
    ["left", box.left, box.top, box.left, box.bottom],
    ["right", box.right, box.top, box.right, box.bottom],
    ["top", box.left, box.top, box.right, box.top],
    ["bottom", box.left, box.bottom, box.right, box.bottom],
  ];
  return edges.filter(([, x1, y1, x2, y2]) => crosses(text, x1, y1, x2, y2)).map(([name]) => name);
}

const contains = (box: Extent, text: Extent) => box.left <= text.left + TOLERANCE && box.right >= text.right - TOLERANCE && box.top <= text.top + TOLERANCE && box.bottom >= text.bottom - TOLERANCE;

/**
 * Every text that overflowed in what `records` drew on a `width`×`height` canvas, one line each: a text that
 * leaves the canvas, two texts that meet, a text across the edge of a box or a grid line (it belongs wholly
 * inside or wholly outside), and a text a box was filled over after it was drawn — covered is still a defect.
 */
export function overflowsOf(records: StubContext, width: number, height: number): string[] {
  const failures: string[] = [];
  const canvas: Extent = { left: 0, top: 0, right: width, bottom: height };
  for (const text of records.texts) {
    if (!contains(canvas, text)) failures.push(`${labelOf(text)} leaves the ${width}×${height} canvas`);
    for (const other of records.texts) if (other.order > text.order && intersects(text, other)) failures.push(`${labelOf(text)} meets ${labelOf(other)}`);
    for (const box of records.boxes) {
      const edges = crossedEdges(text, box);
      if (edges.length > 0) failures.push(`${labelOf(text)} crosses the ${edges.join(" and ")} edge of ${labelOf(box)}`);
      else if (box.filled && box.order > text.order && contains(box, text)) failures.push(`${labelOf(text)} is covered by ${labelOf(box)} filled after it`);
    }
    for (const segment of records.segments) if (crosses(text, segment.x1, segment.y1, segment.x2, segment.y2)) failures.push(`${labelOf(text)} crosses ${labelOf(segment)}`);
  }
  return failures;
}
