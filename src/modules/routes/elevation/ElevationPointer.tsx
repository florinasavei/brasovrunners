"use client";

import Box from "@mui/material/Box";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { indexAtShare, nearestMarkerName, readoutAt, shareAtX, stepIndex, xAtShare } from "./pointer";

/** One drawn chart's frame, plain numbers in its own viewBox: where the plot stands and what altitude it spans. */
export type PointerChart = {
  size: "narrow" | "wide";
  viewWidth: number;
  viewHeight: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  altitudeMin: number;
  altitudeMax: number;
};

export type PointerWords = {
  /** «{km} km · {altitude} m». */
  readout: string;
  /** «{km} km · {altitude} m · {name}». */
  readoutNamed: string;
  /** What the focused chart says about itself: the arrow keys read the kilometre and the altitude. */
  hint: string;
};

/** Text a screen reader reads and the eye never sees (`'1px'` strings: MUI's `sx` would turn the number 1 into a hundred per cent). */
const SR_ONLY = { position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** Where the overlay stands, in pixels from the wrapper's top left, measured when the pointer last moved. */
type Overlay = { index: number; spoken: boolean; left: number; top: number; height: number; dotTop: number; flip: boolean };

/**
 * The elevation chart's pointer (§NNN; the owner, 2026-10-16: «a pointer line “4.5 KM”»): a thin line down the chart and
 * «4,5 km · 712 m» at the profile point nearest the finger, the mouse or the arrow keys, the name of a checkpoint within
 * two hundred metres added to it. It wraps the server-drawn SVGs (the page draws a narrow chart and a wide one and shows
 * the one that fits, so this finds the visible one) and draws only an overlay of its own: nothing before the first event,
 * and with scripts off the static chart stands as it is.
 *
 * Props are plain data — numbers, strings, no element and no function (§370); the arithmetic is `pointer.ts`, so the
 * rule is tested without a browser. A mouse leaving hides the line; a touch leaves it where the finger lifted, the way
 * a chart you read keeps the place you pointed at. `touch-action: pan-y` keeps a vertical swipe scrolling the page while a
 * horizontal one moves the line. The wrapper is a tab stop with the arrow keys (a hundredth of the route each, the page
 * keys a tenth, home and end the ends), and its readout is announced politely only for keys, never for every pixel of a drag.
 */
export default function ElevationPointer({
  charts,
  points,
  distanceMeters,
  markers,
  locale,
  words,
  children,
}: {
  charts: readonly PointerChart[];
  /** The profile: `[metres, altitude]`. */
  points: ReadonlyArray<readonly [number, number]>;
  /** The distance the plot spans, metres (the club's typed figure, else the track's). */
  distanceMeters: number;
  /** The checkpoints the chart draws, by name and kilometre. */
  markers: ReadonlyArray<{ km: number; name: string }>;
  locale: string;
  words: PointerWords;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Overlay | null>(null);
  const kmFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const metresFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  // A turned phone or a resized window changes what the pixels mean: the line is taken away rather than left in the wrong place.
  useEffect(() => {
    const clear = () => setAt(null);
    window.addEventListener("resize", clear);
    return () => window.removeEventListener("resize", clear);
  }, []);

  /** The chart that is on screen now (the other is `display: none`, which has no box). */
  const visible = (): { chart: PointerChart; box: DOMRect; host: DOMRect } | null => {
    const element = root.current;
    if (!element) return null;
    for (const chart of charts) {
      const box = element.querySelector<SVGSVGElement>(`svg[data-size="${chart.size}"]`)?.getBoundingClientRect();
      if (box && box.width > 0) return { chart, box, host: element.getBoundingClientRect() };
    }
    return null;
  };

  /** The overlay for a profile point, measured on the chart that is showing; null when none is. */
  const place = (index: number, spoken: boolean): Overlay | null => {
    const shown = visible();
    if (!shown) return null;
    const { chart, box, host } = shown;
    const reading = readoutAt({ points, distanceMeters }, index);
    const scale = box.width / chart.viewWidth;
    const left = box.left - host.left + xAtShare({ plotLeft: chart.plotLeft, plotRight: chart.plotRight, mirrored: false }, reading.share) * scale;
    const span = chart.altitudeMax - chart.altitudeMin;
    const y = chart.plotBottom - ((reading.altitude - chart.altitudeMin) / span) * (chart.plotBottom - chart.plotTop);
    return {
      index: reading.index,
      spoken,
      left,
      top: box.top - host.top + chart.plotTop * scale,
      height: (chart.plotBottom - chart.plotTop) * scale,
      dotTop: box.top - host.top + y * scale,
      // Past the middle the readout sits on the line's left, so it never leaves the chart.
      flip: left > host.width / 2,
    };
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const shown = visible();
    if (!shown) return;
    const { chart, box } = shown;
    const x = ((event.clientX - box.left) * chart.viewWidth) / box.width;
    setAt(place(indexAtShare(points.length, shareAtX({ plotLeft: chart.plotLeft, plotRight: chart.plotRight, mirrored: false }, x)), false));
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    // From nothing, a key lands on the end it moves toward; after that it steps.
    const toStart = event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home";
    const next = at === null ? (stepIndex(0, points.length, event.key) === null ? null : toStart ? 0 : last) : stepIndex(at.index, points.length, event.key);
    if (next === null) return;
    event.preventDefault();
    setAt(place(next, true));
  };

  const reading = at && readoutAt({ points, distanceMeters }, at.index);
  const name = reading ? nearestMarkerName(markers, reading.km) : null;
  const text =
    reading &&
    fill(name ? words.readoutNamed : words.readout, {
      km: kmFormat.format(reading.km),
      altitude: metresFormat.format(reading.altitude),
      name: name ?? "",
    });

  return (
    <Box
      ref={root}
      role="group"
      aria-label={words.hint}
      tabIndex={0}
      data-testid="elevation-pointer"
      onPointerDown={move}
      onPointerMove={move}
      onPointerLeave={(event) => {
        // A mouse leaving takes the line away; a finger lifting leaves it where it was.
        if (event.pointerType === "mouse") setAt(null);
      }}
      onKeyDown={key}
      onBlur={() => setAt((current) => (current?.spoken ? null : current))}
      sx={{
        position: "relative",
        touchAction: "pan-y",
        borderRadius: 1,
        "&:focus-visible": { outline: "2px solid var(--mui-palette-primary-main)", outlineOffset: "2px" },
      }}
    >
      {children}
      {at && text && (
        <>
          <Box
            aria-hidden="true"
            data-testid="elevation-pointer-line"
            sx={{ position: "absolute", left: at.left, top: at.top, height: at.height, width: "2px", ml: "-1px", bgcolor: "text.primary", pointerEvents: "none" }}
          />
          <Box
            aria-hidden="true"
            sx={{ position: "absolute", left: at.left, top: at.dotTop, width: 10, height: 10, ml: "-5px", mt: "-5px", borderRadius: "50%", bgcolor: "primary.main", border: 2, borderColor: "background.paper", pointerEvents: "none" }}
          />
          <Box
            aria-hidden="true"
            data-testid="elevation-pointer-readout"
            sx={{
              position: "absolute",
              left: at.left,
              top: at.top,
              transform: at.flip ? "translate(calc(-100% - 8px), 0)" : "translate(8px, 0)",
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: "background.paper",
              color: "text.primary",
              border: 1,
              borderColor: "divider",
              fontSize: "0.8125rem",
              fontWeight: 600,
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {text}
          </Box>
        </>
      )}
      {/* Said for keys only: a drag would be a sentence per pixel. */}
      <Box role="status" aria-live="polite" sx={SR_ONLY}>
        {at?.spoken ? text : ""}
      </Box>
    </Box>
  );
}
