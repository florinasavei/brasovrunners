import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { pictureDrawingIn } from "@/modules/registrations/bib-picture-frame";
import { CLUB_NAME, COLOR } from "@/theme/brand";
import {
  type BadgeDesign,
  type BadgeLocale,
  type BadgeWords,
  badgeBandColour,
  badgeLabelText,
  badgeRoleColour,
  badgeRoleText,
  badgeTextOn,
} from "./badge-design";
import { BADGE_LAYOUT, BADGE_PAGE_MARGIN, type BadgeLayout, badgeLayout, badgePaper, badgeSheetGrid, badgeSheetSlots } from "./badge-geometry";

/**
 * The volunteer badges as a sheet to print (§NNN): every badge one strip of the club's size, packed
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
 * words in white or ink, whichever reads on it, the writing area and the telephone. Every line was fitted
 * by the layout; each is handed to pdfkit with **no width**, so it cannot wrap (the bib's §317 lesson).
 */

/** One pile of the sheet: a role's badges, or (`role: null`) the badges «fără rol». */
export type BadgeSheetEntry = {
  /** The role's name in the badge's language and its band's colour; null prints «VOLUNTAR» alone. */
  role: { name: string; colour: string | null } | null;
  /** How many badges of it, spares included. */
  count: number;
};

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
  const badges = badgeSheetOrder(input.entries);
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
  const label = badgeLabelText(words.label, locale);
  // Laid out once per role: every badge of a pile is the same badge.
  const layouts = new Map<string, BadgeLayout>();
  const layoutFor = (role: BadgeSheetEntry["role"]) => {
    const key = role ? `r:${role.name}` : "none";
    let layout = layouts.get(key);
    if (!layout) {
      layout = badgeLayout(
        { ...design, headerPicture: header !== null },
        { title: words.title, label, role: role ? badgeRoleText(role.name, locale) : null, name: words.name, phone: words.phone },
        measure,
      );
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

  const drawBadge = (role: BadgeSheetEntry["role"], x: number, y: number) => {
    const layout = layoutFor(role);
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
    const roleColour = badgeRoleColour(role?.colour ?? null);
    const roleText = badgeTextOn(roleColour);
    doc.rect(x + content.left, y + layout.role.top, content.width, layout.role.height).fill(roleColour);
    const bandWidth = content.width - 2 * pad;
    if (layout.label) text("bold", layout.label, centredX("bold", layout.label, x + content.left + pad, bandWidth), y, roleText);
    text("bold", layout.roleLine, centredX("bold", layout.roleLine, x + content.left + pad, bandWidth), y, roleText);
    // The writing area: «Nume:», and the faint line the name is written on.
    text("body", layout.name, x + layout.name.left, y, COLOR.inkMuted);
    if (layout.line) {
      doc.save();
      doc
        .moveTo(x + layout.line.left, y + layout.line.y)
        .lineTo(x + layout.line.right, y + layout.line.y)
        .lineWidth(L.lineWeight)
        .strokeOpacity(L.lineOpacity)
        .strokeColor(COLOR.inkMuted)
        .stroke();
      doc.restore();
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
    const onPage = badges.map((role, index) => ({ role, slot: slots[index] })).filter((entry) => entry.slot.page === page);
    const rowsUsed = Math.ceil(onPage.length / grid.columns);
    for (const entry of onPage) drawBadge(entry.role, entry.slot.x, entry.slot.y);
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
