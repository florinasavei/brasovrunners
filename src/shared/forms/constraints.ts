import { z } from "zod";

/**
 * The HTML constraint attributes a Zod rule already implies (`DECISIONS.md` §315, §47), read off
 * the schema so the browser's native validation cannot drift from the server's rules.
 *
 * Checks, formats and wrappers are walked; a rule hidden in a `refine` is declared as `html`
 * metadata (`schema.meta({ html: { ... } })`), merged last.
 */
export type HtmlConstraints = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  type?: "text" | "email" | "url" | "number";
  min?: number;
  max?: number;
  step?: number;
};

/** What a schema may declare about its box: `schema.meta({ html: { type: "url", pattern: "https://.*" } })`. */
export type HtmlMeta = { html?: HtmlConstraints };

type Def = {
  type: string;
  /** `z.email()` / `z.url()`: a format, not a check. */
  format?: string;
  checks?: ReadonlyArray<{ _zod: { def: Record<string, unknown> & { check: string } } }>;
  innerType?: unknown;
  in?: unknown;
  out?: unknown;
  options?: readonly unknown[];
};

function defOf(schema: unknown): Def | null {
  const zod = (schema as { _zod?: { def?: Def } } | null)?._zod;
  return zod?.def ?? null;
}

/**
 * Anchors dropped (the browser anchors an HTML pattern), and spaces allowed at either end when the
 * schema trims first, or the browser would refuse what the server accepts (`trim` strips `\s`).
 */
function htmlPattern(regex: RegExp, trimmed: boolean): string {
  const source = regex.source.replace(/^\^/, "").replace(/\$$/, "");
  return trimmed ? `\\s*(?:${source})\\s*` : source;
}

/** Whether an `overwrite` check is `.trim()`: Zod keeps only the function, so try it on " x ". */
function isTrim(check: Record<string, unknown>): boolean {
  if (typeof check.tx !== "function") return false;
  try {
    return (check.tx as (value: string) => unknown)(" x ") === "x";
  } catch {
    return false;
  }
}

function readChecks(def: Def, into: HtmlConstraints): void {
  // Checks run in the order they were chained, so a trim widens only the patterns after it.
  let trimmed = false;
  for (const check of def.checks ?? []) {
    const c = check._zod.def;
    switch (c.check) {
      case "overwrite":
        if (isTrim(c)) trimmed = true;
        break;
      case "min_length":
        if (typeof c.minimum === "number" && c.minimum > 1) into.minLength = c.minimum;
        break;
      case "max_length":
        if (typeof c.maximum === "number") into.maxLength = c.maximum;
        break;
      case "string_format":
        if (c.format === "regex" && c.pattern instanceof RegExp) into.pattern = htmlPattern(c.pattern, trimmed);
        if (c.format === "email") into.type = "email";
        if (c.format === "url") into.type = "url";
        break;
      case "greater_than":
        if (typeof c.value === "number") into.min = c.inclusive === false ? c.value + 1 : c.value;
        break;
      case "less_than":
        if (typeof c.value === "number") into.max = c.inclusive === false ? c.value - 1 : c.value;
        break;
      case "multiple_of":
        if (typeof c.value === "number") into.step = c.value;
        break;
      case "number_format":
        if (typeof c.format === "string" && /int/.test(c.format)) into.step ??= 1;
        break;
      default:
        break;
    }
  }
}

function walk(schema: unknown, into: HtmlConstraints, depth = 0): void {
  const def = defOf(schema);
  if (!def || depth > 12) return;

  switch (def.type) {
    case "string":
      if (def.format === "email") into.type = "email";
      if (def.format === "url") into.type = "url";
      readChecks(def, into);
      break;
    case "number":
      into.type = "number";
      readChecks(def, into);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "nonoptional":
    case "readonly":
    case "catch":
      walk(def.innerType, into, depth + 1);
      break;
    case "pipe":
      walk(def.in, into, depth + 1);
      // A pipe into a number schema carries its bounds on the far side; a transform carries nothing.
      if (defOf(def.out)?.type !== "transform") walk(def.out, into, depth + 1);
      break;
    case "union":
      for (const option of def.options ?? []) walk(option, into, depth + 1);
      break;
    default:
      break;
  }

  // Last, so declared metadata wins over the checks.
  const meta = z.globalRegistry.get(schema as z.ZodType) as HtmlMeta | undefined;
  if (meta?.html) Object.assign(into, meta.html);
}

/**
 * The attributes for the box behind one schema. `required` asks whether the schema refuses what
 * an empty box arrives as: `""`, or `undefined` with `blankIsAbsent`.
 */
export function htmlConstraints(schema: z.ZodType, options: ConstraintOptions = {}): HtmlConstraints {
  const into: HtmlConstraints = {};
  if (!schema.safeParse(options.blankIsAbsent ? undefined : "").success) into.required = true;
  walk(schema, into);
  return into;
}

export type ConstraintOptions = {
  /** The action posts a blank box to the schema as `undefined`, not as `""`. */
  blankIsAbsent?: boolean;
};

/** The same, for one field of an object schema; an unknown field is `{}`. */
export function constraintsOf<S extends z.ZodObject>(schema: S, field: string, options: ConstraintOptions = {}): HtmlConstraints {
  const shape = schema.shape as Record<string, z.ZodType | undefined>;
  const member = shape[field];
  return member ? htmlConstraints(member, options) : {};
}

/** As MUI `TextField` props: `required` and `type` on the field (MUI marks the label), all on the `<input>`. */
export function textFieldConstraints(constraints: HtmlConstraints, extra: Record<string, unknown> = {}) {
  return {
    required: constraints.required,
    type: constraints.type,
    slotProps: { htmlInput: { ...constraints, ...extra } },
  };
}
