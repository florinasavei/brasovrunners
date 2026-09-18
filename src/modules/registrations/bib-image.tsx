import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { COLOR } from "@/theme/brand";
import { brandFonts } from "@/theme/pdf/fonts";

/**
 * One race number as a picture (`DECISIONS.md` §94; the owner: "I should be able to preview
 * and see bibs for each participant — a pretty bib, with our logo, participant name, race").
 *
 * The same lockup the PDF sheet prints (`src/theme/pdf/logo.png`, a literal path so the file
 * is traced into the function), the number in the club's blue as large as the card allows,
 * the name under it, the race and its date along the top, the kit's orange as the rule.
 * Drawn through `next/og` like the share cards: flexbox only, the bundled Noto Sans.
 * 900×600, the proportion of an A5 bib lying on its side.
 */
export const BIB_IMAGE = { width: 900, height: 600 } as const;

let logoDataUrl: Promise<string> | undefined;
function logo(): Promise<string> {
  logoDataUrl ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "logo.png")).then(
    (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
  );
  return logoDataUrl;
}

export async function renderBibImage(input: {
  bibNumber: number;
  registeredName: string;
  eventTitle: string;
  eventDate: string;
}): Promise<ImageResponse> {
  const { width, height } = BIB_IMAGE;
  const digits = String(input.bibNumber);
  const numberSize = digits.length > 3 ? 240 : 300;
  const nameSize = input.registeredName.length > 26 ? 34 : 44;
  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          background: COLOR.surface,
          color: COLOR.ink,
          fontFamily: "Roboto, sans-serif",
          border: `6px solid ${COLOR.blue}`,
          borderRadius: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "26px 40px 0 40px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws the data URI */}
          <img src={await logo()} alt="" width={210} height={87} style={{ objectFit: "contain" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: COLOR.inkMuted, fontSize: 24 }}>
            <div style={{ display: "flex", fontWeight: 600, color: COLOR.ink }}>{input.eventTitle}</div>
            <div style={{ display: "flex" }}>{input.eventDate}</div>
          </div>
        </div>
        <div style={{ display: "flex", height: 8, background: COLOR.orange, margin: "20px 40px 0 40px", borderRadius: 4 }} />
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            fontSize: numberSize,
            fontWeight: 700,
            color: COLOR.blue,
            letterSpacing: -6,
            lineHeight: 1,
          }}
        >
          {digits}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "0 40px 30px 40px",
            fontSize: nameSize,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {input.registeredName}
        </div>
      </div>
    ),
    { width, height, fonts: await brandFonts() },
  );
}
