# Brand assets

Source material for the club's visual identity. Nothing here is served to the web — that is
`public/brand/`, and the tokens that point at it are `src/theme/brand.ts`.

| File | What it is |
| --- | --- |
| `logo-blue-source.svg` | The club's logo as supplied, untouched |
| `logo-white-source.svg` | The same, in white, for dark backgrounds |
| `logo-original.pdf` | The original the SVGs were exported from |
| `tricou-bvr.jpg` | The club kit, photographed. Recompressed to 900px / 64kB |
| `fonts/Facon.ttf` | The display face used on the kit. **Not shipped — see below** |
| `fonts/Facon-read-me.txt` | Its licence, as the designer wrote it |

The two PNG exports of the logo are deliberately absent: 64MB and 23MB. Git keeps every blob
forever, so committing them would add 111MB to every clone the club ever makes, in order to
store what the 16kB vectors already say. Generate rasters from the SVG at the size needed.

## Facón — the kit's display face

Designed by Alejo Bergmann (RosType), one style, Bold Italic, TTF. It is what the shirt's
"BRASOV RUNNERS" is set in, before a slice-and-offset effect was applied on top of it — the
angled cuts run across the gaps between letters as well as through them, so they are artwork,
not glyphs.

### It cannot set Romanian. At all.

Reading the font's own `cmap` table: **129 mapped characters**, and none of them are Romanian.

| | ș / Ș | ț / Ț | ă / Ă | â / Â | î / Î |
| --- | --- | --- | --- | --- | --- |
| Comma-below (correct) | missing | missing | — | — | — |
| Cedilla (legacy substitute) | missing | missing | — | — | — |
| Vowels | — | — | missing | missing | missing |

Not one is present, in either encoding. The word **Brașov cannot be set in this font** — the ș
falls back to whatever comes next in the stack, so you get one Roboto letter in the middle of a
Facón word. So do "Tură pe Tâmpa", "Distanță", "Înscriere", "Alergare de duminică": most
headings this site would ever show.

This is very likely why the shirt itself reads BRASOV rather than BRAȘOV.

Where that leaves it: usable for a fixed English string set once as artwork — a hero image, a
poster — and unusable for any heading rendered from the message catalogues.

### The licence contradicts itself

`Facon-read-me.txt`, in full, says both of these:

> You may use this version of Facón Font for personal and commercial use.
>
> You may not Sell or Distribute Facón Font for profit or alter it in any way without asking
> me first.

and then

> Open Font License.

Those do not agree. The OFL explicitly permits modification and redistribution; the sentence
above it withholds both. Two consequences for a website:

- **Converting TTF to WOFF2 is "altering it"** by the plain reading. That conversion is the
  normal first step of self-hosting a webfont.
- **Serving the file to visitors is distribution.** Not for profit, and this club is not
  commercial, but the clause is broad.

Neither is a problem worth guessing about, because the resolution is one email to
`alejobergmann@gmail.com` asking whether web embedding is permitted. Until that answer exists,
the font stays here as reference and is not in the build. If it is granted, note that the TTF
can be served *unmodified* — 36kB, which every browser accepts — so the "alter" clause need
never be tested.

### The ancestor is already installed

The read-me names it: **"Base font: Roboto Black Italic."** Roboto is already loaded by
`next/font` in this app, is Apache-2.0, and has complete Romanian coverage. Roboto at weight
900, italic, is therefore the closest possible stand-in for the kit's face, costs nothing to
add, raises no licence question, and can set "Brașov" correctly. The slice effect is
reproducible in CSS over any typeface.

## Colour

Two blues exist and they are not the same colour.

| Source | Value | How it was obtained |
| --- | --- | --- |
| The logo file | `#0000ff` | Every path in the supplied SVG computes to this |
| The kit | `#0d1c3d` – `#1b2843` | Sampled from `tricou-bvr.jpg` |

Lighting does not explain the gap: pure blue has no red or green channel at all, and the
garment samples have plenty of both. `src/theme/brand.ts` uses the logo's value, on the
grounds that it is the only one *stated* rather than photographed. **The club should decide
which is the brand blue**, and the printer's file is where the answer is.

The kit's gradient, sampled down the shirt front, runs:

```
#0d1c3d → #09254b → #0f3c60 → #295572 → (white)
```

The photograph is warm-lit and underexposed, so those read duller and greyer than the fabric
does. `GRADIENT` in `src/theme/brand.ts` keeps that structure with the saturation restored, and
is a proposal rather than a measurement until the print file is available.

## Open questions for the club

1. Which blue is the brand blue — the logo's or the kit's?
2. Can we have the printer's file, for the gradient's real values?
3. May we use Facón on the website? (Email the designer; see above.)
4. The logo's wordmark reads BRASOV while the club's name is Brașov. The site sets the name as
   live text beside the mark so it is spelled correctly; is a corrected wordmark wanted?
