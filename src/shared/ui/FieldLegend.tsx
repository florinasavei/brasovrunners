import Box from "@mui/material/Box";

/** A short mark beside a field's name: "în text", "folosit în textul platformei", "poate lipsi". */
export type FieldLegendMark = {
  label: string;
  /** `success` for "this text uses it"; `neutral` for a remark about the field. */
  tone: "success" | "neutral";
};

/** One field of a legend, already in words: this component decides only the shape. */
export type FieldLegendRow = {
  /** The field as it is typed into the text, braces and all. */
  token: string;
  /** What it becomes, in words. */
  meaning: string;
  /** A value it takes, in italics after the meaning — a real-looking one, not a description. */
  example?: string;
  marks?: readonly FieldLegendMark[];
  /** Said after the meaning where the example would be: "nu se completează în acest mesaj". */
  note?: string;
  /** Drawn dimmed: the field exists, and this text never gets a value for it. */
  muted?: boolean;
};

type Props = {
  rows: readonly FieldLegendRow[];
  "data-testid"?: string;
};

/**
 * The look of every row, set once on the list rather than on each element: `/admin/emails` draws
 * twenty legends of twelve rows (§NNN, email follow-up), and an `sx` per term, description and
 * mark was a styled component each — markup and payload for 240 rows the page mostly keeps shut.
 * Plain elements under one class are the same picture for a fraction of the bytes.
 */
const LEGEND_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" },
  columnGap: 2,
  rowGap: 1,
  m: 0,
  alignItems: "baseline",
  // Each row groups its term and description (a `<div>` in a `<dl>`) and draws no box of its own.
  "& > div": { display: "contents" },
  "& dt": { m: 0, typography: "body1" },
  "& dd": { m: 0, typography: "body2", color: "text.secondary" },
  /*
    Dimmed by colour and outline, never by opacity: the description is already the secondary ink,
    and 0.6 of it fell to about 2.8:1 on white (3.8:1 in the dark scheme) — words a Redactor has to
    read, "nu se completează în acest mesaj" among them, so held to 4.5:1 (`AGENTS.md` §18.2).
    The token takes the secondary ink too, its chip only a dashed outline; the note is in italics.
  */
  "& > div[data-muted] > dt": { color: "text.secondary" },
  "& > div[data-muted] > dd": { fontStyle: "italic" },
  "& code": {
    fontFamily: "monospace",
    fontSize: "0.875rem",
    bgcolor: "action.hover",
    px: 0.75,
    py: 0.25,
    borderRadius: 0.5,
    // On a phone the token may break anywhere: "{eventStartsAtFormatted}" is wider than a
    // 320-pixel card inside two cards. Never beside its meaning on a wider screen.
    whiteSpace: { xs: "normal", sm: "nowrap" },
    overflowWrap: "anywhere",
  },
  "& > div[data-muted] code": { bgcolor: "transparent", border: 1, borderStyle: "dashed", borderColor: "divider" },
  // A mark reads as an outlined chip, and a long one wraps inside itself on a phone.
  "& dt > span": {
    display: "inline-block",
    ml: 1,
    px: 1,
    border: 1,
    borderRadius: 4,
    borderColor: "divider",
    color: "text.secondary",
    fontSize: "0.8125rem",
    lineHeight: 1.6,
    verticalAlign: "middle",
  },
  "& dt > span[data-tone='success']": { borderColor: "success.main", color: "success.main" },
} as const;

/**
 * The fields a text is written with, one row each: the token in a code chip, what it becomes, and
 * an example (`DECISIONS.md` §190 for the declaration; §NNN, email follow-up, for the emails).
 *
 * One layout for both legends — the declaration's `{{tokens}}` (`legal-documents/ui/TokenLegend`)
 * and an email's `{fields}` (`notifications/ui/EmailFieldLegend`) — because the owner asked for
 * the second to be "the same" as the first: a definition list, two columns from `sm` and one on a
 * phone, where the token stacks over its meaning.
 *
 * A Server Component with no state, and each token plain text inside a `<code>`: selecting and
 * copying one is the browser's job. A muted row is set on its term and its description — the row
 * itself is `display: contents` and draws nothing — in the secondary ink at full strength, so its
 * words keep the contrast every other row has.
 */
export default function FieldLegend({ rows, "data-testid": testId }: Props) {
  return (
    <Box component="dl" data-testid={testId} sx={LEGEND_SX}>
      {rows.map((row) => (
        <div key={row.token} data-field={row.token} data-muted={row.muted ? "true" : undefined}>
          <dt>
            <code>{row.token}</code>
            {row.marks?.map((mark) => (
              <span key={mark.label} data-tone={mark.tone}>
                {mark.label}
              </span>
            ))}
          </dt>
          <dd>
            {row.meaning}
            {row.example !== undefined && (
              <>
                {" — "}
                <em>{row.example}</em>
              </>
            )}
            {row.note !== undefined && ` — ${row.note}`}
          </dd>
        </div>
      ))}
    </Box>
  );
}
