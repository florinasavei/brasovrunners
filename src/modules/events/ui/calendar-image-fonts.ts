// The picture's faces (§855): read from the page, and the poster's own fetched once. The dialog and
// `yarn calendar:preview` draw with the same.
import type { CalendarImageFonts } from "./calendar-image-draw";

/**
 * Poppins (SIL OFL 1.1, `public/fonts/calendar/`), the geometric sans «Afiș» is set in: the picture's own,
 * fetched when the dialog first opens, so no other page pays for it. Each weight is two files, as fontsource splits
 * them: the Latin letters, and the extended ones Romanian's «ș ț ă» live in.
 */
const POSTER_FAMILY = "Poppins";
const POSTER_FACES = [
  { weight: "500", style: "normal", file: "500" },
  { weight: "700", style: "normal", file: "700" },
  { weight: "800", style: "normal", file: "800" },
  { weight: "500", style: "italic", file: "500italic" },
  { weight: "900", style: "italic", file: "900italic" },
] as const;
const POSTER_SUBSETS = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  latinext:
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
} as const;
let posterFaces: Promise<unknown> | null = null;

/** The poster's faces added to the document once; a failed load is tried again the next time the dialog opens. */
function loadPosterFaces(): Promise<unknown> {
  posterFaces ??= Promise.all(
    POSTER_FACES.flatMap(({ weight, style, file }) =>
      Object.entries(POSTER_SUBSETS).map(([subset, unicodeRange]) => {
        const face = new FontFace(POSTER_FAMILY, `url(/fonts/calendar/${POSTER_FAMILY}-${file}-${subset}.woff2) format("woff2")`, { weight, style, unicodeRange });
        document.fonts.add(face);
        return face.load();
      }),
    ),
  ).catch((error: unknown) => {
    posterFaces = null;
    throw error;
  });
  return posterFaces;
}

/** The faces the canvas names: the page's body, the club kit's and the hand-written one; and the poster's, the page's body after it. */
export function calendarImageFonts(): CalendarImageFonts {
  const style = getComputedStyle(document.body);
  const body = style.fontFamily || "sans-serif";
  const display = style.getPropertyValue("--font-facon").trim() || body;
  const script = style.getPropertyValue("--font-signature").trim() || body;
  return { body, display, script, poster: `'${POSTER_FAMILY}', ${body}` };
}

/**
 * The faces the picture draws with, loaded: the poster's own. The body's is the page's and is there already;
 * the kit's and the hand-written one are named but drawn by no layout today, so nothing is fetched for them.
 * A face that fails leaves its fallback.
 */
export function loadCalendarImageFonts(): Promise<unknown> {
  return loadPosterFaces()
    .catch(() => undefined)
    .then(() => document.fonts.ready);
}
