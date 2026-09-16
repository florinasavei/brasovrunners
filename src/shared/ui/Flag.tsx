/**
 * One country flag, from the set copied into `public/flags/` by `scripts/sync-flags.mjs`.
 *
 * Always 4:3, whatever the country's real proportions are — Romania is 2:3 and the United
 * Kingdom 1:2, so a row of faithful flags is a row of different widths. That normalisation is
 * the reason a set is used at all rather than two hand-drawn files.
 *
 * A plain `<img>`, not `next/image`: these are a few hundred bytes of SVG, there is nothing for
 * an image optimizer to do, and serving SVG through `next/image` requires `dangerouslyAllowSVG`
 * for every remote image the application might ever load.
 *
 * `alt=""` because a flag is never the label. A flag is a country and a language is not, and a
 * country is not always a language, so whatever this decorates carries the real text — the
 * language code beside it in the header, the country name in a form.
 */
export default function Flag({
  code,
  width = 16,
  className,
}: {
  /** ISO 3166-1 alpha-2, in either case: `RO`, `gb`. */
  code: string;
  width?: number;
  className?: string;
}) {
  return (
    // An SVG has nothing for an image optimizer to do, and next/image would need
    // `dangerouslyAllowSVG` for every remote image the application ever loads.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      // Both are set so the row reserves its space and nothing reflows while the file loads.
      width={width}
      height={Math.round((width * 3) / 4)}
      className={className}
      style={{ display: "block", borderRadius: 2 }}
    />
  );
}
