import FemaleIcon from "@mui/icons-material/Female";
import MaleIcon from "@mui/icons-material/Male";
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import { SEX_CHOICES, type SexChoice } from "../domain/sex";

/** Each answer's glyph beside its word (§171, §554; the owner: «trebuie să afișăm și iconițele»). */
const SEX_GLYPHS = { MALE: MaleIcon, FEMALE: FemaleIcon } as const satisfies Record<SexChoice, unknown>;

/**
 * «Sex» on the public registration form: two answers side by side, «Masculin» and «Feminin», each
 * with its glyph (§554, amending §510; the owner, 2026-09-29: «sexul e doar masculin și feminin și
 * trebuie să afișăm și iconițele, nu avem opțiunea de a prefera să nu zică»).
 *
 * **Two radio cards, native inputs, no island.** A `<fieldset>` whose legend is the label, and two
 * `<label>` cards each holding a real `<input type="radio" name="sex" required>`: the browser posts
 * the answer and refuses a form without one with JavaScript off, and the §422 list reads the group's
 * own `validity` (one entry for the name). Nothing is pre-chosen — §510's reason stands: an answer
 * the runner never gave is worse than a refused press. Rendered by the server alone; the glyphs are
 * children here, never a prop handed to a client component.
 *
 * The card is 56 pixels tall — the outlined boxes' height — over the 44 a thumb needs (BR-REQ-041-01 criterion 6), and the whole
 * card is the input's label, so a press anywhere on it answers. The first input carries the field's
 * id, where the refusal summary's link lands (§47).
 */
export default function SexField({
  id,
  name,
  label,
  error,
  helperText,
  defaultValue,
  answers,
}: {
  id: string;
  name: string;
  label: string;
  error?: boolean;
  helperText?: string;
  /** A refused submission's answer (§142); anything else — the retired one included — starts unanswered. */
  defaultValue?: string;
  /** Each answer's word, in the reader's language. */
  answers: Readonly<Record<SexChoice, string>>;
}) {
  const helperId = `${id}-helper-text`;
  return (
    <Box
      component="fieldset"
      data-testid="sex-field"
      aria-describedby={helperText ? helperId : undefined}
      sx={{ border: 0, m: 0, p: 0, minWidth: 0, width: "100%" }}
    >
      <Box component="legend" sx={{ p: 0, mb: 0.5, typography: "body2", color: error ? "error.main" : "text.secondary" }}>
        {label}
        <Box component="span" aria-hidden="true">
          {" *"}
        </Box>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        {SEX_CHOICES.map((answer, index) => {
          const Glyph = SEX_GLYPHS[answer];
          return (
            <Box
              key={answer}
              component="label"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                // The outlined boxes' own height beside it, and over the 44 a thumb needs.
                minHeight: 56,
                px: 1.5,
                border: 1,
                borderColor: error ? "error.main" : "divider",
                borderRadius: 1,
                cursor: "pointer",
                typography: "body1",
                "&:hover": { borderColor: "text.primary" },
                "&:has(input:checked)": { borderColor: "primary.main", bgcolor: "action.selected" },
                "&:has(input:focus-visible)": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
                "& input": { m: 0, width: 20, height: 20, flex: "0 0 auto", accentColor: "var(--mui-palette-primary-main)", cursor: "pointer" },
              }}
            >
              <input
                type="radio"
                id={index === 0 ? id : `${id}-${answer.toLowerCase()}`}
                name={name}
                value={answer}
                required
                defaultChecked={defaultValue === answer}
              />
              <Glyph fontSize="small" aria-hidden="true" />
              <span>{answers[answer]}</span>
            </Box>
          );
        })}
      </Box>
      {helperText && (
        <FormHelperText id={helperId} error={error} sx={{ mx: 1.75 }}>
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
}
