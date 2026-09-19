import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { DIALING_CODES, PHONE_COUNTRY_CODES, splitPhone } from "../phone";

/**
 * A telephone number as two controls: the country (a native select, prefix shown) and the
 * digits (`DECISIONS.md` §84). Posted as `<name>Country` and `<name>`; `form-mapping.ts`
 * composes the E.164 the schema stores.
 *
 * Native `<select>` rather than MUI's, on purpose: it works before hydration, it is the
 * control a phone knows how to open, and 200 options in a Popover is a scroll nobody wants.
 * Romania first, then the rest by name in the reader's language.
 */
export default function PhoneField({
  name,
  label,
  countryLabel,
  locale,
  value,
  required = false,
  autoComplete,
  id,
  error,
  helperText,
}: {
  name: string;
  label: string;
  countryLabel: string;
  locale: "ro" | "en";
  /** A stored E.164 number to prefill, or nothing. */
  value?: string | null;
  required?: boolean;
  autoComplete?: string;
  id?: string;
  error?: boolean;
  helperText?: string;
}) {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const { countryCode, national } = splitPhone(value ?? null);
  const options = PHONE_COUNTRY_CODES.map((code) => ({
    code,
    label: `${names.of(code) ?? code} (+${DIALING_CODES[code]})`,
  })).sort((a, b) => (a.code === "RO" ? -1 : b.code === "RO" ? 1 : a.label.localeCompare(b.label, locale)));

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <TextField
        select
        name={`${name}Country`}
        label={countryLabel}
        defaultValue={countryCode}
        size="medium"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        sx={{ width: { xs: 132, sm: 200 }, flexShrink: 0 }}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </TextField>
      <TextField
        id={id}
        name={name}
        type="tel"
        label={label}
        defaultValue={national}
        required={required}
        fullWidth
        autoComplete={autoComplete}
        error={error}
        helperText={helperText}
        slotProps={{
          htmlInput: {
            inputMode: "tel",
            // Digits, with the separators people type; the server strips them and checks the count.
            pattern: "[0-9+()./\\s-]{4,20}",
            minLength: 4,
            maxLength: 20,
          },
        }}
      />
    </Stack>
  );
}
