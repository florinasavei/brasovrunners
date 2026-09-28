"use client";

import Box, { type BoxProps } from "@mui/material/Box";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { createContext, type InputHTMLAttributes, type ReactNode, useContext } from "react";
import QuietHelp from "@/shared/ui/QuietHelp";
import { fieldId } from "./outcome";

/**
 * What a refused submit typed, handed back to every box (§315). Stateful islands key on
 * `generation` to re-mount from it. `values === null`: no refusal yet.
 */
type Recall = {
  values: Readonly<Record<string, readonly string[]>> | null;
  /** The field names the refusal was about, so a box can mark itself. */
  fields: readonly string[];
  generation: number;
  /** "Check this field", already translated. */
  fieldError: string;
  /** Id prefix when the form shares a page with a namesake. */
  scope?: string;
};

const RecallContext = createContext<Recall>({ values: null, fields: [], generation: 0, fieldError: "" });

export function RecallProvider({ value, children }: { value: Recall; children: ReactNode }) {
  return <RecallContext.Provider value={value}>{children}</RecallContext.Provider>;
}

export function useRecall() {
  const recall = useContext(RecallContext);
  return {
    /** `false` on first paint. */
    has: recall.values !== null,
    generation: recall.generation,
    /** The first posted value under this name, or `undefined` when it was not posted (an unticked box). */
    value: (name: string): string | undefined => recall.values?.[name]?.[0],
    /** A checkbox group's values. */
    all: (name: string): readonly string[] | undefined => recall.values?.[name],
    /** Every posted name, for an island whose boxes are numbered (`event.schedule[3].date`). */
    names: (): string[] => Object.keys(recall.values ?? {}),
    named: (name: string): boolean => recall.fields.includes(name),
    /** The id the refusal summary links to. */
    idOf: (name: string): string => fieldId(name, recall.scope),
    fieldError: recall.fieldError,
  };
}

/** A recalled JSON field, parsed; `fallback` when it is not JSON. */
export function recalledJson(value: string | undefined, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * A `TextField` that comes back filled after a refused submit, with an id from its name for the
 * refusal summary (§47). Keyed on the generation so a MUI select shows the recalled value too.
 */
export default function RecallField({
  name,
  helpMore,
  ...props
}: TextFieldProps & {
  name: string;
  /** The «?» tooltip after the helper line (§511); a string so a Server Component may pass it (§370). */
  helpMore?: string;
}) {
  const recall = useRecall();
  const recalled = recall.value(name);
  const named = recall.named(name);
  const help = named && recall.fieldError ? recall.fieldError : props.helperText;
  return (
    <TextField
      key={recall.generation}
      id={props.id ?? recall.idOf(name)}
      name={name}
      {...props}
      defaultValue={recalled ?? props.defaultValue}
      error={props.error || named}
      helperText={
        helpMore ? (
          <>
            {help}
            <QuietHelp text={helpMore} />
          </>
        ) : (
          help
        )
      }
    />
  );
}

/**
 * A box for a value meant to be typed again (`NEVER_KEPT`: an erase's title, a legal phrase, a
 * name; §180, §151, §315): like `RecallField` but never reads its value back, empty after every
 * refusal. The page's help stays beside "check this field", since it says what to type (§47).
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
 * A hidden field holding what the refused submit posted. For the version guard (§36): a fresh
 * version under recalled boxes would let the next press overwrite a colleague without a CONFLICT.
 */
export function RecallHidden({ name, value }: { name: string; value: string | number }) {
  const recall = useRecall();
  return <input type="hidden" name={name} value={recall.value(name) ?? String(value)} />;
}

/**
 * A fold that opens itself after every refusal, so recalled boxes inside it are not hidden
 * (a re-rendered `<details>` arrives closed).
 */
export function RecallDetails({ children, sx }: { children: ReactNode; sx?: BoxProps["sx"] }) {
  const recall = useRecall();
  return (
    <Box component="details" key={recall.generation} open={recall.has || undefined} sx={sx}>
      {children}
    </Box>
  );
}

/** A plain checkbox posting `on` that comes back as it was ticked (§315). */
export function RecallCheckbox({
  name,
  defaultChecked,
  ...rest
}: { name: string; defaultChecked?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "defaultChecked" | "type">) {
  const recall = useRecall();
  const checked = recall.has ? recall.value(name) === "on" : defaultChecked;
  return <input key={recall.generation} type="checkbox" name={name} value="on" defaultChecked={checked} {...rest} />;
}

/** A plain radio button that comes back as it was ticked. */
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
