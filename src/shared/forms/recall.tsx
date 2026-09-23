"use client";

import Box, { type BoxProps } from "@mui/material/Box";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { createContext, type InputHTMLAttributes, type ReactNode, useContext } from "react";
import { fieldId } from "./outcome";

/**
 * What a refused submit typed, handed back to every box (`DECISIONS.md` §315).
 *
 * `ActionForm` provides it from the outcome the Server Action returned; a field asks for its own
 * name and puts the value back as its `defaultValue`. Islands that hold state of their own — a
 * MUI select, a rich-text editor, the programme's rows — key themselves on `generation`, which
 * changes with every answer, so they re-mount from the recalled values rather than keep what
 * they held before the press.
 *
 * `values === null` means no refusal has happened: every field shows what the page gave it.
 */
type Recall = {
  values: Readonly<Record<string, readonly string[]>> | null;
  /** The field names the refusal was about, so a box can mark itself. */
  fields: readonly string[];
  /** Changes with every refusal; islands with state of their own key on it. */
  generation: number;
  /** "Check this field", already translated, for the box that was named. */
  fieldError: string;
  /** The form's own prefix for the ids its boxes carry, when it shares a page with a namesake. */
  scope?: string;
};

const RecallContext = createContext<Recall>({ values: null, fields: [], generation: 0, fieldError: "" });

export function RecallProvider({ value, children }: { value: Recall; children: ReactNode }) {
  return <RecallContext.Provider value={value}>{children}</RecallContext.Provider>;
}

export function useRecall() {
  const recall = useContext(RecallContext);
  return {
    /** Whether a refusal has been answered at all — `false` on first paint. */
    has: recall.values !== null,
    generation: recall.generation,
    /** The first posted value under this name, or `undefined` when it was not posted (an unticked box). */
    value: (name: string): string | undefined => recall.values?.[name]?.[0],
    /** Every posted value under this name — a checkbox group — or `undefined`. */
    all: (name: string): readonly string[] | undefined => recall.values?.[name],
    /** Every posted name, for an island whose boxes are numbered (`event.schedule[3].date`). */
    names: (): string[] => Object.keys(recall.values ?? {}),
    /** Whether the refusal named this box. */
    named: (name: string): boolean => recall.fields.includes(name),
    /** The id this box carries, which the refusal summary links to (`fieldId`, with the form's scope). */
    idOf: (name: string): string => fieldId(name, recall.scope),
    fieldError: recall.fieldError,
  };
}

/**
 * A recalled rich-text or JSON field, parsed; the page's own document when the recalled string
 * is not JSON (an older browser posting a textarea's contents, say).
 */
export function recalledJson(value: string | undefined, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * A `TextField` that comes back filled after a refused submit.
 *
 * Nothing else about it is different — every prop goes straight through — so a Server Component
 * renders it exactly as it rendered `TextField`, with one addition: the field carries an `id`
 * built from its name, which is what the refusal summary links to (§47).
 *
 * Keyed on the generation so a MUI select, which holds its choice in state of its own, shows
 * the recalled value rather than the one it opened with. A plain input would have followed its
 * `defaultValue` anyway; the key makes the two behave alike.
 */
export default function RecallField({ name, ...props }: TextFieldProps & { name: string }) {
  const recall = useRecall();
  const recalled = recall.value(name);
  const named = recall.named(name);
  return (
    <TextField
      key={recall.generation}
      id={props.id ?? recall.idOf(name)}
      name={name}
      {...props}
      defaultValue={recalled ?? props.defaultValue}
      error={props.error || named}
      helperText={named && recall.fieldError ? recall.fieldError : props.helperText}
    />
  );
}

/**
 * The box for a value that is meant to be typed again (`NEVER_KEPT`): an erase's typed title,
 * a legal version's phrase, a registration's name (§180, §151, §315).
 *
 * `RecallField`'s twin with the one difference that matters: it **never reads its value back**.
 * It still carries the id the refusal summary links to, and still marks itself when the refusal
 * named it — a plain `TextField` got an id MUI made up, so "the typed title does not match" linked
 * nowhere (§47). The page's own help stays under the box beside "check this field", because
 * that help is what says *what* to type (the title, the phrase, the name), and a box emptied on
 * purpose with its instructions replaced would be a guard nobody can pass.
 *
 * Keyed on the generation, so the box is empty after every refusal whatever it held before the
 * press — with JavaScript on as with it off.
 */
export function NeverKeptField({ name, ...props }: Omit<TextFieldProps, "defaultValue" | "value"> & { name: string }) {
  const recall = useRecall();
  const named = recall.named(name);
  return (
    <TextField
      key={recall.generation}
      id={props.id ?? recall.idOf(name)}
      name={name}
      {...props}
      error={props.error || named}
      helperText={
        named && recall.fieldError ? (
          <>
            {recall.fieldError} {props.helperText}
          </>
        ) : (
          props.helperText
        )
      }
    />
  );
}

/**
 * A hidden field whose value is what the refused submit posted, when it posted one.
 *
 * For the version guard (§36): the save carries the version its boxes were rendered from. With
 * JavaScript off, a refused POST re-renders the page from the database while every box is
 * recalled from the press — so a plain hidden input would now hold the colleague's newer version
 * under the edits made against the older one, and the next press would overwrite that colleague
 * without a CONFLICT. The recalled version keeps the boxes and their version together; a reload
 * (which the CONFLICT sentence asks for) is what fetches both fresh.
 */
export function RecallHidden({ name, value }: { name: string; value: string | number }) {
  const recall = useRecall();
  return <input type="hidden" name={name} value={recall.value(name) ?? String(value)} />;
}

/**
 * A fold inside a kept form that opens itself after a refusal.
 *
 * With JavaScript off a refused POST renders the page afresh, and a `<details>` arrives closed:
 * the kept boxes inside it — a registration's erase reason, a hand-set race number — would be
 * back but out of sight, under a summary line that says nothing happened. Keyed on the answer,
 * so every refusal opens it again, even after it was closed by hand.
 */
export function RecallDetails({ children, sx }: { children: ReactNode; sx?: BoxProps["sx"] }) {
  const recall = useRecall();
  return (
    <Box component="details" key={recall.generation} open={recall.has || undefined} sx={sx}>
      {children}
    </Box>
  );
}

/**
 * A plain radio button that comes back as it was ticked: the bib design's picture choices.
 * `defaultChecked` is what the page says; after a refusal it is whether this value was posted.
 */
export function RecallRadio({
  name,
  value,
  defaultChecked,
  ...rest
}: { name: string; value: string; defaultChecked?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "name" | "value" | "defaultChecked" | "type"
>) {
  const recall = useRecall();
  const checked = recall.has ? recall.value(name) === value : defaultChecked;
  return <input key={recall.generation} type="radio" name={name} value={value} defaultChecked={checked} {...rest} />;
}
