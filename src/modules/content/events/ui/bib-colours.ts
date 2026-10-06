/**
 * The colours a race's numbers may print in (§173, §177): six that stay apart from each other
 * on paper and from the club's blue, which is the empty choice. Hex triplets, because that is
 * what `events.bib_colour` checks for and what the sheet paints. The members' header offers the
 * same six (§664), its empty choice being the event's own band.
 */
export const BIB_COLOURS = [
  { key: "green", hex: "#1b8a3a" },
  { key: "red", hex: "#c62828" },
  { key: "orange", hex: "#ef6c00" },
  { key: "purple", hex: "#6a1b9a" },
  { key: "teal", hex: "#00838f" },
  { key: "black", hex: "#212121" },
] as const;
