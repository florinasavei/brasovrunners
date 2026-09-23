import { z } from "zod";

/**
 * The HTML constraint attributes a Zod rule already implies (`DECISIONS.md` §315).
 *
 * The owner: "nu ar trebui sa pot crea evenimentul daca am campuri invalide!" A rule the server
 * refuses is a rule the browser can refuse first — `required`, `maxLength`, `pattern`,
 * `type="url"`, `min`/`max` — and native constraint validation works with JavaScript off, which
 * is why it is the platform's answer and not a library's (§47). What must not happen is a
 * second, hand-kept list of the same rules that drifts the day one of them changes; so the
 * attributes are read **off the schema**: its checks, its wrappers, and the `html` metadata a
 * schema declares where a rule lives in a closure the walker cannot see (a `refine`).
 *
 * What it reads:
 *
 *   - `required`: the schema refuses the empty string, which is what an empty box posts.
 *   - `minLength` / `maxLength`: a string's `min` and `max` checks. A minimum of one is
 *     `required` and is not repeated.
 *   - `pattern`: a string's `regex` check, with the anchors stripped — an HTML pattern is
 *     anchored by the browser.
 *   - `type`: `email` and `url` string formats; `number` for a number schema.
 *   - `min` / `max` / `step`: a number's bounds and integer check.
 *   - `html` metadata (`schema.meta({ html: { ... } })`): merged last, so a schema whose rule is
 *     a `refine` can still say what it wants of the box — `optionalWholeNumber` in
 *     `content/events/fields.ts` declares its bounds this way.
 *
 * Wrappers — optional, nullable, default, pipe, union — are looked through; a checkbox, a rich
 * text and anything else that is not a box is the caller's business and never asks.
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
  /** `z.email()` and `z.url()` are strings with a format of their own rather than a check. */
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

/** `^…$` off, because the browser anchors an HTML pattern itself. */
function htmlPattern(regex: RegExp): string {
  return regex.source.replace(/^\^/, "").replace(/\$$/, "");
}

function readChecks(def: Def, into: HtmlConstraints): void {
  for (const check of def.checks ?? []) {
    const c = check._zod.def;
    switch (c.check) {
      case "min_length":
        if (typeof c.minimum === "number" && c.minimum > 1) into.minLength = c.minimum;
        break;
      case "max_length":
        if (typeof c.maximum === "number") into.maxLength = c.maximum;
        break;
      case "string_format":
        if (c.format === "regex" && c.pattern instanceof RegExp) into.pattern = htmlPattern(c.pattern);
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
      // A pipe into a number schema (`z.string().transform(Number).pipe(z.number().min(0))`)
      // carries its bounds on the far side; a pipe into a transform carries nothing readable.
      if (defOf(def.out)?.type !== "transform") walk(def.out, into, depth + 1);
      break;
    case "union":
      for (const option of def.options ?? []) walk(option, into, depth + 1);
      break;
    default:
      break;
  }

  // Declared last, so it wins over what the checks said: the schema knows its own box best.
  const meta = z.globalRegistry.get(schema as z.ZodType) as HtmlMeta | undefined;
  if (meta?.html) Object.assign(into, meta.html);
}

/**
 * The attributes for the box behind one schema, or `{}` when the schema has nothing to say.
 *
 * `required` is asked of the schema directly rather than inferred from the presence of
 * `optional()`: does it refuse what an empty box arrives as? That is `""` for an action that
 * hands the posted string on as it is (the event form), and `undefined` for one that turns a
 * blank box into "not given" before the schema sees it (`blankIsAbsent` — the staff
 * registration form's optional details, `admin/registrations/actions.ts#optional`). A schema may
 * accept one and refuse the other, which is exactly why the question names which one.
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

/**
 * The same, for one field of an object schema — the shape most `fields.ts` modules export.
 * An unknown field is `{}`: the box renders, the server refuses whatever it posts.
 */
export function constraintsOf<S extends z.ZodObject>(schema: S, field: string, options: ConstraintOptions = {}): HtmlConstraints {
  const shape = schema.shape as Record<string, z.ZodType | undefined>;
  const member = shape[field];
  return member ? htmlConstraints(member, options) : {};
}

/**
 * The props a MUI `TextField` takes them as: `required` on the field, so MUI marks the label and
 * the browser refuses the box; the type on the field; and the whole set on the `<input>` itself
 * through `slotProps.htmlInput`, with whatever the box adds of its own (`inputMode`, say).
 */
export function textFieldConstraints(constraints: HtmlConstraints, extra: Record<string, unknown> = {}) {
  return {
    required: constraints.required,
    type: constraints.type,
    slotProps: { htmlInput: { ...constraints, ...extra } },
  };
}
