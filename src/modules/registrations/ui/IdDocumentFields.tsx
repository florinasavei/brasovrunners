import TextField from "@mui/material/TextField";

/** The kinds of identity document a declaration asks for (§283), in the order the select offers them. */
export const ID_DOCUMENT_TYPES = ["ID_CARD", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"] as const;

/** A document's series box, by the name it posts: the declarant's, and on a minor's declaration the minor's (§330). */
export type DocumentBox = "idDocument" | "minorIdDocument";

/**
 * One signer's identity document, as the declaration asks for it (§95, §283): the kind, chosen
 * from a closed list, and the series and number, typed — never scanned. An adult has one; a minor's
 * declaration has two, the minor's (`minorIdDocument`) and the parent's (`idDocument`), each the
 * same two boxes under its own words (§330). The action composes each pair into the one line the
 * declaration prints (`id-document-input.ts`).
 *
 * Shared by the race's declaration page and a group run's self-declaration (§NNN), so the two ask
 * for a document with the same two boxes and the same pattern.
 *
 * Rendered on the server with the page: it passes strings to MUI and nothing else
 * (`AGENTS.md` §14.1).
 */
export default function IdDocumentFields({
  name,
  typeLabel,
  typeHelp,
  label,
  help,
  placeholder,
  kinds,
  defaultKind,
  defaultValue,
  refused,
}: {
  name: DocumentBox;
  typeLabel: string;
  typeHelp: string;
  label: string;
  help: string;
  placeholder: string;
  kinds: ReadonlyArray<{ kind: string; label: string }>;
  defaultKind: string;
  defaultValue: string;
  /** The server refused the press for this box (`?invalid=document`, §330): shown in its red state. */
  refused: boolean;
}) {
  return (
    <>
      {/*
        Which document, chosen rather than described (§283; Amalia: "we must give some hints on
        the ID document or select ID doc type"). A native select, like the telephone's country
        (§198): it works before hydration and it is the control a phone knows how to open.
      */}
      <TextField
        name={`${name}Type`}
        label={typeLabel}
        helperText={typeHelp}
        select
        required
        defaultValue={defaultKind}
        slotProps={{ select: { native: true } }}
      >
        {kinds.map((entry) => (
          <option key={entry.kind} value={entry.kind}>
            {entry.label}
          </option>
        ))}
      </TextField>
      {/* The id is the name it posts, like the signature boxes': what the refusal's link points at. */}
      <TextField
        id={name}
        name={name}
        error={refused}
        label={label}
        helperText={help}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: 30, pattern: "[A-Za-z0-9][A-Za-z0-9 .\\-/]{2,28}[A-Za-z0-9]" } }}
      />
    </>
  );
}
