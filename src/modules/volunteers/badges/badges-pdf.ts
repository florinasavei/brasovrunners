import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { pictureDrawingIn } from "@/modules/registrations/bib-picture-frame";
import { CLUB_NAME, COLOR } from "@/theme/brand";
import {
  type BadgeDesign,
  type BadgeFaceRole,
  type BadgeLocale,
  type BadgeWords,
  badgeBandColour,
  badgeLayoutWords,
  badgeNoRoleColour,
  badgePhoneRow,
  badgeRoleColour,
  badgeTextOn,
} from "./badge-design";
import { BADGE_LAYOUT, BADGE_PAGE_MARGIN, type BadgeLayout, badgeLayout, badgePaper, badgeSheetGrid, badgeSheetSlots } from "./badge-geometry";

/**
 * The volunteer badges as a sheet to print (§764): every badge one strip of the club's size, packed
 * edge to edge on A4 portrait pages (`badgeSheetGrid`), a dashed hairline on every cut and — with the
 * design's «Semne de tăiere» — a short solid mark in the page's margin at each end of every cut, what a
 * guillotine is lined up on (the bib's §249 marks).
 *
 * **Printed per role, never per person**: the caller hands one entry per role with how many of its
 * badges to print (spares included) and the badges «fără rol», which say «VOLUNTAR» alone. No name, no
 * address, no telephone of a volunteer is ever an input here: the name is written by hand at the desk.
 *
 * Drawn at `badge-geometry.ts`'s points, as the picture (`badge-image.tsx`) draws them: the header band
 * in its colour or the club's picture across it (the crop drawn by the bib's rule, `pictureDrawingIn`),
 * the logo as its file is — blue on its own white ground, never recoloured — the role's band with its
 * words in white or ink, whichever reads on it (the role's category among them, §962), the free-text line
 * (§776), the writing area — with the marker's area beside «Nume:» when the club ticks it — and the
 * telephone. With «Logo-ul clubului jos, ca filigran» (§965) the same lockup, pale, at the writing area's foot, under its words.
 * Every line was fitted by the layout, from the words the picture takes too
 * (`badgeLayoutWords`); each is handed to pdfkit with **no width**, so it cannot wrap (the bib's §317 lesson).
 */

/** One pile of the sheet: a role's badges, or (`role: null`) the badges «fără rol». */
export type BadgeSheetEntry = {
  /**
   * The role's name in the badge's language and its band's colour; null prints «VOLUNTAR» alone. `phone` is the telephone of its category's
   * contact person (§774): the coordinator's number of this role's badges while the design leaves its own empty (`badgePhoneLine`).
   * `category` is its category's name, the volunteer's type (§962): beside «VOLUNTAR», or under the role's name.
   */
  role: BadgeFaceRole | null;
  /** How many badges of it, spares included. */
  count: number;
  /**
   * «Ecusoane cu nume» (the hotfix of 2026-11-19, `badge-named.ts`): the word on these badges' band in place of the design's
   * («FOTOGRAF», «ORGANIZATOR»), on a badge with no role; absent, the design's word.
   */
  label?: string;
  /** «Ecusoane cu nume»: the first name printed large where «Nume:» and the marker's line would be; absent, «Nume:» as always. */
  printedName?: string;
  /** «Ecusoane cu nume»: the band's own colour, a hex triplet checked again here (`badgeRoleColour`); absent, the design's. */
  colour?: string;
};

/** One badge of the sheet, in print order. */
type BadgeSheetItem = Pick<BadgeSheetEntry, "role" | "label" | "printedName" | "colour">;

/** The badges of a sheet in print order, each with its own words: every pile in the order given. */
function badgeSheetItems(entries: readonly BadgeSheetEntry[]): BadgeSheetItem[] {
  return entries.flatMap((entry) =>
    Array.from({ length: Math.max(0, Math.floor(entry.count)) }, () => ({ role: entry.role, label: entry.label, printedName: entry.printedName, colour: entry.colour })),
  );
}

export type BadgeSheetInput = {
  design: BadgeDesign;
  locale: BadgeLocale;
  /** The badge's words in its language (`badge-design.ts#badgeWords`). */
  words: BadgeWords;
  entries: readonly BadgeSheetEntry[];
  /** The header's picture as PNG bytes, read by the caller (`bib-pictures.ts`); null prints the band. */
  headerPicture?: Buffer | null;
  /** For the file's own title. */
  eventTitle: string;
  generatedAt: Date;
};

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

/** The badges of a sheet in print order: every role's pile in the order given, then nothing else. */
export function badgeSheetOrder(entries: readonly BadgeSheetEntry[]): Array<BadgeSheetEntry["role"]> {
  return entries.flatMap((entry) => Array.from({ length: Math.max(0, Math.floor(entry.count)) }, () => entry.role));
}

export async function renderBadgeSheet(input: BadgeSheetInput): Promise<Buffer> {
  const { design, locale, words } = input;
  const L = BADGE_LAYOUT;
  const paper = badgePaper(design);
  const grid = badgeSheetGrid(paper);
  const badges = badgeSheetItems(input.entries);
  const slots = badgeSheetSlots(badges.length, paper);
  const band = badgeBandColour(design);
  const bandText = badgeTextOn(band);

  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo.png")),
  ]);
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    font: regular as unknown as string,
    // The file says how many badges it holds, in its own properties: what the printer is asked for, readable without opening it.
    info: { Title: `${input.eventTitle} — badges`, Subject: `${badges.length} badges`, Author: CLUB_NAME, CreationDate: input.generatedAt, ModDate: input.generatedAt },
  });
  doc.registerFont("body", regular);
  doc.registerFont("bold", bold);
  // Embedded once, drawn on every badge (the bib's reason: `doc.image(buffer)` copies the bytes each call).
  const embed = (doc as unknown as { openImage: (src: Buffer) => Buffer }).openImage.bind(doc);
  const lockup = embed(logo);
  const header = input.headerPicture ? embed(input.headerPicture) : null;

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const measure = { bold: bibTitleWidth, regular: bibFooterWidth };
  // Laid out once per role: every badge of a pile is the same badge. Keyed by everything the words hold, the category's name among them
  // (§962): «Direcționare» under two categories is two badges, never the first one's twice.
  const layouts = new Map<string, BadgeLayout>();
  const layoutFor = (item: BadgeSheetItem) => {
    const { role } = item;
    // «Ecusoane cu nume»: a badge's own word on its band, in place of the design's (the hotfix of 2026-11-19).
    const laid = badgeLayoutWords(design, item.label !== undefined ? { ...words, label: item.label } : words, locale, role);
    const key = role ? JSON.stringify(["role", laid.role, laid.phone, laid.category ?? null, laid.label]) : JSON.stringify(["none", laid.label]);
    let layout = layouts.get(key);
    if (!layout) {
      layout = badgeLayout({ ...design, showPhone: badgePhoneRow(design), headerPicture: header !== null }, laid, measure);
      layouts.set(key, layout);
    }
    return layout;
  };

  /** A line of text at its points, without a width: left-aligned at `x`. */
  const text = (font: "body" | "bold", line: { text: string; size: number; top: number }, x: number, y0: number, colour: string) => {
    doc.font(font).fontSize(line.size).fillColor(colour).text(line.text, x, y0 + line.top, { lineBreak: false });
  };
  const centredX = (font: "body" | "bold", line: { text: string; size: number }, left: number, width: number) => {
    doc.font(font).fontSize(line.size);
    return left + (width - doc.widthOfString(line.text)) / 2;
  };

  /**
   * «Ecusoane cu nume» (the hotfix of 2026-11-19): the first name in the writing area, bold and in ink, centred both ways, at the
   * largest size its width and half the area's height allow — one line, never wrapped, shrunk to fit and never cut.
   */
  const drawPrintedName = (name: string, layout: BadgeLayout, x: number, y: number) => {
    const width = layout.content.width - 2 * layout.pad;
    const ems = Math.max(bibTitleWidth(name), 0.01);
    const size = Math.max(6, Math.min(layout.writing.height * 0.5, width / ems));
    doc.font("bold").fontSize(size).fillColor(COLOR.ink);
    const left = x + layout.content.left + layout.pad + (width - doc.widthOfString(name)) / 2;
    const top = y + layout.writing.top + (layout.writing.height - size) / 2;
    doc.text(name, left, top, { lineBreak: false });
  };

  const drawBadge = (item: BadgeSheetItem, x: number, y: number) => {
    const { role } = item;
    const layout = layoutFor(item);
    const { content, pad } = layout;
    // The header: the club's picture across the band, or the band's colour with the logo and the title.
    if (header) {
      const box = { width: content.width, height: layout.header.height };
      const opened = header as unknown as { width?: number; height?: number };
      const size = opened.width && opened.height ? { width: opened.width, height: opened.height } : null;
      const drawing = pictureDrawingIn(box, box.width / box.height, "cover", design.headerImageCrop, size);
      const left = x + content.left;
      const top = y + layout.header.top;
      doc.save();
      doc.rect(left, top, box.width, box.height).clip();
      if (drawing.kind === "crop") doc.image(header, left + drawing.left, top + drawing.top, { width: drawing.width, height: drawing.height });
      else doc.image(header, left, top, { cover: [box.width, box.height], align: "center", valign: "center" });
      doc.restore();
    } else {
      doc.rect(x + content.left, y + layout.header.top, content.width, layout.header.height).fill(band);
    }
    if (layout.logo) {
      doc.image(lockup, x + layout.logo.left, y + layout.logo.top, { fit: [layout.logo.width, layout.logo.height], align: "center", valign: "center" });
    }
    if (layout.title) {
      doc.font("bold").fontSize(layout.title.size);
      text("bold", layout.title, x + layout.title.right - doc.widthOfString(layout.title.text), y, bandText);
    }
    // The role's band in its colour; «VOLUNTAR» small above the role's name, or alone and large.
    // A badge with no role wears the one badge's colour in `single` mode (§783), the club's orange in `perRole` mode (§764).
    // «Ecusoane cu nume»: a badge's own colour when its line named one (the hotfix of 2026-11-19), checked at AA like a role's.
    const roleColour = item.colour ? badgeRoleColour(item.colour) : role ? badgeRoleColour(role.colour) : badgeNoRoleColour(design);
    const roleText = badgeTextOn(roleColour);
    doc.rect(x + content.left, y + layout.role.top, content.width, layout.role.height).fill(roleColour);
    const bandWidth = content.width - 2 * pad;
    if (layout.label) text("bold", layout.label, centredX("bold", layout.label, x + content.left + pad, bandWidth), y, roleText);
    text("bold", layout.roleLine, centredX("bold", layout.roleLine, x + content.left + pad, bandWidth), y, roleText);
    // The role's category (§962), when the small line above could not hold it beside «VOLUNTAR»: its own small line under the name.
    if (layout.categoryLine) text("bold", layout.categoryLine, centredX("bold", layout.categoryLine, x + content.left + pad, bandWidth), y, roleText);
    // The free-text line (§776): the club's own words, small and centred under the role's band.
    if (layout.freeLine) text("body", layout.freeLine, centredX("body", layout.freeLine, x + content.left + pad, bandWidth), y, COLOR.ink);
    // «Logo-ul clubului jos, ca filigran» (§965): the lockup the header draws, pale, first in the writing area — «Nume:», the lines and the
    // marker's area go over it. Its opacity in a graphics state of its own, so nothing else is drawn pale. No ground of its own: the
    // raster's white falls on the white writing area, so only the logo shows.
    if (layout.footerLogo) {
      const mark = layout.footerLogo;
      doc.save();
      doc.opacity(mark.opacity);
      doc.image(lockup, x + mark.left, y + mark.top, { fit: [mark.width, mark.height], align: "center", valign: "center" });
      doc.restore();
    }
    // «Ecusoane cu nume»: the first name printed, and nothing to write on — no «Nume:», no line, no marker's area.
    if (item.printedName !== undefined) {
      if (item.printedName !== "") drawPrintedName(item.printedName, layout, x, y);
      if (layout.phoneLine) text("body", layout.phoneLine, centredX("body", layout.phoneLine, x + content.left + pad, bandWidth), y, COLOR.ink);
      return;
    }
    // The writing area: «Nume:», and the faint line the name is written on.
    text("body", layout.name, x + layout.name.left, y, COLOR.inkMuted);
    /** A faint hairline, as the writing line is: the name's, the marker's and the divider between them. */
    const faint = (x1: number, y1: number, x2: number, y2: number) => {
      doc.save();
      doc.moveTo(x + x1, y + y1).lineTo(x + x2, y + y2).lineWidth(L.lineWeight).strokeOpacity(L.lineOpacity).strokeColor(COLOR.inkMuted).stroke();
      doc.restore();
    };
    if (layout.line) faint(layout.line.left, layout.line.y, layout.line.right, layout.line.y);
    // «Spațiu pentru marker» (§776): a divider, the club's label and one faint line at the name's height. Blank: it is written at the desk.
    if (layout.marker) {
      faint(layout.marker.divider.x, layout.marker.divider.top, layout.marker.divider.x, layout.marker.divider.bottom);
      if (layout.marker.label) text("body", layout.marker.label, x + layout.marker.label.left, y, COLOR.inkMuted);
      faint(layout.marker.line.left, layout.marker.line.y, layout.marker.line.right, layout.marker.line.y);
    }
    if (layout.phoneLine) text("body", layout.phoneLine, centredX("body", layout.phoneLine, x + content.left + pad, bandWidth), y, COLOR.ink);
  };

  /**
   * The cuts of a page: a dashed hairline along every line of the grid, the badges butted edge to edge so
   * one cut separates two; with the club's marks, a short solid rule in the margin at each end of each.
   */
  const drawCuts = (rowsUsed: number) => {
    const left = grid.left;
    const top = grid.top;
    const right = grid.left + grid.columns * paper.width;
    const bottom = grid.top + rowsUsed * paper.height;
    doc.save();
    doc.lineWidth(0.4).strokeColor(COLOR.inkMuted).dash(3, { space: 3 });
    for (let column = 0; column <= grid.columns; column++) {
      const cutX = left + column * paper.width;
      doc.moveTo(cutX, top).lineTo(cutX, bottom).stroke();
    }
    for (let row = 0; row <= rowsUsed; row++) {
      const cutY = top + row * paper.height;
      doc.moveTo(left, cutY).lineTo(right, cutY).stroke();
    }
    doc.undash();
    doc.restore();
    if (!design.cutMarks) return;
    doc.save();
    doc.lineWidth(0.75).strokeColor(COLOR.ink);
    const mark = Math.min(BADGE_PAGE_MARGIN, left, top) * 0.8;
    for (let column = 0; column <= grid.columns; column++) {
      const cutX = left + column * paper.width;
      doc.moveTo(cutX, top - mark).lineTo(cutX, top - mark * 0.15).stroke();
      doc.moveTo(cutX, bottom + mark * 0.15).lineTo(cutX, bottom + mark).stroke();
    }
    for (let row = 0; row <= rowsUsed; row++) {
      const cutY = top + row * paper.height;
      doc.moveTo(left - mark, cutY).lineTo(left - mark * 0.15, cutY).stroke();
      doc.moveTo(right + mark * 0.15, cutY).lineTo(right + mark, cutY).stroke();
    }
    doc.restore();
  };

  const pages = badges.length === 0 ? 0 : slots[slots.length - 1].page + 1;
  for (let page = 0; page < pages; page++) {
    doc.addPage();
    const onPage = badges.map((item, index) => ({ item, slot: slots[index] })).filter((entry) => entry.slot.page === page);
    const rowsUsed = Math.ceil(onPage.length / grid.columns);
    for (const entry of onPage) drawBadge(entry.item, entry.slot.x, entry.slot.y);
    drawCuts(rowsUsed);
  }
  // A sheet with nothing to print is still a file that says so (the bib's «—» page).
  if (pages === 0) {
    doc.addPage();
    doc.font("body").fontSize(12).fillColor(COLOR.inkMuted).text("—", BADGE_PAGE_MARGIN, BADGE_PAGE_MARGIN, { lineBreak: false });
  }
  doc.end();
  return finished;
}
