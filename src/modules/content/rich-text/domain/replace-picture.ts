/**
 * «Înlocuiește» on a picture in a text (§673): what the image node becomes when a new upload takes
 * its place, and how the editor finds that node again once the upload has answered.
 *
 * The node stays where it is, with the words written about it — `alt`, `caption`, its width share
 * and its placement — and takes the new picture's address and stored size. The crop and the card's
 * centre (§241, §454) are fractions of *that* photograph, so they go: a rectangle drawn over one
 * photograph means nothing on another, and the whole picture is the honest start. Nothing else in
 * the document moves, and the old picture is not deleted here — the text is not saved yet, and the
 * organizer may cancel; once a save no longer names it, the sweep takes it (§73).
 *
 * Pure, with no Tiptap import, so the rule is tested without a browser.
 */

/** The upload's answer, as much of it as the node carries. */
export type ReplacementPicture = { src: string; width: number; height: number };

export function replacedPictureAttrs<A extends Record<string, unknown>>(attrs: A, next: ReplacementPicture): A {
  return { ...attrs, src: next.src, width: next.width, height: next.height, crop: null, focus: null };
}

/** As much of a ProseMirror node as the search reads. */
type PictureNode = { type: { name: string }; attrs: Record<string, unknown> };
type PictureDoc = {
  nodeAt(position: number): PictureNode | null | undefined;
  descendants(visit: (node: PictureNode, position: number) => boolean | void): void;
};

/**
 * Where the picture to replace is now: at the position it was selected at, when the picture there
 * still carries the address it had; otherwise the first picture carrying that address (text typed
 * above it during the upload moved it); `null` when no picture carries it any more (removed while
 * the upload ran — the new picture then waits, unused, for the sweep).
 */
export function findPictureToReplace(doc: PictureDoc, selectedAt: number, src: string): number | null {
  const there = doc.nodeAt(selectedAt);
  if (there && there.type.name === "image" && there.attrs.src === src) return selectedAt;
  let found: number | null = null;
  doc.descendants((node, position) => {
    if (found !== null) return false;
    if (node.type.name === "image" && node.attrs.src === src) {
      found = position;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Every picture in a document that carries `src`, by position — what a box changes when another
 * box of the same form replaced that picture (§673): the Romanian text and its English copy name
 * the same stored picture, and a replace in one reaches the other. Positions are stable through
 * the change: an image is an atom, and a new attribute does not change its size.
 */
export function picturesCarrying(doc: Pick<PictureDoc, "descendants">, src: string): number[] {
  const found: number[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "image" && node.attrs.src === src) found.push(position);
    return true;
  });
  return found;
}

/** A stored document as JSON — any node, its attributes and its children. */
type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[] } & Record<string, unknown>;

/**
 * The same change on a stored document that no editor holds yet — a fold not opened (§96): every
 * image carrying `oldSrc` takes the new picture, each with its own words kept. `null` when no
 * image carries it, so the caller leaves the document as it was.
 */
export function replacePictureInDoc<D extends { type: string; content?: unknown[] }>(doc: D, oldSrc: string, next: ReplacementPicture): D | null {
  let changed = false;
  const walk = (node: JsonNode): JsonNode => {
    if (node.type === "image" && node.attrs?.src === oldSrc) {
      changed = true;
      return { ...node, attrs: replacedPictureAttrs(node.attrs, next) };
    }
    return Array.isArray(node.content) ? { ...node, content: node.content.map(walk) } : node;
  };
  const after = walk(doc as unknown as JsonNode);
  return changed ? (after as unknown as D) : null;
}
