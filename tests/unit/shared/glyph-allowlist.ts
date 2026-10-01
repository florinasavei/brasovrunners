/**
 * The buttons that wear no separate glyph (§521), each with its one-line reason. An entry matches a
 * button in `file` whose source contains `words`; `glyph-on-every-button-and-fold.test.ts` reads it,
 * and checks every entry still matches something, so a stale line fails rather than lingers.
 *
 * Two more exceptions are rules in the test itself, since they are recognised by shape, not file:
 * the order arrows «↑» / «↓», as a `label` or as the button's only words (the label *is* the
 * glyph), and a self-closing `<button />` or
 * `component="button"` with no children (an invisible overlay over a control that draws its own
 * picture, such as the telephone's flag).
 */
export const WITHOUT_GLYPH: ReadonlyArray<{ file: string; words: string; reason: string }> = [
  {
    file: "src/modules/registrations/ui/ReadAndAgree.tsx",
    words: "agreed ? agreedLabel : openLabel",
    reason: "§498: the race's conditions row, whose required checkbox is its picture.",
  },
  {
    file: "src/shared/ui/SiteNav.tsx",
    words: 'id="site-nav-more"',
    reason: "§498: the header's «Meniu ▾» / ☰ draws its glyph in text.",
  },
  {
    file: "src/modules/content/rich-text/ui/RichTextEditor.tsx",
    words: "{percent}%",
    reason: "A picture's or a film's width: the percentage is the face.",
  },
  {
    file: "src/modules/content/rich-text/ui/RichTextEditor.tsx",
    words: "{labels.preset[preset]}",
    reason: "§454's upload shapes: the ratio is the face, «16:9», «4:3», «1:1», «4:5», and «Liber» beside them.",
  },
  {
    file: "src/modules/content/rich-text/ui/ImageCropBox.tsx",
    words: "{labels.preset[value]}",
    reason: "§454's crop shapes, the same faces as the upload's.",
  },
  {
    file: "src/modules/content/rich-text/ui/PictureLightbox.tsx",
    words: 'data-testid="picture-preview-trigger"',
    reason: "§NNN: a picture in a rich text that opens large; the picture itself is the face.",
  },
  {
    file: "src/modules/media/ui/GalleryPicker.tsx",
    words: 'data-testid="gallery-picker-item"',
    reason: "§485: a gallery thumbnail — the picture itself is the button's face.",
  },
  {
    file: "src/shared/ui/BuildBadgeLink.tsx",
    words: 'role="button"',
    reason: "§365: the version chip's hidden staff entrance — a double-click or a long press, no visible verb.",
  },
];
