import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * No Server Component hands a React element to a client component as a prop (`AGENTS.md` §14.1,
 * which states the rule; §370, which makes this test its enforcement).
 *
 * The rule has cost this repository three outages, each the same defect in a different prop:
 * `FormControlLabel`'s `control` (a 500 on the registration form, `shared/ui/CheckboxField.tsx`),
 * `Chip`'s `icon` (a hydration failure on every chip, `modules/events/ui/GlyphChip.tsx`), and
 * `Stack`'s `divider` (a 500 under `next dev` on every backoffice list, because each list's
 * `loading.tsx` rendered `AdminListSkeleton`, `modules/staff-identity/ui/AdminSkeleton.tsx`). An
 * element crossing the server/client boundary as a prop may arrive as a lazy Flight wrapper rather
 * than an element — past a certain depth of tree, and in development whenever the element's owner
 * or stack row is still waiting on another — and a client component that inspects or clones its
 * prop (`isValidElement`, `cloneElement`, `prop.props.disabled`) then drops it or builds an element
 * with no type. Whether it bites depends on the shape of the tree and on the order the payload
 * streams in, so a page can pass for weeks, and a dev server can pass its first render and fail
 * its second: the defect is only reliably visible in the source, which is where this looks.
 *
 * **What it checks.** Every `.tsx` file under `src/` without `"use client"` is a Server Component
 * module. In each, every JSX attribute whose value holds an element (`divider={<Box />}`,
 * `items={[{ icon: <Star /> }]}`, `x={cond ? <A /> : null}`) — outside a function, which could not
 * cross anyway — is refused when the component receiving it is a client component: anything from
 * `@mui/*`, a `next` client component, or a local module that starts with `"use client"`.
 * `children` is exempt, written as an attribute or nested: React renders a lazy child, and that is
 * the channel the fixes use (`CheckboxField`'s `label`). An element handed to another Server
 * Component is not refused either — nothing crosses there — unless that component forwards it
 * into a client one, which this does not follow; the forwarding file is where to look then.
 *
 * **The fix, when this fails**: pass a string, a name or `children`, and make the element on the
 * client side of the boundary (`GlyphButton` takes `icon="save"`, `GlyphChip` takes
 * `glyph="STAR"`), or draw the thing with CSS (`AdminSkeleton`'s row rules). `ALLOWED` below is
 * for a prop the receiving component provably renders as a child and never inspects — each entry
 * names the line of the installed library that does it, and fails when an upgrade removes it.
 *
 * Source-level, like `action-icons.test.ts` and `client-messages.test.ts`: no DOM, no server.
 */
const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

type Sources = ReadonlyMap<string, string>;

const SOURCES: Sources = new Map(
  sourceFiles(path.join(ROOT, "src")).map((file) => [
    path.relative(ROOT, file).split(path.sep).join("/"),
    readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
  ]),
);

const isClient = (text: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(text);

/** `@/x` and `./x` to the file under `src/` they name; a package is not followed. */
function resolveImport(sources: Sources, fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Packages whose components are client components. MUI marks every component `"use client"`
 * (the payload names `@mui/material/Stack/Stack.mjs` as a client reference); `next/link` and
 * `next/image` are client components too. A package's entry file is not read, because MUI's deep
 * imports resolve to an `index` that re-exports the marked file rather than carrying the marker.
 */
const CLIENT_PACKAGES = [/^@mui\//, /^next\/(?:link|image|form)$/];

/**
 * Local modules that are not `"use client"` themselves but export client components: next-intl's
 * `createNavigation` returns a `Link` that is `BaseLink`, a client reference.
 */
const CLIENT_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  "src/i18n/navigation.ts": ["Link"],
};

/**
 * Props a client component renders as a child and never inspects, so a lazy element in them
 * renders like any other child. `evidence` must match the installed library's own source.
 */
const ALLOWED = [
  {
    from: "@mui/material/Alert",
    prop: "action",
    // `action != null ? _jsx(ActionSlot, { ...actionSlotProps, children: action }) : null`
    source: "node_modules/@mui/material/Alert/Alert.mjs",
    evidence: /_jsx\(ActionSlot, \{\s*\.\.\.actionSlotProps,\s*children: action\s*\}\)/,
  },
] as const;

type Receiver = { from: string; client: boolean };

/** The value imports of a file, by the local name they bind. */
function importsOf(sources: Sources, file: string, source: ts.SourceFile): Map<string, Receiver> {
  const bound = new Map<string, Receiver>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const from = statement.moduleSpecifier.text;
    const target = resolveImport(sources, file, from);
    const moduleIsClient =
      CLIENT_PACKAGES.some((pattern) => pattern.test(from)) || (target !== null && isClient(sources.get(target) ?? ""));
    const exportIsClient = (exported: string) =>
      moduleIsClient || (target !== null && (CLIENT_EXPORTS[target] ?? []).includes(exported));

    if (clause.name) bound.set(clause.name.text, { from, client: exportIsClient("default") });
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        bound.set(element.name.text, { from, client: exportIsClient((element.propertyName ?? element.name).text) });
      }
    }
  }
  return bound;
}

/** Whether an expression holds a JSX element anywhere outside a function it contains. */
function holdsElement(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, (child) => (holdsElement(child) ? true : undefined)) ?? false;
}

/** The identifier a tag starts with: `Stack` for `<Stack>`, `Foo` for `<Foo.Bar>`. */
function tagRoot(tag: ts.JsxTagNameExpression): string | null {
  let expression: ts.Node = tag;
  while (ts.isPropertyAccessExpression(expression)) expression = expression.expression;
  return ts.isIdentifier(expression) ? expression.text : null;
}

/** `file:line <Component prop>` for every element handed to a client component as a prop. */
function findings(sources: Sources): string[] {
  const found: string[] = [];
  for (const [file, text] of sources) {
    if (!file.endsWith(".tsx") || isClient(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = importsOf(sources, file, source);

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const root = tagRoot(node.tagName);
        const receiver = root ? imports.get(root) : undefined;
        if (receiver?.client) {
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
            if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) continue;
            const prop = attribute.name.getText(source);
            if (prop === "children" || !holdsElement(attribute.initializer.expression)) continue;
            if (ALLOWED.some((allowed) => allowed.from === receiver.from && allowed.prop === prop)) continue;
            const line = source.getLineAndCharacterOfPosition(attribute.getStart(source)).line + 1;
            found.push(`${file}:${line} <${node.tagName.getText(source)} ${prop}> (from "${receiver.from}")`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("AGENTS.md §14.1 no Server Component hands an element to a client component as a prop (§370)", () => {
  it("finds none in src/", () => {
    expect(findings(SOURCES)).toEqual([]);
  });

  it("allows a prop only where the installed library renders it as a child", () => {
    for (const allowed of ALLOWED) {
      const text = readFileSync(path.join(ROOT, allowed.source), "utf8");
      expect(text, `${allowed.from} no longer renders \`${allowed.prop}\` as a child`).toMatch(allowed.evidence);
    }
  });

  describe("the detector itself", () => {
    const check = (files: Record<string, string>) => findings(new Map(Object.entries(files)));
    const STACK = `import Box from "@mui/material/Box";\nimport Stack from "@mui/material/Stack";\n`;

    it("refuses the divider that took down the backoffice lists under next dev", () => {
      expect(
        check({ "src/a.tsx": `${STACK}export function A() {\n  return <Stack divider={<Box />}><Box /></Stack>;\n}\n` }),
      ).toEqual([`src/a.tsx:4 <Stack divider> (from "@mui/material/Stack")`]);
    });

    it("refuses an element inside an array, an object or a conditional, and into a local client component", () => {
      const found = check({
        "src/ui/Menu.tsx": `"use client";\nexport default function Menu(props: { items: unknown }) { return null; }\n`,
        "src/a.tsx": [
          `import Chip from "@mui/material/Chip";`,
          `import Menu from "./ui/Menu";`,
          `export function A({ on }: { on: boolean }) {`,
          `  return <><Menu items={[{ icon: <b /> }]} /><Chip icon={on ? <i /> : undefined} /></>;`,
          `}`,
        ].join("\n"),
      });
      expect(found).toEqual([`src/a.tsx:4 <Menu items> (from "./ui/Menu")`, `src/a.tsx:4 <Chip icon> (from "@mui/material/Chip")`]);
    });

    it("lets children, functions, strings, server-to-server props and client files through", () => {
      expect(
        check({
          "src/ui/Card.tsx": `export default function Card(props: { aside: unknown }) { return null; }\n`,
          "src/a.tsx": [
            STACK,
            `import Card from "./ui/Card";`,
            `import { Suspense } from "react";`,
            `export function A() {`,
            `  return <Suspense fallback={<Box />}><Card aside={<Box />} /><Stack children={<Box />} spacing={2} /><Stack sx={{ p: 1 }}>{<Box />}</Stack></Suspense>;`,
            `}`,
          ].join("\n"),
          "src/b.tsx": `"use client";\n${STACK}export function B() {\n  return <Stack divider={<Box />} />;\n}\n`,
        }),
      ).toEqual([]);
    });
  });
});
