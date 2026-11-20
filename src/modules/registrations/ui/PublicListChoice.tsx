import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/shared/ui/SubmitButton";

type ServerAction = (form: FormData) => Promise<void>;

/** The block's words, already in the page's language: `public-list-choice-words.ts` reads them (`Registrations.list.*`, `Event.startList.anonymous`). */
export type PublicListChoiceWords = {
  /** «Lista publică și clasamentul» on a race; the list's own title, «Lista publică de participanți», on an event without results. */
  title: string;
  /** Where the name stands now, from `listChoiceState`: drawn bold, after the eye. */
  state: string;
  /** The other answer, the button's words — the tick's own (§570): «Vreau să apar pe lista de participanți & rezultate» or «Nu vreau să apar pe lista de participanți & rezultate». */
  press: string;
  /** What the button says while the request is in flight. */
  pressing: string;
  /** «Poți schimba oricând, …». */
  help: string;
  /** «Am reținut alegerea ta.» / the refusal, after a press on this registration's block. */
  changed: string;
  failed: string;
};

/**
 * The public participant list's choice, one registration's (§NNN, BR-REQ-039-01; the rule is §143's and §186's, unchanged): its own
 * clearly marked block on «Gestionează înscrierea» — every person of a family's page included — and on «Înscrierile mele», drawn
 * where the eye lands, under the registration's state, number and QR.
 *
 * - **A box of its own**: the info tint the house's notices wear (`Alert` severity info's own background, through MUI's variable,
 *   so both colour schemes follow), the divider's border, rounded as the page's cards. Never an error's or a warning's colour: this
 *   is a choice, not a problem.
 * - **A heading on every registration** — `level` 2 on a one-person page, 3 or 4 inside a card — and the state in bold beside the
 *   eye: open when the name is shown, crossed when it is not.
 * - **One button, the same in both states**: contained, the primary colour, at least 48 pixels tall and the full width on a phone,
 *   its eye the answer it gives. Taking the name off is exactly as easy as putting it on, and neither answer is coloured, pre-chosen
 *   or worded as the one to pick (consent freely given, withdrawn as easily, art. 7(3) GDPR). The label in sentence case: it is a
 *   sentence the person reads before pressing, and capitals cost a line at 320 pixels.
 * - **The press** posts the answer it asks for (`listed`), the page's own door (the manage link or the address's link), read and
 *   never spent; `#list` is where the manage page's press lands, on the link's own person's block.
 *
 * A Server Component with strings in, synchronous, so the pages' own tests render it; the one island is the house's `SubmitButton`
 * (pending words, no double press), its glyph passed as a child — the slot an element crosses safely (§370).
 */
export default function PublicListChoice(props: {
  /** `list` on the manage page's own person; nothing elsewhere. */
  id?: string;
  /** The registration this block's form names; also makes the heading's id unique on a page of several. */
  registrationId: string;
  listed: boolean;
  level: 2 | 3 | 4;
  /** The press this block answers, when it does: saved or refused. */
  outcome: "changed" | "failed" | null;
  words: PublicListChoiceWords;
  action: ServerAction;
  /** The door's own fields — `locale`, `token`, `registrationId` — posted as they are. */
  fields: Readonly<Record<string, string>>;
  "data-testid": string;
}) {
  const testId = props["data-testid"];
  const headingId = `list-choice-${props.registrationId}`;
  return (
    <Box
      component="section"
      id={props.id}
      aria-labelledby={headingId}
      data-testid={testId}
      data-listed={props.listed ? "true" : "false"}
      sx={BOX_SX}
    >
      <Typography id={headingId} component={`h${props.level}`} variant={props.level === 2 ? "h2" : "h3"} sx={props.level === 2 ? TITLE_SX : CARD_TITLE_SX}>
        {props.words.title}
      </Typography>
      {props.outcome === "changed" && (
        <Alert severity="success" sx={{ mb: 1.5 }} data-testid={`${testId}-changed`}>
          {props.words.changed}
        </Alert>
      )}
      {props.outcome === "failed" && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid={`${testId}-failed`}>
          {props.words.failed}
        </Alert>
      )}
      <Typography sx={STATE_SX} data-testid={`${testId}-state`}>
        {props.listed ? <VisibilityIcon aria-hidden="true" sx={STATE_GLYPH_SX} /> : <VisibilityOffIcon aria-hidden="true" sx={STATE_GLYPH_SX} />}
        <span>{props.words.state}</span>
      </Typography>
      <form action={props.action}>
        {Object.entries(props.fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {/* The answer this press asks for: «set», not «flip», so a second press of a stale page lands where the button said (§143). */}
        <input type="hidden" name="listed" value={props.listed ? "0" : "1"} />
        <Box sx={PRESS_SX} data-testid={`${testId}-press`}>
          <SubmitButton label={props.words.press} pendingLabel={props.words.pressing} variant="contained" size="large">
            {props.listed ? <VisibilityOffIcon /> : <VisibilityIcon />}
          </SubmitButton>
        </Box>
      </form>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {props.words.help}
      </Typography>
    </Box>
  );
}

/** The box: the info notices' tint, the divider's border, the cards' corners; a step less padding on a phone, where width is short. */
const BOX_SX = {
  bgcolor: "var(--mui-palette-Alert-infoStandardBg)",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  p: { xs: 1.5, sm: 2 },
  mb: 2,
} as const;

/** A one-person page's section heading, the size of its neighbours («Ziua cursei», «Oferte și beneficii»). */
const TITLE_SX = { fontSize: "1.25rem", mb: 1 } as const;
/** Inside a card (a family's person, a row of «Înscrierile mele»): a step smaller, still a heading. */
const CARD_TITLE_SX = { fontSize: "1.0625rem", fontWeight: 700, mb: 1 } as const;

/** The state: bold, the eye on its first line, the words wrapping beside it rather than under it. */
const STATE_SX = { display: "flex", alignItems: "flex-start", gap: 1, fontWeight: 700, mb: 1.5 } as const;
const STATE_GLYPH_SX = { fontSize: 22, flexShrink: 0, mt: "1px" } as const;

/**
 * The button's frame: the full width on a phone, its own width from `sm`; 48 pixels at the least, over the house's 44
 * (`TAP_TARGET`, which `SubmitButton` wears), and the words as written.
 */
const PRESS_SX = {
  display: { xs: "block", sm: "inline-block" },
  width: { xs: "100%", sm: "auto" },
  "& .MuiButton-root": { minHeight: 48, textTransform: "none" },
} as const;
