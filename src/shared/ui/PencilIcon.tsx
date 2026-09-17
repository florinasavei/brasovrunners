/**
 * A pen, for "edit" controls in the backoffice. Inline SVG in `currentColor`, the same reason
 * `SocialIcon` is: one glyph is not worth an icon package (AGENTS.md §1.5). `aria-hidden`,
 * because the control it sits in carries the accessible name.
 */
export default function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
